import { useMemo, useRef, useState } from 'react'
import * as db from '../db'
import { useData } from '../useData'
import { parseCsvFile, buildTradeRecords, FIELD_LABELS, ALL_FIELDS, REQUIRED_FIELDS } from '../csv'
import { Card, Button, Select, EmptyState, InfoNote } from './ui'
import { fmtMoney, fmtDateTime, fmtDateKey, fmtTime, toDateKey } from '../format'

const MAX_PREVIEW_ROWS = 15

export default function Accounts() {
  const { accounts, trades, batches, reload } = useData()
  const [newName, setNewName] = useState('')
  const [newCapital, setNewCapital] = useState('')
  const [newMax, setNewMax] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [newDrawdownType, setNewDrawdownType] = useState('eod')
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [editingCapital, setEditingCapital] = useState('')
  const [editingMax, setEditingMax] = useState('')
  const [editingTarget, setEditingTarget] = useState('')
  const [editingDrawdownType, setEditingDrawdownType] = useState('eod')
  const [error, setError] = useState(null)

  // Upload states
  const [accountId, setAccountId] = useState('')
  const [fileName, setFileName] = useState('')
  const [rawText, setRawText] = useState('')
  const [dateFormat, setDateFormat] = useState('auto')
  const [parsed, setParsed] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const fileInputRef = useRef(null)

  const stats = useMemo(() => {
    const m = {}
    for (const t of trades) {
      const key = String(t.accountId)
      const s = (m[key] = m[key] || { trades: 0, pnl: 0 })
      s.trades += 1
      s.pnl += t.netProfit
    }
    return m
  }, [trades])

  const existingKeys = useMemo(() => {
    if (!accountId) return new Set()
    return new Set(trades.filter((t) => String(t.accountId) === String(accountId)).map((t) => `${t.tradeNumber}|${t.entryTime}`))
  }, [trades, accountId])

  const parseNum = (v) => {
    if (v === '' || v == null) return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      setError('Un compte porte déjà ce nom.')
      return
    }
    await db.addAccount(name, {
      capital: parseNum(newCapital),
      maxDrawdown: parseNum(newMax),
      target: parseNum(newTarget),
      drawdownType: newDrawdownType,
    })
    setNewName('')
    setNewCapital('')
    setNewMax('')
    setNewTarget('')
    setNewDrawdownType('eod')
    setError(null)
    await reload()
  }

  const rename = async (id) => {
    const name = editingName.trim()
    if (!name) return
    await db.updateAccount(id, {
      name,
      capital: parseNum(editingCapital),
      maxDrawdown: parseNum(editingMax),
      target: parseNum(editingTarget),
      drawdownType: editingDrawdownType,
    })
    setEditingId(null)
    await reload()
  }

  const remove = async (acc) => {
    const n = stats[acc.id] ? stats[acc.id].trades : 0
    if (!window.confirm(`Supprimer le compte « ${acc.name} » ?\n${n} trade(s) et les historiques d'import associés seront définitivement perdus.`)) return
    await db.deleteAccount(acc.id)
    await reload()
  }

  const handleFile = async (file) => {
    setUploadError(null)
    setResult(null)
    setParsed(null)
    if (!accountId) {
      setUploadError('Sélectionnez d’abord un compte cible.')
      return
    }
    setFileName(file.name)
    setRawText('')
    setDateFormat('auto')
    const text = await file.text()
    setRawText(text)
    const res = parseCsvFile(text)
    if (!res.ok) {
      setUploadError(`Impossible de lire le fichier : ${res.fatalErrors.join(' ')}`)
      return
    }
    setParsed(res)
  }

  const createAccount = async () => {
    try {
      const id = await db.addAccount('Compte principal')
      setAccountId(Number(id))
      setError(null)
      await reload()
    } catch (err) {
      setError(`Erreur création compte : ${err && err.message ? err.message : err}`)
    }
  }

  const applyMapping = (mapping) => {
    if (!rawText) return
    const res = parseCsvFile(rawText, { mapping, dateFormat })
    setParsed(res)
  }

  const changeDateFormat = (fmt) => {
    setDateFormat(fmt)
    if (!rawText || !parsed) return
    const res = parseCsvFile(rawText, { mapping: parsed.mapping, dateFormat: fmt })
    setParsed(res)
  }

  const doImport = async () => {
    if (!parsed || !parsed.trades.length) return
    setImporting(true)
    setUploadError(null)
    setResult(null)
    try {
      const entryTimes = parsed.trades.map((t) => t.entryTime.getTime())
      const from = new Date(Math.min(...entryTimes))
      const to = new Date(Math.max(...entryTimes))
      const now = Date.now()
      const batchId = await db.addBatch({ accountId, fileName, uploadedAt: now, dateRangeCovered: [from.getTime(), to.getTime()], tradeCount: parsed.trades.length })
      const records = buildTradeRecords(parsed.trades, accountId, batchId, now)
      const toImport = records.filter((r) => !existingKeys.has(`${r.tradeNumber}|${r.entryTime}`))
      const skipped = records.length - toImport.length
      await db.addTrades(toImport)
      await reload()
      setResult({ imported: toImport.length, skipped, total: records.length, from, to })
      setParsed(null)
      setFileName('')
      setRawText('')
    } catch (err) {
      setUploadError(`Erreur lors de l’import : ${err && err.message ? err.message : err}`)
    } finally {
      setImporting(false)
    }
  }

  const requiredOk = parsed && parsed.missing && parsed.missing.length === 0
  const previewRows = parsed ? parsed.trades.slice(0, MAX_PREVIEW_ROWS) : []

  return (
    <div className="stack">
      <Card title="Ajouter un compte — Money management">
        <div className="form-row">
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Nom du compte (ex : Compte démo NQ)" />
          <Button variant="primary" onClick={add} disabled={!newName.trim()}>Ajouter</Button>
        </div>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <div className="field"><label className="field-label">Capital ($)</label><input className="input" value={newCapital} onChange={(e) => setNewCapital(e.target.value)} placeholder="50000" inputMode="decimal" /></div>
          <div className="field"><label className="field-label">Max drawdown ($)</label><input className="input" value={newMax} onChange={(e) => setNewMax(e.target.value)} placeholder="2000" inputMode="decimal" /></div>
          <div className="field"><label className="field-label">Objectif / Target ($)</label><input className="input" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="3000" inputMode="decimal" /></div>
          <div className="field"><label className="field-label">Type drawdown</label><Select value={newDrawdownType} onChange={setNewDrawdownType}><option value="eod">EOD (clôture)</option><option value="trailing">Trailing (intraday)</option></Select></div>
        </div>
        {(newCapital || newMax || newTarget) && <InfoNote>{newCapital && newMax ? `Max = ${fmtMoney(Number(newMax), { sign: false })} soit ${((Number(newMax)/Number(newCapital))*100).toFixed(1)}% du capital` : ''} {newCapital && newTarget ? ` • Target = ${((Number(newTarget)/Number(newCapital))*100).toFixed(1)}%` : ''} • EOD = seuil fixe jusqu'à clôture, Trailing = seuil qui suit l'equity intraday.</InfoNote>}
        {error && <div className="alert error">{error}</div>}
      </Card>

      <Card title="Importer un CSV NinjaTrader" note="Délimiteurs : ; (export Trades), virgule ou tabulation. Montants FR (58,00 $) ou US ($525.00), dates DD/MM/YYYY ou MM/DD/YYYY.">
        <div className="form-row">
          <label className="field-label">Compte cible</label>
          {accounts.length === 0 ? (
            <div>
              <EmptyState message="Aucun compte pour l'instant — créez-en un pour pouvoir importer." />
              <Button variant="primary" onClick={createAccount}>Créer « Compte principal »</Button>
            </div>
          ) : (
            <Select value={accountId} onChange={(v) => setAccountId(Number(v))}>
              <option value="" disabled>— Choisir un compte —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </div>

        <div className={`dropzone ${dragOver ? 'drag' : ''}`} onClick={() => fileInputRef.current && fileInputRef.current.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f) }}>
          <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) handleFile(f); e.target.value = '' }} />
          <div className="dropzone-main">
            {fileName ? <><div className="dropzone-file">{fileName}</div><div className="dropzone-hint">Cliquer pour choisir un autre fichier</div></> : <><div className="dropzone-icon">⬆</div><div className="dropzone-hint">Glissez-déposez votre export ici, ou cliquez pour parcourir</div></>}
          </div>
        </div>

        {uploadError && <div className="alert error">{uploadError}</div>}
        {parsed && (
          <div className="stack-sm">
            {parsed.missing.length > 0 && <div className="alert warn">Colonnes obligatoires non détectées : {parsed.missing.map((f) => FIELD_LABELS[f]).join(', ')}. Ajustez le mapping.</div>}
            {parsed.trades.length === 0 && <div className="alert warn">Aucune ligne reconnue — ce fichier ne ressemble pas à un export de performance.</div>}
            {parsed.parseErrors.length > 0 && <div className="alert warn">{parsed.parseErrors.length} ligne(s) ignorée(s) : {parsed.parseErrors.slice(0, 5).join(' · ')}</div>}
            {parsed.warnings.length > 0 && <div className="alert warn">{parsed.warnings.slice(0, 5).join(' · ')}{parsed.warnings.length > 5 && ` (+${parsed.warnings.length - 5} autres)`}</div>}
            <ColumnMapper headers={parsed.headers} mapping={parsed.mapping} dateFormat={dateFormat} onChange={applyMapping} onDateFormat={changeDateFormat} />
            <div className="import-summary">
              <div><strong>{parsed.trades.length}</strong> trade(s) détecté(s)</div>
              {parsed.trades.length > 0 && <><div>Du <strong>{fmtDateKey(toDateKey(Math.min(...parsed.trades.map((t) => t.entryTime.getTime()))))}</strong> au <strong>{fmtDateKey(toDateKey(Math.max(...parsed.trades.map((t) => t.entryTime.getTime()))))}</strong></div><div>Doublons déjà présents : <strong>{parsed.trades.filter((t) => existingKeys.has(`${t.tradeNumber}|${t.entryTime.getTime()}`)).length}</strong></div></>}
            </div>
            {previewRows.length > 0 && (
              <div className="table-wrap">
                <table className="table"><thead><tr><th>#</th><th>Instrument</th><th>Pos</th><th>Entrée</th><th>Sortie</th><th>Profit</th><th>MAE</th><th>MFE</th></tr></thead>
                <tbody>{previewRows.map((t) => <tr key={t.tradeNumber}><td>{t.tradeNumber}</td><td>{t.instrument}</td><td>{t.marketPos}</td><td>{fmtDateKey(toDateKey(t.entryTime.getTime()))} {fmtTime(t.entryTime.getTime())}</td><td>{fmtDateKey(toDateKey(t.exitTime.getTime()))} {fmtTime(t.exitTime.getTime())}</td><td className={t.profit >= 0 ? 'text-pos' : 'text-neg'}>{fmtMoney(t.profit)}</td><td>{fmtMoney(t.mae)}</td><td>{fmtMoney(t.mfe)}</td></tr>)}</tbody></table>
                {parsed.trades.length > MAX_PREVIEW_ROWS && <InfoNote>Aperçu limité aux {MAX_PREVIEW_ROWS} premières lignes.</InfoNote>}
              </div>
            )}
            <div className="form-row"><Button variant="primary" disabled={!requiredOk || parsed.trades.length === 0 || importing} onClick={doImport}>{importing ? 'Import en cours…' : 'Importer'}</Button></div>
          </div>
        )}
        {result && <div className="alert success">Import terminé : {result.imported} trade(s) ajouté(s){result.skipped > 0 && `, ${result.skipped} doublon(s) ignoré(s)`}{result.imported > 0 && ` — du ${fmtDateKey(toDateKey(result.from.getTime()))} au ${fmtDateKey(toDateKey(result.to.getTime()))}.`}</div>}
      </Card>

      {accounts.length === 0 ? <EmptyState message="Aucun compte pour l'instant." /> : (
        <Card title={`Comptes (${accounts.length})`}>
          <div className="table-wrap">
            <table className="table"><thead><tr><th>Nom</th><th>Capital / Max / Target</th><th>Type</th><th>Trades</th><th>Net P&L / Rendement</th><th>Dernier import</th><th>Actions</th></tr></thead>
            <tbody>{accounts.map((a) => {
              const s = stats[String(a.id)] || { trades: 0, pnl: 0 }
              const lastBatch = batches.find((b) => String(b.accountId) === String(a.id))
              const cap = a.capital, max = a.maxDrawdown, tgt = a.target
              const maxPct = cap && max ? ((max / cap) * 100).toFixed(1) : null
              const tgtPct = cap && tgt ? ((tgt / cap) * 100).toFixed(1) : null
              const rend = cap ? ((s.pnl / cap) * 100).toFixed(1) : null
              const isEditing = editingId === a.id
              return (
                <tr key={a.id}>
                  <td>{isEditing ? <input className="input" value={editingName} onChange={(e) => setEditingName(e.target.value)} /> : a.name}</td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                        <input className="input" value={editingCapital} onChange={(e) => setEditingCapital(e.target.value)} placeholder="Capital" />
                        <input className="input" value={editingMax} onChange={(e) => setEditingMax(e.target.value)} placeholder="Max" />
                        <input className="input" value={editingTarget} onChange={(e) => setEditingTarget(e.target.value)} placeholder="Target" />
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                        <div>{cap != null ? fmtMoney(cap, { sign: false }) : '—'}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{max != null ? `Max ${fmtMoney(max, { sign: false })}${maxPct ? ` (${maxPct}%)` : ''}` : 'Max —'}{tgt != null ? ` • Tgt ${fmtMoney(tgt, { sign: false })}${tgtPct ? ` (${tgtPct}%)` : ''}` : ''}</div>
                      </div>
                    )}
                  </td>
                  <td>{isEditing ? <Select value={editingDrawdownType} onChange={setEditingDrawdownType}><option value="eod">EOD</option><option value="trailing">Trailing</option></Select> : <span className={`badge ${a.drawdownType === 'trailing' ? 'warn' : 'neutral'}`}>{a.drawdownType === 'trailing' ? 'Trailing' : 'EOD'}</span>}</td>
                  <td>{s.trades}</td>
                  <td className={s.pnl >= 0 ? 'text-pos' : 'text-neg'}><div>{fmtMoney(s.pnl)}</div>{rend != null && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rend}% capital</div>}</td>
                  <td>{lastBatch ? `${fmtDateTime(lastBatch.uploadedAt)} — ${lastBatch.fileName}` : '—'}</td>
                  <td><div className="row-actions">{isEditing ? <><Button variant="ghost" onClick={() => rename(a.id)}>OK</Button><Button variant="ghost" onClick={() => setEditingId(null)}>Annuler</Button></> : <Button variant="ghost" onClick={() => { setEditingId(a.id); setEditingName(a.name); setEditingCapital(a.capital != null ? String(a.capital) : ''); setEditingMax(a.maxDrawdown != null ? String(a.maxDrawdown) : ''); setEditingTarget(a.target != null ? String(a.target) : ''); setEditingDrawdownType(a.drawdownType || 'eod') }}>Éditer</Button>}<Button variant="danger" onClick={() => remove(a)}>Supprimer</Button></div></td>
                </tr>
              )
            })}</tbody></table>
          </div>
        </Card>
      )}

      <Card title="Historique des fichiers importés">
        {batches.length === 0 ? <EmptyState message="Aucun fichier importé pour l'instant." /> : (
          <>
            <div className="table-wrap">
              <table className="table"><thead><tr><th>Fichier</th><th>Compte</th><th>Importé le</th><th>Période couverte</th><th>Trades</th><th>Action</th></tr></thead>
              <tbody>{batches.map((b) => {
                const acc = accounts.find((a) => String(a.id) === String(b.accountId))
                return (
                  <tr key={b.id}>
                    <td>{b.fileName || `#${b.id}`}</td>
                    <td>{acc ? acc.name : `#${b.accountId}`}</td>
                    <td>{b.uploadedAt ? fmtDateTime(b.uploadedAt) : '—'}</td>
                    <td>{Array.isArray(b.dateRangeCovered) && b.dateRangeCovered[0] ? `${fmtDateTime(b.dateRangeCovered[0])} → ${fmtDateTime(b.dateRangeCovered[1])}` : '—'}</td>
                    <td>{b.tradeCount ?? '—'}</td>
                    <td><Button variant="ghost" onClick={async () => { if (!window.confirm(`Supprimer "${b.fileName || b.id}" et ses trades ?`)) return; try { await db.deleteBatch(b.id); await reload() } catch (e) { alert(`Erreur: ${e.message}`) } }}>Supprimer</Button></td>
                  </tr>
                )
              })}</tbody></table>
            </div>
            <InfoNote>Suppression = batch + trades. Le bouton Importer est dans la section ci-dessus.</InfoNote>
          </>
        )}
      </Card>
    </div>
  )
}

