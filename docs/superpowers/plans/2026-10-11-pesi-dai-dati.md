# Pesi del modello decisi dai dati (v2.2.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stimare i pesi delle fonti del motore e le soglie del "Valore" su un banco di prova storico ESPN, senza dati dal futuro; inserire l'Elo nella media solo se lo merita; chiudere i tre rilievi minori; tracciare la versione del modello nello Storico.

**Architecture:** Le funzioni pure stanno in `src/backtest/` (ricostruzione dei dati pre-partita, stima dei pesi, regole) e in `src/prediction/` (`eloOutcomes`, `mixOutcomes`). Due script fanno il lavoro di rete e di scrittura: `build-backtest-dataset.mjs` scarica l'archivio e `run-backtest.mjs` scrive `ensembleWeights.js` e il report. Il motore legge pesi e soglie da `src/prediction/ensembleWeights.js`, un unico punto valido sia per il motore sia per il banco di prova.

**Tech Stack:** Node ESM senza dipendenze, `node:test`, fetch nativo, frontend vanilla incorporato (CSP rigida).

**Spec:** `docs/superpowers/specs/2026-10-11-pesi-dai-dati-design.md`

## Global Constraints

- **Addestramento** sulla stagione con `season.year = 2025`, **verifica** su quella con `season.year = 2026`. Nessun dato della partita stessa o di partite successive entra nel suo bundle.
- **Stima dei pesi:** pesi ≥ 0 con somma 1; discesa a coordinate, passo 0,05 dimezzato fino a 0,001, partenza uniforme, deterministica.
- **Elo nella media** solo se il log loss di verifica migliora di **almeno 0,002**.
- **Soglia "Valore":** si cambia solo se il ROI di verifica è negativo **con almeno 50 segnali**. In quel caso l'edge sale a passi di 0,01 fino a 0,10, fermandosi alla prima soglia con ROI ≥ 0 e almeno 30 segnali; se nessuna lo soddisfa, 0,10.
- **Meno di 300 partite di verifica:** niente pesi nuovi, e ci si ferma a chiedere all'utente.
- **Pareggio dell'Elo:** `drawBase × (1 − |2E − 1|)^1,5`, limitato a [0,12; 0,34]; `drawBase` scelto nella griglia 0,22–0,34 con passo 0,01.
- **Invariato dalla 2.1.0:** il segno indicato è sempre il più probabile e le giocate più sicure restano.
- **Versione:** 2.2.0, `mathVersion` 2.4.0. iPhone 390 px senza scorrimento orizzontale. Firma "Creata da Leone Francesco" invariata.

## Review Focus

- Squadra al debutto in stagione o neopromossa → statistiche `null`, Elo 1500, nessun NaN nella media (test in Task 1 e 2).
- Partita senza quote nell'archivio → la fonte mercato manca e il suo peso si ridistribuisce come dal vivo (test in Task 2 e 3).
- Pesi con una fonte a 0 → fonte mostrata come "peso 0 (escluso dai dati)" e fuori dal consenso e dalla confidenza (test in Task 2).
- `ensembleWeights.js` malformato o senza alcune fonti → motore con i pesi attuali e segnalazione in governance (test in Task 2).
- Elo con peso > 0 ma assente in una vista (previsione rapida, Top del giorno) → elenco e dettaglio coerenti (Task 5, passo condizionale).

---

### Task 1: Ricostruzione dei dati pre-partita

**Files:**
- Create: `src/backtest/historicalBundles.js`
- Test: `test/backtest.test.js`

**Interfaces:**
- Consumes: `eloForFixture`, `ELO_DEFAULTS` da `src/prediction/elo.js`.
- Produces: `buildHistoricalBundles(matches: Match[]): Array<{ match: Match, bundle: Bundle }>`, con `Match = { id, slug, leagueName, seasonYear, date, homeId, awayId, homeName, awayName, homeGoals, awayGoals, neutral, odds: { '1', X, '2' } | null }`. Il bundle ha la stessa forma di quello ESPN dal vivo: `fixture`, `homeStats`, `awayStats`, `recentHome`, `recentAway`, `h2h`, `odds`, `elo`, `sourceStatus`, `sourceErrors: []`, `injuries: null`, `prediction: null`, `lineups: null`, `news: []`, `weather: null`.

- [ ] **Step 1: Write the failing test** — `test/backtest.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoricalBundles } from '../src/backtest/historicalBundles.js';

const match = (id, date, homeId, awayId, homeGoals, awayGoals, extra = {}) => ({ id, slug: 'ita.1', leagueName: 'Serie A', seasonYear: 2025, date, homeId, awayId, homeName: `T${homeId}`, awayName: `T${awayId}`, homeGoals, awayGoals, neutral: false, odds: { '1': 2, X: 3.3, '2': 3.8 }, ...extra });
const season = [
  match('1', '2025-08-20T18:00:00Z', 'A', 'B', 2, 0),
  match('2', '2025-08-27T18:00:00Z', 'B', 'C', 1, 1),
  match('3', '2025-09-03T18:00:00Z', 'C', 'A', 0, 3),
  match('4', '2025-09-10T18:00:00Z', 'A', 'B', 1, 2)
];

test('ricostruzione: solo partite precedenti, forma uguale al vivo', () => {
  const rows = buildHistoricalBundles(season);
  assert.deepEqual(rows.map((row) => row.match.id), ['1', '2', '3', '4']);
  const first = rows[0].bundle;
  assert.equal(first.homeStats, null, 'debutto: nessuna statistica');
  assert.equal(first.recentHome, null);
  assert.equal(first.elo.home.rating, 1500);
  const last = rows[3].bundle;
  assert.deepEqual([last.homeStats.played, last.homeStats.goalsForTotal, last.homeStats.goalsAgainstTotal], [2, 2.5, 0]);
  assert.equal(last.homeStats.goalsForHome, null, 'come dal vivo: niente divisione casa/trasferta');
  assert.deepEqual([last.recentHome.matches, last.recentHome.wins, last.recentHome.ppg], [2, 2, 3]);
  assert.equal(last.recentHome.restDays, 7);
  assert.deepEqual([last.h2h.matches, last.h2h.home, last.h2h.away], [1, 1, 0]);
  assert.deepEqual(last.odds.values, { '1': 2, X: 3.3, '2': 3.8 });
  assert.equal(last.fixture.status, 'NS');
  assert.equal(last.elo.matches, 3);
});

test('ricostruzione: nessun dato dal futuro (cambiare il risultato non cambia il bundle della stessa partita)', () => {
  const original = buildHistoricalBundles(season)[3].bundle;
  const altered = buildHistoricalBundles(season.map((item) => (item.id === '4' ? { ...item, homeGoals: 9, awayGoals: 0 } : item)))[3].bundle;
  assert.deepEqual(altered, original);
});

test('ricostruzione: stagioni e campionati separati, partita senza quote', () => {
  const rows = buildHistoricalBundles([
    match('a', '2025-08-20T18:00:00Z', 'A', 'B', 2, 0),
    match('b', '2025-08-21T18:00:00Z', 'A', 'B', 0, 0, { slug: 'eng.1', leagueName: 'Premier League' }),
    match('c', '2026-08-20T18:00:00Z', 'A', 'B', 1, 0, { seasonYear: 2026, odds: null })
  ]);
  const byId = Object.fromEntries(rows.map((row) => [row.match.id, row.bundle]));
  assert.equal(byId.b.homeStats, null, 'altro campionato: nessuna storia');
  assert.equal(byId.c.homeStats, null, 'nuova stagione: si riparte');
  assert.equal(byId.c.odds, null);
});
```

