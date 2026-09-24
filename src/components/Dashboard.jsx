import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  ScatterChart,
  Scatter,
  ReferenceLine,
} from 'recharts'
import { startOfWeek, endOfWeek } from 'date-fns'
import { useData } from '../useData'
import {
  aggregateMetrics,
  latentDrawdownSeries,
  pnlSeries,
  rMultiples,
  heatmapGrid,
  exitQualitySeries,
  disciplineCorrelation,
  streakAnalysis,
  expectancySeries,
  pnlDistribution,
} from '../metrics'
import { Card, MetricCard, EmptyState, InfoNote, Button, Select } from './ui'
import MonteCarloCard from './MonteCarloCard'
import { fmtMoney, fmtNum, fmtPct, fmtDateKey, toDateKey } from '../format'

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

const SECTION_DEFAULTS = {
  metrics: true,
  equity: true,
  dailyPnl: true,
  rDist: true,
  expectancy: true,
  pnlDist: true,
  heatmap: true,
  scatter: true,
  exitQuality: true,
  streaks: true,
  discipline: true,
  monteCarlo: true,
}

const SECTION_LABELS = {
  metrics: 'Cartes de métriques',
  equity: 'Equity réalisée vs latente',
  dailyPnl: 'PnL journalier / hebdo / mensuel',
  rDist: 'Distribution des R-multiples',
  expectancy: 'Évolution de l’expectancy',
  pnlDist: 'Distribution du P&L',
  heatmap: 'Heatmap jour / tranche horaire',
  scatter: 'MAE vs MFE (qualité d’exécution)',
  exitQuality: 'Score de qualité de sortie',
  streaks: 'Séquences (streaks)',
  discipline: 'Corrélation discipline / performance',
  monteCarlo: 'Simulation Monte Carlo',
}

function loadSections() {
  try {
    const raw = localStorage.getItem('dashboard.sections')
    if (raw) return { ...SECTION_DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...SECTION_DEFAULTS }
}

function saveSections(sections) {
  try {
    localStorage.setItem('dashboard.sections', JSON.stringify(sections))
  } catch {
    /* ignore */
  }
}

function periodRange(period, customRange) {
  const now = new Date()
  if (period === 'week') {
    const start = startOfWeek(now, { weekStartsOn: 1 })
    const end = endOfWeek(now, { weekStartsOn: 1 })
    return [start.getTime(), end.getTime()]
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return [start.getTime(), end.getTime()]
  }
  if (period === 'custom') {
    if (customRange.from && customRange.to) {
      const start = new Date(`${customRange.from}T00:00:00`)
      const end = new Date(`${customRange.to}T23:59:59.999`)
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        return [start.getTime(), end.getTime()]
      }
    }
    return null
  }
  return null
}

function tooltipStyle() {
  return {
    backgroundColor: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
  }
}

