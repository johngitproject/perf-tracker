import { toDateKey } from './format.js'

export const emptyMetrics = () => ({
  tradeCount: 0,
  winCount: 0,
  lossCount: 0,
  breakevenCount: 0,
  netProfit: 0,
  grossProfit: 0,
  grossLoss: 0,
  profitFactor: null,
  winRate: null,
  avgWin: null,
  avgLoss: null,
  payoffRatio: null,
  expectancy: null,
  maxDrawdown: null,
  maxDrawdownPct: null,
  sharpe: null,
  sortino: null,
  calmar: null,
  ulcer: null,
  sqn: null,
  kelly: null,
  var95: null,
  avgR: null,
  stdR: null,
  avgExitQuality: null,
  avgEntryQuality: null,
  longestWinStreak: 0,
  longestLossStreak: 0,
})

function sum(arr, fn) {
  return arr.reduce((acc, x) => acc + fn(x), 0)
}

function mean(arr) {
  return arr.length ? sum(arr, (x) => x) / arr.length : 0
}

function sampleStd(arr, m) {
  if (arr.length < 2) return 0
  const v = sum(arr, (x) => (x - m) ** 2) / (arr.length - 1)
  return Math.sqrt(v)
}

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function equityCurve(trades) {
  const sorted = [...trades].sort(
    (a, b) => a.entryTime - b.entryTime || (a.id || 0) - (b.id || 0),
  )
  let cum = 0
  let peak = 0
  return sorted.map((t, i) => {
    cum += t.netProfit
    peak = Math.max(peak, cum)
    return {
      tradeId: t.id,
      idx: i,
      date: t.entryTime,
      cum,
      peak,
      dd$: cum - peak,
      ddPct: peak !== 0 ? (cum - peak) / peak : 0,
    }
  })
}

/**
 * Regroupe les jambes (trades) en opérations de scaling selon la spec :
 * - même Account et même Instrument
 * - même Exit time (± toleranceMs, défaut 1 min)
 * - fenêtres [Entry, Exit] qui se chevauchent / s'enchaînent sans flat
 *   => approximé : intervalles qui se chevauchent à l'instant de sortie commun
 * Retourne { operations, warnings }.
 */
export function groupTradesIntoOperations(trades, toleranceMs = 60 * 1000) {
  const warnings = []
  const valid = []
  for (const t of trades) {
    if (t.entryTime == null || t.exitTime == null || Number.isNaN(Number(t.entryTime)) || Number.isNaN(Number(t.exitTime))) {
      warnings.push(`Trade #${t.tradeNumber || t.id} exclu : Entry/Exit time manquant ou invalide`)
      continue
    }
    valid.push(t)
  }
  // tri par entry pour détecter le chevauchement
  valid.sort((a, b) => a.entryTime - b.entryTime || (a.id || 0) - (b.id || 0))

  const ops = []
  for (const t of valid) {
    let merged = false
    // cherche une opération existante compatible (parcours inverse : la plus récente d'abord)
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]
      if (String(op.accountId) !== String(t.accountId)) continue
      if (String(op.instrument) !== String(t.instrument)) continue
      if (Math.abs(op.exitTime - t.exitTime) > toleranceMs) continue
      // chevauchement : l'entrée du nouveau trade est avant la sortie de l'opération
      // et la sortie du nouveau trade est après l'entrée la plus ancienne de l'opération
      const overlaps = t.entryTime <= op.exitTime && t.exitTime >= op.entryTimeFirst
      // enchaînement sans flat : si les entrées se suivent sans gap > tolerance, on considère continu
      // pour la V1 on accepte overlaps comme critère principal ; l'écart de sortie suffit
      if (!overlaps) continue
      // merge
      op.trades.push(t)
      op.tradeNumbers.push(t.tradeNumber)
      op.entryTimeFirst = Math.min(op.entryTimeFirst, t.entryTime)
      op.exitTime = Math.max(op.exitTime, t.exitTime)
      op.profitTotal += t.netProfit != null ? t.netProfit : (t.profit || 0)
      op.maeAgrege += Math.abs(t.mae || 0)
      op.mfeAgrege += Math.abs(t.mfe || 0)
      merged = true
      break
    }
    if (!merged) {
      ops.push({
        accountId: t.accountId,
        instrument: t.instrument,
        entryTimeFirst: t.entryTime,
        exitTime: t.exitTime,
        profitTotal: t.netProfit != null ? t.netProfit : (t.profit || 0),
        maeAgrege: Math.abs(t.mae || 0),
        mfeAgrege: Math.abs(t.mfe || 0),
        trades: [t],
        tradeNumbers: [t.tradeNumber],
      })
    }
  }
  // tri final par entry_time_first (ordre chronologique réel)
  ops.sort((a, b) => a.entryTimeFirst - b.entryTimeFirst)
  return { operations: ops, warnings }
}