- [ ] **Step 2: Run** `node --test test/backtest.test.js` → FAIL (modulo mancante).

- [ ] **Step 3: Implement** — `src/backtest/historicalBundles.js`

```js
// Ricostruisce, per ogni partita passata, i dati che il motore avrebbe avuto PRIMA del calcio d'inizio.
// Solo partite precedenti della stessa stagione e dello stesso campionato: nessun dato dal futuro.
import { ELO_DEFAULTS, eloForFixture } from '../prediction/elo.js';
import { round } from '../utils.js';

const groupKey = (match) => `${match.slug}|${match.seasonYear}`;

function teamGames(previous, teamId) {
  return previous.filter((item) => item.homeId === teamId || item.awayId === teamId).map((item) => {
    const home = item.homeId === teamId;
    return { date: item.date, scored: home ? item.homeGoals : item.awayGoals, conceded: home ? item.awayGoals : item.homeGoals };
  });
}

function stats(games) {
  if (!games.length) return null;
  const goalsFor = games.reduce((sum, game) => sum + game.scored, 0);
  const goalsAgainst = games.reduce((sum, game) => sum + game.conceded, 0);
  return {
    played: games.length,
    goalsForHome: null, goalsAgainstHome: null, goalsForAway: null, goalsAgainstAway: null,
    goalsForTotal: round(goalsFor / games.length, 3),
    goalsAgainstTotal: round(goalsAgainst / games.length, 3),
    cleanSheets: null, failedToScore: null, form: null, rank: null, points: 0
  };
}

function recent(games, kickoff) {
  const last = games.slice(-5);
  if (!last.length) return null;
  let wins = 0; let draws = 0; let losses = 0; let goalsFor = 0; let goalsAgainst = 0;
  for (const game of last) {
    goalsFor += game.scored; goalsAgainst += game.conceded;
    if (game.scored > game.conceded) wins += 1; else if (game.scored === game.conceded) draws += 1; else losses += 1;
  }
  return {
    matches: last.length, wins, draws, losses,
    ppg: round((wins * 3 + draws) / last.length, 3),
    goalsForAverage: round(goalsFor / last.length, 3),
    goalsAgainstAverage: round(goalsAgainst / last.length, 3),
    goalDifferenceAverage: round((goalsFor - goalsAgainst) / last.length, 3),
    restDays: round((Date.parse(kickoff) - Date.parse(last[last.length - 1].date)) / 86400000, 1),
    results: last.map((game) => `${game.scored}-${game.conceded}`)
  };
}

function headToHead(previous, homeId, awayId) {
  const meetings = previous.filter((item) => (item.homeId === homeId && item.awayId === awayId) || (item.homeId === awayId && item.awayId === homeId));
  if (!meetings.length) return null;
  let home = 0; let draw = 0; let away = 0; let homeGoals = 0; let awayGoals = 0;
  for (const item of meetings) {
    const scored = item.homeId === homeId ? item.homeGoals : item.awayGoals;
    const conceded = item.homeId === homeId ? item.awayGoals : item.homeGoals;
    homeGoals += scored; awayGoals += conceded;
    if (scored > conceded) home += 1; else if (scored === conceded) draw += 1; else away += 1;
  }
  return { matches: meetings.length, home, draw, away, homeGoalsAverage: round(homeGoals / meetings.length, 3), awayGoalsAverage: round(awayGoals / meetings.length, 3) };
}

export function buildHistoricalBundles(matches) {
  const ordered = [...matches].sort((left, right) => left.date.localeCompare(right.date) || String(left.id).localeCompare(String(right.id)));
  const history = new Map();
  const rows = [];
  for (const match of ordered) {
    const key = groupKey(match);
    const previous = history.get(key) || [];
    const homeGames = teamGames(previous, match.homeId);
    const awayGames = teamGames(previous, match.awayId);
    const elo = eloForFixture(previous.map((item) => ({ date: item.date, homeId: item.homeId, awayId: item.awayId, homeGoals: item.homeGoals, awayGoals: item.awayGoals, neutral: item.neutral })), { homeId: match.homeId, awayId: match.awayId, neutral: match.neutral });
    const bundle = {
      fixture: { id: `bt:${match.slug}:${match.id}`, kickoff: match.date, status: 'NS', referee: null, venue: '', league: { id: match.slug, name: match.leagueName, season: match.seasonYear, round: '' }, home: { id: match.homeId, name: match.homeName }, away: { id: match.awayId, name: match.awayName } },
      homeStats: stats(homeGames),
      awayStats: stats(awayGames),
      recentHome: recent(homeGames, match.date),
      recentAway: recent(awayGames, match.date),
      h2h: headToHead(previous, match.homeId, match.awayId),
      injuries: null,
      prediction: null,
      lineups: null,
      news: [],
      weather: null,
      odds: match.odds ? { values: { ...match.odds }, bookmaker: 'DraftKings (chiusura)' } : null,
      elo: { ...elo, season: String(match.seasonYear), k: ELO_DEFAULTS.k, homeAdvantage: ELO_DEFAULTS.homeAdvantage },
      sourceStatus: { odds: { available: Boolean(match.odds) } },
      sourceErrors: []
    };
    rows.push({ match, bundle });
    history.set(key, [...previous, match]);
  }
  return rows;
}
```

Nota sul test anti-futuro: il bundle della partita 4 dipende solo dalle partite 1–3, quindi alterarne il risultato lo lascia identico. `restDays` 7 = dal 3 al 10 settembre.

- [ ] **Step 4: Run** `node --test test/backtest.test.js && npm test` → PASS
- [ ] **Step 5: Commit** `git add src/backtest/historicalBundles.js test/backtest.test.js && git commit -m "Banco di prova: ricostruzione dei dati pre-partita senza dati dal futuro"`

---

### Task 2: Pesi esterni, fonte Elo e miscela unica nel motore

**Files:**
- Create: `src/prediction/ensembleWeights.js`
- Modify: `src/prediction/elo.js` (`eloOutcomes`)
- Modify: `src/prediction/engine.js` (pesi da file o da `options.weights`, fonte `elo`, `mixOutcomes`, Elo ricalcolato con campo neutro, esclusione dei pesi 0, `governance.modelVersion`, `mathVersion` 2.4.0)
- Modify: `src/prediction/recommendation.js` (soglie da `ensembleWeights.js`)
- Test: `test/ensemble.test.js`

**Interfaces:**
- Produces:
  - `ENSEMBLE` (default export di `ensembleWeights.js`) = `{ version, generatedAt, weights: { poisson, montecarlo, market, form, provider, h2h, elo }, eloDrawBase, valueThresholds: { edge, ev }, metrics }`;
  - `resolveEnsemble(candidate = ENSEMBLE): { config, fallback: boolean }`;
  - `eloOutcomes(expectedHome, drawBase): { home, draw, away }`;
  - `mixOutcomes(probabilitiesById, weights): { home, draw, away } | null` (stessa logica di `enforceSourceWeightCaps` + `blendOutcomes`);
  - `analysis.governance.modelVersion` e `analysis.governance.ensemble = { version, weights, fallback }`;
  - `agents[].excludedByData: boolean`.

