import { useMemo, useRef, useState } from 'react'
import * as db from '../db'
import { useData } from '../useData'
import {
  parseCsvFile,
  buildTradeRecords,
  FIELD_LABELS,
  ALL_FIELDS,
  REQUIRED_FIELDS,
} from '../csv'
import { Card, Button, Select, EmptyState, InfoNote } from './ui'
import { fmtMoney, fmtDateKey, fmtDateTime, fmtTime, toDateKey } from '../format'

const MAX_PREVIEW_ROWS = 15

export default function Upload() {
  const data = useData() || {}
  const accounts = Array.isArray(data.accounts) ? data.accounts : []
  const trades = Array.isArray(data.trades) ? data.trades : []
  const batches = Array.isArray(data.batches) ? data.batches : []
  const reload = data.reload || (() => {})
  const [accountId, setAccountId] = useState('')
  const [fileName, setFileName] = useState('')
  const [rawText, setRawText] = useState('')
  const [dateFormat, setDateFormat] = useState('auto')
  const [parsed, setParsed] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const existingKeys = useMemo(() => {
    if (!accountId) return new Set()
    return new Set(
      trades.filter((t) => String(t.accountId) === String(accountId)).map((t) => `${t.tradeNumber}|${t.entryTime}`),
    )
  }, [trades, accountId])

  const handleFile = async (file) => {
    setError(null)
    setResult(null)
    setParsed(null)
    if (!accountId) {
      setError('Sélectionnez d’abord un compte cible.')
      return
    }
    setFileName(file.name)
    setRawText('')
    setDateFormat('auto')
    const text = await file.text()
    setRawText(text)
    const res = parseCsvFile(text)
    if (!res.ok) {
      setError(
        `Impossible de lire le fichier : ${res.fatalErrors.join(' ')}`,
      )
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
      setError(`Erreur lors de la création du compte : ${err && err.message ? err.message : err}`)
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
    setError(null)
    setResult(null)
    try {
      const entryTimes = parsed.trades.map((t) => t.entryTime.getTime())
      const from = new Date(Math.min(...entryTimes))
      const to = new Date(Math.max(...entryTimes))
      const now = Date.now()
      const batchId = await db.addBatch({
        accountId,
        fileName,
        uploadedAt: now,
        dateRangeCovered: [from.getTime(), to.getTime()],
        tradeCount: parsed.trades.length,
      })
      const records = buildTradeRecords(parsed.trades, accountId, batchId, now)
      const toImport = records.filter((r) => !existingKeys.has(`${r.tradeNumber}|${r.entryTime}`))
      const skipped = records.length - toImport.length
      await db.addTrades(toImport)
      await reload()
      setResult({
        imported: toImport.length,
        skipped,
        total: records.length,
        from,
        to,
      })
      setParsed(null)
      setFileName('')
      setRawText('')
    } catch (err) {
      setError(`Erreur lors de l’import : ${err && err.message ? err.message : err}`)
    } finally {
      setImporting(false)
    }
  }

  const requiredOk = parsed && parsed.missing && parsed.missing.length === 0
  const previewRows = parsed ? parsed.trades.slice(0, MAX_PREVIEW_ROWS) : []

  return (
    <div className="stack">
      <Card title="Historique des fichiers importés">
        {batches.length === 0 ? (
          <EmptyState message="Aucun fichier importe pour l'instant." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fichier</th><th>Compte</th><th>Date</th><th>Periode</th><th>Trades</th><th>Action</th></tr></thead>
                <tbody>
                  {batches.map((b) => {
                    const acc = accounts.find((a) => String(a.id) === String(b.accountId))
                    return (
                      <tr key={b.id}>
                        <td>{b.fileName || `#${b.id}`}</td>
                        <td>{acc ? acc.name : `#${b.accountId}`}</td>
                        <td>{b.uploadedAt ? fmtDateTime(b.uploadedAt) : '—'}</td>
                        <td>{Array.isArray(b.dateRangeCovered) && b.dateRangeCovered[0] ? `${fmtDateKey(toDateKey(b.dateRangeCovered[0]))} → ${fmtDateKey(toDateKey(b.dateRangeCovered[1]))}` : '—'}</td>
                        <td>{b.tradeCount ?? '—'}</td>
                        <td><Button variant="ghost" onClick={async () => { if (!window.confirm(`Supprimer le fichier "${b.fileName || b.id}" et ses trades ?`)) return; try { await db.deleteBatch(b.id); await reload() } catch (e) { alert(`Erreur suppression: ${e.message}`) } }}>Supprimer</Button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <InfoNote>Suppression = trades + batch. Pour corriger le 21/08 (double frais), supprime le batch puis reimporte le CSV.</InfoNote>
          </>
        )}
      </Card>
      <Card title="Importer un CSV NinjaTrader" note="Délimiteurs : ; (export Trades de NinjaTrader), virgule ou tabulation. Montants FR (58,00 $) ou US ($525.00), dates DD/MM/YYYY ou MM/DD/YYYY.">
        <div className="form-row">
          <label className="field-label">Compte cible</label>
          {accounts.length === 0 ? (
            <div>
              <EmptyState message="Aucun compte pour l'instant — créez-en un pour pouvoir importer vos trades." />
              <Button variant="primary" onClick={createAccount}>
                Créer un compte « Compte principal »
              </Button>
            </div>
          ) : (
            <Select value={accountId} onChange={(v) => setAccountId(Number(v))}>
              <option value="" disabled>
                — Choisir un compte —
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div
          className={`dropzone ${dragOver ? 'drag' : ''}`}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files && e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
          <div className="dropzone-main">
            {fileName ? (
              <>
                <div className="dropzone-file">{fileName}</div>
                <div className="dropzone-hint">Cliquer pour choisir un autre fichier</div>
              </>
            ) : (
              <>
                <div className="dropzone-icon">⬆</div>
                <div className="dropzone-hint">Glissez-déposez votre export NinjaTrader ici, ou cliquez pour parcourir</div>
              </>
            )}
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        {parsed && (
          <div className="stack-sm">
            {parsed.missing.length > 0 && (
              <div className="alert warn">
                Colonnes obligatoires non détectées : {parsed.missing.map((f) => FIELD_LABELS[f]).join(', ')}.
                Ajustez le mapping ci-dessous.
              </div>
            )}
            {parsed.trades.length === 0 && (
              <div className="alert warn">
                Aucune ligne de trade reconnue dans ce fichier. Vérifiez le mapping ci-dessous —
                ce fichier ne ressemble pas à un export de performance (ex : la fenêtre « Grid » de
                NinjaTrader exporte des logs/erreurs, pas des trades).
              </div>
            )}
            {parsed.parseErrors.length > 0 && (
              <div className="alert warn">
                {parsed.parseErrors.length} ligne(s) ignorée(s) : {parsed.parseErrors.slice(0, 5).join(' · ')}
              </div>
            )}
            {parsed.warnings.length > 0 && (
              <div className="alert warn">
                {parsed.warnings.slice(0, 5).join(' · ')}
                {parsed.warnings.length > 5 && ` (+${parsed.warnings.length - 5} autres)`}
              </div>
            )}

            <ColumnMapper
              headers={parsed.headers}
              mapping={parsed.mapping}
              dateFormat={dateFormat}
              onChange={applyMapping}
              onDateFormat={changeDateFormat}
            />

            <div className="import-summary">
              <div><strong>{parsed.trades.length}</strong> trade(s) détecté(s)</div>
              {parsed.trades.length > 0 && (
                <>
                  <div>
                    Du <strong>{fmtDateKey(toDateKey(Math.min(...parsed.trades.map((t) => t.entryTime.getTime()))))}</strong> au{' '}
                    <strong>{fmtDateKey(toDateKey(Math.max(...parsed.trades.map((t) => t.entryTime.getTime()))))}</strong>
                  </div>
                  <div>
                    Doublons déjà présents : <strong>{parsed.trades.filter((t) => existingKeys.has(`${t.tradeNumber}|${t.entryTime.getTime()}`)).length}</strong>
                  </div>
                </>
              )}
            </div>

            {previewRows.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Instrument</th>
                      <th>Pos</th>
                      <th>Entrée</th>
                      <th>Sortie</th>
                      <th>Profit</th>
                      <th>MAE</th>
                      <th>MFE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((t) => (
                      <tr key={t.tradeNumber}>
                        <td>{t.tradeNumber}</td>
                        <td>{t.instrument}</td>
                        <td>{t.marketPos}</td>
                        <td>
                          {fmtDateKey(toDateKey(t.entryTime.getTime()))} {fmtTime(t.entryTime.getTime())}
                        </td>
                        <td>
                          {fmtDateKey(toDateKey(t.exitTime.getTime()))} {fmtTime(t.exitTime.getTime())}
                        </td>
                        <td className={t.profit >= 0 ? 'text-pos' : 'text-neg'}>{fmtMoney(t.profit)}</td>
                        <td>{fmtMoney(t.mae)}</td>
                        <td>{fmtMoney(t.mfe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.trades.length > MAX_PREVIEW_ROWS && (
                  <InfoNote>Aperçu limité aux {MAX_PREVIEW_ROWS} premières lignes.</InfoNote>
                )}
              </div>
            )}

            <div className="form-row">
              <Button variant="primary" disabled={!requiredOk || parsed.trades.length === 0 || importing} onClick={doImport}>
                {importing ? 'Import en cours…' : 'Importer'}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="alert success">
            Import terminé : {result.imported} trade(s) ajouté(s)
            {result.skipped > 0 && `, ${result.skipped} doublon(s) ignoré(s)`}
            {result.imported > 0 && ` — du ${fmtDateKey(toDateKey(result.from.getTime()))} au ${fmtDateKey(toDateKey(result.to.getTime()))}.`}
          </div>
        )}
      </Card>
    </div>
  )
}

function ColumnMapper({ headers, mapping, dateFormat, onChange, onDateFormat }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(mapping)

  const startEdit = () => {
    setDraft(mapping)
    setEditing(true)
  }

  const selectFor = (field) => (mapping[field] != null ? String(mapping[field]) : '')

  return (
    <div className="colmap">
      <div className="colmap-head">
        <strong>Mapping des colonnes</strong>
        {!editing && <Button variant="ghost" onClick={startEdit}>Ajuster</Button>}
      </div>
      {!editing ? (
        <div className="colmap-summary">
          {ALL_FIELDS.filter((f) => mapping[f] != null).map((f) => (
            <span key={f} className={`colmap-chip ${REQUIRED_FIELDS.includes(f) ? 'req' : ''}`}>
              {FIELD_LABELS[f]} → {headers[mapping[f]]}
            </span>
          ))}
        </div>
      ) : (
        <div className="colmap-editor">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Champ</th>
                  <th>Colonne du fichier</th>
                </tr>
              </thead>
              <tbody>
                {ALL_FIELDS.map((f) => (
                  <tr key={f}>
                    <td>
                      {FIELD_LABELS[f]}
                      {REQUIRED_FIELDS.includes(f) && <span className="req-star"> *</span>}
                    </td>
                    <td>
                      <Select value={selectFor(f)} onChange={(v) => setDraft({ ...draft, [f]: v === '' ? undefined : Number(v) })}>
                        <option value="">— non mappé —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-row">
            <Button
              variant="primary"
              onClick={() => {
                onChange(draft)
                setEditing(false)
              }}
            >
              Valider le mapping
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      <div className="form-row" style={{ marginTop: 10 }}>
        <label className="field-label" style={{ margin: 0 }}>
          Format des dates
        </label>
        <Select value={dateFormat} onChange={(v) => onDateFormat(v)}>
          <option value="auto">Auto (détection)</option>
          <option value="dd/mm">Jour/Mois (10/08/2026 → 10 août)</option>
          <option value="mm/dd">Mois/Jour (06/15/2026 → 15 juin)</option>
        </Select>
      </div>
    </div>
  )
}