/**
 * Calcule les séries equity réalisée / equity latente par opération.
 * Formules spec :
 *   equity_realisee(i)  = equity_realisee(i-1) + profit_total(i)
 *   pic_realise(i)      = max(pic_realise(i-1), equity_realisee(i))
 *   drawdown_realise(i) = pic_realise(i) - equity_realisee(i)
 *   equity_latente(i)   = equity_realisee(i-1) - mae_agrege(i)
 *   drawdown_latent(i)  = pic_realise(i-1) - equity_latente(i)
 * Retourne { series, operations, maxDrawdownRealise, maxDrawdownLatent, ecart, warnings }
 */
export function latentDrawdownSeries(trades, toleranceMs = 60 * 1000) {
  const { operations, warnings } = groupTradesIntoOperations(trades, toleranceMs)
  if (!operations.length) {
    return { series: [], operations, maxDrawdownRealise: 0, maxDrawdownLatent: 0, ecart: 0, warnings }
  }
  let equityRealisee = 0
  let picRealise = 0
  let maxDDRealise = 0
  let maxDDLatent = 0
  const series = operations.map((op, idx) => {
    const prevEquity = equityRealisee
    const prevPic = picRealise
    equityRealisee = prevEquity + op.profitTotal
    picRealise = Math.max(prevPic, equityRealisee)
    const drawdownRealise = picRealise - equityRealisee
    const equityLatente = prevEquity - op.maeAgrege
    const drawdownLatent = prevPic - equityLatente
    if (drawdownRealise > maxDDRealise) maxDDRealise = drawdownRealise
    if (drawdownLatent > maxDDLatent) maxDDLatent = drawdownLatent
    return {
      idx,
      date: op.entryTimeFirst,
      exitTime: op.exitTime,
      cum: equityRealisee,
      equityLatente,
      drawdownRealise,
      drawdownLatent,
      maeAgrege: op.maeAgrege,
      mfeAgrege: op.mfeAgrege,
      profitTotal: op.profitTotal,
      tradeNumbers: [...op.tradeNumbers],
      tradesCount: op.trades.length,
      accountId: op.accountId,
      instrument: op.instrument,
      // compat Recharts : dd$ pour l'Area existante
      'dd$': drawdownRealise ? -drawdownRealise : 0,
      op,
    }
  })
  return {
    series,
    operations,
    maxDrawdownRealise: maxDDRealise,
    maxDrawdownLatent: maxDDLatent,
    ecart: maxDDLatent - maxDDRealise,
    warnings,
  }
}

// Compat : ancien nom utilisé par le Dashboard avant spec
export function latentDrawdown(trades, toleranceMs) {
  const res = latentDrawdownSeries(trades, toleranceMs)
  // map vers ancien shape { tradeId, idx, date, latentDD } pour rétrocompat
  const map = []
  for (const p of res.series) {
    for (const tn of p.tradeNumbers) {
      map.push({ tradeId: tn, idx: p.idx, date: p.date, latentDD: p.drawdownLatent })
    }
  }
  return map
}