- [ ] **Step 1: Write the failing test** — `test/ensemble.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { eloOutcomes } from '../src/prediction/elo.js';
import { analyzeMatch, mixOutcomes } from '../src/prediction/engine.js';
import ENSEMBLE, { resolveEnsemble } from '../src/prediction/ensembleWeights.js';
import { DemoProvider } from '../src/providers/demo.js';

const sum = (p) => p.home + p.draw + p.away;
const config = buildConfig({ DEMO_MODE: 'true' });

test('eloOutcomes: somma 1, simmetria, pareggio massimo a 0,5 e limitato', () => {
  const even = eloOutcomes(0.5, 0.3);
  assert.ok(Math.abs(sum(even) - 1) < 1e-9);
  assert.ok(Math.abs(even.home - even.away) < 1e-9);
  assert.ok(Math.abs(even.draw - 0.3) < 1e-9);
  const strong = eloOutcomes(0.8, 0.3);
  const mirrored = eloOutcomes(0.2, 0.3);
  assert.ok(strong.draw < even.draw && strong.draw >= 0.12);
  assert.ok(Math.abs(strong.home - mirrored.away) < 1e-9);
  assert.ok(eloOutcomes(0.99, 0.3).away >= 0);
});

test('mixOutcomes: pesi, ridistribuzione delle fonti mancanti, limite agli scontri diretti', () => {
  const p = { a: { home: 0.6, draw: 0.2, away: 0.2 }, b: { home: 0.2, draw: 0.2, away: 0.6 } };
  const mixed = mixOutcomes({ market: p.a, poisson: p.b }, { market: 0.75, poisson: 0.25 });
  assert.ok(Math.abs(mixed.home - 0.5) < 1e-9);
  assert.deepEqual(mixOutcomes({ market: p.a, poisson: null }, { market: 0.5, poisson: 0.5 }), p.a, 'fonte mancante: peso ridistribuito');
  const capped = mixOutcomes({ market: p.a, h2h: p.b }, { market: 0.5, h2h: 0.5 });
  assert.ok(capped.home > 0.55, 'scontri diretti limitati al 7% come nel motore');
  assert.equal(mixOutcomes({ market: null }, { market: 1 }), null);
});

test('pesi: file valido, fallback se malformato', () => {
  assert.equal(resolveEnsemble().fallback, false);
  assert.equal(typeof ENSEMBLE.version, 'string');
  const broken = resolveEnsemble({ weights: { market: -1 } });
  assert.equal(broken.fallback, true);
  assert.deepEqual(broken.config.weights, { poisson: 25, montecarlo: 15, market: 25, form: 18, provider: 10, h2h: 7, elo: 0 });
});

test('motore: pesi da options, fonte a peso 0 esclusa, Elo come fonte, campo neutro ricalcolato', async () => {
  const base = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const elo = { home: { rating: 1600, games: 10 }, away: { rating: 1500, games: 10 }, expectedHome: 0.7, matches: 50, season: '2026', k: 20, homeAdvantage: 60 };
  const bundle = { ...base, elo };
  const onlyMarket = analyzeMatch(bundle, { neutral: true, weights: { market: 1 } }, config);
  const market = onlyMarket.agents.find((agent) => agent.id === 'market').probabilities;
  assert.ok(Math.abs(onlyMarket.summary.outcomes.home - market.home) < 1e-3, 'solo mercato → esito = mercato');
  const poisson = onlyMarket.agents.find((agent) => agent.id === 'poisson');
  assert.equal(poisson.excludedByData, true);
  assert.equal(poisson.effectiveWeight, 0);
  const withElo = analyzeMatch(bundle, { neutral: true, weights: { elo: 1 } }, config);
  assert.ok(withElo.agents.find((agent) => agent.id === 'elo').active);
  assert.ok(Math.abs(withElo.context.elo.expectedHome - 1 / (1 + 10 ** (-100 / 400))) < 1e-3, 'campo neutro: niente +60');
  const home = analyzeMatch(bundle, { neutral: false, weights: { elo: 1 } }, config);
  assert.ok(home.context.elo.expectedHome > withElo.context.elo.expectedHome);
  assert.equal(home.governance.modelVersion, ENSEMBLE.version);
  assert.equal(home.governance.mathVersion, '2.4.0');
});
```

- [ ] **Step 2: Run** `node --test test/ensemble.test.js` → FAIL (moduli ed export mancanti).

- [ ] **Step 3: Implement**

`src/prediction/ensembleWeights.js` (valori attuali: il Task 4 lo riscriverà con i pesi stimati):

```js
// Pesi delle fonti del motore e soglie del "Valore". Riscritto da scripts/run-backtest.mjs con i valori stimati sul
// banco di prova storico; questi sono i pesi manuali in uso fino alla 2.1.0.
export const DEFAULT_ENSEMBLE = Object.freeze({
  version: 'manuale-2.1',
  generatedAt: null,
  weights: Object.freeze({ poisson: 25, montecarlo: 15, market: 25, form: 18, provider: 10, h2h: 7, elo: 0 }),
  eloDrawBase: 0.3,
  valueThresholds: Object.freeze({ edge: 0.025, ev: 0.03 }),
  metrics: null
});

const ENSEMBLE = DEFAULT_ENSEMBLE;
export default ENSEMBLE;

const SOURCE_IDS = ['poisson', 'montecarlo', 'market', 'form', 'provider', 'h2h', 'elo'];

/** Pesi utilizzabili: tutte le fonti presenti, numeri ≥ 0 con somma > 0; altrimenti i pesi manuali (fallback). */
export function resolveEnsemble(candidate = ENSEMBLE) {
  const weights = candidate?.weights;
  const valid = weights && SOURCE_IDS.every((id) => Number.isFinite(weights[id]) && weights[id] >= 0) && SOURCE_IDS.some((id) => weights[id] > 0)
    && Number.isFinite(candidate.eloDrawBase) && Number.isFinite(candidate.valueThresholds?.edge) && Number.isFinite(candidate.valueThresholds?.ev);
  return valid ? { config: candidate, fallback: false } : { config: DEFAULT_ENSEMBLE, fallback: true };
}
```

Il Task 4 rigenera il file mantenendo `DEFAULT_ENSEMBLE` e `resolveEnsemble` e sostituendo solo la costante `ENSEMBLE` con l'oggetto stimato.

`src/prediction/elo.js`, in fondo:

```js
/** Probabilità 1X2 dall'attesa Elo: pareggio massimo a squadre pari, limitato a [0,12; 0,34]. */
export function eloOutcomes(expectedHome, drawBase = 0.3) {
  const e = Math.min(1, Math.max(0, Number(expectedHome)));
  const draw = Math.min(0.34, Math.max(0.12, drawBase * (1 - Math.abs(2 * e - 1)) ** 1.5));
  const home = Math.max(0, e - draw / 2);
  const away = Math.max(0, 1 - e - draw / 2);
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}
```

