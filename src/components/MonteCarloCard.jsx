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
  ReferenceLine,
} from 'recharts'
import { monteCarlo } from '../metrics'
import { Card, MetricCard, EmptyState, InfoNote, Button, Select } from './ui'
import { fmtMoney, fmtNum, fmtPct } from '../format'

function tooltipStyle() {
  return {
    backgroundColor: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
  }
}

function poolOf(filtered, account) {
  if (account === 'global') return filtered
  return filtered.filter((t) => String(t.accountId) === String(account))
}

function poolSig(pool) {
  if (!pool.length) return '0'
  return `${pool.length}:${pool[0].entryTime}:${pool[pool.length - 1].entryTime}`
}

function clampParams(nSim, horizon) {
  const n = Math.max(100, Math.min(10000, Math.round(Number(String(nSim).replace(',', '.')) || 5000)))
  const h = Math.max(10, Math.min(2000, Math.round(Number(String(horizon).replace(',', '.')) || 200)))
  return { nSim: n, horizon: h }
}

export default function MonteCarloCard({ filtered, accounts, accountFilter }) {
  const [mcAccount, setMcAccount] = useState('global')
  const [mcNSim, setMcNSim] = useState('5000')
  const [mcHorizon, setMcHorizon] = useState('200')
  const [mcSeed, setMcSeed] = useState('')
  // Snapshot figé au clic Simuler (paramètres + pool) — rien ne recalcule avant le prochain clic
  const [mcRun, setMcRun] = useState(() => {
    const pool = poolOf(filtered, 'global')
    return { account: 'global', nSim: '5000', horizon: '200', seed: '', pool, sig: poolSig(pool) }
  })

  const runPool = mcRun.pool || []
  const runParams = clampParams(mcRun.nSim, mcRun.horizon)

  const mcAccountObj = useMemo(
    () => accounts.find((a) => String(a.id) === String(mcRun.account === 'global' ? accountFilter : mcRun.account)),
    [accounts, mcRun.account, accountFilter],
  )

  const mcResult = useMemo(
    () =>
      monteCarlo(runPool, {
        nSim: runParams.nSim,
        horizon: runParams.horizon,
        maxDrawdown: mcAccountObj && mcAccountObj.maxDrawdown != null ? mcAccountObj.maxDrawdown : null,
        target: mcAccountObj && mcAccountObj.target != null ? mcAccountObj.target : null,
        seed: mcRun.seed,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runPool, runParams.nSim, runParams.horizon, mcAccountObj, mcRun.seed],
  )

  const mcFan = useMemo(
    () =>
      (mcResult.fan || []).map((p) => ({
        ...p,
        band95: p.p95 != null && p.p5 != null ? p.p95 - p.p5 : 0,
      })),
    [mcResult],
  )

  const mcHist = useMemo(() => {
    const vals = mcResult.finalPnls || []
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
  }, [mcResult])

  const livePool = poolOf(filtered, mcAccount)
  const mcDirty =
    String(mcAccount) !== String(mcRun.account) ||
    mcNSim !== mcRun.nSim ||
    mcHorizon !== mcRun.horizon ||
    mcSeed !== mcRun.seed ||
    poolSig(livePool) !== mcRun.sig

  const runMonteCarlo = () => {
    const pool = poolOf(filtered, mcAccount)
    setMcRun({ account: mcAccount, nSim: mcNSim, horizon: mcHorizon, seed: mcSeed, pool, sig: poolSig(pool) })
  }

  return (
    <Card
      title="Simulation Monte Carlo"
      note="Bootstrap avec remise sur les netProfit par trade (suppose les trades i.i.d — ignore streaks et régimes). Seuil de ruine = maxDrawdown du compte. Non prédictif."
    >
      <div className="form-row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ minWidth: 180 }}>
          <label className="field-label">Compte simulé</label>
          <Select value={String(mcAccount)} onChange={(v) => setMcAccount(v === 'global' ? 'global' : Number(v))}>
            <option value="global">Global (filtre actuel)</option>
            {accounts.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="field" style={{ maxWidth: 110 }}>
          <label className="field-label">Simulations</label>
          <input className="input" value={mcNSim} onChange={(e) => setMcNSim(e.target.value)} placeholder="5000" inputMode="numeric" />
        </div>
        <div className="field" style={{ maxWidth: 110 }}>
          <label className="field-label">Horizon (trades)</label>
          <input className="input" value={mcHorizon} onChange={(e) => setMcHorizon(e.target.value)} placeholder="200" inputMode="numeric" />
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label className="field-label">Seed (rejouable)</label>
          <input className="input" value={mcSeed} onChange={(e) => setMcSeed(e.target.value)} placeholder="aléatoire" inputMode="numeric" />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label className="field-label">&nbsp;</label>
          <Button variant="primary" onClick={runMonteCarlo}>
            Simuler
          </Button>
        </div>
      </div>
      {mcDirty && (
        <div className="alert warn" style={{ marginTop: 8 }}>
          Paramètres ou filtre modifiés — clique sur « Simuler » pour relancer.
        </div>
      )}
      {runPool.length === 0 ? (
        <EmptyState message="Aucun trade pour ce compte sur la période filtrée." />
      ) : mcResult.empty ? (
        <EmptyState message="Pas assez de données pour simuler." />
      ) : (
        <>
          <div className="metric-inline">
            <MetricCard
              label="Médiane finale"
              value={fmtMoney(mcResult.medianFinal)}
              sub={`${mcResult.nSim} sims × ${mcResult.horizon} trades · seed ${mcResult.seedUsed}`}
              tone={mcResult.medianFinal >= 0 ? 'pos' : 'neg'}
              note="P&L final médian sur l'horizon simulé."
            />
            <MetricCard
              label="P5 / P95"
              value={`${fmtMoney(mcResult.p5Final, { sign: false })} / ${fmtMoney(mcResult.p95Final, { sign: false })}`}
              note="Intervalle à 90 % des P&L finaux."
            />
            <MetricCard
              label="Proba ruine"
              value={mcResult.probRuin == null ? '—' : fmtPct(mcResult.probRuin, 1)}
              sub={mcAccountObj && mcAccountObj.maxDrawdown != null ? `max ${fmtMoney(mcAccountObj.maxDrawdown, { sign: false })}` : 'max non défini'}
              tone={mcResult.probRuin != null && mcResult.probRuin > 0.2 ? 'neg' : 'neutral'}
              note="Part des sims qui finissent sous −maxDrawdown."
            />
            <MetricCard
              label="Proba target"
              value={mcResult.probTarget == null ? '—' : fmtPct(mcResult.probTarget, 1)}
              sub={mcAccountObj && mcAccountObj.target != null ? `target ${fmtMoney(mcAccountObj.target, { sign: false })}` : 'target non défini'}
              note="Part des sims qui atteignent l'objectif."
            />
            <MetricCard
              label="MaxDD médian"
              value={mcResult.medianMaxDD != null ? `−${fmtMoney(mcResult.medianMaxDD, { sign: false })}` : '—'}
              note="Drawdown maximal médian sur l'horizon."
            />
          </div>
          <div className="grid-2">
            <div>
              <h4 className="sub-title">Éventail des trajectoires (P5–P95)</h4>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={mcFan} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="step"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    allowDecimals={false}
                    stroke="var(--text-muted)"
                    tick={{ fontSize: 11 }}
                    label={{ value: 'Trade simulé', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis
                    stroke="var(--text-muted)"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => v.toLocaleString('en-US')}
                    label={{ value: 'PnL cumulé ($)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    labelFormatter={(v) => `Trade simulé #${v}`}
                    formatter={(value, name) => {
                      if (name === 'p50') return [fmtMoney(value), 'Médiane']
                      if (name === 'p5') return [fmtMoney(value), 'P5']
                      if (name === 'p95') return [fmtMoney(value), 'P95']
                      return [fmtMoney(value), name]
                    }}
                  />
                  <Area dataKey="p5" stackId="1" stroke="none" fill="transparent" dot={false} legendType="none" tooltipType="none" />
                  <Area dataKey="band95" stackId="1" stroke="none" fill="var(--accent)" fillOpacity={0.18} dot={false} name="Bande P5–P95" tooltipType="none" />
                  <Line type="monotone" dataKey="p50" name="p50" stroke="var(--accent)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="p5" name="p5" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                  <Line type="monotone" dataKey="p95" name="p95" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                  {mcAccountObj && mcAccountObj.maxDrawdown != null && (
                    <ReferenceLine y={-mcAccountObj.maxDrawdown} stroke="var(--danger)" strokeDasharray="6 4" label={{ value: 'Ruine (−max)', fill: 'var(--danger)', fontSize: 11, position: 'insideTopRight' }} />
                  )}
                  {mcAccountObj && mcAccountObj.target != null && (
                    <ReferenceLine y={mcAccountObj.target} stroke="var(--pos)" strokeDasharray="6 4" label={{ value: 'Target', fill: 'var(--pos)', fontSize: 11, position: 'insideTopRight' }} />
                  )}
                  <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h4 className="sub-title">Distribution des P&L finaux</h4>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={mcHist} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="center"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="var(--text-muted)"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    label={{ value: 'P&L final ($)', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} allowDecimals={false} label={{ value: 'Sims', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    labelFormatter={(v) => `P&L final ≈ ${fmtMoney(Math.round(v))}`}
                    formatter={(value) => [fmtNum(value, 0), 'sims']}
                  />
                  <Bar dataKey="count" name="sims" radius={[8, 8, 0, 0]}>
                    {mcHist.map((b) => (
                      <Cell key={`${b.from}-${b.to}`} fill={b.center >= 0 ? 'var(--pos)' : 'var(--danger)'} />
                    ))}
                  </Bar>
                  <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
                  {mcResult.medianFinal != null && <ReferenceLine x={mcResult.medianFinal} stroke="var(--accent)" strokeDasharray="4 4" />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <InfoNote>
            Bootstrap : chaque pas tire un trade historique au hasard (avec remise). Suppose les trades indépendants — les streaks et régimes (matin/après-midi) ne sont pas modélisés. Horizon {mcResult.horizon} trades · seed {mcResult.seedUsed} (ressaisis-le pour rejouer la même simulation).
          </InfoNote>
        </>
      )}
    </Card>
  )
}