function computeRiskBase(trades) {
  const posMae = trades
    .map((t) => Math.abs(t.mae || 0))
    .filter((v) => v > 0)
  return median(posMae) || 0
}

function riskForTrade(t, baseRisk) {
  const mae = Math.abs(t.mae || 0)
  return mae > 0 ? mae : baseRisk
}

export function aggregateMetrics(trades) {
  if (!trades.length) return emptyMetrics()

  const wins = trades.filter((t) => t.netProfit > 0)
  const losses = trades.filter((t) => t.netProfit < 0)
  const breakevenCount = trades.length - wins.length - losses.length

  const grossProfit = sum(wins, (t) => t.netProfit)
  const grossLoss = -sum(losses, (t) => t.netProfit)
  const netProfit = sum(trades, (t) => t.netProfit)

  const winRate = wins.length / trades.length
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss
  const kelly =
    Number.isFinite(payoffRatio) && payoffRatio > 0
      ? winRate - (1 - winRate) / payoffRatio
      : null

  const curve = equityCurve(trades)
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (const p of curve) {
    if (p.dd$ < maxDrawdown) maxDrawdown = p.dd$
    if (p.ddPct < maxDrawdownPct) maxDrawdownPct = p.ddPct
  }

  const returns = trades.map((t) => t.netProfit)
  const rMean = mean(returns)
  const rStd = sampleStd(returns, rMean)
  const neg = returns.filter((r) => r < 0)
  const sharpe = rStd > 0 ? rMean / rStd : null
  const sortino = neg.length ? rMean / sampleStd(neg, mean(neg)) : null
  const calmar =
    maxDrawdownPct !== 0 ? netProfit / Math.abs(maxDrawdownPct) : null

  const retracements = curve.map((p) =>
    p.cum < p.peak ? 1 - p.cum / p.peak : 0,
  )
  const ulcer = retracements.length
    ? Math.sqrt(mean(retracements.map((r) => r ** 2))) * 100
    : null

  /* R-multiples (risque = distance Entry → MAE comme proxy) */
  const baseRisk = computeRiskBase(trades)
  const rVals = trades.map((t) => {
    const risk = riskForTrade(t, baseRisk)
    return risk > 0 ? t.netProfit / risk : null
  }).filter((v) => v != null)
  const rMeanVal = mean(rVals)
  const rStdVal = sampleStd(rVals, rMeanVal)
  const sqn =
    rVals.length && rStdVal > 0
      ? (rMeanVal / rStdVal) * Math.sqrt(Math.min(rVals.length, 100))
      : null

  /* VaR journalière 95 % */
  const byDay = groupByDay(trades)
  const dailyPnl = Object.values(byDay).map((arr) => sum(arr, (t) => t.netProfit))
  dailyPnl.sort((a, b) => a - b)
  const var95 =
    dailyPnl.length >= 5
      ? dailyPnl[Math.floor(0.05 * dailyPnl.length)]
      : null

  /* Qualité de sortie & d'entrée */
  const exitQs = trades
    .filter((t) => Math.abs(t.mfe || 0) > 0)
    .map((t) => t.netProfit / Math.abs(t.mfe))
  const entryQs = trades
    .filter((t) => Math.abs(t.mae || 0) > 0)
    .map((t) => {
      const mae = Math.abs(t.mae)
      return t.netProfit / (Math.abs(t.netProfit) + mae)
    })

  const streaks = streakAnalysis(trades)

  return {
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount,
    netProfit,
    grossProfit,
    grossLoss,
    profitFactor,
    winRate,
    avgWin,
    avgLoss,
    payoffRatio,
    expectancy,
    maxDrawdown,
    maxDrawdownPct,
    sharpe,
    sortino,
    calmar,
    ulcer,
    sqn,
    kelly,
    var95,
    avgR: rVals.length ? rMeanVal : null,
    stdR: rVals.length ? rStdVal : null,
    avgExitQuality: exitQs.length ? mean(exitQs) : null,
    avgEntryQuality: entryQs.length ? mean(entryQs) : null,
    longestWinStreak: streaks.longestWin,
    longestLossStreak: streaks.longestLoss,
  }
}

