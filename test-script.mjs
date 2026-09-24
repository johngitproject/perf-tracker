import {
  parseCsvFile,
  parseFrenchNumber,
  parseTradeDate,
  buildTradeRecords,
  detectColumnMap,
} from './src/csv.js'
import { aggregateMetrics, equityCurve, expectancySeries, pnlDistribution, exitQualitySeries, monteCarlo } from './src/metrics.js'

let failures = 0
function assert(cond, label, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}`, extra ?? '')
  }
}

console.log('— parseFrenchNumber —')
assert(parseFrenchNumber('58,00 $') === 58, '58,00 $ → 58')
assert(parseFrenchNumber('-25,00 $') === -25, '-25,00 $ → -25')
assert(parseFrenchNumber('1.234,50 $') === 1234.5, '1.234,50 $ → 1234.5')
assert(parseFrenchNumber(' 3,5\u00A0$') === 3.5, 'NBSP espace insécable')
assert(parseFrenchNumber('1234.5') === 1234.5, 'format US 1234.5')
assert(parseFrenchNumber('0,00 $') === 0, '0,00 $ → 0')
assert(parseFrenchNumber('') === null, 'vide → null')

console.log('— parseTradeDate —')
const d = parseTradeDate('10/08/2026 14:47')
assert(d && d.getDate() === 10 && d.getMonth() === 7 && d.getFullYear() === 2026, '10/08/2026 14:47 → 10 aout 2026', d && d.toString())
assert(d && d.getHours() === 14 && d.getMinutes() === 47, 'heure 14:47')
assert(parseTradeDate('01/01/2025') && parseTradeDate('01/01/2025').getDate() === 1, 'date seule')

const csv = `Trade number\tInstrument\tAccount\tStrategy\tMarket pos.\tQty\tEntry price\tExit price\tEntry time\tExit time\tEntry name\tExit name\tProfit\tCum. net profit\tCommission\tClearing Fee\tExchange Fee\tIP Fee\tNFA Fee\tMAE\tMFE\tETD\tBars
1\tNQ\tDemo\t\tLong\t1\t22000.00\t22050.00\t10/08/2026 14:47\t10/08/2026 15:02\t\t\t"58,00 $"\t"58,00 $"\t"-2,00 $"\t"0,00 $"\t"-1,00 $"\t"-0,20 $"\t"-0,10 $"\t"-25,00 $"\t"75,00 $"\t0,35\t15
2\tNQ\tDemo\t\tShort\t1\t22050.00\t21990.00\t10/08/2026 15:10\t10/08/2026 15:25\t\t\t"40,00 $"\t"98,00 $"\t"-2,00 $"\t"0,00 $"\t"-1,00 $"\t"-0,20 $"\t"-0,10 $"\t"-15,00 $"\t"60,00 $"\t0,30\t20
3\tMNQ\tDemo\t\tLong\t2\t100.00\t99.20\t11/08/2026 09:05\t11/08/2026 09:20\t\t\t"-30,00 $"\t"68,00 $"\t"-2,00 $"\t"0,00 $"\t"-1,00 $"\t"-0,20 $"\t"-0,10 $"\t"-18,00 $"\t"20,00 $"\t0,40\t12
4\tNQ\tDemo\t\tLong\t1\t22050.00\t22000.00\t11/08/2026 10:00\t11/08/2026 10:30\t\t\t"-60,00 $"\t"8,00 $"\t"-2,00 $"\t"0,00 $"\t"-1,00 $"\t"-0,20 $"\t"-0,10 $"\t"-60,00 $"\t"10,00 $"\t0,25\t18
`

console.log('— parseCsvFile —')
const res = parseCsvFile(csv)
assert(res.ok === true, 'parse ok')
assert(res.trades.length === 4, `4 trades (got ${res.trades.length})`)
assert(res.missing.length === 0, 'aucune colonne obligatoire manquante')
assert(res.warnings.length === 0, `0 warnings (got ${res.warnings.length})`)
assert(res.parseErrors.length === 0, '0 parse errors')

console.log('— valeurs françaises —')
const t0 = res.trades[0]
assert(t0.profit === 58, `profit 58 (got ${t0.profit})`)
assert(t0.commission === -2, `commission -2 (got ${t0.commission})`)
assert(t0.mae === -25, `mae -25 (got ${t0.mae})`)
assert(t0.mfe === 75, `mfe 75 (got ${t0.mfe})`)
assert(t0.qty === 1, `qty 1 (got ${t0.qty})`)
assert(t0.instrument === 'NQ', 'instrument NQ')
assert(t0.marketPos === 'Long', 'marketPos Long')

console.log('— records + netProfit —')
const records = buildTradeRecords(res.trades, 1, 999, Date.now())
assert(Math.abs(records[0].netProfit - 58) < 1e-9, `netProfit 1 = 58 (got ${records[0].netProfit})`)
assert(Math.abs(records[1].netProfit - 40) < 1e-9, `netProfit 2 = 40 (got ${records[1].netProfit})`)
assert(Math.abs(records[2].netProfit - (-30)) < 1e-9, `netProfit 3 = -30 (got ${records[2].netProfit})`)
assert(Math.abs(records[3].netProfit - (-60)) < 1e-9, `netProfit 4 = -60 (got ${records[3].netProfit})`)
assert(records[0].entryTime === res.trades[0].entryTime.getTime(), 'entryTime converti en ms')

console.log('— métriques —')
const m = aggregateMetrics(records)
assert(m.tradeCount === 4, `tradeCount 4 (got ${m.tradeCount})`)
assert(m.winCount === 2 && m.lossCount === 2, '2W / 2L')
assert(Math.abs(m.netProfit - 8) < 1e-9, `net total = 8 (got ${m.netProfit})`)
const pf = (58 + 40) / (30 + 60)
assert(Math.abs(m.profitFactor - pf) < 1e-9, `profit factor ${pf.toFixed(3)} (got ${m.profitFactor})`)
assert(Math.abs(m.winRate - 0.5) < 1e-9, `win rate 0.5 (got ${m.winRate})`)
assert(Math.abs(m.maxDrawdown - (-90)) < 1e-9, `maxDD = -90 (got ${m.maxDrawdown})`)
console.log(`  expectancy: ${m.expectancy.toFixed(2)}, sharpe: ${m.sharpe}, avgR: ${m.avgR}, sqn: ${m.sqn}`)

console.log('— equityCurve (un point = un trade, cumul chronologique) —')
const curve = equityCurve(records)
assert(curve.length === 4, `4 points (got ${curve.length})`)
assert(curve[0].idx === 0 && curve[3].idx === 3, 'idx 0..3')
assert(Math.abs(curve[0].cum - 58) < 1e-9, `cum 1 = 58 (got ${curve[0].cum})`)
assert(Math.abs(curve[1].cum - 98) < 1e-9, `cum 2 = 98 (got ${curve[1].cum})`)
assert(Math.abs(curve[2].cum - 68) < 1e-9, `cum 3 = 68 (got ${curve[2].cum})`)
assert(Math.abs(curve[3].cum - 8) < 1e-9, `cum 4 = 8 (got ${curve[3].cum})`)
assert(Math.abs(curve[3].dd$ - (-90)) < 1e-9, `dd$ final = -90 (got ${curve[3].dd$})`)
assert(curve[0].date === records[0].entryTime, 'date = entryTime du trade')

console.log('— exitQualitySeries (par trade, indexé) —')
const exitQ = exitQualitySeries(records)
assert(exitQ.length === 4, `4 points (got ${exitQ.length})`)
assert(exitQ[0].idx === 0 && exitQ[3].idx === 3, 'idx 0..3')
assert(Math.abs(exitQ[0].score - 58 / 75) < 1e-9, `score 1 = ${(58 / 75).toFixed(4)} (got ${exitQ[0].score})`)
assert(Math.abs(exitQ[1].score - 40 / 60) < 1e-9, `score 2 = ${(40 / 60).toFixed(4)} (got ${exitQ[1].score})`)
assert(Math.abs(exitQ[2].score - (-30) / 20) < 1e-9, `score 3 = ${(-30 / 20).toFixed(4)} (got ${exitQ[2].score})`)
const exitQNoMfe = exitQualitySeries(records.map((t) => ({ ...t, mfe: 0 })))
assert(exitQNoMfe.length === 0, 'sans MFE → []')

console.log('— expectancySeries (par jour puis par semaine) —')
const expDay = expectancySeries(records, 'day')
assert(expDay.length === 2, `2 jours (got ${expDay.length})`)
assert(Math.abs(expDay[0].expectancy - (58 + 40) / 2) < 1e-9, `jour 1 expectancy = 49 (got ${expDay[0].expectancy})`)
assert(Math.abs(expDay[1].expectancy - (-45)) < 1e-9, `jour 2 expectancy = -45 (got ${expDay[1].expectancy})`)
assert(Math.abs(expDay[1].cum - (49 - 45)) < 1e-9, `cum expectancy = 4 (got ${expDay[1].cum})`)
assert(expDay[0].count === 2 && expDay[0].pnl === 98, 'jour 1 : 2 trades, pnl 98')
const expWeek = expectancySeries(records, 'week')
assert(expWeek.length === 1, '1 semaine (trades sur 2 jours consécutifs)')

console.log('— pnlDistribution —')
const pnlH = pnlDistribution(records, 4)
assert(pnlH.length === 4, `4 bins (got ${pnlH.length})`)
const totalCount = pnlH.reduce((s, b) => s + b.count, 0)
assert(totalCount === 4, `total 4 (got ${totalCount})`)
const pnlH2 = pnlDistribution([records[0], records[0]], 20)
assert(pnlH2.length === 1 && pnlH2[0].count === 2, 'valeurs identiques → 1 bin')
const pnlH3 = pnlDistribution([])
assert(pnlH3.length === 0, 'vide → []')

console.log('— detectColumnMap —')
const headers = ['Trade number', 'Instrument', 'Account', 'Strategy', 'Market pos.', 'Qty', 'Entry price', 'Exit price', 'Entry time', 'Exit time', 'Entry name', 'Exit name', 'Profit', 'Cum. net profit', 'Commission', 'Clearing Fee', 'Exchange Fee', 'IP Fee', 'NFA Fee', 'MAE', 'MFE', 'ETD', 'Bars']
const cm = detectColumnMap(headers)
assert(cm.mapping.tradeNumber === 0, 'tradeNumber→0')
assert(cm.mapping.profit === 12, 'profit→12')
assert(cm.mapping.cumNetProfit === 13, 'cumNetProfit→13')
assert(cm.mapping.mae === 19 && cm.mapping.mfe === 20, 'MAE/MFE')
assert(cm.mapping.nfaFee === 18, 'nfaFee→18')
assert(cm.missing.length === 0, 'missing vide')

console.log('— montants US (Performance.csv) —')
assert(parseFrenchNumber('$525.00') === 525, '$525.00 → 525')
assert(parseFrenchNumber('$(250.00)') === -250, '$(250.00) → -250')
assert(parseFrenchNumber('$1,405.00') === 1405, '$1,405.00 → 1405')
assert(parseFrenchNumber('"$1,405.00"') === 1405, 'avec guillemets')
assert(parseFrenchNumber('$ (250.00)') === -250, 'espace avant parenthèses')

console.log('— format de date MM/DD (auto-détection) —')
const perf = `symbol\tqty\tbuyFillId\tpnl\tboughtTimestamp\tsoldTimestamp\tduration
NQM6\t1\t123\t$525.00\t06/15/2026 14:44:42\t06/15/2026 14:45:40\t57sec
NQM6\t1\t456\t$(250.00)\t06/16/2026 15:05:43\t06/16/2026 15:06:12\t28sec
`
const perfRes = parseCsvFile(perf)
assert(perfRes.ok === true, 'parse ok Performance.csv')
assert(perfRes.missing.length === 0, 'aucune colonne manquante (buyFillId/pnl/bought/sold)')
assert(perfRes.dateFormat === 'mm/dd', `dateFormat mm/dd (got ${perfRes.dateFormat})`)
assert(perfRes.trades.length === 2, '2 trades')
assert(perfRes.trades[0].entryTime.getDate() === 15 && perfRes.trades[0].entryTime.getMonth() === 5, '06/15/2026 → 15 juin', perfRes.trades[0].entryTime.toString())
assert(perfRes.trades[0].profit === 525, 'profit 525')
assert(perfRes.trades[1].profit === -250, 'profit -250 (parenthèses)')
assert(perfRes.trades[0].tradeNumber === '123', 'tradeNumber = buyFillId')
assert(perfRes.trades[1].mae == null, 'MAE absent → null')

console.log('— rejet d\'un export « Grid » (logs d\'erreurs NinjaTrader) —')
const grid = `NinjaScript File\tError\tCode\tLine\tColumn
MGIPriorDayOHLC.cs\tArgument 3: cannot convert from 'int' to 'bool'\tCS1503\t460\t47
`
const gridRes = parseCsvFile(grid)
assert(gridRes.ok === true, 'parse ok (pas de crash)')
assert(gridRes.trades.length === 0, '0 trade reconnu')
assert(gridRes.missing.length === 4, '4 colonnes obligatoires manquantes')

console.log('— mapping forcé (en-têtes atypiques) —')
const weird = `C1\tC2\tC3\tC4
1\tNQ\t10/08/2026 14:47\t10/08/2026 15:02
2\tNQ\t10/08/2026 15:10\t10/08/2026 15:25
`
const forced = {
  tradeNumber: 0,
  instrument: 1,
  entryTime: 2,
  exitTime: 3,
  profit: 0,
  mae: 0,
  mfe: 0,
}
const res2 = parseCsvFile(weird, { mapping: forced })
assert(res2.ok === true, 'parse ok avec mapping forcé')
assert(res2.trades.length === 2, `2 trades (got ${res2.trades.length})`)
assert(res2.trades[0].profit === 1, `profit forcé 1 (got ${res2.trades[0].profit})`)

console.log('— monteCarlo (bootstrap, seed 42) —')
const mc1 = monteCarlo(records, { nSim: 200, horizon: 20, maxDrawdown: 2000, target: 3000, seed: '42' })
const mc2 = monteCarlo(records, { nSim: 200, horizon: 20, maxDrawdown: 2000, target: 3000, seed: '42' })
assert(mc1.empty === false, 'non vide')
assert(mc1.finalPnls.length === 200, `200 sims (got ${mc1.finalPnls.length})`)
assert(mc1.fan.length === 20, `fan 20 pas (got ${mc1.fan.length})`)
assert(mc1.seedUsed === 42, `seed 42 (got ${mc1.seedUsed})`)
assert(JSON.stringify(mc1.finalPnls) === JSON.stringify(mc2.finalPnls), 'déterminisme seed fixe')
assert(mc1.fan.every((p) => p.p5 <= p.p50 && p.p50 <= p.p95), 'P5 ≤ P50 ≤ P95 sur tout le fan')
assert(mc1.probRuin >= 0 && mc1.probRuin <= 1, `probRuin ∈ [0,1] (got ${mc1.probRuin})`)
assert(mc1.probTarget >= 0 && mc1.probTarget <= 1, `probTarget ∈ [0,1] (got ${mc1.probTarget})`)
assert(Number.isFinite(mc1.medianFinal) && Number.isFinite(mc1.medianMaxDD), 'médianes finies')
const mcEmpty = monteCarlo([], { nSim: 200, horizon: 20, seed: '7' })
assert(mcEmpty.empty === true && mcEmpty.finalPnls.length === 0, 'vide → empty')
const mcNoMoney = monteCarlo(records, { nSim: 100, horizon: 10, seed: '7' })
assert(mcNoMoney.probRuin === null && mcNoMoney.probTarget === null, 'sans max/target → probas null')
const mcClamp = monteCarlo(records, { nSim: 5, horizon: 5, seed: '7' })
assert(mcClamp.nSim === 100 && mcClamp.horizon === 10, `clamp 100×10 (got ${mcClamp.nSim}×${mcClamp.horizon})`)

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} test(s) en échec`)
process.exit(failures === 0 ? 0 : 1)