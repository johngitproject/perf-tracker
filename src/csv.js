import Papa from 'papaparse'

export const FIELD_LABELS = {
  tradeNumber: 'Trade number',
  instrument: 'Instrument',
  account: 'Account',
  strategy: 'Strategy',
  marketPos: 'Market pos.',
  qty: 'Qty',
  entryPrice: 'Entry price',
  exitPrice: 'Exit price',
  entryTime: 'Entry time',
  exitTime: 'Exit time',
  entryName: 'Entry name',
  exitName: 'Exit name',
  profit: 'Profit / P&L',
  cumNetProfit: 'Cum. net profit',
  commission: 'Commission',
  clearingFee: 'Clearing Fee',
  exchangeFee: 'Exchange Fee',
  ipFee: 'IP Fee',
  nfaFee: 'NFA Fee',
  mae: 'MAE',
  mfe: 'MFE',
  etd: 'ETD',
  bars: 'Bars',
}

export const REQUIRED_FIELDS = ['tradeNumber', 'entryTime', 'exitTime', 'profit']

export const ALL_FIELDS = Object.keys(FIELD_LABELS)

/* ---------------- Number & date parsers ---------------- */

/**
 * Parse un montant avec tolérance aux formats français ET américains :
 *   "58,00 $" | "-25,00 $" | "1.234,50 $" (FR) | "$525.00" | "$1,405.00" | "$(250.00)" (US, parenthèses = négatif)
 * NBSP / espaces insécables acceptés.
 */
