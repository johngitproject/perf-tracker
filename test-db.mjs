import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import * as db from './src/db.js'
import { parseCsvFile, buildTradeRecords } from './src/csv.js'

let failures = 0
function assert(cond, label, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}`, extra ?? '')
  }
}

const DB_NAME = 'trader-desk'

async function run() {
  await deleteDB(DB_NAME)

  console.log('— flux complet réel (db.js + csv.js sur base simulée) —')

  const accId = await db.addAccount('Compte démo')
  assert(typeof accId === 'number' && accId > 0, `addAccount OK (id=${accId})`)

  const csv = `Trade number\tInstrument\tAccount\tStrategy\tMarket pos.\tQty\tEntry price\tExit price\tEntry time\tExit time\tEntry name\tExit name\tProfit\tCum. net profit\tCommission\tClearing Fee\tExchange Fee\tIP Fee\tNFA Fee\tMAE\tMFE\tETD\tBars
1\tNQ\tDemo\t\tLong\t1\t22000.00\t22050.00\t10/08/2026 14:47\t10/08/2026 15:02\t\t\t"58,00 $"\t"58,00 $"\t"-2,00 $"\t"0,00 $"\t"-1,00 $"\t"-0,20 $"\t"-0,10 $"\t"-25,00 $"\t"75,00 $"\t0,35\t15
`
  const res = parseCsvFile(csv)
  const batchId = await db.addBatch({
    accountId: accId,
    fileName: 'test.csv',
    uploadedAt: Date.now(),
    dateRangeCovered: [0, 0],
    tradeCount: res.trades.length,
  })
  const records = buildTradeRecords(res.trades, accId, batchId, Date.now())
  assert(records[0].id === undefined, 'records sans clé id (avant add)')
  await db.addTrades(records)
  const all = await db.getAllTrades()
  assert(all.length === 1 && typeof all[0].id === 'number', `addTrades OK (id=${all[0].id})`)

  /* --- Journal : nouvelle entrée puis mise à jour --- */
  const j1 = await db.saveJournalEntry({
    date: '2026-08-19',
    text: 'première entrée',
    screenshots: ['data:image/png;base64,AAA'],
    planRespected: 'oui',
    emotionTag: 'Calme',
    checklist: { r1: true },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  assert(typeof j1 === 'number', `journal nouveau OK (id=${j1})`)

  const loaded = await db.getJournalEntryByDate('2026-08-19')
  assert(loaded && loaded.text === 'première entrée' && loaded.screenshots.length === 1, 'entrée relue avec screenshots')

  const j2 = await db.saveJournalEntry({ ...loaded, text: 'modifiée' })
  assert(j2 === loaded.id, `journal mise à jour OK (id=${j2})`)

  const reread = await db.getJournalEntryByDate('2026-08-19')
  assert(reread.text === 'modifiée', 'texte modifié persisté')

  /* --- Même date deux fois → ConstraintError (unique by_date), pas DataError --- */
  let dupErr = null
  try {
    await db.saveJournalEntry({ date: '2026-08-19', text: 'doublon' })
  } catch (err) {
    dupErr = err.name
  }
  assert(dupErr === 'ConstraintError', `doublon de date → ConstraintError (${dupErr})`)

  /* --- Comptes / settings --- */
  await db.renameAccount(accId, 'Renommé')
  const accs = await db.getAccounts()
  assert(accs[0].name === 'Renommé', 'renameAccount OK')
  await db.setSetting('emotionTags', ['Calme', 'FOMO'])
  const settings = await db.getAllSettings()
  assert(settings.emotionTags.length === 2, 'setSetting OK')

  console.log(failures === 0 ? '\n✅ FLUX COMPLET OK' : `\n❌ ${failures} échec(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})