import { useEffect, useMemo, useRef, useState } from 'react'
import * as db from '../db'
import { useData } from '../useData'
import { Card, Button, EmptyState, Badge } from './ui'
import { fmtMoney, fmtTime, toDateKey, todayKey, uid } from '../format'

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

export default function Journal({ initialDate }) {
  const { journals, trades, accounts, emotionTags, contextTags, checklistRules, reload } = useData()
  const [selectedDate, setSelectedDate] = useState(initialDate || todayKey())
  const [monthOffset, setMonthOffset] = useState(0)

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate)
  }, [initialDate])

  const journalByDate = useMemo(() => {
    const m = {}
    for (const j of journals) m[j.date] = j
    return m
  }, [journals])

  const dailyPnl = useMemo(() => {
    const m = {}
    for (const t of trades) {
      const k = toDateKey(t.entryTime)
      m[k] = (m[k] || 0) + t.netProfit
    }
    return m
  }, [trades])

  const dayTrades = useMemo(
    () =>
      trades
        .filter((t) => toDateKey(t.entryTime) === selectedDate)
        .sort((a, b) => a.entryTime - b.entryTime),
    [trades, selectedDate],
  )

  const currentEntry = journalByDate[selectedDate]

  return (
    <div className="journal-layout">
      <Card className="journal-cal">
        <div className="cal-nav">
          <Button variant="ghost" onClick={() => setMonthOffset((o) => o - 1)}>‹</Button>
          <div className="cal-title">
            {fmtMonthTitle(selectedDate, monthOffset)}
          </div>
          <Button variant="ghost" onClick={() => setMonthOffset((o) => o + 1)}>›</Button>
          <Button variant="ghost" onClick={() => { setMonthOffset(0); setSelectedDate(todayKey()) }}>Aujourd&#39;hui</Button>
        </div>
        <div className="cal-grid">
          {DAY_LABELS.map((d, i) => (
            <div key={i} className="cal-dow">{d}</div>
          ))}
          <CalendarCells
            monthOffset={monthOffset}
            selectedDate={selectedDate}
            journalByDate={journalByDate}
            dailyPnl={dailyPnl}
            onSelect={setSelectedDate}
          />
        </div>
        <div className="cal-legend">
          <span className="legend-item"><span className="legend-dot journaled" /> journal écrit</span>
          <span className="legend-item"><span className="legend-dot profit" /> jour profitable</span>
          <span className="legend-item"><span className="legend-dot loss" /> jour perdant</span>
        </div>
      </Card>

      <DayEditor
        date={selectedDate}
        entry={currentEntry}
        dayTrades={dayTrades}
        accounts={accounts}
        emotionTags={emotionTags}
        contextTags={contextTags}
        checklistRules={checklistRules}
        reload={reload}
      />
    </div>
  )
}