export function groupByDay(trades) {
  const map = {}
  for (const t of trades) {
    const k = toDateKey(t.entryTime)
    ;(map[k] = map[k] || []).push(t)
  }
  return map
}

export function dailySeries(trades) {
  const byDay = groupByDay(trades)
  const dates = Object.keys(byDay).sort()
  let cum = 0
  return dates.map((date) => {
    const pnl = sum(byDay[date], (t) => t.netProfit)
    cum += pnl
    return { date, pnl, cum }
  })
}

export function pnlSeries(trades, bucket = 'day') {
  if (!trades.length) return []
  const byKey = {}
  const keyOf = (ms) => {
    const d = new Date(ms)
    if (bucket === 'week') {
      const dow = (d.getDay() + 6) % 7
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
      return toDateKey(monday.getTime())
    }
    if (bucket === 'month') {
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    }
    return toDateKey(d.getTime())
  }
  const labelOf = (key) => {
    if (bucket === 'month') {
      const [y, m] = key.split('-')
      return `${m}/${y.slice(2)}`
    }
    return key
  }
  for (const t of trades) {
    const k = keyOf(t.entryTime)
    const e = (byKey[k] = byKey[k] || { pnl: 0, count: 0, key: k, label: labelOf(k) })
    e.pnl += t.netProfit
    e.count += 1
  }
  return Object.keys(byKey)
    .sort()
    .map((k) => byKey[k])
}

/**
 * Évolution de l'expectancy par bucket de temps.
 * `bucket` = 'day' | 'week'. Expectancy = (moyenne glissante du P&L net par trade)
 * calculée sur chaque bucket : pnl total du bucket ÷ nombre de trades du bucket.
 * `cum` = expectancy cumulative (moyenne des expectancy des buckets vus jusqu'ici).
 */
export function expectancySeries(trades, bucket = 'day') {
  const byKey = {}
  const keyOf = (ms) => {
    const d = new Date(ms)
    if (bucket === 'week') {
      const dow = (d.getDay() + 6) % 7
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
      return toDateKey(monday.getTime())
    }
    return toDateKey(d.getTime())
  }
  for (const t of trades) {
    const k = keyOf(t.entryTime)
    const e = (byKey[k] = byKey[k] || { pnl: 0, count: 0 })
    e.pnl += t.netProfit
    e.count += 1
  }
  const dates = Object.keys(byKey).sort()
  let cumSum = 0
  return dates.map((dateKey) => {
    const e = byKey[dateKey]
    const expectancy = e.count ? e.pnl / e.count : 0
    cumSum += expectancy
    return {
      dateKey,
      date: new Date(`${dateKey}T00:00:00`).getTime(),
      pnl: e.pnl,
      count: e.count,
      expectancy,
      cum: cumSum,
    }
  })
}

/**
 * Distribution du P&L net par trade : histogramme en bins adaptatifs.
 */
export function pnlDistribution(trades, bins = 20) {
  if (!trades.length) return []
  const values = trades.map((t) => t.netProfit)
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    return [{ from: min, to: max, count: values.length, center: min }]
  }
  const width = (max - min) / bins
  const out = []
  for (let i = 0; i < bins; i++) {
    const from = min + i * width
    const to = i === bins - 1 ? max : from + width
    const count = values.filter((v) => v >= from && v <= to).length
    out.push({ from, to, count, center: (from + to) / 2 })
  }
  return out
}