function ColumnMapper({ headers, mapping, dateFormat, onChange, onDateFormat }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(mapping)
  const startEdit = () => { setDraft(mapping); setEditing(true) }
  const selectFor = (field) => (mapping[field] != null ? String(mapping[field]) : '')
  return (
    <div className="colmap">
      <div className="colmap-head"><strong>Mapping des colonnes</strong>{!editing && <Button variant="ghost" onClick={startEdit}>Ajuster</Button>}</div>
      {!editing ? <div className="colmap-summary">{ALL_FIELDS.filter((f) => mapping[f] != null).map((f) => <span key={f} className={`colmap-chip ${REQUIRED_FIELDS.includes(f) ? 'req' : ''}`}>{FIELD_LABELS[f]} → {headers[mapping[f]]}</span>)}</div> : (
        <div className="colmap-editor">
          <div className="table-wrap"><table className="table"><thead><tr><th>Champ</th><th>Colonne du fichier</th></tr></thead>
          <tbody>{ALL_FIELDS.map((f) => <tr key={f}><td>{FIELD_LABELS[f]}{REQUIRED_FIELDS.includes(f) && <span className="req-star"> *</span>}</td><td><Select value={selectFor(f)} onChange={(v) => setDraft({ ...draft, [f]: v === '' ? undefined : Number(v) })}><option value="">— non mappé —</option>{headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</Select></td></tr>)}</tbody></table></div>
          <div className="form-row"><Button variant="primary" onClick={() => { onChange(draft); setEditing(false) }}>Valider</Button><Button variant="ghost" onClick={() => setEditing(false)}>Annuler</Button></div>
        </div>
      )}
      <div className="form-row" style={{ marginTop: 10 }}><label className="field-label" style={{ margin: 0 }}>Format des dates</label><Select value={dateFormat} onChange={(v) => onDateFormat(v)}><option value="auto">Auto</option><option value="dd/mm">Jour/Mois</option><option value="mm/dd">Mois/Jour</option></Select></div>
    </div>
  )
}
