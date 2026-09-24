import { useState } from 'react'
import { useData } from './useData'
import Dashboard from './components/Dashboard'
import Journal from './components/Journal'
import Accounts from './components/Accounts'
import Backup from './components/Backup'
import Report from './components/Report'

const TABS = [
  ['dashboard', 'Dashboard'],
  ['journal', 'Journal'],
  ['accounts', 'Comptes'],
  ['report', 'Rapport'],
  ['backup', 'Backup'],
]

export default function App() {
  const { ready, error } = useData()
  const [tab, setTab] = useState('dashboard')
  const [journalDate, setJournalDate] = useState(null)
  const [flash, setFlash] = useState(null)

  const openDay = (dateKey) => {
    if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return
    setJournalDate(dateKey)
    setTab('journal')
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" />
          <div>
            <div className="brand-title">Trader Desk</div>
            <div className="brand-sub">Performance tracker — NQ / MNQ / US30</div>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              onClick={() => {
                setTab(key)
                if (key !== 'journal') setJournalDate(null)
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions" />
      </header>

      {error && <div className="banner error">Erreur de chargement de la base locale : {error}</div>}
      {flash && (
        <div className="banner info" onClick={() => setFlash(null)}>
          {flash} <span className="banner-close">✕</span>
        </div>
      )}

      <main className="app-main">
        {!ready ? (
          <div className="loading">Chargement…</div>
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard onOpenDay={openDay} />}
            {tab === 'journal' && <Journal key={journalDate || 'default'} initialDate={journalDate} />}
            {tab === 'accounts' && <Accounts />}
            {tab === 'report' && <Report />}
            {tab === 'backup' && <Backup />}
          </>
        )}
      </main>

      <footer className="app-footer">
        Pensez a exporter regulierement une sauvegarde via l'onglet Backup.
      </footer>
    </div>
  )
}