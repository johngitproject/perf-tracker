import { useCallback, useEffect, useState } from 'react'
import * as db from './db'
import { DataContext } from './useData'

const DEFAULT_EMOTION_TAGS = [
  'Calme',
  'Confiant',
  'FOMO',
  'Impatient',
  'Revenge trading',
  'Fatigué',
  'Frustré',
]

const DEFAULT_CONTEXT_TAGS = [
  'Open Range',
  'Trend',
  'HFT',
  'Range',
  'Breakout',
  'Retest',
  'Continuation',
  'Reversal',
]

const DEFAULT_CHECKLIST = [
  'Stop placé avant l’entrée',
  'Attendu confirmation de volume',
  'Pas de trade dans les 2 premières minutes après ouverture',
  'Taille de position conforme au plan',
  'Trades pris uniquement sur mes zones',
]

export function DataProvider({ children }) {
  const [state, setState] = useState({
    ready: false,
    error: null,
    accounts: [],
    trades: [],
    batches: [],
    journals: [],
    settings: {},
  })

  const reload = useCallback(async () => {
    try {
      const [accounts, trades, batches, journals, settings] = await Promise.all([
        db.getAccounts(),
        db.getAllTrades(),
        db.getBatches(),
        db.getJournalEntries(),
        db.getAllSettings(),
      ])
      setState({ ready: true, error: null, accounts, trades, batches, journals, settings })
    } catch (err) {
      setState((s) => ({ ...s, ready: true, error: String(err && err.message ? err.message : err) }))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const emotionTags =
    Array.isArray(state.settings.emotionTags) && state.settings.emotionTags.length
      ? state.settings.emotionTags
      : DEFAULT_EMOTION_TAGS

  const contextTags =
    Array.isArray(state.settings.contextTags) && state.settings.contextTags.length
      ? state.settings.contextTags
      : DEFAULT_CONTEXT_TAGS

  const checklistRules =
    Array.isArray(state.settings.checklistRules) && state.settings.checklistRules.length
      ? state.settings.checklistRules
      : DEFAULT_CHECKLIST

  const value = {
    ...state,
    emotionTags,
    contextTags,
    checklistRules,
    reload,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}