export function parseFrenchNumber(value) {
  if (value == null) return null
  let s = String(value)
    .trim()
    .replace(/[\u00A0\u202F ]/g, '')
    .replace(/["']/g, '')
  if (!s) return null
  s = s.replace(/[$€£]/g, '')
  if (!s) return null
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (!s) return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // Le dernier séparateur suivi d'exactement 2 chiffres est la virgule décimale.
    const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
    if (/^\d{2}$/.test(s.slice(lastSep + 1))) {
      if (s[lastSep] === ',') s = s.replace(/\./g, '').replace(',', '.')
      else s = s.replace(/,/g, '')
    } else {
      s = s.replace(/\./g, '').replace(/,/g, '.')
    }
  } else if (hasComma) {
    s = s.replace(/,/g, '.')
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/**
 * Parse une date "DD/MM/YYYY HH:mm[:ss]" ou "MM/DD/YYYY HH:mm[:ss]" selon `format`.
 * Années à 2 chiffres : 2000 + valeur.
 */
export function parseTradeDate(value, format = 'dd/mm') {
  if (value == null) return null
  const s = String(value).trim().replace(/[\u00A0\u202F]/g, ' ')
  if (!s) return null
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  if (!m) return null
  const a = parseInt(m[1], 10)
  const b = parseInt(m[2], 10)
  const yyyy =
    m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)
  const hh = m[4] != null ? parseInt(m[4], 10) : 0
  const min = m[5] != null ? parseInt(m[5], 10) : 0
  const sec = m[6] != null ? parseInt(m[6], 10) : 0
  const dd = format === 'mm/dd' ? b : a
  const mm = format === 'mm/dd' ? a : b
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const d = new Date(yyyy, mm - 1, dd, hh, min, sec, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Devine le format de date en scannant la colonne d'entrée :
 * si une valeur a un 2e nombre > 12 → MM/DD ; si un 1er nombre > 12 → DD/MM.
 * Sinon (ambigu) → DD/MM par défaut.
 */
export function guessDateFormat(dataRows, mapping) {
  let sawDayFirst = false
  let sawMonthFirst = false
  const idx = mapping.entryTime
  for (const row of dataRows) {
    const val = idx != null ? row[idx] : undefined
    if (val == null) continue
    const m = String(val)
      .trim()
      .replace(/[\u00A0\u202F]/g, ' ')
      .match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/)
    if (!m) continue
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a > 12) sawDayFirst = true
    if (b > 12) sawMonthFirst = true
  }
  if (sawMonthFirst && !sawDayFirst) return 'mm/dd'
  return 'dd/mm'
}

export function parseInteger(value) {
  const n = parseFrenchNumber(value)
  return n == null ? null : Math.trunc(n)
}

/* ---------------- Détection du mapping des colonnes ---------------- */

const norm = (s) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim()

const has = (h, ...parts) => parts.every((p) => h.includes(p))

function matchField(h, field) {
  switch (field) {
    case 'tradeNumber':
      return (
        has(h, 'tradenum') ||
        has(h, 'buyfillid') ||
        has(h, 'sellfillid') ||
        has(h, 'fillid') ||
        has(h, 'orderid')
      )
    case 'instrument':
      return has(h, 'instrument') || has(h, 'symbol')
    case 'account':
      return has(h, 'account')
    case 'strategy':
      return has(h, 'strateg')
    case 'marketPos':
      return has(h, 'marketpos') || (has(h, 'market') && has(h, 'pos'))
    case 'qty':
      return has(h, 'qty') || has(h, 'quantity')
    case 'entryPrice':
      return (
        has(h, 'entryprice') ||
        (has(h, 'entry') && has(h, 'price')) ||
        has(h, 'buyprice') ||
        (has(h, 'buy') && has(h, 'price'))
      )
    case 'exitPrice':
      return (
        has(h, 'exitprice') ||
        (has(h, 'exit') && has(h, 'price')) ||
        has(h, 'sellprice') ||
        (has(h, 'sell') && has(h, 'price'))
      )
    case 'entryTime':
      return (
        has(h, 'entrytime') ||
        has(h, 'entry', 'time') ||
        has(h, 'entry', 'datetime') ||
        has(h, 'boughttimestamp') ||
        has(h, 'buytimestamp') ||
        has(h, 'buytime') ||
        has(h, 'bought')
      )
    case 'exitTime':
      return (
        has(h, 'exittime') ||
        has(h, 'exit', 'time') ||
        has(h, 'exit', 'datetime') ||
        has(h, 'soldtimetimestamp') ||
        has(h, 'selltimestamp') ||
        has(h, 'selltime') ||
        has(h, 'sold')
      )
    case 'entryName':
      return has(h, 'entryname') || (has(h, 'entry') && has(h, 'name'))
    case 'exitName':
      return has(h, 'exitname') || (has(h, 'exit') && has(h, 'name'))
    case 'profit':
      return (
        h === 'profit' ||
        h === 'pnl' ||
        h === 'netpnl' ||
        h === 'grossprofit' ||
        (has(h, 'profit') && !has(h, 'cum') && !has(h, 'net') && !has(h, 'gross'))
      )
    case 'cumNetProfit':
      return (has(h, 'cum') && has(h, 'net')) || has(h, 'cumulative')
    case 'commission':
      return has(h, 'commission')
    case 'clearingFee':
      return has(h, 'clearing')
    case 'exchangeFee':
      return has(h, 'exchange')
    case 'ipFee':
      return has(h, 'ip')
    case 'nfaFee':
      return has(h, 'nfa')
    case 'mae':
      return h === 'mae'
    case 'mfe':
      return h === 'mfe'
    case 'etd':
      return h === 'etd'
    case 'bars':
      return h === 'bars'
    default:
      return false
  }
}

export function detectColumnMap(headers) {
  const normalized = headers.map(norm)
  const mapping = {}
  const used = new Set()
  for (const field of ALL_FIELDS) {
    for (let i = 0; i < normalized.length; i++) {
      if (used.has(i)) continue
      if (matchField(normalized[i], field)) {
        mapping[field] = i
        used.add(i)
        break
      }
    }
  }
  const missing = REQUIRED_FIELDS.filter((f) => !(f in mapping))
  return { mapping, missing, headerCount: headers.length }
}

/* ---------------- Parsing d'un fichier ---------------- */

export function parseCsvFile(text, { mapping: forcedMapping, dateFormat = 'auto' } = {}) {
  const result = Papa.parse(text, { header: false, skipEmptyLines: 'greedy' })
  if (result.errors && result.errors.length) {
    return {
      ok: false,
      fatalErrors: result.errors
        .filter((e) => e.type === 'Delimiter' || e.code === 'TooFewFields')
        .map((e) => e.message),
    }
  }
  const rows = result.data
  if (!rows.length || rows[0].length === 0) {
    return { ok: false, fatalErrors: ['Fichier vide ou illisible.'] }
  }
  const headers = rows[0].map((h) => String(h == null ? '' : h).trim())
  const detected = detectColumnMap(headers)
  const mapping = forcedMapping || detected.mapping
  const missing = REQUIRED_FIELDS.filter((f) => !(f in mapping))

  const dataRows = rows.slice(1)
  const fmt =
    dateFormat === 'auto'
      ? mapping.entryTime != null
        ? guessDateFormat(dataRows, mapping)
        : 'dd/mm'
      : dateFormat

  const trades = []
  const parseErrors = []
  const warnings = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    if (!row || row.every((c) => c === '' || c == null)) continue
    const t = parseRow(row, mapping, fmt)
    if (!t) {
      parseErrors.push(`Ligne ${i + 2} : impossible à interpréter.`)
      continue
    }
    if (t._warnings && t._warnings.length) {
      for (const w of t._warnings) warnings.push(`Ligne ${i + 2} : ${w}`)
    }
    trades.push(t)
  }

  return {
    ok: true,
    headers,
    mapping,
    missing,
    trades,
    parseErrors,
    warnings,
    rowCount: dataRows.length,
    dateFormat: fmt,
  }
}

function parseRow(row, mapping, dateFormat) {
  const get = (field) => (field in mapping ? row[mapping[field]] : undefined)

  const entryTime = parseTradeDate(get('entryTime'), dateFormat)
  const exitTime = parseTradeDate(get('exitTime'), dateFormat)
  const tradeNumber = get('tradeNumber')
  const profit = parseFrenchNumber(get('profit'))

  if (tradeNumber == null || entryTime == null || exitTime == null || profit == null) {
    return null
  }

  const t = {
    tradeNumber: String(tradeNumber).trim(),
    instrument: get('instrument') != null ? String(get('instrument')).trim() : '',
    account: get('account') != null ? String(get('account')).trim() : '',
    strategy: get('strategy') != null ? String(get('strategy')).trim() : '',
    marketPos: get('marketPos') != null ? String(get('marketPos')).trim() : '',
    qty: parseInteger(get('qty')),
    entryPrice: parseFrenchNumber(get('entryPrice')),
    exitPrice: parseFrenchNumber(get('exitPrice')),
    entryTime,
    exitTime,
    entryName: get('entryName') != null ? String(get('entryName')).trim() : '',
    exitName: get('exitName') != null ? String(get('exitName')).trim() : '',
    profit,
    cumNetProfit: parseFrenchNumber(get('cumNetProfit')),
    commission: parseFrenchNumber(get('commission')),
    clearingFee: parseFrenchNumber(get('clearingFee')),
    exchangeFee: parseFrenchNumber(get('exchangeFee')),
    ipFee: parseFrenchNumber(get('ipFee')),
    nfaFee: parseFrenchNumber(get('nfaFee')),
    mae: parseFrenchNumber(get('mae')),
    mfe: parseFrenchNumber(get('mfe')),
    etd: parseFrenchNumber(get('etd')),
    bars: parseInteger(get('bars')),
    _warnings: [],
  }

  for (const [field, idx] of Object.entries(mapping)) {
    const raw = row[idx]
    if (raw != null && String(raw).trim() !== '') {
      const needs = [
        'qty', 'entryPrice', 'exitPrice', 'profit', 'mae', 'mfe', 'etd',
        'bars', 'commission', 'clearingFee', 'exchangeFee', 'ipFee', 'nfaFee',
        'cumNetProfit',
      ]
      if (needs.includes(field)) {
        const parsed = ['qty', 'bars'].includes(field)
          ? parseInteger(raw)
          : parseFrenchNumber(raw)
        if (parsed == null) {
          t._warnings.push(
            `valeur « ${String(raw).trim()} » non reconnue pour ${FIELD_LABELS[field] || field}`,
          )
        }
      }
    }
  }

  return t
}

/* ---------------- Utils ---------------- */

export function formatDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function buildTradeRecords(parsedTrades, accountId, batchId, uploadDate) {
  return parsedTrades.map((t) => {
    const { _warnings, ...rest } = t
    const totalFees =
      Math.abs(t.commission || 0) +
      Math.abs(t.clearingFee || 0) +
      Math.abs(t.exchangeFee || 0) +
      Math.abs(t.ipFee || 0) +
      Math.abs(t.nfaFee || 0)
    // NinjaTrader Grid : Profit = déjà net (Cum. net profit = Σ Profit), Commission informative
    // → ne pas re-soustraire les frais (écart 809 vs 771 constaté le 21/08). On garde totalFees pour affichage.
    return {
      ...rest,
      accountId,
      uploadBatchId: batchId,
      uploadDate,
      totalFees,
      netProfit: t.profit || 0,
      entryTime: t.entryTime.getTime(),
      exitTime: t.exitTime.getTime(),
    }
  })
}