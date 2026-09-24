# TraderDesk — Performance Tracker

Application desktop Windows **100 % locale** (aucune donnée ne sort de la machine) de
journaling et d'audit de performance pour le trading de futures **NQ/MNQ et US30**
(angle AMT / Volume Profile / order flow). Elle analyse *comment* le trader gère ses
entrées et sorties (discipline, exécution, émotions) et quantifie le risque réellement
traversé (drawdown latent via MAE). Vitrine « build in public » de TraderDesk /
Africa TraderIA (public africain/francophone).

## Stack

- **Front** : React 19 + Vite 8, Recharts 3 (graphiques), `date-fns`, `papaparse` (CSV),
  `jspdf` + `html2canvas` (rapport PDF A4 avec graphiques).
- **Desktop** : Electron 43 + electron-builder 26 (NSIS x64).
- **Stockage** : IndexedDB via `idb` (`DB trader-desk` v1) — `localStorage` uniquement
  pour les sections affichées du dashboard.

## Lancer l'app

```bash
npm install
npm run dev          # web : http://localhost:5173
npm run dev:desktop  # Electron
npm run build        # build web (dist/)
npm run preview
```

## Build Windows

```bash
npm run build:win    # vite build + electron-builder --win
```

Sortie configurée hors dossier synchronisé (OneDrive verrouille le cache Electron) —
voir `package.json > build.directories.output`.

## Données (IndexedDB)

Stores : `accounts` (by_name), `trades` (by_account/by_batch/by_entryTime),
`uploadBatches` (by_account), `journalEntries` (by_date unique), `settings`.

Un compte porte : nom, **Capital**, **Max drawdown**, **Target** (en $ et %),
type de drawdown **EOD vs Trailing**.

## Import NinjaTrader

Onglet **Comptes** : compte cible → dropzone CSV → mapping colonnes ajustable
(détection auto) → aperçu 15 lignes → **Importer**. Dédoublonnage sur
`tradeNumber + entryTime`. Historique des fichiers avec bouton **Supprimer**
(batch + trades).

Formats gérés : export Grid `;` (colonnes `Trade number … Profit, Cum. net profit,
Commission, MAE, MFE…`), format « fills » (`symbol/qty/pnl/boughtTimestamp…`),
montants FR (`58,00 $`) et US (`$525.00`, `$(250.00)` = négatif), dates
`DD/MM/YYYY` ou `MM/DD/YYYY` (auto-détection).

> **Règle critique** : la colonne `Profit` NinjaTrader est **déjà nette**
> (`Cum. net profit = Σ Profit`) → `netProfit = profit` (les frais sont gardés
> en `totalFees` pour info, jamais re-soustraits).

## Onglets

- **Dashboard** (11 sections activables) : cartes métriques (Net P&L, PF, Expectancy,
  Win Rate, Payoff, SQN, Max DD, Sharpe/Sortino/Calmar/Ulcer/Kelly/VaR 95 %, Avg R),
  Equity réalisée vs latente, PnL Daily/Semaine/Mois, R-multiples, Expectancy,
  Distribution P&L, Heatmap, MAE vs MFE (+ seuil manuel), Qualité de sortie,
  Streaks, Discipline, **Monte Carlo** (bootstrap, bouton Simuler, fan P5–P95,
  probas ruine/target). Filtres compte + période.
- **Journal** : calendrier mensuel, mode lecture après enregistrement, analyse libre,
  screenshots multiples (12 max), Plan respecté, tags **Contexte** personnalisables,
  émotion, checklist + conformité, trades du jour.
- **Comptes** : money management, import CSV, historique des fichiers.
- **Rapport** : 8 sections identiques preview + PDF A4 (exécutif, rendement, risque
  réalisé vs latent, trades, MAE/MFE, temporel, conclusion, Monte Carlo).
- **Backup** : export/import JSON complet (l'import remplace tout).

## Formules (extraits)

- Opérations : même compte+instrument, `|exitTime| ≤ 1 min`, entrées qui se
  chevauchent → `profitTotal = Σ netProfit`, `maeAgrege = Σ|MAE|`.
- Equity latente : `equityLatente(i) = equity(i-1) − maeAgrege`,
  `drawdownLatent = pic(i-1) − equityLatente`.
- EOD = max sur clôtures jour ; Trailing = suit le plus haut equity intraday.
- R-multiple : risque ≈ `|MAE|` (proxy documentée). Sharpe/Sortino **non annualisés**
  (par trade). SQN plafonné à 100 trades (Van Tharp).
- Monte Carlo : bootstrap avec remise sur `netProfit` (trades supposés i.i.d),
  seuil de ruine = `maxDrawdown` du compte, PRNG `mulberry32` + seed rejouable.

## Tests & qualité

```bash
npm run lint        # oxlint — 0 erreur exigée
node test-script.mjs  # parser + métriques
node test-db.mjs      # flux DB complet (fake-indexeddb)
```

## Structure

```
src/
  db.js                IndexedDB (comptes, trades, imports, journaux, réglages)
  csv.js               Parser NinjaTrader (formats FR/US, mapping, dédup)
  metrics.js           Formules (métriques, equity, heatmap, Monte Carlo…)
  format.js            Affichage ($, dates FR, guards anti Invalid Date)
  DataContext.jsx      Fournisseur de données + tags par défaut
  components/          Dashboard, MonteCarloCard, Journal, Accounts,
                       Report, Backup, Upload (non routé), ui, ErrorBoundary
electron/main.cjs      Fenêtre sécurisée (sandbox, userData hors OneDrive en dev)
test-script.mjs / test-db.mjs   Tests Node
```
