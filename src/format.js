export function fmtMoney(n, { sign = true, decimals = 2 } = {}) {
  if (n == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  if (n === 0) return sign ? '±0.00 $' : '0.00 $'
  const prefix = sign ? (n > 0 ? '+' : '−') : n < 0 ? '−' : ''
  return `${prefix}${s} $`
}

export function fmtNum(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return '—'
  if (!Number.isFinite(n)) return '∞'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtPct(n, decimals = 1) {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return '—'
  return `${fmtNum(n * 100, decimals)} %`
}

export function fmtDateKey(key) {
  if (!key || typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return '—'
  const [y, m, d] = key.split('-').map(Number)
  if ([y, m, d].some((n) => Number.isNaN(n))) return '—'
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

export function fmtTime(ms) {
  if (ms == null) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDateTime(ms) {
  if (ms == null) return '—'
  return `${fmtDateKey(toDateKey(ms))} ${fmtTime(ms)}`
}

export function toDateKey(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return null
  const d = new Date(Number(ms))
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayKey() {
  return toDateKey(Date.now())
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}