`src/prediction/engine.js`:
- import: `import ENSEMBLE, { resolveEnsemble } from './ensembleWeights.js';` e `import { eloExpectation, eloOutcomes } from './elo.js';`
- nuova funzione esportata, dopo `enforceSourceWeightCaps`:

```js
/** Miscela unica usata da motore e banco di prova: limite agli scontri diretti, poi media pesata delle fonti presenti. */
export function mixOutcomes(probabilitiesById, weights) {
  const sources = Object.entries(probabilitiesById).map(([id, probabilities]) => ({ id, weight: Number(weights[id]) || 0, probabilities }));
  const active = sources.filter((source) => source.probabilities && source.weight > 0);
  if (!active.length) return null;
  return blendOutcomes(enforceSourceWeightCaps(sources));
}
```

  (`blendOutcomes` restituisce già `{ home, draw, away }` arrotondati a 6 decimali. Nel motore `finalOutcomes` diventa `mixOutcomes(Object.fromEntries(sources.map((source) => [source.id, source.probabilities])), weights)`, così motore e banco di prova usano la stessa miscela.)

- in `analyzeMatch`:
  - dopo `const market = ...`:

```js
  const ensemble = resolveEnsemble();
  const weights = options?.weights ? { ...Object.fromEntries(Object.keys(ensemble.config.weights).map((id) => [id, 0])), ...options.weights } : ensemble.config.weights;
  const eloView = bundle.elo ? { ...bundle.elo, expectedHome: round(eloExpectation(bundle.elo.home.rating, bundle.elo.away.rating, { neutral, homeAdvantage: bundle.elo.homeAdvantage ?? 60 }), 4) } : null;
```

  - nell'array delle fonti, sostituisci i pesi fissi con `weights.poisson`, `weights.montecarlo`, `weights.market`, `weights.form`, `weights.provider`, `weights.h2h` e aggiungi in fondo:

```js
    { id: 'elo', agent: 'Elo Rating', weight: weights.elo, probabilities: eloView ? eloOutcomes(eloView.expectedHome, options?.eloDrawBase ?? ensemble.config.eloDrawBase) : null }
```

  - `const activeSources = sources.filter((source) => source.probabilities && source.weight > 0);` (consenso, confidenza e disaccordi considerano solo le fonti con peso);
  - `sourceConsensus(sources)` → `sourceConsensus(activeSources)`;
  - in `agents`: `active: Boolean(source.probabilities)`, `excludedByData: Boolean(source.probabilities) && !(source.weight > 0)`, `effectiveWeight: source.probabilities && source.weight > 0 ? round(source.weight / activeWeight, 4) : 0`;
  - `decisiveFactors(bundle, ...)` riceve `eloView` al posto di `bundle.elo` per il fattore Elo: passa `{ ...bundle, elo: eloView }`;
  - `context.elo: eloView`;
  - in `governance`: `modelVersion: ensemble.config.version, ensemble: { version: ensemble.config.version, weights, fallback: ensemble.fallback },`, `mathVersion: '2.4.0'`.

`src/prediction/recommendation.js`: `import ENSEMBLE from './ensembleWeights.js';` e la riga di `hasValue` diventa:

```js
  const { edge: edgeThreshold, ev: evThreshold } = ENSEMBLE.valueThresholds;
  const hasValue = selected.edge != null && selected.edge >= edgeThreshold && selected.expectedValue != null && selected.expectedValue >= evThreshold;
```

`public/app.js`, sezione "Modelli e pesi": per gli agenti attivi con `agent.excludedByData` mostra `<span class="signal-muted">peso 0 (escluso dai dati)</span>` al posto della percentuale.

- [ ] **Step 4: Run** `node --test test/ensemble.test.js && npm test` → PASS. Con i pesi manuali i numeri del motore non cambiano rispetto alla 2.1.0. L'unica eccezione possibile è il consenso, che ora conta solo le fonti con peso: ma `provider` è già assente dal vivo, quindi i test esistenti devono restare verdi. Un test che fallisce va analizzato con systematic-debugging prima di cambiare l'aspettativa.
- [ ] **Step 5: Commit** `git add src/prediction src/backtest public/app.js test/ensemble.test.js && git commit -m "Motore: pesi da file, fonte Elo, miscela unica; Elo ricalcolato col campo neutro"`

---

### Task 3: Banco di prova — raccolta, stima dei pesi e regole

**Files:**
- Create: `src/backtest/evaluate.js`
- Test: `test/backtest.test.js` (aggiunte)

**Interfaces:**
- Consumes: `buildHistoricalBundles` (Task 1); `analyzeMatch`, `mixOutcomes` (Task 2); `brierScore`, `logLoss`, `rankedProbabilityScore`, `outcomeFromGoals` da `metrics.js`; `eloOutcomes`.
- Produces:
  - `collectRows(rows, config): Row[]` con `Row = { seasonYear, outcome, odds, sources: { [id]: {home,draw,away} | null }, market: {home,draw,away} | null, eloExpected: number|null }`;
  - `scoreRows(rows, weights): { n, brier, logLoss, rps, accuracy }`;
  - `fitWeights(rows, ids): { weights, logLoss }`;
  - `chooseDrawBase(rows): number`;
  - `withEloSource(rows, drawBase): Row[]`;
  - `valueSignals(rows, weights, edge, ev): { signals, roi }`;
  - `chooseValueThresholds(rows, weights, current): { edge, ev, changed: boolean, reason: string }`;
  - `decideElo(withElo, withoutElo): boolean`.

- [ ] **Step 1: Write the failing test** — aggiungi in fondo a `test/backtest.test.js`

```js
import { chooseValueThresholds, decideElo, fitWeights, scoreRows, valueSignals } from '../src/backtest/evaluate.js';

const row = (outcome, sources, odds = { '1': 2.5, X: 3.2, '2': 2.9 }) => ({ seasonYear: 2025, outcome, odds, sources, market: sources.market || null, eloExpected: null });
const truth = (outcome) => ({ home: outcome === 'home' ? 0.8 : 0.1, draw: outcome === 'draw' ? 0.8 : 0.1, away: outcome === 'away' ? 0.8 : 0.1 });
const noise = { home: 0.34, draw: 0.33, away: 0.33 };
const synthetic = ['home', 'away', 'draw', 'home', 'home', 'away', 'draw', 'away', 'home', 'draw'].map((outcome) => row(outcome, { market: truth(outcome), poisson: noise }));

test('stima dei pesi: la fonte che "sa" prende il peso, somma 1, deterministica', () => {
  const first = fitWeights(synthetic, ['market', 'poisson']);
  const second = fitWeights(synthetic, ['market', 'poisson']);
  assert.deepEqual(first, second);
  assert.ok(first.weights.market > 0.9);
  assert.ok(Math.abs(first.weights.market + first.weights.poisson - 1) < 1e-9);
  assert.ok(first.logLoss < scoreRows(synthetic, { market: 0.5, poisson: 0.5 }).logLoss);
});

test('punteggi: Brier, log loss, accuratezza', () => {
  const score = scoreRows(synthetic, { market: 1, poisson: 0 });
  assert.equal(score.n, 10);
  assert.equal(score.accuracy, 1);
  assert.ok(Math.abs(score.logLoss + Math.log(0.8)) < 1e-9);
});

test('regola Elo: entra solo con almeno 0,002 di log loss in meno', () => {
  assert.equal(decideElo({ logLoss: 0.95 }, { logLoss: 0.953 }), true);
  assert.equal(decideElo({ logLoss: 0.952 }, { logLoss: 0.953 }), false);
});

test('regola Valore: soglie invariate se il ROI non è negativo con almeno 50 segnali', () => {
  const few = synthetic.slice(0, 5);
  assert.deepEqual(chooseValueThresholds(few, { poisson: 1 }, { edge: 0.025, ev: 0.03 }).changed, false);
  // 60 segnali tutti persi con edge alto: la soglia sale fino a 0,10.
  const losing = Array.from({ length: 60 }, () => row('away', { poisson: { home: 0.7, draw: 0.15, away: 0.15 }, market: { home: 0.4, draw: 0.3, away: 0.3 } }, { '1': 2.4, X: 3.3, '2': 3.3 }));
  const before = valueSignals(losing, { poisson: 1 }, 0.025, 0.03);
  assert.equal(before.signals, 60);
  assert.ok(before.roi < 0);
  const decision = chooseValueThresholds(losing, { poisson: 1 }, { edge: 0.025, ev: 0.03 });
  assert.deepEqual([decision.changed, decision.edge], [true, 0.1]);
  assert.match(decision.reason, /nessuna soglia/);
});
```