export function streakAnalysis(trades) {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime)
  let curType = null
  let curLen = 0
  let curAmt = 0
  let longestWin = 0
  let longestLoss = 0
  const streaks = []
  for (const t of sorted) {
    const type = t.netProfit > 0 ? 'win' : t.netProfit < 0 ? 'loss' : 'breakeven'
    if (type === curType) {
      curLen++
      curAmt += t.netProfit
    } else {
      if (curLen > 0) {
        streaks.push({ type: curType, length: curLen, amount: curAmt })
        if (curType === 'win' && curLen > longestWin) longestWin = curLen
        if (curType === 'loss' && curLen > longestLoss) longestLoss = curLen
      }
      curType = type
      curLen = 1
      curAmt = t.netProfit
    }
  }
  if (curLen > 0) {
    streaks.push({ type: curType, length: curLen, amount: curAmt })
    if (curType === 'win' && curLen > longestWin) longestWin = curLen
    if (curType === 'loss' && curLen > longestLoss) longestLoss = curLen
  }
  return { longestWin, longestLoss, streaks }
}

export function rMultiples(trades) {
  const baseRisk = computeRiskBase(trades)
  return trades.map((t) => {
    const risk = riskForTrade(t, baseRisk)
    return { tradeId: t.id, r: risk > 0 ? t.netProfit / risk : null }
  }).filter((x) => x.r != null)
}

export function exitQualitySeries(trades) {
  return trades
    .filter((t) => Math.abs(t.mfe || 0) > 0)
    .sort((a, b) => a.entryTime - b.entryTime || (a.id || 0) - (b.id || 0))
    .map((t, i) => ({
      tradeId: t.id,
      idx: i,
      date: t.entryTime,
      score: t.netProfit / Math.abs(t.mfe),
    }))
}

export function entryQualitySeries(trades) {
  return trades
    .filter((t) => Math.abs(t.mae || 0) > 0)
    .sort((a, b) => a.entryTime - b.entryTime)
    .map((t) => ({
      tradeId: t.id,
      date: t.entryTime,
      mae: Math.abs(t.mae),
      netProfit: t.netProfit,
      score: t.netProfit / (Math.abs(t.netProfit) + Math.abs(t.mae)),
    }))
}

export function heatmapGrid(trades) {
  const grid = []
  for (let d = 0; d < 7; d++) {
    grid[d] = []
    for (let h = 0; h < 12; h++) grid[d][h] = { pnl: 0, count: 0 }
  }
  for (const t of trades) {
    const d = new Date(t.entryTime)
    const dow = d.getDay()
    const bucket = Math.min(11, Math.floor(d.getHours() / 2))
    grid[dow][bucket].pnl += t.netProfit
    grid[dow][bucket].count += 1
  }
  return grid
}

export function disciplineCorrelation(journals, trades) {
  const dailyPnl = {}
  for (const [date, arr] of Object.entries(groupByDay(trades))) {
    dailyPnl[date] = sum(arr, (t) => t.netProfit)
  }
  const byPlan = {}
  const byEmotion = {}
  for (const j of journals) {
    const pnl = dailyPnl[j.date] || 0
    const hasTrades = j.date in dailyPnl
    if (j.planRespected) {
      const key = j.planRespected
      const e = (byPlan[key] = byPlan[key] || { count: 0, pnl: 0, daysWithTrades: 0 })
      e.count += 1
      if (hasTrades) {
        e.pnl += pnl
        e.daysWithTrades += 1
      }
    }
    if (j.emotionTag) {
      const key = j.emotionTag
      const e = (byEmotion[key] = byEmotion[key] || { count: 0, pnl: 0, daysWithTrades: 0 })
      e.count += 1
      if (hasTrades) {
        e.pnl += pnl
        e.daysWithTrades += 1
      }
    }
  }
  return { byPlan, byEmotion }
}

export function dailyPnlStats(trades) {
  const byDay = groupByDay(trades)
  const dates = Object.keys(byDay).sort()
  if (!dates.length) return { daily: [], median: null, mean: null, best: null, worst: null, avg: null }
  const daily = dates.map((date) => {
    const pnl = sum(byDay[date], (t) => t.netProfit)
    return { date, pnl, count: byDay[date].length }
  })
  const pnls = daily.map((d) => d.pnl)
  const avg = mean(pnls)
  return { daily, median: median(pnls), mean: avg, avg, best: Math.max(...pnls), worst: Math.min(...pnls) }
}

