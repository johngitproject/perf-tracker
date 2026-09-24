import { useRef, useState } from 'react'
import * as db from '../db'
import { useData } from '../useData'
import { Card, Button, InfoNote } from './ui'

export default function Backup() {
  const { reload } = useData()
  const [flash, setFlash] = useState(null)
  const importRef = useRef(null)

  const doExport = async () => {
    try {
      const data = await db.exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trader-desk-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setFlash('Sauvegarde exportée.')
    } catch (err) {
      setFlash(`Échec export : ${err.message}`)
    }
  }

  const doImport = async (file) => {
    if (!window.confirm('Importer remplace TOUTES les données actuelles. Continuer ?')) return
    try {
      const data = JSON.parse(await file.text())
      await db.importAll(data)
      await reload()
      setFlash('Données restaurées avec succès.')
    } catch (err) {
      setFlash(`Échec import : ${err.message}`)
    }
  }

  return (
    <div className="stack">
      <Card title="Backup — Import / Export">
        <p>Sauvegarde locale (IndexedDB). Exportez regulierement. L'import remplace tout.</p>
        {flash && <div className="alert info" style={{ marginTop: 10 }}>{flash}</div>}
        <div className="form-row" style={{ marginTop: 16 }}>
          <Button variant="primary" onClick={doExport}>Exporter la sauvegarde (JSON)</Button>
          <Button variant="ghost" onClick={() => importRef.current && importRef.current.click()}>Importer une sauvegarde</Button>
          <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) doImport(f); e.target.value = '' }} />
        </div>
        <InfoNote>Le fichier contient comptes, trades, batches, journaux et reglages.</InfoNote>
      </Card>
    </div>
  )
}