function fmtMonthTitle(dateKey, offset) {
  const base = new Date(`${dateKey}T00:00:00`)
  const target = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  return `${target.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
}

function CalendarCells({ monthOffset, selectedDate, journalByDate, dailyPnl, onSelect }) {
  const base = new Date(`${selectedDate}T00:00:00`)
  const target = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1)
  const year = target.getFullYear()
  const month = target.getMonth()
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toDateKey(new Date(year, month, d).getTime())
    cells.push({ key, day: d })
  }
  const rows = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const curMonthKey = toDateKey(new Date(year, month, 1).getTime()).slice(0, 7)

  return rows.map((row, ri) =>
    row.map((cell, ci) => {
      if (!cell) return <div key={`${ri}-${ci}`} className="cal-cell empty" />
      const pnl = dailyPnl[cell.key]
      const hasJournal = Boolean(journalByDate[cell.key])
      const isToday = cell.key === todayKey()
      const isSelected = cell.key === selectedDate
      const isCurrentMonth = cell.key.slice(0, 7) === curMonthKey
      let tone = ''
      if (pnl != null) tone = pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : 'flat'
      return (
        <div
          key={cell.key}
          className={`cal-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isCurrentMonth ? '' : 'other'}`}
          onClick={() => onSelect(cell.key)}
          title={`${cell.key}${pnl != null ? ` — ${fmtMoney(pnl)}` : ''}`}
        >
          <span className="cal-daynum">{cell.day}</span>
          {hasJournal && <span className="cal-journal-dot" />}
          {pnl != null && <span className={`cal-pnl ${tone}`}>{pnl > 0 ? '+' : ''}{Math.round(pnl).toLocaleString('en-US')}</span>}
        </div>
      )
    }),
  )
}

function DayEditor({ date, entry, dayTrades, accounts, emotionTags, contextTags, checklistRules, reload }) {
  const [text, setText] = useState('')
  const [screenshots, setScreenshots] = useState([])
  const [planRespected, setPlanRespected] = useState(null)
  const [emotionTag, setEmotionTag] = useState('')
  const [selectedContext, setSelectedContext] = useState([])
  const [checklist, setChecklist] = useState({})
  const [savedAt, setSavedAt] = useState(null)
  const [zoomImg, setZoomImg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState(Boolean(entry))
  const fileRef = useRef(null)
  const prevDateRef = useRef(date)

  useEffect(() => {
    setText(entry ? entry.text || '' : '')
    setScreenshots(
      entry
        ? Array.isArray(entry.screenshots) && entry.screenshots.length
          ? [...entry.screenshots]
          : entry.screenshotBase64
            ? [entry.screenshotBase64]
            : []
        : [],
    )
    setPlanRespected(entry ? entry.planRespected || null : null)
    setEmotionTag(entry ? entry.emotionTag || '' : '')
    setSelectedContext(entry && Array.isArray(entry.contextTags) ? [...entry.contextTags] : [])
    setChecklist(entry && entry.checklist ? { ...entry.checklist } : {})
    setError(null)
    setViewMode(Boolean(entry))
    if (prevDateRef.current !== date) {
      setSavedAt(null)
      prevDateRef.current = date
    }
  }, [entry, date])

  const onScreenshot = (file) => {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('Image trop volumineuse (> 8 Mo). Choisissez une capture plus légère.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setScreenshots((prev) => {
        const next = [...prev, reader.result]
        return next.length > 12 ? next.slice(next.length - 12) : next
      })
    }
    reader.readAsDataURL(file)
  }

  const onScreenshotFiles = (files) => {
    for (const f of files) onScreenshot(f)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const existing = entry
      const payload = {
        ...(existing ? { id: existing.id } : {}),
        date,
        text,
        screenshots,
        planRespected: planRespected || null,
        emotionTag: emotionTag || null,
        contextTags: selectedContext.length ? selectedContext : [],
        checklist,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
      }
      await db.saveJournalEntry(payload)
      await reload()
      setSavedAt(new Date())
      setViewMode(true)
    } catch (err) {
      setError(`Erreur : ${err && err.message ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }

  const removeEntry = async () => {
    if (!entry) return
    if (!window.confirm('Supprimer cette entrée de journal ?')) return
    await db.deleteJournalEntry(entry.id)
    await reload()
    setSavedAt(null)
  }

  const checkedCount = Object.values(checklist).filter(Boolean).length
  const conformity = checklistRules.length ? Math.round((checkedCount / checklistRules.length) * 100) : null
  const accountName = useMemo(() => {
    const m = {}
    for (const a of accounts) m[String(a.id)] = a.name
    return m
  }, [accounts])

  return (
    <Card className="journal-editor">
      <div className="editor-head">
        <h3 className="card-title">{fmtLongDate(date)}</h3>
        <div className="editor-trades-info">
          {dayTrades.length} trade(s) · {fmtMoney(dayTrades.reduce((s, t) => s + t.netProfit, 0))}
        </div>
      </div>

      {viewMode && entry ? (
        <div className="journal-view">
          {entry.text ? (
            <div className="journal-view-section">
              <label className="field-label">Analyse de la journée</label>
              <div className="journal-view-text">{entry.text}</div>
            </div>
          ) : (
            <EmptyState message="Aucune analyse écrite pour cette journée." />
          )}

          {Array.isArray(entry.screenshots) && entry.screenshots.length > 0 && (
            <div className="journal-view-section">
              <label className="field-label">Screenshots ({entry.screenshots.length})</label>
              <div className="shot-grid">
                {entry.screenshots.map((src, i) => (
                  <div key={i} className="shot">
                    <img src={src} alt={`Screenshot ${i + 1}`} onClick={() => setZoomImg(src)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(entry.planRespected || entry.emotionTag) && (
            <div className="journal-view-section">
              <label className="field-label">Exécution</label>
              <div className="journal-view-badges">
                {entry.planRespected && (
                  <Badge tone={entry.planRespected === 'oui' ? 'pos' : entry.planRespected === 'partiel' ? 'warn' : 'neg'}>
                    {entry.planRespected === 'oui' ? 'Plan respecté' : entry.planRespected === 'partiel' ? 'Plan partiellement respecté' : 'Plan non respecté'}
                  </Badge>
                )}
                {entry.emotionTag && <Badge tone="neutral">{entry.emotionTag}</Badge>}
              </div>
            </div>
          )}

          {Array.isArray(entry.contextTags) && entry.contextTags.length > 0 && (
            <div className="journal-view-section">
              <label className="field-label">Contexte</label>
              <div className="journal-view-badges">
                {entry.contextTags.map((t) => (
                  <Badge key={t} tone="accent">{t}</Badge>
                ))}
              </div>
            </div>
          )}

          {Object.values(entry.checklist || {}).length > 0 && (
            <div className="journal-view-section">
              <label className="field-label">Checklist pré-trade</label>
              <div className="journal-view-checklist">
                {checklistRules.map((rule) => (
                  <div key={rule.id} className={`check-item view ${entry.checklist[rule.id] ? 'done' : ''}`}>
                    <span className={`check-dot ${entry.checklist[rule.id] ? 'on' : ''}`}>
                      {entry.checklist[rule.id] ? '✓' : ''}
                    </span>
                    <span>{rule.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div className="alert error">{error}</div>}

          <div className="form-row">
            <Button variant="primary" onClick={() => setViewMode(false)}>
              Modifier
            </Button>
            <Button variant="danger" onClick={removeEntry}>
              Supprimer l'entrée
            </Button>
          </div>
        </div>
      ) : (
        <>
          <label className="field-label">Analyse de la journée</label>
          <textarea
            className="textarea"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Comment s'est déroulée la journée ? Quels trades, pourquoi ces entrées, qu'avez-vous ressenti ?"
          />

          <div className="field-row">
            <div className="field">
              <label className="field-label">Screenshots ({screenshots.length}/12)</label>
              <div className="shot-grid">
                {screenshots.map((src, i) => (
                  <div key={i} className="shot">
                    <img src={src} alt={`Screenshot ${i + 1}`} onClick={() => setZoomImg(src)} />
                    <button
                      type="button"
                      className="shot-remove"
                      onClick={() => setScreenshots((prev) => prev.filter((_, j) => j !== i))}
                      title="Retirer cette capture"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {screenshots.length < 12 && (
                  <button
                    className="shot-add"
                    type="button"
                    onClick={() => fileRef.current && fileRef.current.click()}
                  >
                    📷 Ajouter {screenshots.length ? 'une capture' : 'des screenshots'}
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  onScreenshotFiles(e.target.files ? Array.from(e.target.files) : [])
                  e.target.value = ''
                }}
              />
            </div>

            <div className="field grow">
              <label className="field-label">Plan respecté</label>
              <div className="segmented">
                {[
                  ['oui', 'Oui'],
                  ['partiel', 'Partiellement'],
                  ['non', 'Non'],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={planRespected === val ? 'seg active' : 'seg'}
                    onClick={() => setPlanRespected(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="field-label" style={{ marginTop: 12 }}>
                État émotionnel dominant
              </label>
              <select
                className="select"
                value={emotionTag}
                onChange={(e) => setEmotionTag(e.target.value)}
              >
                <option value="">— Aucun —</option>
                {emotionTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <TagManager tags={emotionTags} storageKey="emotionTags" reload={reload} />

              <label className="field-label" style={{ marginTop: 12 }}>
                Contexte de trading
              </label>
              <div className="context-tags">
                {contextTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`context-tag ${selectedContext.includes(t) ? 'active' : ''}`}
                    onClick={() => setSelectedContext((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <TagManager tags={contextTags} storageKey="contextTags" reload={reload} />
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Checklist pré-trade
              {conformity != null && <span className="conformity">Conformité : {conformity} %</span>}
            </label>
            <ChecklistBox rules={checklistRules} values={checklist} onChange={(id, val) => setChecklist({ ...checklist, [id]: val })} />
            <RuleManager rules={checklistRules} reload={reload} />
          </div>

          {error && <div className="alert error">{error}</div>}
          {savedAt && <div className="alert success">Enregistré à {savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>}

          <div className="form-row">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Enregistrement…' : entry ? 'Enregistrer les modifications' : 'Enregistrer'}
            </Button>
            {entry && (
              <Button variant="danger" onClick={removeEntry}>
                Supprimer l'entrée
              </Button>
            )}
          </div>
        </>
      )}

      {dayTrades.length > 0 && (
        <div className="day-trades">
          <h4 className="sub-title">Trades du jour (tous comptes)</h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>#</th>
                  <th>Instrument</th>
                  <th>Entrée</th>
                  <th>Sortie</th>
                  <th>Profit</th>
                  <th>MAE</th>
                  <th>MFE</th>
                </tr>
              </thead>
              <tbody>
                {dayTrades.map((t) => (
                  <tr key={t.id}>
                    <td>{accountName[String(t.accountId)] || `#${t.accountId}`}</td>
                    <td>{t.tradeNumber}</td>
                    <td>{t.instrument}</td>
                    <td>{fmtTime(t.entryTime)}</td>
                    <td>{fmtTime(t.exitTime)}</td>
                    <td className={t.netProfit >= 0 ? 'text-pos' : 'text-neg'}>{fmtMoney(t.netProfit)}</td>
                    <td>{fmtMoney(t.mae)}</td>
                    <td>{fmtMoney(t.mfe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {zoomImg && (
        <div className="modal" onClick={() => setZoomImg(null)}>
          <img src={zoomImg} alt="Zoom" onClick={(e) => e.stopPropagation()} />
          <div className="modal-actions" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              onClick={() => {
                const i = screenshots.indexOf(zoomImg)
                setZoomImg(screenshots[(i - 1 + screenshots.length) % screenshots.length])
              }}
            >
              ‹ Précédent
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const i = screenshots.indexOf(zoomImg)
                setZoomImg(screenshots[(i + 1) % screenshots.length])
              }}
            >
              Suivant ›
            </Button>
          </div>
          <button className="modal-close" onClick={() => setZoomImg(null)}>✕</button>
        </div>
      )}
    </Card>
  )
}

function TagManager({ tags, storageKey, reload }) {
  const [open, setOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const add = async () => {
    const t = newTag.trim()
    if (!t || tags.includes(t)) return
    await db.setSetting(storageKey, [...tags, t])
    await reload()
    setNewTag('')
  }
  const remove = async (t) => {
    await db.setSetting(storageKey, tags.filter((x) => x !== t))
    await reload()
  }
  return (
    <div className="tag-manager">
      <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
        {open ? 'Masquer la liste' : 'Éditer la liste des états'}
      </button>
      {open && (
        <div className="tag-manager-body">
          <div className="tag-cloud">
            {tags.map((t) => (
              <span key={t} className="tag-chip">
                {t} <button type="button" onClick={() => remove(t)}>×</button>
              </span>
            ))}
          </div>
          <div className="form-row">
            <input
              className="input"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Nouvel état (ex : Déterminé)"
            />
            <Button variant="ghost" onClick={add}>Ajouter</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChecklistBox({ rules, values, onChange }) {
  return (
    <div className="checklist">
      {rules.map((rule) => (
        <label key={rule.id} className="check-item">
          <input
            type="checkbox"
            checked={Boolean(values[rule.id])}
            onChange={(e) => onChange(rule.id, e.target.checked)}
          />
          <span>{rule.text}</span>
        </label>
      ))}
    </div>
  )
}

function RuleManager({ rules, reload }) {
  const [open, setOpen] = useState(false)
  const [newRule, setNewRule] = useState('')
  const add = async () => {
    const t = newRule.trim()
    if (!t) return
    await db.setSetting('checklistRules', [...rules, { id: uid(), text: t }])
    await reload()
    setNewRule('')
  }
  const remove = async (id) => {
    await db.setSetting('checklistRules', rules.filter((r) => r.id !== id))
    await reload()
  }
  return (
    <div className="tag-manager">
      <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
        {open ? 'Masquer' : 'Personnaliser mes règles'}
      </button>
      {open && (
        <div className="tag-manager-body">
          {rules.map((r) => (
            <div key={r.id} className="rule-row">
              <span>{r.text}</span>
              <button type="button" className="link-btn" onClick={() => remove(r.id)}>supprimer</button>
            </div>
          ))}
          <div className="form-row">
            <input
              className="input"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Nouvelle règle d'exécution"
            />
            <Button variant="ghost" onClick={add}>Ajouter</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtLongDate(key) {
  const d = new Date(`${key}T00:00:00`)
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}