export function drawdownDurations(trades) {
  const curve = equityCurve(trades)
  if (!curve.length) return { durations: [], avg: null, max: null }
  const durations = []
  let peakIdx = 0
  let peakValue = curve[0].cum
  let inDD = false
  let ddStartIdx = -1
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i]
    if (p.cum > peakValue) {
      if (inDD) {
        const days = (p.date - curve[ddStartIdx].date) / (1000 * 60 * 60 * 24)
        durations.push(Math.max(0, days))
        inDD = false
      }
      peakValue = p.cum
      peakIdx = i
    } else if (p.cum < peakValue && !inDD) {
      inDD = true
      ddStartIdx = peakIdx
    }
  }
  if (!durations.length) return { durations, avg: null, max: null }
  return { durations, avg: mean(durations), max: Math.max(...durations) }
}

export function maeMfeStats(trades, seuil = null) {
  if (!trades.length) return { maeWin: null, maeLoss: null, mfeMean: null, edgeRatio: null, captured: null, seuilStats: null }
  const wins = trades.filter((t) => t.netProfit > 0)
  const losses = trades.filter((t) => t.netProfit < 0)
  const maeWin = wins.length ? mean(wins.map((t) => Math.abs(t.mae || 0))) : null
  const maeLoss = losses.length ? mean(losses.map((t) => Math.abs(t.mae || 0))) : null
  const mfeMean = trades.length ? mean(trades.map((t) => Math.abs(t.mfe || 0))) : null
  const maeMean = trades.length ? mean(trades.map((t) => Math.abs(t.mae || 0))) : null
  const edgeRatio = maeMean && maeMean !== 0 ? mfeMean / maeMean : null
  const withMfe = trades.filter((t) => Math.abs(t.mfe || 0) > 0)
  const captured = withMfe.length ? mean(withMfe.map((t) => t.netProfit / Math.abs(t.mfe))) : null
  let seuilStats = null
  if (seuil != null && String(seuil) !== '') {
    const n = Number(String(seuil).replace(',', '.'))
    if (Number.isFinite(n)) {
      const below = trades.filter((t) => Math.abs(t.mae || 0) <= n)
      const above = trades.filter((t) => Math.abs(t.mae || 0) > n)
      seuilStats = {
        seuil: n,
        below: below.length,
        above: above.length,
        winBelow: below.filter((t) => t.netProfit > 0).length,
        winAbove: above.filter((t) => t.netProfit > 0).length,
      }
    }
  }
  return { maeWin, maeLoss, mfeMean, maeMean, edgeRatio, captured, seuilStats }
}

export function temporalStats(trades) {
  const buckets = [
    { key: '09h30-11h', label: '09h30–11h00', from: 9.5, to: 11 },
    { key: '11h-14h', label: '11h00–14h00', from: 11, to: 14 },
    { key: '14h-16h', label: '14h00–16h00', from: 14, to: 16 },
  ]
  const byBucket = {}
  for (const b of buckets) byBucket[b.key] = { ...b, pnl: 0, count: 0, wins: 0 }
  const byDow = Array.from({ length: 7 }, (_, i) => ({ dow: i, pnl: 0, count: 0 }))
  for (const t of trades) {
    const d = new Date(t.entryTime)
    const h = d.getHours() + d.getMinutes() / 60
    for (const b of buckets) {
      if (h >= b.from && h < b.to) {
        byBucket[b.key].pnl += t.netProfit
        byBucket[b.key].count += 1
        if (t.netProfit > 0) byBucket[b.key].wins += 1
        break
      }
    }
    const dow = d.getDay()
    byDow[dow].pnl += t.netProfit
    byDow[dow].count += 1
  }
  const bucketArr = buckets.map((b) => byBucket[b.key])
  return { buckets: bucketArr, byDow }
}