- [ ] **Step 2: Run** `node --test test/backtest.test.js` → FAIL (modulo `evaluate.js` mancante).

- [ ] **Step 3: Implement** — `src/backtest/evaluate.js`

```js
// Banco di prova: probabilità di ogni fonte sulle partite ricostruite, stima dei pesi e regole fissate nella spec.
import { analyzeMatch, mixOutcomes } from '../prediction/engine.js';
import { eloOutcomes } from '../prediction/elo.js';
import { brierScore, logLoss, outcomeFromGoals, rankedProbabilityScore } from '../tracking/metrics.js';

const KEYS = ['home', 'draw', 'away'];
const SIGN = { home: '1', draw: 'X', away: '2' };

export function collectRows(rows, config) {
  return rows.map(({ match, bundle }) => {
    const analysis = analyzeMatch(bundle, { neutral: match.neutral, weights: { poisson: 1 } }, config);
    const sources = Object.fromEntries(analysis.agents.filter((agent) => agent.id !== 'elo').map((agent) => [agent.id, agent.probabilities]));
    return {
      seasonYear: match.seasonYear,
      outcome: outcomeFromGoals({ home: match.homeGoals, away: match.awayGoals }),
      odds: match.odds,
      sources,
      market: sources.market || null,
      eloExpected: analysis.context.elo?.expectedHome ?? null
    };
  });
}

export function withEloSource(rows, drawBase) {
  return rows.map((row) => ({ ...row, sources: { ...row.sources, elo: row.eloExpected == null ? null : eloOutcomes(row.eloExpected, drawBase) } }));
}

const blended = (row, weights) => mixOutcomes(row.sources, weights);

export function scoreRows(rows, weights) {
  let n = 0; let brier = 0; let loss = 0; let rps = 0; let correct = 0;
  for (const row of rows) {
    const p = blended(row, weights);
    if (!p || !row.outcome) continue;
    n += 1;
    brier += brierScore(p, row.outcome);
    loss += logLoss(p, row.outcome);
    rps += rankedProbabilityScore(p, row.outcome);
    const top = KEYS.reduce((best, key) => (p[key] > p[best] ? key : best), 'home');
    if (top === row.outcome) correct += 1;
  }
  return n ? { n, brier: brier / n, logLoss: loss / n, rps: rps / n, accuracy: correct / n } : { n: 0, brier: null, logLoss: null, rps: null, accuracy: null };
}

/** Discesa a coordinate sul simplesso (pesi ≥ 0, somma 1), passo 0,05 dimezzato fino a 0,001, partenza uniforme. */
export function fitWeights(rows, ids) {
  let weights = Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));
  let best = scoreRows(rows, weights).logLoss;
  let step = 0.05;
  while (step >= 0.001) {
    let improved = false;
    for (const to of ids) {
      for (const from of ids) {
        if (to === from) continue;
        const move = Math.min(step, weights[from]);
        if (move <= 1e-12) continue;
        const candidate = { ...weights, [to]: weights[to] + move, [from]: weights[from] - move };
        const loss = scoreRows(rows, candidate).logLoss;
        if (loss < best - 1e-12) { weights = candidate; best = loss; improved = true; }
      }
    }
    if (!improved) step /= 2;
  }
  const rounded = Object.fromEntries(ids.map((id) => [id, Math.round(weights[id] * 10000) / 10000]));
  const total = Object.values(rounded).reduce((sum, value) => sum + value, 0);
  return { weights: Object.fromEntries(ids.map((id) => [id, rounded[id] / total])), logLoss: best };
}

export function chooseDrawBase(rows) {
  let best = { drawBase: 0.3, loss: Infinity };
  for (let index = 0; index <= 12; index += 1) {
    const drawBase = Math.round((0.22 + index * 0.01) * 100) / 100;
    const loss = scoreRows(withEloSource(rows, drawBase), { elo: 1 }).logLoss;
    if (loss != null && loss < best.loss) best = { drawBase, loss };
  }
  return best.drawBase;
}

/** Segnali "Valore" sul segno più probabile (stessa regola della 2.1.0) e ROI a quota di chiusura. */
export function valueSignals(rows, weights, edge, ev) {
  let signals = 0; let profit = 0;
  for (const row of rows) {
    const p = blended(row, weights);
    if (!p || !row.market || !row.odds || !row.outcome) continue;
    const sign = ['home', 'away', 'draw'].reduce((best, key) => (p[key] > p[best] ? key : best), 'home');
    const odd = Number(row.odds[SIGN[sign]]);
    if (!(odd > 1)) continue;
    const signEdge = p[sign] - row.market[sign];
    const signEv = p[sign] * odd - 1;
    if (signEdge >= edge && signEv >= ev) {
      signals += 1;
      profit += row.outcome === sign ? odd - 1 : -1;
    }
  }
  return { signals, roi: signals ? profit / signals : null };
}

export function chooseValueThresholds(rows, weights, current) {
  const base = valueSignals(rows, weights, current.edge, current.ev);
  if (!(base.signals >= 50 && base.roi < 0)) return { ...current, changed: false, reason: `ROI ${base.roi == null ? 'n.d.' : base.roi.toFixed(3)} su ${base.signals} segnali: soglie invariate.` };
  for (let edge = 0.03; edge <= 0.1 + 1e-9; edge += 0.01) {
    const rounded = Math.round(edge * 100) / 100;
    const result = valueSignals(rows, weights, rounded, current.ev);
    if (result.signals >= 30 && result.roi >= 0) return { edge: rounded, ev: current.ev, changed: true, reason: `ROI ${result.roi.toFixed(3)} su ${result.signals} segnali con edge ≥ ${rounded}.` };
  }
  return { edge: 0.1, ev: current.ev, changed: true, reason: 'nessuna soglia fino a 0,10 dà ROI ≥ 0 con almeno 30 segnali: edge 0,10.' };
}

export function decideElo(withElo, withoutElo) {
  return withElo.logLoss <= withoutElo.logLoss - 0.002;
}
```

