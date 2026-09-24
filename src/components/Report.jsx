import { useMemo, useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { ResponsiveContainer, ComposedChart, Line, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { useData } from '../useData'
import { aggregateMetrics, latentDrawdownSeries, pnlSeries, streakAnalysis, dailyPnlStats, drawdownDurations, maeMfeStats, temporalStats, rMultiples, heatmapGrid, monteCarlo } from '../metrics'
import { Card, Button, Select, InfoNote } from './ui'
import { fmtMoney, fmtNum, fmtPct, fmtDateKey, toDateKey } from '../format'
import { startOfWeek, endOfWeek } from 'date-fns'

function periodRange(period, customRange) {
  const now = new Date()
  if (period === 'week') {
    const s = startOfWeek(now, { weekStartsOn: 1 }); const e = endOfWeek(now, { weekStartsOn: 1 }); return [s.getTime(), e.getTime()]
  }
  if (period === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); return [s.getTime(), e.getTime()]
  }
  if (period === 'custom' && customRange.from && customRange.to) {
    const s = new Date(`${customRange.from}T00:00:00`); const e = new Date(`${customRange.to}T23:59:59.999`); if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) return [s.getTime(), e.getTime()]
  }
  return null
}

export default function Report() {
  const { trades, accounts } = useData()
  const [accountFilter, setAccountFilter] = useState('global')
  const [period, setPeriod] = useState('all')
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [pfTarget, setPfTarget] = useState('1.4')
  const [sharpeTarget, setSharpeTarget] = useState('1.2')
  const [ddTargetPct, setDdTargetPct] = useState('5')
  const [seuilMae, setSeuilMae] = useState('8')

  const filtered = useMemo(() => {
    let list = trades
    if (accountFilter !== 'global') list = list.filter((t) => String(t.accountId) === String(accountFilter))
    const range = periodRange(period, customRange)
    if (range) { const [s, e] = range; list = list.filter((t) => t.entryTime >= s && t.entryTime <= e) }
    return list
  }, [trades, accountFilter, period, customRange])

  const m = useMemo(() => aggregateMetrics(filtered), [filtered])
  const latent = useMemo(() => latentDrawdownSeries(filtered), [filtered])
  const daily = useMemo(() => pnlSeries(filtered, 'day'), [filtered])
  const streaks = useMemo(() => streakAnalysis(filtered), [filtered])
  const dailyStats = useMemo(() => dailyPnlStats(filtered), [filtered])
  const ddDur = useMemo(() => drawdownDurations(filtered), [filtered])
  const maeReport = useMemo(() => maeMfeStats(filtered, seuilMae), [filtered, seuilMae])
  const temporal = useMemo(() => temporalStats(filtered), [filtered])
  const rDistReport = useMemo(() => rMultiples(filtered), [filtered])
  const rHistogram = useMemo(() => {
    const bins = []
    for (let b = -6; b < 6; b += 0.5) bins.push({ key: b, label: `${b.toFixed(1)}`, count: 0 })
    for (const x of rDistReport) { let idx = Math.round((x.r - -6) / 0.5); idx = Math.max(0, Math.min(bins.length - 1, idx)); bins[idx].count += 1 }
    return bins
  }, [rDistReport])
  const gridReport = useMemo(() => heatmapGrid(filtered), [filtered])
  const selectedAcc = useMemo(() => accounts.find((a) => String(a.id) === String(accountFilter)), [accounts, accountFilter])
  const money = useMemo(() => {
    if (accountFilter === 'global') {
      const caps = accounts.filter((a) => a.capital != null)
      if (!caps.length) return null
      return { capital: caps.reduce((s, a) => s + (a.capital || 0), 0), max: caps.reduce((s, a) => s + (a.maxDrawdown || 0), 0), target: caps.reduce((s, a) => s + (a.target || 0), 0), type: 'mixte' }
    }
    if (!selectedAcc || selectedAcc.capital == null) return null
    return { capital: selectedAcc.capital, max: selectedAcc.maxDrawdown, target: selectedAcc.target, type: selectedAcc.drawdownType }
  }, [accountFilter, selectedAcc, accounts])
  const mcReport = useMemo(
    () =>
      monteCarlo(filtered, {
        nSim: 5000,
        horizon: 200,
        maxDrawdown: money && money.max != null ? money.max : null,
        target: money && money.target != null ? money.target : null,
        seed: '',
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, money && money.max, money && money.target],
  )
  const mcFanReport = useMemo(
    () => (mcReport.fan || []).map((p) => ({ ...p, band95: p.p95 != null && p.p5 != null ? p.p95 - p.p5 : 0 })),
    [mcReport],
  )
  const mcHistReport = useMemo(() => {
    const vals = mcReport.finalPnls || []
    if (!vals.length) return []
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    if (min === max) return [{ from: min, to: max, count: vals.length, center: min }]
    const bins = 20
    const width = (max - min) / bins
    const out = []
    for (let i = 0; i < bins; i++) {
      const from = min + i * width
      const to = i === bins - 1 ? max : from + width
      const count = vals.filter((v) => v >= from && v <= to).length
      out.push({ from, to, count, center: (from + to) / 2 })
    }
    return out
  }, [mcReport])
  const accName = accountFilter === 'global' ? 'Global (tous comptes)' : selectedAcc?.name || accountFilter
  const periodLabel = period === 'all' ? 'Toute la période' : period === 'week' ? 'Cette semaine' : period === 'month' ? 'Ce mois' : `${customRange.from} → ${customRange.to}`

  const downloadPdf = async () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210
    let y = 15
    const line = (txt, opts = {}) => { doc.setFontSize(opts.size || 10); doc.setFont(undefined, opts.bold ? 'bold' : 'normal'); doc.text(txt, opts.x ?? 15, y, opts); y += opts.h ?? 7 }
    const sep = () => { doc.setDrawColor(200); doc.line(15, y, W - 15, y); y += 5 }
    const capture = async (id) => {
      const el = document.getElementById(id)
      if (!el) return null
      try {
        const canvas = await html2canvas(el, { backgroundColor: '#0f1216', scale: 1.5, useCORS: true, logging: false })
        return canvas.toDataURL('image/png')
      } catch { return null }
    }
    const needPage = (h = 40) => { if (y + h > 285) { doc.addPage(); y = 15 } }

    // Header
    doc.setFillColor(14, 17, 23); doc.rect(0, 0, W, 22, 'F')
    doc.setTextColor(255); doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text('TraderDesk — Rapport de performance', 15, 14)
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.text(`${accName} • ${periodLabel} • ${fmtDateKey(toDateKey(Date.now()))} • ${filtered.length} trades`, 15, 18)
    doc.setTextColor(0); y = 30

    // 1. Résumé exécutif
    line('1. Resume executif', { bold: true, size: 12 }); y += 2
    const pfOk = m.profitFactor != null && m.profitFactor >= Number(pfTarget)
    const shOk = m.sharpe != null && m.sharpe >= Number(sharpeTarget)
    const ddPct = money && money.capital ? (Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0) / money.capital * 100) : null
    const ddOk = ddPct != null ? ddPct < Number(ddTargetPct) : null
    const rows1 = [
      ['Net P&L', fmtMoney(m.netProfit), money?.target ? fmtMoney(money.target, { sign: false }) : '—', money?.target && m.netProfit >= money.target ? '✅' : '—'],
      ['Rendement / capital', money && money.capital ? fmtPct(m.netProfit / money.capital, 1) : '—', '—', '—'],
      ['Max DD', `−${fmtMoney(Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0), { sign: false })}${ddPct != null ? ` (${ddPct.toFixed(1)}%)` : ''}`, `${ddTargetPct}%`, ddOk == null ? '—' : ddOk ? '✅' : '⚠️'],
      ['Profit Factor', m.profitFactor != null ? fmtNum(m.profitFactor) : '—', pfTarget, pfOk ? '✅' : '⚠️'],
      ['Sharpe (non annualisé)', m.sharpe != null ? fmtNum(m.sharpe) : '—', sharpeTarget, shOk ? '✅' : '⚠️'],
      ['Trades', `${m.tradeCount} (${m.winCount}W/${m.lossCount}L)`, '—', '—'],
    ]
    rows1.forEach(([a, b, c, d]) => { doc.setFontSize(8); doc.text(a, 15, y); doc.text(b, 65, y); doc.text(c, 120, y); doc.text(d, 170, y); y += 5 })
    sep()

    // 2. Rendement
    needPage(45); line('2. Metriques de rendement', { bold: true }); y += 2
    const rows2 = [
      ['Net P&L', fmtMoney(m.netProfit)],
      ['P&L moyen / jour', dailyStats.daily.length ? fmtMoney(dailyStats.mean) : '—'],
      ['P&L median / jour', dailyStats.median != null ? fmtMoney(dailyStats.median) : '—'],
      ['Meilleur jour / pire jour', dailyStats.best != null ? `${fmtMoney(dailyStats.best)} / ${fmtMoney(dailyStats.worst)}` : '—'],
      ['Rendement / capital', money && money.capital ? fmtPct(m.netProfit / money.capital, 1) + ' (non annualisé)' : '—'],
      ['Expectancy / trade', fmtMoney(m.expectancy)],
      ['Payoff Ratio', m.payoffRatio != null ? fmtNum(m.payoffRatio) : '—'],
    ]
    rows2.forEach(([k, v]) => { doc.setFontSize(8); doc.text(k, 15, y); doc.text(v, 80, y); y += 5 })
    // par instrument
    const byInst = {}; for (const t of filtered) { const k = String(t.instrument).includes('US30') || String(t.instrument).includes('YM') ? 'US30' : 'NQ/MNQ'; (byInst[k] = byInst[k] || { pnl: 0, count: 0 }).pnl += t.netProfit; byInst[k].count += 1 }
    const instKeys = Object.keys(byInst)
    if (instKeys.length) { doc.setFontSize(7); doc.setTextColor(100); doc.text(instKeys.map((k) => `${k}: ${fmtMoney(byInst[k].pnl)} (${byInst[k].count})`).join(' • '), 15, y); doc.setTextColor(0); y += 5 }
    sep()

    // 3. Risque
    needPage(50); line('3. Metriques de risque (non annualisé)', { bold: true }); y += 2
    const riskRows = [
      ['Max DD ($ / %)', `−${fmtMoney(Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0), { sign: false })}${ddPct != null ? ` (${ddPct.toFixed(1)}%)` : ''}`],
      ['Max DD latent', latent.maxDrawdownLatent ? `−${fmtMoney(latent.maxDrawdownLatent, { sign: false })}` : '—'],
      ['Ecart latent−réalisé', fmtMoney(latent.ecart, { sign: true })],
      ['Duree moy. recup. DD', ddDur.avg != null ? `${ddDur.avg.toFixed(1)} jours${ddDur.max != null ? ` (max ${ddDur.max.toFixed(1)}j)` : ''}` : '—'],
      ['Sortino / Sharpe', `${m.sortino != null ? fmtNum(m.sortino) : '—'} / ${m.sharpe != null ? fmtNum(m.sharpe) : '—'} — non annualisé`],
      ['Calmar / Ulcer', `${m.calmar != null ? fmtNum(m.calmar) : '—'} / ${m.ulcer != null ? fmtNum(m.ulcer) : '—'}`],
      ['VaR jour 95% / SQN', `${m.var95 != null ? fmtMoney(m.var95) : '—'} / ${m.sqn != null ? fmtNum(m.sqn) : '—'}`],
      ['Kelly théo / appliqué', `${m.kelly != null ? fmtPct(m.kelly, 1) : '—'} / ${money && money.max && money.capital ? fmtPct(money.max / money.capital, 1) + ' max' : '—'}`],
    ]
    if (money && money.max) {
      const effDD = money.type === 'trailing' ? latent.maxDrawdownLatent : money.type === 'mixte' ? Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0) : latent.maxDrawdownRealise
      riskRows.splice(1, 0, ['Max autorisé / Reste', `${fmtMoney(money.max, { sign: false })} (${((money.max / money.capital) * 100).toFixed(1)}%) / ${fmtMoney(money.max - (effDD || 0), { sign: true })} — ${money.type === 'trailing' ? 'Trailing' : money.type === 'mixte' ? 'Mixte' : 'EOD'}`])
    }
    riskRows.forEach(([k, v]) => { doc.setFontSize(8); doc.text(k, 15, y); doc.text(v, 75, y); y += 5 })
    doc.setFontSize(7); doc.setTextColor(100); doc.text('Latent = Σ|MAE| par opération (±1min même exit, même compte/instrument). Ratios non annualisés.', 15, y); doc.setTextColor(0); y += 6
    sep()

    // Graphiques 4
    if (filtered.length) {
      const ids = ['report-equity', 'report-r', 'report-mae', 'report-temporal']
      const imgs = []
      for (const id of ids) { const img = await capture(id); imgs.push(img) }
      if (imgs.some(Boolean)) {
        needPage(60); line('Graphiques', { bold: true }); y += 1
        const positions = [[15, y, 85, 45], [110, y, 85, 45], [15, y + 50, 85, 45], [110, y + 50, 85, 45]]
        imgs.forEach((img, i) => { if (img) doc.addImage(img, 'PNG', positions[i][0], positions[i][1], positions[i][2], positions[i][3]) })
        y += 100; sep()
      }
    }

    // 4. Trade stats
    needPage(40); line('4. Statistiques de trades', { bold: true }); y += 2
    const rows4 = [
      ['Nb trades / Win rate / PF', `${m.tradeCount} / ${fmtPct(m.winRate, 1)} / ${m.profitFactor != null ? fmtNum(m.profitFactor) : '—'}`],
      ['Streaks', `Gagnante max ${streaks.longestWin} / Perdante max ${streaks.longestLoss} — ${streaks.streaks.length} séquences`],
      ['R-multiples', `${rDistReport.length} valeurs, voir graphique`],
    ]
    rows4.forEach(([k, v]) => { doc.setFontSize(8); doc.text(k, 15, y); doc.text(v, 70, y); y += 5 })
    sep()

    // 5. MAE/MFE
    needPage(40); line('5. Analyse MAE/MFE', { bold: true }); y += 2
    const rows5 = [
      ['MAE gagnants / perdants', `${maeReport.maeWin != null ? fmtMoney(maeReport.maeWin, { sign: false }) : '—'} / ${maeReport.maeLoss != null ? fmtMoney(maeReport.maeLoss, { sign: false }) : '—'}`],
      ['MFE moyen', maeReport.mfeMean != null ? fmtMoney(maeReport.mfeMean, { sign: false }) : '—'],
      ['MFE capturé / Edge Ratio', `${maeReport.captured != null ? fmtPct(maeReport.captured, 0) : '—'} / ${maeReport.edgeRatio != null ? fmtNum(maeReport.edgeRatio) : '—'}`],
      [`Seuil MAE (manuel ${seuilMae}$)`, maeReport.seuilStats ? `≤ seuil: ${maeReport.seuilStats.below} (${maeReport.seuilStats.winBelow} gagnants) | > seuil: ${maeReport.seuilStats.above} (${maeReport.seuilStats.winAbove} gagnants)` : '—'],
    ]
    rows5.forEach(([k, v]) => { doc.setFontSize(8); doc.text(k, 15, y); doc.text(v, 70, y); y += 5 })
    sep()

    // 6. Temporel
    needPage(45); line('6. Analyse temporelle', { bold: true }); y += 2
    temporal.buckets.forEach((b) => { doc.setFontSize(8); doc.text(`${b.label}`, 15, y); doc.text(`${fmtMoney(b.pnl)} (${b.count} trades, WR ${b.count ? fmtPct(b.wins / b.count, 0) : '—'})`, 60, y); y += 5 })
    // par jour semaine
    const dowLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    const dowLine = temporal.byDow.map((d, i) => `${dowLabels[i]}:${fmtMoney(d.pnl)}`).join(' • ')
    doc.setFontSize(7); doc.setTextColor(100); doc.text(dowLine, 15, y); doc.setTextColor(0); y += 6
    sep()

    // 7. Conclusion
    needPage(35); line('7. Conclusion & plan d\'action', { bold: true }); y += 2
    const worst = [...temporal.buckets].sort((a, b) => a.pnl - b.pnl)[0]
    const actions = [
      `1. Réduire exposition sur ${worst ? `${worst.label} (${fmtMoney(worst.pnl)})` : 'tranche la plus faible'}`,
      `2. Tester seuil MAE ${seuilMae}$ comme base stop — Edge ${maeReport.edgeRatio != null ? fmtNum(maeReport.edgeRatio) : '—'}`,
      `3. Suivre MFE capturé ${maeReport.captured != null ? fmtPct(maeReport.captured, 0) : '—'} sur 3 mois`,
      `4. Respect PF cible ${pfTarget} / Sharpe cible ${sharpeTarget} (non annualisé) / DD max ${ddTargetPct}%`,
    ]
    actions.forEach((a) => { doc.setFontSize(8); const ls = doc.splitTextToSize(a, W - 30); doc.text(ls, 15, y); y += ls.length * 5 })
    sep()

    // 8. Monte Carlo
    needPage(45); line('8. Simulation Monte Carlo (bootstrap, 5000 sims x 200 trades)', { bold: true }); y += 2
    const rows8 = [
      ['Médiane finale', mcReport.medianFinal != null ? fmtMoney(mcReport.medianFinal) : '—'],
      ['P5 / P95', mcReport.p5Final != null ? `${fmtMoney(mcReport.p5Final, { sign: false })} / ${fmtMoney(mcReport.p95Final, { sign: false })}` : '—'],
      ['Proba ruine (−max)', mcReport.probRuin == null ? '— (max non défini)' : fmtPct(mcReport.probRuin, 1)],
      ['Proba target', mcReport.probTarget == null ? '— (target non défini)' : fmtPct(mcReport.probTarget, 1)],
      ['MaxDD médian', mcReport.medianMaxDD != null ? `−${fmtMoney(mcReport.medianMaxDD, { sign: false })}` : '—'],
      ['Seed', String(mcReport.seedUsed)],
    ]
    rows8.forEach(([k, v]) => { doc.setFontSize(8); doc.text(k, 15, y); doc.text(v, 70, y); y += 5 })
    if (filtered.length && !mcReport.empty) {
      const mcImg = await capture('report-montecarlo')
      if (mcImg) {
        needPage(60); doc.addImage(mcImg, 'PNG', 15, y, 180, 70); y += 75; sep()
      }
    }
    doc.setFontSize(7); doc.setTextColor(100); doc.text('Bootstrap avec remise sur netProfit par trade — suppose trades i.i.d (streaks non modélisés). Non prédictif.', 15, y); doc.setTextColor(0); y += 6
    sep()

    line('Disclaimer', { bold: true, size: 8 }); doc.setFontSize(7); doc.setTextColor(100)
    const disclaimer = 'Données issues des CSV NinjaTrader importés. MAE agrégé multi-jambes suppose exposition simultanée au pire prix (hors scope tick-by-tick). Mesure descriptive, non prédictive. Ratios non annualisés.'
    const lines = doc.splitTextToSize(disclaimer, W - 30); doc.text(lines, 15, y); y += lines.length * 4
    doc.setTextColor(0)

    // footer
    doc.setFontSize(7); doc.setTextColor(120); doc.text(`Généré le ${new Date().toLocaleString('fr-FR')} — TraderDesk Performance Tracker`, 15, 287)

    doc.save(`TraderDesk-Rapport-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <div className="stack">
      <Card title="Rapport institutionnel — paramètres" note="Choisis compte & période, prévisualise, puis télécharge en PDF A4.">
        <div className="form-row">
          <Select value={String(accountFilter)} onChange={(v) => setAccountFilter(v === 'global' ? 'global' : Number(v))}>
            <option value="global">Global (tous comptes)</option>
            {accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
          </Select>
          <Select value={period} onChange={setPeriod}>
            <option value="all">Toute la période</option>
            <option value="week">Cette semaine</option>
            <option value="month">Ce mois</option>
            <option value="custom">Personnalisé</option>
          </Select>
        </div>
        {period === 'custom' && (
          <div className="custom-range" style={{ marginTop: 10 }}>
            <input type="date" value={customRange.from} onChange={(e) => setCustomRange({ ...customRange, from: e.target.value })} />
            <span>→</span>
            <input type="date" value={customRange.to} onChange={(e) => setCustomRange({ ...customRange, to: e.target.value })} />
          </div>
        )}
        <div className="grid-2" style={{ marginTop: 10 }}>
          <div className="field"><label className="field-label">PF cible</label><input className="input" value={pfTarget} onChange={(e) => setPfTarget(e.target.value)} placeholder="1.4" inputMode="decimal" /></div>
          <div className="field"><label className="field-label">Sharpe cible (non annualisé)</label><input className="input" value={sharpeTarget} onChange={(e) => setSharpeTarget(e.target.value)} placeholder="1.2" inputMode="decimal" /></div>
          <div className="field"><label className="field-label">DD max cible (% capital)</label><input className="input" value={ddTargetPct} onChange={(e) => setDdTargetPct(e.target.value)} placeholder="5" inputMode="decimal" /></div>
          <div className="field"><label className="field-label">Seuil MAE ($)</label><input className="input" value={seuilMae} onChange={(e) => setSeuilMae(e.target.value)} placeholder="8" inputMode="decimal" /></div>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <Button variant="primary" onClick={downloadPdf} disabled={!filtered.length}>Télécharger PDF A4 (jsPDF)</Button>
        </div>
        <InfoNote>Rapport inspiré des tear sheets CTA / prime broker : executive summary, risk réalisé vs latent (écart), attribution journalière, séquences, disclaimer. Les graphiques restent interactifs dans TraderDesk ; le PDF embarque les chiffres.</InfoNote>
      </Card>

      <div id="report-preview" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 1. Résumé exécutif */}
        <Card title={`1. Résumé exécutif — ${accName} • ${periodLabel}`} note={`Cibles: PF ${pfTarget} | Sharpe ${sharpeTarget} (non annualisé) | DD ${ddTargetPct}%`}>
          <div className="table-wrap"><table className="table"><thead><tr><th>Indicateur</th><th>Valeur</th><th>Cible</th><th>Statut</th></tr></thead><tbody>
            <tr><td>Net P&L</td><td className={m.netProfit >= 0 ? 'text-pos' : 'text-neg'}>{fmtMoney(m.netProfit)}</td><td>{money?.target ? fmtMoney(money.target, { sign: false }) : '—'}</td><td>{money?.target && m.netProfit >= money.target ? '✅' : money?.target ? '—' : '—'}</td></tr>
            <tr><td>Rendement / capital</td><td>{money && money.capital ? fmtPct(m.netProfit / money.capital, 1) : '—'}</td><td>—</td><td>—</td></tr>
            <tr><td>Max DD</td><td className="text-neg">−{fmtMoney(Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0), { sign: false })}</td><td>{ddTargetPct}%</td><td>{money && money.capital && (Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0) / money.capital * 100) < Number(ddTargetPct) ? '✅' : '⚠️'}</td></tr>
            <tr><td>Profit Factor</td><td>{m.profitFactor != null ? fmtNum(m.profitFactor) : '—'}</td><td>{pfTarget}</td><td>{m.profitFactor != null && m.profitFactor >= Number(pfTarget) ? '✅' : '⚠️'}</td></tr>
            <tr><td>Sharpe (non annualisé)</td><td>{m.sharpe != null ? fmtNum(m.sharpe) : '—'}</td><td>{sharpeTarget}</td><td>{m.sharpe != null && m.sharpe >= Number(sharpeTarget) ? '✅' : '⚠️'}</td></tr>
            <tr><td>Trades</td><td>{m.tradeCount} ({m.winCount}W/{m.lossCount}L)</td><td>—</td><td>—</td></tr>
          </tbody></table></div>
          <InfoNote>Synthèse : {m.netProfit >= 0 ? 'période rentable' : 'période en perte'} — PF {m.profitFactor != null ? fmtNum(m.profitFactor) : '—'} vs cible {pfTarget}.</InfoNote>
        </Card>

        {/* 2. Métriques de rendement */}
        <Card title="2. Métriques de rendement">
          <div className="table-wrap"><table className="table"><thead><tr><th>Métrique</th><th>Valeur</th></tr></thead><tbody>
            <tr><td>Net P&L (net de frais)</td><td>{fmtMoney(m.netProfit)}</td></tr>
            <tr><td>P&L moyen / jour</td><td>{dailyStats.daily.length ? fmtMoney(dailyStats.mean) : '—'}</td></tr>
            <tr><td>P&L médian / jour</td><td>{dailyStats.median != null ? fmtMoney(dailyStats.median) : '—'}</td></tr>
            <tr><td>Meilleur jour / pire jour</td><td>{dailyStats.best != null ? `${fmtMoney(dailyStats.best)} / ${fmtMoney(dailyStats.worst)}` : '—'}</td></tr>
            <tr><td>Rendement / capital</td><td>{money && money.capital ? `${fmtPct(m.netProfit / money.capital, 1)} (${fmtMoney(m.netProfit)})` : '—'} — non annualisé</td></tr>
            <tr><td>Expectancy / trade</td><td>{fmtMoney(m.expectancy)}</td></tr>
            <tr><td>Payoff Ratio</td><td>{m.payoffRatio != null ? fmtNum(m.payoffRatio) : '—'}</td></tr>
          </tbody></table></div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Par instrument : {(() => { const byInst = {}; for (const t of filtered) { const k = String(t.instrument).includes('US30') || String(t.instrument).includes('YM') ? 'US30' : 'NQ/MNQ'; (byInst[k] = byInst[k] || { pnl: 0, count: 0 }).pnl += t.netProfit; byInst[k].count += 1 } const keys = Object.keys(byInst); return keys.length ? keys.map((k) => `${k}: ${fmtMoney(byInst[k].pnl)} (${byInst[k].count} trades)`).join(' • ') : '—' })()}</div>
        </Card>

        {/* 3. Métriques de risque */}
        <Card title="3. Métriques de risque" note="Sharpe/Sortino non annualisés — bloc prioritaire desk">
          <div className="table-wrap"><table className="table"><thead><tr><th>Métrique</th><th>Valeur</th></tr></thead><tbody>
            <tr><td>Max DD ($ / % capital)</td><td>{latent.maxDrawdownRealise ? `−${fmtMoney(latent.maxDrawdownRealise, { sign: false })}` : '—'} {money && money.capital ? `(${(Math.max(latent.maxDrawdownRealise || 0, latent.maxDrawdownLatent || 0) / money.capital * 100).toFixed(1)}%)` : ''}</td></tr>
            <tr><td>Max DD latent</td><td>{latent.maxDrawdownLatent ? `−${fmtMoney(latent.maxDrawdownLatent, { sign: false })}` : '—'}</td></tr>
            <tr><td>Écart latent−réalisé</td><td>{fmtMoney(latent.ecart, { sign: true })}</td></tr>
            <tr><td>Durée moyenne récup. DD</td><td>{ddDur.avg != null ? `${ddDur.avg.toFixed(1)} jours` : '—'} {ddDur.max != null ? `(max ${ddDur.max.toFixed(1)}j)` : ''}</td></tr>
            <tr><td>Sortino / Sharpe</td><td>{m.sortino != null ? fmtNum(m.sortino) : '—'} / {m.sharpe != null ? fmtNum(m.sharpe) : '—'} — non annualisé</td></tr>
            <tr><td>Calmar / Ulcer</td><td>{m.calmar != null ? fmtNum(m.calmar) : '—'} / {m.ulcer != null ? fmtNum(m.ulcer) : '—'}</td></tr>
            <tr><td>VaR jour 95% / SQN</td><td>{m.var95 != null ? fmtMoney(m.var95) : '—'} / {m.sqn != null ? fmtNum(m.sqn) : '—'}</td></tr>
            <tr><td>Kelly théorique / appliqué</td><td>{m.kelly != null ? fmtPct(m.kelly, 1) : '—'} / {money && money.max && money.capital ? `${fmtPct((money.max / money.capital), 1)} max` : '—'}</td></tr>
          </tbody></table></div>
          {money && money.capital && <InfoNote>Max autorisé {fmtMoney(money.max, { sign: false })} ({((money.max / money.capital) * 100).toFixed(1)}%) — Reste EOD {fmtMoney(money.max - (latent.maxDrawdownRealise || 0), { sign: true })} / Trailing {fmtMoney(money.max - (latent.maxDrawdownLatent || 0), { sign: true })} — {money.type}</InfoNote>}
        </Card>

        {/* 4. Statistiques trades */}
        <Card title="4. Statistiques de trades">
          <div className="table-wrap"><table className="table"><thead><tr><th>Métrique</th><th>Valeur</th></tr></thead><tbody>
            <tr><td>Nb trades / Win rate / PF</td><td>{m.tradeCount} / {fmtPct(m.winRate, 1)} / {m.profitFactor != null ? fmtNum(m.profitFactor) : '—'}</td></tr>
            <tr><td>Streaks</td><td>Gagnante max {streaks.longestWin} / Perdante max {streaks.longestLoss} — {streaks.streaks.length} séquences</td></tr>
          </tbody></table></div>
          <div id="report-r" style={{ background: 'var(--bg-elev)', borderRadius: 8, padding: 8, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Distribution R-multiples</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={rHistogram} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="var(--text-muted)" interval={4} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v) => [v, 'trades']} labelFormatter={(l) => `R = ${l}`} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{rHistogram.map((b) => <Cell key={b.key} fill={b.key >= 0 ? 'var(--pos)' : 'var(--danger)'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 5. MAE/MFE */}
        <Card title="5. Analyse MAE/MFE">
          <div className="table-wrap"><table className="table"><thead><tr><th>Métrique</th><th>Valeur</th></tr></thead><tbody>
            <tr><td>MAE moyen gagnants / perdants</td><td>{maeReport.maeWin != null ? fmtMoney(maeReport.maeWin, { sign: false }) : '—'} / {maeReport.maeLoss != null ? fmtMoney(maeReport.maeLoss, { sign: false }) : '—'}</td></tr>
            <tr><td>MFE moyen</td><td>{maeReport.mfeMean != null ? fmtMoney(maeReport.mfeMean, { sign: false }) : '—'}</td></tr>
            <tr><td>MFE capturé / Edge Ratio</td><td>{maeReport.captured != null ? fmtPct(maeReport.captured, 0) : '—'} / {maeReport.edgeRatio != null ? fmtNum(maeReport.edgeRatio) : '—'}</td></tr>
            <tr><td>Seuil MAE (manuel = {seuilMae}$)</td><td>{maeReport.seuilStats ? `≤ seuil: ${maeReport.seuilStats.below} trades (${maeReport.seuilStats.winBelow} gagnants) | > seuil: ${maeReport.seuilStats.above} trades (${maeReport.seuilStats.winAbove} gagnants)` : '—'}</td></tr>
          </tbody></table></div>
          <div id="report-mae" style={{ background: 'var(--bg-elev)', borderRadius: 8, padding: 8, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>MAE vs MFE (seuil {seuilMae}$)</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={[{ label: '≤ seuil', count: maeReport.seuilStats ? maeReport.seuilStats.winBelow : 0 }, { label: '> seuil', count: maeReport.seuilStats ? maeReport.seuilStats.winAbove : 0 }]} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}><Cell fill="var(--pos)" /><Cell fill="var(--danger)" /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 6. Temporel */}
        <Card title="6. Analyse temporelle">
          <div className="table-wrap"><table className="table"><thead><tr><th>Fenêtre</th><th>P&L</th><th>Trades</th><th>Win rate</th></tr></thead><tbody>
            {temporal.buckets.map((b) => <tr key={b.key}><td>{b.label}</td><td className={b.pnl >= 0 ? 'text-pos' : 'text-neg'}>{fmtMoney(b.pnl)}</td><td>{b.count}</td><td>{b.count ? fmtPct(b.wins / b.count, 0) : '—'}</td></tr>)}
          </tbody></table></div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Par jour de semaine (heatmap) — voir Dashboard pour détail 2h.</div>
          <div id="report-temporal" style={{ background: 'var(--bg-elev)', borderRadius: 8, padding: 8, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>P&L par jour de semaine</div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={temporal.byDow.map((d, i) => ({ label: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][i], pnl: d.pnl }))} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => v.toLocaleString('en-US')} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v) => [fmtMoney(v), 'PnL']} />
                <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>{temporal.byDow.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? 'var(--pos)' : 'var(--danger)'} />)}</Bar>
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 7. Conclusion */}
        <Card title="7. Conclusion & plan d'action">
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Réduire exposition sur tranche la plus faible : {(() => { const worst = [...temporal.buckets].sort((a, b) => a.pnl - b.pnl)[0]; return worst ? `${worst.label} (${fmtMoney(worst.pnl)}, WR ${worst.count ? fmtPct(worst.wins / worst.count, 0) : '—'})` : '—' })()}</li>
            <li>Tester seuil MAE manuel ({seuilMae}$) comme base de stop — actuel Edge {maeReport.edgeRatio != null ? fmtNum(maeReport.edgeRatio) : '—'}</li>
            <li>Suivre MFE capturé {maeReport.captured != null ? fmtPct(maeReport.captured, 0) : '—'} sur 3 mois</li>
            <li>Respect discipline : PF cible {pfTarget}, Sharpe cible {sharpeTarget} (non annualisé), DD max {ddTargetPct}%</li>
          </ol>
        </Card>

        {/* 8. Simulation Monte Carlo */}
        <Card title="8. Simulation Monte Carlo" note="Bootstrap avec remise sur les netProfit par trade (5000 sims × 200 trades). Suppose les trades i.i.d — ignore streaks et régimes. Non prédictif.">
          <div className="table-wrap"><table className="table"><thead><tr><th>Métrique</th><th>Valeur</th></tr></thead><tbody>
            <tr><td>Médiane finale</td><td className={mcReport.medianFinal >= 0 ? 'text-pos' : 'text-neg'}>{mcReport.medianFinal != null ? fmtMoney(mcReport.medianFinal) : '—'}</td></tr>
            <tr><td>P5 / P95</td><td>{mcReport.p5Final != null ? `${fmtMoney(mcReport.p5Final, { sign: false })} / ${fmtMoney(mcReport.p95Final, { sign: false })}` : '—'}</td></tr>
            <tr><td>Proba ruine (−max)</td><td>{mcReport.probRuin == null ? '— (max non défini)' : fmtPct(mcReport.probRuin, 1)}</td></tr>
            <tr><td>Proba target</td><td>{mcReport.probTarget == null ? '— (target non défini)' : fmtPct(mcReport.probTarget, 1)}</td></tr>
            <tr><td>MaxDD médian</td><td>{mcReport.medianMaxDD != null ? `−${fmtMoney(mcReport.medianMaxDD, { sign: false })}` : '—'}</td></tr>
          </tbody></table></div>
          <div id="report-montecarlo" style={{ background: 'var(--bg-elev)', borderRadius: 8, padding: 8, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Éventail P5–P95 (5000 sims × 200 trades)</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={mcFanReport} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="step" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => v.toLocaleString('en-US')} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [fmtMoney(v), n]} labelFormatter={(v) => `Trade simulé #${v}`} />
                <Area dataKey="p5" stackId="1" stroke="none" fill="transparent" dot={false} tooltipType="none" />
                <Area dataKey="band95" stackId="1" stroke="none" fill="var(--accent)" fillOpacity={0.18} dot={false} tooltipType="none" />
                <Line type="monotone" dataKey="p50" name="Médiane" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
                {money && money.max != null && <ReferenceLine y={-money.max} stroke="var(--danger)" strokeDasharray="6 4" />}
                {money && money.target != null && <ReferenceLine y={money.target} stroke="var(--pos)" strokeDasharray="6 4" />}
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 4px' }}>Distribution des P&L finaux</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={mcHistReport} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="center" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v) => [v, 'sims']} labelFormatter={(v) => `P&L final ≈ ${fmtMoney(Math.round(v))}`} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>{mcHistReport.map((b) => <Cell key={`${b.from}-${b.to}`} fill={b.center >= 0 ? 'var(--pos)' : 'var(--danger)'} />)}</Bar>
                {mcReport.medianFinal != null && <ReferenceLine x={mcReport.medianFinal} stroke="var(--accent)" strokeDasharray="4 4" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <InfoNote>Seed {mcReport.seedUsed} — le PDF fige la même simulation. Bootstrap i.i.d : les streaks observés (§4) ne sont pas modélisés.</InfoNote>
        </Card>

        <Card title="Graphiques — Equity">
          <div id="report-equity" style={{ background: 'var(--bg-elev)', borderRadius: 8, padding: 8 }}>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={latent.series} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="idx" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" tickFormatter={(v) => v.toLocaleString('en-US')} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [fmtMoney(v), n]} />
                <Line type="monotone" dataKey="cum" name="Equity réalisée" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="equityLatente" name="Equity latente" stroke="#9b6dff" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div id="report-pnl" style={{ display: 'none' }}><ResponsiveContainer width="100%" height={200}><BarChart data={daily}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Bar dataKey="pnl">{daily.map((e) => <Cell key={e.key} fill={e.pnl >= 0 ? 'var(--pos)' : 'var(--danger)'} />)}</Bar></BarChart></ResponsiveContainer></div>
        </Card>
      </div>
    </div>
  )
}
