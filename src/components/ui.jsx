export function Card({ children, className = '', title, actions, note }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && (
            <h3 className="card-title">
              {title}
              {note && <span className="card-note" title={note}>ⓘ</span>}
            </h3>
          )}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function MetricCard({ label, value, sub, tone = 'neutral', note }) {
  return (
    <div className={`metric-card ${tone}`} title={note || undefined}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub != null && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

export function Button({ children, onClick, variant = 'default', type = 'button', disabled, title }) {
  return (
    <button type={type} className={`btn ${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function Select({ value, onChange, children, className = '' }) {
  return (
    <select className={`select ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  )
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function EmptyState({ message }) {
  return <div className="empty-state">{message}</div>
}

export function InfoNote({ children }) {
  return <p className="info-note">{children}</p>
}