Nota sul test "nessuna soglia": nei 60 segnali sintetici il segno più probabile è sempre "1" (70%) contro il 40% del mercato (edge 0,30), e il risultato è sempre "2". A ogni soglia fino a 0,10 restano 60 segnali in perdita, quindi edge 0,10 e motivo "nessuna soglia".

- [ ] **Step 4: Run** `node --test test/backtest.test.js && npm test` → PASS
- [ ] **Step 5: Commit** `git add src/backtest/evaluate.js test/backtest.test.js && git commit -m "Banco di prova: stima dei pesi, regola Elo e regola del Valore"`

---

### Task 4: Archivio reale, esecuzione del banco di prova, pesi di produzione

**Files:**
- Create: `scripts/build-backtest-dataset.mjs`, `scripts/run-backtest.mjs`
- Modify: `src/providers/espn.js` (esporta `regulationGoals`)
- Modify (generato): `src/prediction/ensembleWeights.js`
- Create (generato): `docs/backtest/2026-10-11-report.md`

**Interfaces:**
- Consumes: `ESPN_LEAGUES`, `americanToDecimal`, `regulationGoals` (Task 4); `buildHistoricalBundles` (Task 1); tutte le funzioni del Task 3; `DEFAULT_ENSEMBLE` (Task 2).

- [ ] **Step 1:** `src/providers/espn.js` — `function regulationGoals(` → `export function regulationGoals(`. `npm test` → PASS.
- [ ] **Step 2: Archivio** — `scripts/build-backtest-dataset.mjs`:

```js
// Scarica una volta l'archivio del banco di prova: partite concluse 2025–2026 dei 15 campionati e quote DraftKings
// dal riepilogo di ogni partita. Uscita: data/backtest/<slug>.json (escluso da git, rigenerabile).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESPN_LEAGUES, americanToDecimal, regulationGoals } from '../src/providers/espn.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data/backtest');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
fs.mkdirSync(outDir, { recursive: true });

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (response.ok) return await response.json();
      if (response.status < 500 && response.status !== 429) return null;
    } catch { /* nuovo tentativo */ }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return null;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next; next += 1; results[index] = await mapper(items[index]); }
  }));
  return results;
}

let total = 0; let withOdds = 0; let failed = 0;
for (const league of ESPN_LEAGUES) {
  const events = [];
  for (const year of [2025, 2026]) {
    const payload = await getJson(`${BASE}/${league.slug}/scoreboard?dates=${year}&limit=1000`);
    for (const event of payload?.events || []) if (event.competitions?.[0]?.status?.type?.completed && [2025, 2026].includes(event.season?.year)) events.push(event);
  }
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  const matches = (await mapLimit(unique, 4, async (event) => {
    const competition = event.competitions[0];
    const home = competition.competitors.find((item) => item.homeAway === 'home');
    const away = competition.competitors.find((item) => item.homeAway === 'away');
    const goals = regulationGoals(competition);
    if (!home || !away || !goals) return null;
    const summary = await getJson(`${BASE}/${league.slug}/summary?event=${event.id}`);
    if (!summary) failed += 1;
    const pick = summary?.pickcenter?.[0];
    const odds = pick ? { '1': americanToDecimal(pick.homeTeamOdds?.moneyLine), X: americanToDecimal(pick.drawOdds?.moneyLine), '2': americanToDecimal(pick.awayTeamOdds?.moneyLine) } : null;
    const validOdds = odds && Object.values(odds).every((value) => value > 1) ? odds : null;
    return { id: String(event.id), slug: league.slug, leagueName: league.name, seasonYear: event.season.year, date: new Date(event.date).toISOString(), homeId: String(home.team.id), awayId: String(away.team.id), homeName: home.team.displayName, awayName: away.team.displayName, homeGoals: goals.home, awayGoals: goals.away, neutral: Boolean(competition.neutralSite), odds: validOdds };
  })).filter(Boolean);
  total += matches.length; withOdds += matches.filter((item) => item.odds).length;
  fs.writeFileSync(path.join(outDir, `${league.slug}.json`), JSON.stringify(matches));
  console.log(`${league.slug}: ${matches.length} partite, ${matches.filter((item) => item.odds).length} con quote`);
}
console.log(`Totale ${total} partite, ${withOdds} con quote, ${failed} riepiloghi non scaricati.`);
```

  Run (in background, può richiedere vari minuti): `node scripts/build-backtest-dataset.mjs`. Attesi 15 file in `data/backtest/` e il riepilogo finale. Annota i numeri nel ledger.

- [ ] **Step 3: Esecuzione** — `scripts/run-backtest.mjs`:

```js
// Esegue il banco di prova: pesi stimati sull'addestramento (stagione 2025), verifica sulla 2026, regole della spec.
// Scrive src/prediction/ensembleWeights.js e docs/backtest/2026-10-11-report.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../src/configCore.js';
import { buildHistoricalBundles } from '../src/backtest/historicalBundles.js';
import { chooseDrawBase, chooseValueThresholds, collectRows, decideElo, fitWeights, scoreRows, valueSignals, withEloSource } from '../src/backtest/evaluate.js';
import { DEFAULT_ENSEMBLE } from '../src/prediction/ensembleWeights.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/backtest');
const matches = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).flatMap((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
const config = buildConfig({ DEMO_MODE: 'false', DATA_PROVIDER: 'espn', MONTE_CARLO_RUNS: '10000' });
const rows = collectRows(buildHistoricalBundles(matches), config);
const train = rows.filter((row) => row.seasonYear === 2025);
const testRows = rows.filter((row) => row.seasonYear === 2026);
if (testRows.length < 300) { console.error(`Solo ${testRows.length} partite di verifica (< 300): pesi non aggiornati.`); process.exit(2); }

const current = Object.fromEntries(Object.entries(DEFAULT_ENSEMBLE.weights).map(([id, value]) => [id, value / 100]));
const ids = ['poisson', 'montecarlo', 'market', 'form', 'h2h'];
const fitted = fitWeights(train, ids).weights;
const drawBase = chooseDrawBase(train);
const trainElo = withEloSource(train, drawBase);
const testElo = withEloSource(testRows, drawBase);
const fittedElo = fitWeights(trainElo, [...ids, 'elo']).weights;
const metrics = {
  current: scoreRows(testRows, current),
  fitted: scoreRows(testRows, fitted),
  fittedWithElo: scoreRows(testElo, fittedElo),
  market: scoreRows(testRows, { market: 1 })
};
const useElo = decideElo(metrics.fittedWithElo, metrics.fitted);
const production = useElo ? fittedElo : { ...fitted, elo: 0 };
const evalRows = useElo ? testElo : testRows;
const thresholds = chooseValueThresholds(evalRows, production, DEFAULT_ENSEMBLE.valueThresholds);
const valueBefore = valueSignals(testRows, current, 0.025, 0.03);
const valueAfter = valueSignals(evalRows, production, thresholds.edge, thresholds.ev);
```

  Poi la funzione dello scostamento dal mercato sulle sfavorite (l'`import` va in testa allo script insieme agli altri):

```js
import { mixOutcomes } from '../src/prediction/engine.js';
const underdogGap = (weights, set) => {
  const gaps = [];
  for (const row of set) {
    if (!row.market || !row.odds) continue;
    const p = mixOutcomes(row.sources, weights);
    if (!p) continue;
    for (const [key, sign] of [['home', '1'], ['draw', 'X'], ['away', '2']]) if (Number(row.odds[sign]) >= 3) gaps.push(p[key] - row.market[key]);
  }
  return gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : null;
};
```

  e in fondo allo script:

```js
const gapBefore = underdogGap(current, testRows);
const gapAfter = underdogGap(production, evalRows);
const toPercent = (weights) => Object.fromEntries(['poisson', 'montecarlo', 'market', 'form', 'provider', 'h2h', 'elo'].map((id) => [id, Math.round((weights[id] || 0) * 1000) / 10]));
const ensemble = {
  version: 'dati-2026-10-11',
  generatedAt: new Date().toISOString(),
  trainSeason: 2025,
  testSeason: 2026,
  matches: { train: train.length, test: testRows.length },
  weights: toPercent(production),
  eloDrawBase: drawBase,
  valueThresholds: { edge: thresholds.edge, ev: thresholds.ev },
  metrics: { ...metrics, useElo, valueBefore, valueAfter, underdogGap: { before: gapBefore, after: gapAfter }, thresholdReason: thresholds.reason }
};
const file = path.join(root, 'src/prediction/ensembleWeights.js');
const source = fs.readFileSync(file, 'utf8');
const marker = 'export const ENSEMBLE = DEFAULT_ENSEMBLE;';
if (!source.includes(marker) && !source.includes('export const ENSEMBLE = Object.freeze(')) throw new Error('ensembleWeights.js: marcatore non trovato');
const replaced = source.replace(/export const ENSEMBLE = (DEFAULT_ENSEMBLE|Object\.freeze\([\s\S]*?\));\n/, `export const ENSEMBLE = Object.freeze(${JSON.stringify(ensemble, null, 2)});\n`);
fs.writeFileSync(file, replaced);
const fmt = (value) => (value == null ? '—' : value.toFixed(4));
const table = (name, m) => `| ${name} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.logLoss)} | ${fmt(m.rps)} | ${m.accuracy == null ? '—' : (m.accuracy * 100).toFixed(1) + '%'} |`;
const report = `# Banco di prova storico — ${new Date().toISOString().slice(0, 10)}\n\nAddestramento: stagione 2025 (${train.length} partite). Verifica: stagione 2026 (${testRows.length} partite), mai vista dalla stima.\n\n| Configurazione (verifica) | N | Brier | Log loss | RPS | Accuratezza |\n|---|---|---|---|---|---|\n${table('Pesi attuali (manuali)', metrics.current)}\n${table('Pesi stimati senza Elo', metrics.fitted)}\n${table('Pesi stimati con Elo', metrics.fittedWithElo)}\n${table('Solo mercato', metrics.market)}\n\nElo nella media: **${useElo ? 'sì' : 'no'}** (regola: almeno 0,002 di log loss in meno). drawBase Elo: ${drawBase}.\n\nPesi di produzione (%): ${JSON.stringify(ensemble.weights)}\n\nSegnale "Valore" sulla verifica: prima ${valueBefore.signals} segnali, ROI ${valueBefore.roi == null ? '—' : (valueBefore.roi * 100).toFixed(1) + '%'}; dopo ${valueAfter.signals} segnali, ROI ${valueAfter.roi == null ? '—' : (valueAfter.roi * 100).toFixed(1) + '%'}. Soglie: edge ${thresholds.edge}, EV ${thresholds.ev} — ${thresholds.reason}\n\nScostamento medio motore − mercato sugli esiti con quota ≥ 3: prima ${gapBefore == null ? '—' : (gapBefore * 100).toFixed(1) + ' pp'}, dopo ${gapAfter == null ? '—' : (gapAfter * 100).toFixed(1) + ' pp'}.\n\nDifferenze dichiarate rispetto al dal vivo: forma recente solo di campionato (dal vivo anche coppe); quote di chiusura (dal vivo quote attuali).\n`;
fs.mkdirSync(path.join(root, 'docs/backtest'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/backtest/2026-10-11-report.md'), report);
console.log(report);
```

  Run: `node scripts/run-backtest.mjs`. Atteso: report stampato, `ensembleWeights.js` aggiornato, `npm test` → PASS. Il test `pesi: file valido` deve restare verde. Se lo script esce con codice 2 (meno di 300 partite di verifica), **fermarsi e chiedere all'utente**.
- [ ] **Step 4: Controllo dei risultati** — leggere il report:
  - se i pesi stimati **non** migliorano il log loss rispetto ai pesi attuali sulla verifica, si tengono i pesi attuali (`ENSEMBLE = DEFAULT_ENSEMBLE`), lo si dichiara nel report e lo si annota come Ruling;
  - altrimenti si tengono i pesi stimati.
- [ ] **Step 5: Commit** `git add scripts/build-backtest-dataset.mjs scripts/run-backtest.mjs src/providers/espn.js src/prediction/ensembleWeights.js docs/backtest && git commit -m "Banco di prova storico eseguito: pesi del modello e soglie del Valore dai dati"`

---

### Task 5: Coerenza dell'Elo nelle viste (condizionale) e rilievi minori

**Files:**
- Modify: `src/tracking/metrics.js` (`modelOnMarketBrier` nella timeline)
- Modify: `public/app.js` (grafico sullo stesso campione, riga "Elo non disponibile")
- Modify (solo se il peso Elo di produzione è > 0): `src/api.js`, `src/browser/mobileEntry.js`
- Test: `test/tracking.test.js`, `test/pwa.test.js`, `test/elo.test.js`

- [ ] **Step 1: Failing tests**
  - in `test/tracking.test.js`, aggiungi:

```js
test('timeline: linea del motore sulle stesse partite del mercato', () => {
  const rec = (kickoff, outcome, market) => ({ fixture: { kickoff }, prediction: { outcomes: { home: 0.6, draw: 0.25, away: 0.15 }, marketOutcomes: market, recommendation: {} }, result: { outcome, goals: { home: 1, away: 0 } } });
  const points = timeline([rec('2026-10-01T00:00:00Z', 'home', { home: 0.5, draw: 0.3, away: 0.2 }), rec('2026-10-02T00:00:00Z', 'away', null)], 50);
  const hit = (1 - 0.6) ** 2 + 0.25 ** 2 + 0.15 ** 2;
  assert.ok(Math.abs(points[1].modelOnMarketBrier - hit) < 1e-6, 'la partita senza mercato non entra nella linea di confronto');
  assert.ok(points[1].brier > points[1].modelOnMarketBrier);
});
```

  - in `test/pwa.test.js`: `assert.match(everything, /Elo non disponibile/);` e `assert.match(everything, /stesse partite con quote/);`.

  Run → FAIL.

- [ ] **Step 2: Implement**
  - `timeline` in `metrics.js`: accanto a `market`, calcola `const modelOnMarket = recent.filter((item) => normalized(item.prediction.marketOutcomes)).map((item) => brierScore(normalized(item.prediction.outcomes), item.result.outcome));` e nel punto `modelOnMarketBrier: modelOnMarket.length ? round(average(modelOnMarket), 6) : null`.
  - `public/app.js`, in `renderTimelineCharts`:
    - la serie del primo grafico usa `{ key: 'modelOnMarketBrier', className: 'model' }` al posto di `brier`;
    - la didascalia diventa `<strong>Brier 1X2 mobile</strong> sulle stesse partite con quote (più basso è meglio) · …`;
    - nell'`aria-label` usa `last.modelOnMarketBrier`.
  - `public/app.js`, in `renderAnalysis`, subito dopo la riga Elo:

```js
      ${!analysis.context.elo && analysis.context.sourceStatus?.elo?.error ? `<p class="weather-line">Elo non disponibile: ${escapeHtml(analysis.context.sourceStatus.elo.error)}</p>` : ''}
```

- [ ] **Step 3 (condizionale — solo se `ENSEMBLE.weights.elo > 0` dopo il Task 4):** l'Elo entra nelle probabilità, quindi elenco, Top del giorno, tracciamento automatico e dettaglio devono usarlo tutti. In `src/api.js`:
  - `analyzeFixture(..., { elo = !lite })` diventa `elo = true`;
  - le chiamate con `elo: false` (Top del giorno: due punti) passano a `elo: true`.

  In `src/browser/mobileEntry.js` l'`autoTrack` passa `elo: true`.

  Nel test esistente "Top del giorno non chiede l Elo" l'aspettativa si inverte (Ruling: l'Elo ora pesa nelle probabilità, quindi la coerenza tra le viste prevale sul risparmio di dati). La deduplica e la cache di 12 ore restano.

  Se il peso Elo è 0, questo passo si salta e si annota nel ledger.
- [ ] **Step 4: Run** `npm run build:pwa && npm test` → PASS
- [ ] **Step 5: Commit** `git add src public test && git commit -m "Rilievi minori: Brier sullo stesso campione, Elo non disponibile; coerenza Elo nelle viste"`

---

### Task 6: Versione del modello nello Storico

**Files:**
- Modify: `src/tracking/predictionLedger.js` (`prediction.modelVersion`)
- Modify: `src/tracking/metrics.js` (`byModelVersion`)
- Modify: `public/app.js` (card "Versione modello")
- Test: `test/tracking.test.js`, `test/pwa.test.js`

- [ ] **Step 1: Failing test** — in `test/tracking.test.js`:

```js
test('Storico per versione del modello: registrata e valutata, record vecchi come "precedente alla 2.2"', () => {
  const ledger = new PredictionLedger();
  const kickoff = new Date(Date.now() - 5 * HOUR).toISOString();
  const analysis = fakeAnalysis({ id: 'mv1', kickoff, generatedAt: new Date(Date.now() - 8 * HOUR).toISOString() });
  analysis.governance.modelVersion = 'dati-2026-10-11';
  const record = ledger.record(analysis);
  assert.equal(record.prediction.modelVersion, 'dati-2026-10-11');
  const settled = [
    { ...record, result: { outcome: 'home', goals: { home: 1, away: 0 } } },
    { ...record, prediction: { ...record.prediction, modelVersion: undefined }, result: { outcome: 'away', goals: { home: 0, away: 1 } } }
  ];
  const groups = evaluatePredictions(settled).byModelVersion;
  assert.deepEqual(groups.map((group) => [group.version, group.n]), [['dati-2026-10-11', 1], ['precedente alla 2.2', 1]]);
});
```

  In `test/pwa.test.js`: `assert.match(everything, /Versione modello/);`. Run → FAIL.

- [ ] **Step 2: Implement**
  - In `predictionLedger.js`, dentro `prediction`: `modelVersion: analysis.governance?.modelVersion || null,`.
  - In `metrics.js`, nel `return` di `evaluatePredictions`:

```js
    byModelVersion: [...settled.reduce((map, record) => {
      const version = record.prediction.modelVersion || 'precedente alla 2.2';
      if (!map.has(version)) map.set(version, []);
      map.get(version).push(record);
      return map;
    }, new Map()).entries()].map(([version, items]) => ({ version, ...scoreSet(items, (record) => record.prediction.outcomes) }))
      .sort((left, right) => (left.version === 'precedente alla 2.2') - (right.version === 'precedente alla 2.2') || right.n - left.n),
```

  - In `public/app.js`, `renderPerformance`, dopo la sezione "Per competizione", con la stessa forma tabellare di quella sezione:

```js
    ${section('Versione modello', 'Metriche separate prima e dopo la correzione dei pesi', `<div class="table-scroll"><table class="data-table"><thead><tr><th>Versione</th><th class="numeric">N</th><th class="numeric">Brier</th><th class="numeric">Log loss</th></tr></thead><tbody>${(evaluation.byModelVersion || []).map((group) => `<tr><td>${escapeHtml(group.version)}</td><td class="numeric">${group.n}</td><td class="numeric">${metric(group.brier)}</td><td class="numeric">${metric(group.logLoss)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nessuna partita conclusa.</td></tr>'}</tbody></table></div>`)}
```

- [ ] **Step 3: Run** `npm run build:pwa && npm test` → PASS
- [ ] **Step 4: Commit** `git add src/tracking public/app.js test && git commit -m "Storico: metriche per versione del modello"`

---

### Task 7: Versione 2.2.0, misure, verifica, revisione e pubblicazione

- [ ] **Step 1:** `APP_VERSION = '2.2.0'`, `package.json` e il test della versione aggiornati; `npm test` → PASS; commit.
- [ ] **Step 2: Misure sul vivo** (script nel scratchpad sullo snapshot reale dopo `node scripts/build-live-snapshot.mjs`):
  - "Valore" sul segno indicato: prima 10,2%, dopo …;
  - scostamento medio dal mercato sulle sfavorite;
  - segno indicato non più probabile, che deve restare 0;
  - Sassuolo–Milan o una partita equivalente, prima/dopo.
- [ ] **Step 3: Documentazione** — README (Novità 2.2.0), AUDIT (Rilievi 2.2.0 con la tabella del report), HANDOFF (`ensembleWeights.js`, banco di prova, comandi `node scripts/build-backtest-dataset.mjs` e `node scripts/run-backtest.mjs`), GUIDA_INSTALLAZIONE (come rifare la stima). Poi `npm run build`, `npm test`, commit.
- [ ] **Step 4: Verifica visiva** — build PWA locale (configurazione `pwa`) nel simulatore iPhone e nel browser a 375 px:
  - "Modelli e pesi" con i nuovi pesi e la dicitura "peso 0 (escluso dai dati)";
  - riga Elo, oppure "Elo non disponibile";
  - Storico con la card "Versione modello" e il grafico sullo stesso campione;
  - nessuno scorrimento orizzontale.
- [ ] **Step 5: Revisione finale** del ramo con un revisore indipendente; correzioni dei rilievi importanti con test RED→GREEN.
- [ ] **Step 6: Chiusura** — merge in main; documenti e HTML offline nella cartella principale; zip `…-v2.2.0`; zip 2.1.0 in `archivio/`.
- [ ] **Step 7: Pubblicazione** — login GitHub temporaneo dell'utente, push, verifica online (`sw.js` 2.2.0, `engine.js` identico), Artifact ripubblicato, logout e pulizia, controllo finale sulla versione online.