export default function Dashboard({ onOpenDay }) {
  const { trades, accounts, journals } = useData()
  const [accountFilter, setAccountFilter] = useState('global')
  const [period, setPeriod] = useState('all')
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [sections, setSections] = useState(loadSections)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [expBucket, setExpBucket] = useState('day')
  const [pnlBucket, setPnlBucket] = useState('day')
  const [maeThreshold, setMaeThreshold] = useState('')

  const filtered = useMemo(() => {
    let list = trades
    if (accountFilter !== 'global') {
      list = list.filter((t) => String(t.accountId) === String(accountFilter))
    }
    const range = periodRange(period, customRange)
    if (range) {
      const [start, end] = range
      list = list.filter((t) => t.entryTime >= start && t.entryTime <= end)
    }
    return list
  }, [trades, accountFilter, period, customRange])

  const m = useMemo(() => aggregateMetrics(filtered), [filtered])
  const latentData = useMemo(() => latentDrawdownSeries(filtered), [filtered])
  const chartData = latentData.series
  const rDist = useMemo(() => rMultiples(filtered), [filtered])
  const dailyPnlData = useMemo(() => pnlSeries(filtered, pnlBucket), [filtered, pnlBucket])
  const grid = useMemo(() => heatmapGrid(filtered), [filtered])
  const exitSeries = useMemo(() => exitQualitySeries(filtered), [filtered])
  const disc = useMemo(() => disciplineCorrelation(journals, filtered), [journals, filtered])
  const streaks = useMemo(() => streakAnalysis(filtered), [filtered])
  const expSeries = useMemo(() => expectancySeries(filtered, expBucket), [filtered, expBucket])
  const pnlHist = useMemo(() => pnlDistribution(filtered), [filtered])

  const toggleSection = (key) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveSections(next)
      return next
    })
  }

  const resetSections = () => {
    setSections({ ...SECTION_DEFAULTS })
    saveSections({ ...SECTION_DEFAULTS })
  }

  const histogram = useMemo(() => {
    const bins = []
    for (let b = -6; b < 6; b += 0.5) {
      bins.push({ key: b, label: `${fmtNum(b, 1)}`, count: 0 })
    }
    for (const x of rDist) {
      let idx = Math.round((x.r - -6) / 0.5)
      idx = Math.max(0, Math.min(bins.length - 1, idx))
      bins[idx].count += 1
    }
    return bins
  }, [rDist])

  const heatMax = useMemo(() => {
    let max = 0
    for (const row of grid) for (const c of row) max = Math.max(max, Math.abs(c.pnl))
    return max || 1
  }, [grid])

  const scatterData = useMemo(
    () =>
      filtered.map((t) => ({
        x: Math.abs(t.mae || 0),
        y: Math.abs(t.mfe || 0),
        win: t.netProfit > 0,
        net: t.netProfit,
      })),
    [filtered],
  )

  const maeThresholdNum = useMemo(() => {
    if (maeThreshold === '' || maeThreshold == null) return null
    const n = Number(String(maeThreshold).replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }, [maeThreshold])

  const maeStats = useMemo(() => {
    if (maeThresholdNum == null) return null
    const total = filtered.length || 1
    const below = filtered.filter((t) => Math.abs(t.mae || 0) <= maeThresholdNum)
    const above = filtered.filter((t) => Math.abs(t.mae || 0) > maeThresholdNum)
    const winBelow = below.filter((t) => t.netProfit > 0).length
    const winAbove = above.filter((t) => t.netProfit > 0).length
    return {
      below: below.length,
      winBelow,
      above: above.length,
      winAbove,
      wrBelow: winBelow / total,
      wrAbove: winAbove / total,
    }
  }, [filtered, maeThresholdNum])

  const openDay = (ms) => {
    if (ms == null) return
    const k = toDateKey(ms)
    if (!k) return
    if (onOpenDay) onOpenDay(k)
  }

  const handleChartClick = (state) => {
    const p = state && state.activePayload && state.activePayload[0] && state.activePayload[0].payload
    if (p && p.date != null) openDay(p.date)
  }

  const selectedAccount = useMemo(() => accounts.find((a) => String(a.id) === String(accountFilter)), [accounts, accountFilter])
  const moneyInfo = useMemo(() => {
    const isTrailing = (t) => t === 'trailing'
    const effectiveDD = (type) => isTrailing(type) ? latentData.maxDrawdownLatent : latentData.maxDrawdownRealise
    if (accountFilter === 'global') {
      const caps = accounts.filter((a) => a.capital != null)
      if (!caps.length) return null
      const cap = caps.reduce((s, a) => s + (a.capital || 0), 0)
      const mx = caps.reduce((s, a) => s + (a.maxDrawdown || 0), 0)
      const tgt = caps.reduce((s, a) => s + (a.target || 0), 0)
      // mixte : on montre les deux max, EOD vs trailing
      return { capital: cap, max: mx, target: tgt, type: 'mixte', pnl: m.netProfit, ddReal: latentData.maxDrawdownRealise, ddLatent: latentData.maxDrawdownLatent }
    }
    if (!selectedAccount || selectedAccount.capital == null) return null
    const type = selectedAccount.drawdownType || 'eod'
    const dd = effectiveDD(type)
    return { capital: selectedAccount.capital, max: selectedAccount.maxDrawdown, target: selectedAccount.target, type, pnl: m.netProfit, dd, ddReal: latentData.maxDrawdownRealise, ddLatent: latentData.maxDrawdownLatent }
  }, [accountFilter, selectedAccount, accounts, m.netProfit, latentData.maxDrawdownRealise, latentData.maxDrawdownLatent])

  const dotClick = (a, b) => {
    const payload = a && a.payload ? a.payload : b && b.payload ? b.payload : a
    const date = payload && (payload.date != null ? payload.date : payload && payload.payload && payload.payload.date)
    if (date != null) openDay(date)
  }

  if (!filtered.length) {
    return (
      <div className="stack">
        <DashboardControls
          accounts={accounts}
          accountFilter={accountFilter}
          setAccountFilter={setAccountFilter}
          period={period}
          setPeriod={setPeriod}
          customRange={customRange}
          setCustomRange={setCustomRange}
          sections={sections}
          optionsOpen={optionsOpen}
          setOptionsOpen={setOptionsOpen}
          toggleSection={toggleSection}
          resetSections={resetSections}
        />
        <EmptyState message="Aucun trade sur la période sélectionnée. Importez un CSV dans l'onglet Upload." />
      </div>
    )
  }

  const profitFactorTone = m.profitFactor == null ? 'neutral' : m.profitFactor >= 1 ? 'pos' : 'neg'
  const netTone = m.netProfit >= 0 ? 'pos' : 'neg'

  const metricCards = [
    { label: 'Net P&L', value: fmtMoney(m.netProfit), tone: netTone, note: 'Somme des profits nets (profit − commissions/frais) sur la période.' },
    { label: 'Trades', value: fmtNum(m.tradeCount, 0), sub: `${m.winCount} W · ${m.lossCount} L · ${m.breakevenCount} B`, note: 'Répartition gagnants / perdants / breakeven.' },
    { label: 'Profit Factor', value: m.profitFactor == null ? '—' : fmtNum(m.profitFactor), tone: profitFactorTone, note: 'Gains bruts ÷ pertes brutes.' },
    { label: 'Expectancy', value: fmtMoney(m.expectancy), sub: 'par trade', note: '(WR × gain moyen) − ((1−WR) × perte moyenne).' },
    { label: 'Win Rate', value: fmtPct(m.winRate, 1), sub: `${m.winCount} / ${m.tradeCount}`, note: 'Trades gagnants ÷ trades totaux.' },
    { label: 'Payoff Ratio', value: fmtNum(m.payoffRatio), note: 'Gain moyen ÷ perte moyenne.' },
    { label: 'SQN', value: m.sqn == null ? '—' : fmtNum(m.sqn), note: '(moyenne des R ÷ écart-type des R) × √n, plafonné à 100 trades (Van Tharp).' },
    { label: 'Max Drawdown', value: fmtMoney(m.maxDrawdown), sub: m.maxDrawdownPct != null ? fmtPct(m.maxDrawdownPct, 2) : undefined, tone: m.maxDrawdown < 0 ? 'neg' : 'neutral', note: 'Plus grande baisse pic→creux de l’equity curve ($ et %).' },
    { label: 'Sharpe', value: m.sharpe == null ? '—' : fmtNum(m.sharpe), note: 'Rendement moyen par trade ÷ écart-type. Non annualisé.' },
    { label: 'Sortino', value: m.sortino == null ? '—' : fmtNum(m.sortino), note: 'Comme Sharpe mais écart-type limité aux rendements négatifs. Non annualisé.' },
    { label: 'Ulcer Index', value: m.ulcer == null ? '—' : fmtNum(m.ulcer), note: '√(moyenne des carrés des % de drawdown à chaque point).' },
    { label: 'Kelly %', value: m.kelly == null ? '—' : fmtPct(m.kelly, 1), note: 'WR − ((1−WR) ÷ Payoff Ratio). Fraction du capital à risquer (théorique).' },
    { label: 'VaR jour (95%)', value: fmtMoney(m.var95), note: '5e percentile des résultats journaliers nets.' },
    { label: 'Avg R / ExitQ', value: `${m.avgR == null ? '—' : fmtNum(m.avgR, 2)}R`, sub: `Sortie ${m.avgExitQuality == null ? '—' : fmtPct(m.avgExitQuality, 0)}`, note: 'R = net ÷ risque (proxy : distance Entry→MAE). Qualité de sortie = profit ÷ MFE.' },
  ]

  return (
    <div className="stack">
      <DashboardControls
        accounts={accounts}
        accountFilter={accountFilter}
        setAccountFilter={setAccountFilter}
        period={period}
        setPeriod={setPeriod}
        customRange={customRange}
        setCustomRange={setCustomRange}
        sections={sections}
        optionsOpen={optionsOpen}
        setOptionsOpen={setOptionsOpen}
        toggleSection={toggleSection}
        resetSections={resetSections}
      />

      {sections.metrics && (
        <div className="metric-grid">
          {metricCards.map((c) => (
            <MetricCard key={c.label} {...c} />
          ))}
        </div>
      )}

      {moneyInfo && (
        <Card
          title={`Money management — ${accountFilter === 'global' ? 'Global' : selectedAccount.name} (${moneyInfo.type === 'trailing' ? 'Trailing' : moneyInfo.type === 'mixte' ? 'Mixte' : 'EOD'})`}
          note={moneyInfo.type === 'trailing' ? 'Trailing : max suit le plus haut equity intraday (par trade). EOD : max calculé à la clôture jour.' : 'EOD : seuil recalculé à 16h59 ET sur balance clôture, appliqué le lendemain.'}
        >
          <div className="metric-inline">
            <MetricCard
              label="Capital"
              value={fmtMoney(moneyInfo.capital, { sign: false })}
              sub={moneyInfo.max ? `Max ${fmtMoney(moneyInfo.max, { sign: false })} (${((moneyInfo.max / moneyInfo.capital) * 100).toFixed(1)}%)` : undefined}
              note="Capital alloué au compte"
            />
            <MetricCard
              label="Rendement"
              value={fmtPct(moneyInfo.pnl / moneyInfo.capital, 1)}
              sub={fmtMoney(moneyInfo.pnl)}
              tone={moneyInfo.pnl >= 0 ? 'pos' : 'neg'}
              note="Net P&L / Capital — non annualisé"
            />
            <MetricCard
              label="Distance au max"
              value={
                moneyInfo.max != null
                  ? moneyInfo.type === 'mixte'
                    ? `${fmtMoney(moneyInfo.max - (moneyInfo.ddReal || 0), { sign: true })} (EOD) / ${fmtMoney(moneyInfo.max - (moneyInfo.ddLatent || 0), { sign: true })} (Trailing)`
                    : fmtMoney(moneyInfo.max - (moneyInfo.dd || 0), { sign: true })
                  : '—'
              }
              sub={
                moneyInfo.max != null
                  ? moneyInfo.type === 'mixte'
                    ? `EOD DD ${fmtMoney(moneyInfo.ddReal || 0, { sign: false })} / Trailing DD ${fmtMoney(moneyInfo.ddLatent || 0, { sign: false })}`
                    : `Max DD ${fmtMoney(moneyInfo.dd || 0, { sign: false })} / Max ${fmtMoney(moneyInfo.max, { sign: false })}`
                  : undefined
              }
              tone={(() => {
                const remain = moneyInfo.max != null ? moneyInfo.max - (moneyInfo.dd || moneyInfo.ddReal || 0) : null
                return remain != null && remain < (moneyInfo.max || 0) * 0.3 ? 'neg' : 'neutral'
              })()}
              note={moneyInfo.type === 'trailing' ? 'Trailing : max − DD latent (intraday)' : moneyInfo.type === 'mixte' ? 'Mixte : EOD vs Trailing côte à côte' : 'EOD : max − DD clôture'}
            />
            <MetricCard
              label="Objectif"
              value={moneyInfo.target != null ? fmtMoney(moneyInfo.target, { sign: false }) : '—'}
              sub={moneyInfo.target != null && moneyInfo.capital ? `${((moneyInfo.target / moneyInfo.capital) * 100).toFixed(1)}% capital • reste ${fmtMoney(moneyInfo.target - moneyInfo.pnl, { sign: true })}` : undefined}
              note="Target du compte"
            />
          </div>
        </Card>
      )}

      <div className="grid-2">
{sections.equity && (
          <Card
            title="Equity réalisée vs latente"
            note="MAE agrégé par opération = somme des MAE des jambes (±1 min sur Exit, même compte/instrument, entrées qui se chevauchent). Approximation : suppose exposition simultanée au pire prix — voir limites. Ne pas interpréter comme prédiction."
          >
            <div className="metric-inline">
              <MetricCard label="Drawdown réalisé max" value={latentData.maxDrawdownRealise ? `−${fmtMoney(latentData.maxDrawdownRealise, { sign: false })}` : '—'} tone={latentData.maxDrawdownRealise > 0 ? 'neg' : 'neutral'} note="max(pic − equity réalisée) sur la période filtrée." />
              <MetricCard label="Drawdown latent max" value={latentData.maxDrawdownLatent ? `−${fmtMoney(latentData.maxDrawdownLatent, { sign: false })}` : '—'} tone={latentData.maxDrawdownLatent > 0 ? 'neg' : 'neutral'} note="max(pic précédent − equity latente), où equity latente = equity précédente − MAE agrégé." />
              <MetricCard label="Écart latent − réalisé" value={fmtMoney(latentData.ecart, { sign: true })} tone={latentData.ecart > 50 ? 'neg' : 'neutral'} note="Risque payé non visible sur l'equity clôturée." />
            </div>
            {latentData.warnings.length > 0 && (
              <div className="alert warn" style={{ marginBottom: 8 }}>{latentData.warnings.length} trade(s) exclu(s) : temps manquant — voir console.</div>
            )}
            <InfoNote>ⓘ Le MAE agrégé multi-jambes suppose exposition simultanée au pire instant ; un calcul exact nécessiterait le tick-by-tick (hors scope). La courbe est descriptive, pas prédictive.</InfoNote>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} onClick={handleChartClick}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="idx"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  allowDecimals={false}
                  label={{ value: 'Opération (ordre chronologique)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                  tickFormatter={(v) => {
                    const p = chartData[Math.round(v)]
                    return p ? fmtDateKey(toDateKey(p.date)) : ''
                  }}
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="pnl"
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString('en-US')}
                  label={{ value: 'PnL cumulé ($)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  labelFormatter={(v) => {
                    const p = chartData[Math.round(v)]
                    if (!p) return ''
                    return `${fmtDateKey(toDateKey(p.date))} — ${p.tradesCount} jambe(s)`
                  }}
                  formatter={(value, name, props) => {
                    const p = props && props.payload
                    if (!p) return [fmtMoney(value), name]
                    const ecart = p.cum - p.equityLatente
                    if (name === 'Equity latente') return [fmtMoney(value), `Equity latente — écart ${fmtMoney(ecart, { sign: true })} (descente ${fmtMoney(p.drawdownLatent, { sign: false })})`]
                    if (name === 'Equity réalisée') return [fmtMoney(value), `Equity réalisée — écart ${fmtMoney(ecart, { sign: true })} (DD ${fmtMoney(p.drawdownRealise, { sign: false })})`]
                    if (name === 'Drawdown') return [fmtMoney(p.drawdownRealise, { sign: false }), 'Drawdown réalisé']
                    return [fmtMoney(value), name]
                  }}
                />
                <Area
                  yAxisId="pnl"
                  type="monotone"
                  dataKey="dd$"
                  name="Drawdown"
                  stroke="var(--danger)"
                  fill="var(--danger)"
                  fillOpacity={0.12}
                  strokeOpacity={0.5}
                  dot={false}
                  activeDot={{ r: 5, onClick: dotClick }}
                />
                <Line
                  yAxisId="pnl"
                  type="monotone"
                  dataKey="cum"
                  name="Equity réalisée"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, onClick: dotClick }}
                />
                <Line
                  yAxisId="pnl"
                  type="monotone"
                  dataKey="equityLatente"
                  name="Equity latente"
                  stroke="#9b6dff"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={{ r: 5, onClick: dotClick }}
                />
                <ReferenceLine yAxisId="pnl" y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        )}

        {sections.rDist && (
          <Card
            title="Distribution des R-multiples"
            note="R = profit net ÷ risque, où le risque est approximé par la distance Entry → MAE (|MAE| en $). Approximation à garder en tête."
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={histogram} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 10 }}
                  interval={1}
                  label={{ value: 'R (profit ÷ risque)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                  label={{ value: 'Trades', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  labelFormatter={(l) => `R = ${l}`}
                  formatter={(v) => [fmtNum(v, 0), 'trades']}
                />
                <Bar dataKey="count" name="trades" radius={[3, 3, 0, 0]}>
                  {histogram.map((b) => (
                    <Cell key={b.key} fill={b.key >= 0 ? 'var(--pos)' : 'var(--danger)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {sections.dailyPnl && (
        <Card
          title="PnL par période"
          note="Barres cylindriques (comme R-multiple) : somme des PnL nets par jour / semaine / mois. Vert = période positive, rouge = négative."
        >
          <div className="card-toolbar">
            <div className="segmented">
              {[
                ['day', 'Daily'],
                ['week', 'Semaine'],
                ['month', 'Mois'],
              ].map(([val, label]) => (
                <button key={val} className={pnlBucket === val ? 'seg active' : 'seg'} onClick={() => setPnlBucket(val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyPnlData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={dailyPnlData.length > 12 ? -20 : 0}
                dy={dailyPnlData.length > 12 ? 10 : 0}
                height={dailyPnlData.length > 12 ? 50 : 30}
                label={{ value: pnlBucket === 'day' ? 'Jour' : pnlBucket === 'week' ? 'Semaine (lundi)' : 'Mois', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                tickFormatter={(v) => (pnlBucket === 'day' || pnlBucket === 'week' ? fmtDateKey(v) : v)}
              />
              <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString('en-US')} label={{ value: 'PnL net ($)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={(l) => (pnlBucket === 'month' ? `Mois ${l}` : fmtDateKey(l))} formatter={(v, _n, p) => [fmtMoney(v), `${p && p.payload ? p.payload.count : 0} trade(s)`]} />
              <Bar dataKey="pnl" name="PnL" radius={[8, 8, 0, 0]}>
                {dailyPnlData.map((e) => (
                  <Cell key={e.key} fill={e.pnl >= 0 ? 'var(--pos)' : 'var(--danger)'} />
                ))}
              </Bar>
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid-2">
        {sections.expectancy && (
          <Card
            title="Évolution de l’expectancy"
            note="Expectancy = P&L net moyen par trade sur la période (jour ou semaine). La courbe montre la moyenne glissante ; les barres montrent le P&L total du bucket."
          >
            <div className="card-toolbar">
              <div className="segmented">
                {[
                  ['day', 'Par jour'],
                  ['week', 'Par semaine'],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    className={expBucket === val ? 'seg active' : 'seg'}
                    onClick={() => setExpBucket(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={expSeries} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => fmtDateKey(toDateKey(Math.round(v)))}
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString('en-US')}
                  label={{ value: 'P&L net ($)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  labelFormatter={(v) => fmtDateKey(toDateKey(Math.round(v)))}
                  formatter={(value, name) => {
                    if (name === 'expectancy') return [fmtMoney(value), 'Expectancy (P&L/trade)']
                    if (name === 'cum') return [fmtMoney(value), 'Cumul expectancy']
                    return [fmtMoney(value), 'P&L du bucket']
                  }}
                />
                <Bar dataKey="pnl" name="pnl" fill="var(--bg-elev-2)" radius={[3, 3, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="expectancy"
                  name="expectancy"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="cum"
                  name="cum"
                  stroke="var(--accent-2)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
            <InfoNote>
              Expectancy cumulée (pointillés) = moyenne des expectancy de tous les buckets vus jusqu’ici. Utile pour voir si l’edge se stabilise ou se dégrade.
            </InfoNote>
          </Card>
        )}

        {sections.pnlDist && (
          <Card
            title="Distribution du P&L par trade"
            note="Histogramme des P&L nets individuels. Forme symétrique = rendements réguliers ; longue traîne à droite = gros gains rares ; à gauche = grosses pertes rares."
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pnlHist} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="center"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 10 }}
                  label={{ value: 'Net P&L par trade ($)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                  label={{ value: 'Trades', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  labelFormatter={(v) => `P&L ≈ ${fmtMoney(Math.round(v))}`}
                  formatter={(value) => [fmtNum(value, 0), 'trades']}
                />
                <Bar dataKey="count" name="trades" radius={[3, 3, 0, 0]}>
                  {pnlHist.map((b) => (
                    <Cell key={`${b.from}-${b.to}`} fill={b.center >= 0 ? 'var(--pos)' : 'var(--danger)'} />
                  ))}
                </Bar>
                <ReferenceLine x={m.expectancy != null ? m.expectancy : undefined} stroke="var(--accent-2)" strokeDasharray="4 4" />
              </BarChart>
            </ResponsiveContainer>
            <InfoNote>
              {m.expectancy != null && (
                <>
                  Ligne pointillée = expectancy moyenne ({fmtMoney(m.expectancy)} par trade). Distribution basée sur {filtered.length} trade(s).
                </>
              )}
            </InfoNote>
          </Card>
        )}
      </div>

      <div className="grid-2">
        {sections.heatmap && (
          <Card
            title="Heatmap — performance par jour de semaine et tranche horaire"
            note="Somme du net P&L des trades par jour de la semaine (lignes) et par tranche de 2h basée sur l’heure d’entrée. Vert = profitable, rouge = perdant."
          >
            <div className="heatmap">
              <div className="heatmap-label" />
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="heatmap-col-head">
                  {String(i * 2).padStart(2, '0')}
                </div>
              ))}
              {grid.map((row, dow) => (
                <div className="heatmap-row" key={dow}>
                  <div className="heatmap-label">{DAY_LABELS[dow]}</div>
                  {row.map((c, h) => {
                    const intensity = heatMax ? Math.min(1, Math.abs(c.pnl) / heatMax) : 0
                    const color =
                      c.count === 0
                        ? 'var(--bg-elev)'
                        : c.pnl >= 0
                          ? `rgba(34, 160, 92, ${0.15 + intensity * 0.8})`
                          : `rgba(220, 64, 64, ${0.15 + intensity * 0.8})`
                    return (
                      <div
                        key={h}
                        className="heatmap-cell"
                        style={{ backgroundColor: color }}
                        title={`${DAY_LABELS[dow]} ${String(h * 2).padStart(2, '0')}h-${String(h * 2 + 1).padStart(2, '0')}h — ${c.count} trade(s) · ${fmtMoney(c.pnl)}`}
                      >
                        {c.count > 0 && <span className="heatmap-count">{c.count}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <InfoNote>
              Les tranches horaires sont basées sur l’heure d’entrée de chaque trade (fuseau local de votre machine).
            </InfoNote>
          </Card>
        )}

        {sections.scatter && (
          <Card
            title="Qualité d'exécution — MAE vs MFE"
            note="Chaque point = un trade. X = MAE ($), Y = MFE ($). Définis un seuil MAE pour voir en dessous/au-dessus combien restent positifs."
          >
            <div className="form-row" style={{ marginBottom: 8, alignItems: 'center' }}>
              <label className="field-label" style={{ margin: 0 }}>Seuil MAE ($)</label>
              <input className="input" style={{ maxWidth: 110 }} value={maeThreshold} onChange={(e) => setMaeThreshold(e.target.value)} placeholder="ex: 40" inputMode="decimal" />
              {maeStats && (
                <span className="metric-sub">
                  Total : {fmtPct(m.winRate, 0)} ({m.winCount}/{filtered.length}) | ≤ seuil : {maeStats.below} trades ({maeStats.winBelow} gagnants, {maeStats.wrBelow != null ? fmtPct(maeStats.wrBelow, 0) : '—'})
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="MAE"
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString('en-US')}
                  label={{ value: 'MAE ($)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="MFE"
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString('en-US')}
                  label={{ value: 'MFE ($)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(value, name) => [fmtMoney(value), name]}
                />
                {maeThresholdNum != null && <ReferenceLine x={maeThresholdNum} stroke="#9b6dff" strokeDasharray="6 4" label={{ value: `Seuil ${maeThresholdNum}$`, fill: '#9b6dff', fontSize: 11, position: 'insideTopRight' }} />}
                <Scatter name="Perdant" data={scatterData.filter((d) => !d.win)} fill="var(--danger)" fillOpacity={0.7} />
                <Scatter name="Gagnant" data={scatterData.filter((d) => d.win)} fill="var(--pos)" fillOpacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      <div className="grid-2">
        {sections.exitQuality && (
          <Card
            title="Score de qualité de sortie"
            note="Qualité de sortie = profit réalisé ÷ MFE. Proche de 100 % = sortie optimale ; très bas = sortie prématurée (le MFE montrait un potentiel plus élevé)."
          >
            <div className="metric-inline">
              <MetricCard
                label="Moyenne période"
                value={m.avgExitQuality == null ? '—' : fmtPct(m.avgExitQuality, 0)}
                note="Moyenne des scores individuels profit ÷ MFE."
              />
              <MetricCard label="Score entrée" value={m.avgEntryQuality == null ? '—' : fmtNum(m.avgEntryQuality, 2)} note="Profit ÷ (|profit| + |MAE|). Proche de 1 = entrée qui a absorbé peu de mouvement adverse." />
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={exitSeries} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="idx"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  allowDecimals={false}
                  tickFormatter={(v) => {
                    const p = exitSeries[Math.round(v)]
                    return p ? fmtDateKey(toDateKey(p.date)) : ''
                  }}
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Trade (ordre chronologique)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${fmtNum(v * 100, 0)}%`}
                  label={{ value: 'Profit ÷ MFE', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  labelFormatter={(v) => {
                    const p = exitSeries[Math.round(v)]
                    return p ? `${fmtDateKey(toDateKey(p.date))} — trade #${p.idx + 1}` : ''
                  }}
                  formatter={(value) => [fmtPct(value, 1), 'Profit ÷ MFE']}
                />
                <Line type="monotone" dataKey="score" name="Profit ÷ MFE" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} />
                <ReferenceLine y={1} stroke="var(--pos)" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        )}

        {sections.streaks && (
          <Card title="Séquences (streaks)">
            <div className="metric-inline">
              <MetricCard label="Plus longue série gagnante" value={`${streaks.longestWin} trades`} tone="pos" />
              <MetricCard label="Plus longue série perdante" value={`${streaks.longestLoss} trades`} tone="neg" />
            </div>
            <div className="streak-grid">
              {streaks.streaks.map((s, i) => (
                <div
                  key={i}
                  className={`streak-square ${s.type}`}
                  title={`${s.length} trade(s) ${s.type === 'win' ? 'gagnant(s)' : s.type === 'loss' ? 'perdant(s)' : 'breakeven'} · ${fmtMoney(s.amount)}`}
                />
              ))}
            </div>
            <InfoNote>Chaque carré = une série consécutive de trades du même signe. Vert = série gagnante, rouge = perdante.</InfoNote>
          </Card>
        )}
      </div>

      {sections.discipline && (
        <Card title="Corrélation discipline / performance">
          <DisciplineTable by={disc.byPlan} labels={{ oui: 'Plan respecté', partiel: 'Partiellement', non: 'Plan non respecté' }} />
          <h4 className="sub-title">Par état émotionnel dominant</h4>
          <DisciplineTable by={disc.byEmotion} labels={null} />
          <InfoNote>Comparaison du P&L net des jours de trading selon le plan respecté (journal) et l’état émotionnel déclaré.</InfoNote>
        </Card>
      )}

      {sections.monteCarlo && (
        <MonteCarloCard filtered={filtered} accounts={accounts} accountFilter={accountFilter} />
      )}
    </div>
  )
}

function DisciplineTable({ by, labels }) {
  const entries = Object.entries(by)
  if (!entries.length) return <EmptyState message="Aucune entrée de journal sur cette période. Renseignez le plan respecté dans l'onglet Journal." />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Groupe</th>
            <th>Jours</th>
            <th>Jours tradés</th>
            <th>P&L net cumulé</th>
            <th>P&L moyen / jour tradé</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, e]) => (
            <tr key={key}>
              <td>{labels ? labels[key] || key : key}</td>
              <td>{e.count}</td>
              <td>{e.daysWithTrades}</td>
              <td className={e.pnl >= 0 ? 'text-pos' : 'text-neg'}>{fmtMoney(e.pnl)}</td>
              <td className={e.pnl >= 0 ? 'text-pos' : 'text-neg'}>
                {e.daysWithTrades ? fmtMoney(e.pnl / e.daysWithTrades) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DashboardControls({
  accounts,
  accountFilter,
  setAccountFilter,
  period,
  setPeriod,
  customRange,
  setCustomRange,
  sections,
  optionsOpen,
  setOptionsOpen,
  toggleSection,
  resetSections,
}) {
  return (
    <div className="controls">
      <Select value={String(accountFilter)} onChange={(v) => setAccountFilter(v === 'global' ? 'global' : Number(v))}>
        <option value="global">Global (tous les comptes)</option>
        {accounts.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select value={period} onChange={setPeriod}>
        {[
          ['week', 'Semaine'],
          ['month', 'Mois'],
          ['all', 'Tout'],
          ['custom', 'Personnalisé'],
        ].map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </Select>
      {period === 'custom' && (
        <div className="custom-range">
          <input type="date" value={customRange.from} onChange={(e) => setCustomRange({ ...customRange, from: e.target.value })} />
          <span>→</span>
          <input type="date" value={customRange.to} onChange={(e) => setCustomRange({ ...customRange, to: e.target.value })} />
        </div>
      )}
      <div className="dashboard-options">
        <Button variant="ghost" onClick={() => setOptionsOpen(!optionsOpen)}>
          {optionsOpen ? 'Masquer les options' : '⚙ Options d’affichage'}
        </Button>
        {optionsOpen && (
          <div className="options-panel">
            <div className="options-title">
              Éléments affichés sur le dashboard
              <Button variant="ghost" onClick={resetSections}>
                Tout réafficher
              </Button>
            </div>
            <div className="options-grid">
              {Object.entries(SECTION_LABELS).map(([key, label]) => (
                <label key={key} className="check-item">
                  <input
                    type="checkbox"
                    checked={Boolean(sections[key])}
                    onChange={() => toggleSection(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}