export function checklistCompliance(journals) {
  const checked = {}
  const total = {}
  for (const j of journals) {
    const resp = j.checklist || {}
    for (const [ruleId, val] of Object.entries(resp)) {
      checked[ruleId] = (checked[ruleId] || 0) + (val ? 1 : 0)
      total[ruleId] = (total[ruleId] || 0) + 1
    }
  }
  return { checked, total }
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quantileSorted(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Simulation Monte Carlo par bootstrap (avec remise) sur les netProfit par trade.
 * - nSim : 100..10000 (défaut 5000), horizon : nb de trades simulés (défaut 200)
 * - seuil de ruine = maxDrawdown du compte (montant positif, ex 2000)
 * - seed : rejouabilité (vide = aléatoire)
 * Suppose les trades i.i.d (ignore streaks/régimes) — noté dans l'UI.
 */
export function monteCarlo(trades, { nSim = 5000, horizon = 200, maxDrawdown = null, target = null, seed = null } = {}) {
  const empty = {
    empty: true,
    nSim: 0,
    horizon: 0,
    seedUsed: null,
    finalPnls: [],
    maxDDs: [],
    fan: [],
    medianFinal: null,
    p5Final: null,
    p95Final: null,
    probRuin: null,
    probTarget: null,
    medianMaxDD: null,
  }
  if (!Array.isArray(trades) || !trades.length) return empty
  const sims = Math.max(100, Math.min(10000, Math.round(Number(nSim) || 5000)))
  const steps = Math.max(10, Math.min(2000, Math.round(Number(horizon) || 200)))
  const pnls = trades.map((t) => (Number.isFinite(t.netProfit) ? t.netProfit : 0))
  const seedUsed =
    seed === '' || seed == null
      ? (Math.random() * 4294967296) >>> 0
      : Number(String(seed).replace(',', '.')) >>> 0 || (Math.random() * 4294967296) >>> 0
  const rand = mulberry32(seedUsed)
  const n = pnls.length
  const cols = Array.from({ length: steps }, () => [])
  const finalPnls = new Array(sims)
  const maxDDs = new Array(sims)
  for (let s = 0; s < sims; s++) {
    let cum = 0
    let peak = 0
    let worst = 0
    for (let i = 0; i < steps; i++) {
      cum += pnls[Math.floor(rand() * n)]
      if (cum > peak) peak = cum
      const dd = peak - cum
      if (dd > worst) worst = dd
      cols[i].push(cum)
    }
    finalPnls[s] = cum
    maxDDs[s] = worst
  }
  const fan = cols.map((col, i) => {
    col.sort((a, b) => a - b)
    return {
      step: i + 1,
      p5: quantileSorted(col, 0.05),
      p25: quantileSorted(col, 0.25),
      p50: quantileSorted(col, 0.5),
      p75: quantileSorted(col, 0.75),
      p95: quantileSorted(col, 0.95),
    }
  })
  const sortedFinal = [...finalPnls].sort((a, b) => a - b)
  const ruinLevel = maxDrawdown != null && Number.isFinite(Number(maxDrawdown)) ? Number(maxDrawdown) : null
  const targetLevel = target != null && target !== '' && Number.isFinite(Number(target)) ? Number(target) : null
  return {
    empty: false,
    nSim: sims,
    horizon: steps,
    seedUsed,
    finalPnls,
    maxDDs,
    fan,
    medianFinal: quantileSorted(sortedFinal, 0.5),
    p5Final: quantileSorted(sortedFinal, 0.05),
    p95Final: quantileSorted(sortedFinal, 0.95),
    probRuin: ruinLevel != null ? finalPnls.filter((v) => v <= -ruinLevel).length / sims : null,
    probTarget: targetLevel != null ? finalPnls.filter((v) => v >= targetLevel).length / sims : null,
    medianMaxDD: median(maxDDs),
  }
}