import { openDB } from 'idb'

const DB_NAME = 'trader-desk'
const DB_VERSION = 1

let _dbPromise = null

export function getDB() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const accounts = db.createObjectStore('accounts', {
          keyPath: 'id',
          autoIncrement: true,
        })
        accounts.createIndex('by_name', 'name')

        const trades = db.createObjectStore('trades', {
          keyPath: 'id',
          autoIncrement: true,
        })
        trades.createIndex('by_account', 'accountId')
        trades.createIndex('by_batch', 'uploadBatchId')
        trades.createIndex('by_entryTime', 'entryTime')

        const batches = db.createObjectStore('uploadBatches', {
          keyPath: 'id',
          autoIncrement: true,
        })
        batches.createIndex('by_account', 'accountId')

        const journals = db.createObjectStore('journalEntries', {
          keyPath: 'id',
          autoIncrement: true,
        })
        journals.createIndex('by_date', 'date', { unique: true })

        db.createObjectStore('settings', { keyPath: 'key' })
      },
    })
  }
  return _dbPromise
}

/* ---------------- Accounts ---------------- */

export async function getAccounts() {
  const db = await getDB()
  return db.getAllFromIndex('accounts', 'by_name')
}

export async function addAccount(name, opts = {}) {
  const db = await getDB()
  const { capital = null, maxDrawdown = null, target = null, drawdownType = 'eod' } = opts
  return db.add('accounts', { name, capital, maxDrawdown, target, drawdownType, createdAt: Date.now() })
}

export async function updateAccount(id, fields) {
  const db = await getDB()
  const acc = await db.get('accounts', id)
  if (!acc) throw new Error('Compte introuvable')
  Object.assign(acc, fields, { updatedAt: Date.now() })
  await db.put('accounts', acc)
}

export async function renameAccount(id, name) {
  const db = await getDB()
  const acc = await db.get('accounts', id)
  if (!acc) throw new Error('Compte introuvable')
  acc.name = name
  await db.put('accounts', acc)
}

export async function deleteAccount(id) {
  const db = await getDB()
  const tx = db.transaction(['trades', 'uploadBatches', 'accounts'], 'readwrite')
  const tradeStore = tx.objectStore('trades')
  const batchStore = tx.objectStore('uploadBatches')
  const trades = await tradeStore.index('by_account').getAllKeys(id)
  for (const k of trades) await tradeStore.delete(k)
  const batches = await batchStore.index('by_account').getAllKeys(id)
  for (const k of batches) await batchStore.delete(k)
  await tx.objectStore('accounts').delete(id)
  await tx.done
}

/* ---------------- Trades ---------------- */

export async function getAllTrades() {
  const db = await getDB()
  return db.getAll('trades')
}

export async function getTradesByAccount(accountId) {
  const db = await getDB()
  return db.getAllFromIndex('trades', 'by_account', accountId)
}

export async function addTrades(trades) {
  const db = await getDB()
  if (!trades.length) return
  const tx = db.transaction('trades', 'readwrite')
  await Promise.all(trades.map((t) => tx.store.add(t)))
  await tx.done
}

/* ---------------- Upload batches ---------------- */

export async function getBatches() {
  const db = await getDB()
  const all = await db.getAll('uploadBatches')
  return all.sort((a, b) => b.uploadedAt - a.uploadedAt)
}

export async function addBatch(batch) {
  const db = await getDB()
  return db.add('uploadBatches', batch)
}

export async function deleteBatch(batchId) {
  const db = await getDB()
  const tx = db.transaction(['trades', 'uploadBatches'], 'readwrite')
  const trades = await tx.objectStore('trades').index('by_batch').getAll(batchId)
  for (const t of trades) await tx.objectStore('trades').delete(t.id)
  await tx.objectStore('uploadBatches').delete(batchId)
  await tx.done
}

/* ---------------- Journal entries ---------------- */

export async function getJournalEntries() {
  const db = await getDB()
  return db.getAll('journalEntries')
}

export async function getJournalEntryByDate(date) {
  const db = await getDB()
  return db.getFromIndex('journalEntries', 'by_date', date)
}

export async function saveJournalEntry(entry) {
  const db = await getDB()
  const { id, ...rest } = entry
  if (id != null) {
    await db.put('journalEntries', { id, ...rest })
    return id
  }
  return db.add('journalEntries', rest)
}

export async function deleteJournalEntry(id) {
  const db = await getDB()
  await db.delete('journalEntries', id)
}

/* ---------------- Settings (tags, checklist, etc.) ---------------- */

export async function getAllSettings() {
  const db = await getDB()
  const rows = await db.getAll('settings')
  const out = {}
  for (const r of rows) out[r.key] = r.value
  return out
}

export async function setSetting(key, value) {
  const db = await getDB()
  await db.put('settings', { key, value })
}

/* ---------------- Export / Import ---------------- */

export async function exportAll() {
  const db = await getDB()
  const [accounts, trades, batches, journals, settings] = await Promise.all([
    db.getAll('accounts'),
    db.getAll('trades'),
    db.getAll('uploadBatches'),
    db.getAll('journalEntries'),
    db.getAll('settings'),
  ])
  return {
    app: 'trader-desk',
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
    trades,
    uploadBatches: batches,
    journalEntries: journals,
    settings,
  }
}

function isValidImported(data) {
  if (!data || typeof data !== 'object') return false
  return (
    Array.isArray(data.accounts) &&
    Array.isArray(data.trades) &&
    Array.isArray(data.uploadBatches) &&
    Array.isArray(data.journalEntries) &&
    Array.isArray(data.settings)
  )
}

export async function importAll(data) {
  if (!isValidImported(data)) {
    throw new Error('Fichier de sauvegarde invalide : structure JSON inattendue.')
  }
  const db = await getDB()
  const stores = ['accounts', 'trades', 'uploadBatches', 'journalEntries', 'settings']
  const tx = db.transaction(stores, 'readwrite')
  for (const s of stores) await tx.objectStore(s).clear()
  await Promise.all(
    data.accounts.map((r) => tx.objectStore('accounts').put(r)),
  )
  await Promise.all(data.trades.map((r) => tx.objectStore('trades').put(r)))
  await Promise.all(
    data.uploadBatches.map((r) => tx.objectStore('uploadBatches').put(r)),
  )
  await Promise.all(
    data.journalEntries.map((r) => tx.objectStore('journalEntries').put(r)),
  )
  await Promise.all(
    data.settings.map((r) => tx.objectStore('settings').put(r)),
  )
  await tx.done
}

export async function clearAll() {
  const db = await getDB()
  const tx = db.transaction(
    ['accounts', 'trades', 'uploadBatches', 'journalEntries', 'settings'],
    'readwrite',
  )
  await Promise.all(
    ['accounts', 'trades', 'uploadBatches', 'journalEntries', 'settings'].map(
      (s) => tx.objectStore(s).clear(),
    ),
  )
  await tx.done
}
