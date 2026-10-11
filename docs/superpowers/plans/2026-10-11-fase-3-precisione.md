# Fase 3 — Precisione (v2.0.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Togliere il margine del bookmaker con il metodo di Shin (meno falsi "Valore"), mostrare l'andamento dello Storico in due grafici e aggiungere il rating Elo della stagione, solo informativo.

**Architecture:** Funzioni pure in `src/prediction/probability.js` (Shin), `src/tracking/metrics.js` (timeline) e nel nuovo `src/prediction/elo.js`. Il metodo di de-vig arriva dalla configurazione (`DEVIG_METHOD`) fino a ensemble, edge e registro, con la scelta tracciata in `governance.devig`. L'Elo nasce nel provider ESPN (risultati della stagione, 1–2 richieste per campionato, cache 12 ore), entra nel bundle come `bundle.elo` e il motore lo mostra in `context.elo` e tra i fattori **senza toccare l'ensemble**. L'interfaccia disegna i grafici SVG con attributi (niente stili inline, CSP rigida).

**Tech Stack:** Node ESM senza dipendenze, `node:test`, frontend vanilla JS in un unico file incorporato.

**Spec:** `docs/superpowers/specs/2026-10-10-ottimizzazione-app-design.md` (sezione 7, più 8 e 9).

## Global Constraints

- Versione: Fase 3 → **2.0.0**. A v2.0.0 si rinominano cartelle e file della cartella principale.
- Dati gratuiti, senza chiave, CORS aperto; stesse modifiche per server Node, file offline, Artifact e app iPhone.
- La firma "Creata da Leone Francesco" resta in alto a destra.
- Previsioni oneste: probabilità, mai certezze.
- Shin: bisezione, **tolleranza 1e-10, massimo 100 iterazioni**; se non converge si torna al proporzionale e la scelta è tracciata nella governance.
- `DEVIG_METHOD=shin|proportional`, predefinito `shin`; usato per benchmark di mercato nell'ensemble, edge e registro.
- Timeline: `timeline(records, window = 50)`, Brier mobile e ROI cumulato a puntata unitaria in ordine di calcio d'inizio; due grafici SVG con assi in scala e un riferimento per il mercato.
- Elo: K=20, vantaggio casa 60 punti, rating iniziale 1500, su tutte le partite della stagione; mostrato nell'analisi e tra i fattori; **non entra nell'ensemble**.
- Ogni nuova fonte fallisce in modo isolato (`sourceStatus`), l'analisi prosegue e l'interfaccia mostra "non disponibile".
- iPhone 390×844: niente scorrimento orizzontale, tocchi ≥ 44 px.

**Esito del test di fattibilità Elo (eseguito l'11/10/2026, prima del piano):**
- `GET /apis/site/v2/sports/soccer/{slug}/teams/{id}/schedule` funziona: AC Milan 5 partite concluse della stagione 2026-27, con punteggi.
- Meglio ancora: `GET /apis/site/v2/sports/soccer/{slug}/scoreboard?dates=2026&limit=1000` restituisce in **una sola richiesta** tutte le partite dell'anno solare (Serie A: 374 eventi, stagioni 2025-26 e 2026-27, ciascuna con `season.slug`). Circa 260–380 KB compressi, CORS `*`.
- **Scostamento motivato:** al posto di ~20 richieste per campionato (una per squadra) si usano le richieste per anno solare: quello del calcio d'inizio e il precedente, cioè 2 per campionato. Si tengono le partite concluse della stessa stagione della gara (`season.slug`) e precedenti al calcio d'inizio. Le richieste sono 10 volte meno e restano in cache 12 ore.

## Review Focus

- Quote con margine nullo o negativo (arbitraggio) o con un esito mancante → proporzionale o `null`, mai NaN; fallback tracciato (test in Task 1).
- Squadra senza partite giocate (inizio stagione, neopromossa) → rating 1500, "0 partite", certezza bassa, nessun crash (test in Task 4).
- Partite su campo neutro (coppe, finali) → nessun vantaggio casa nell'Elo (test in Task 4).
- Una delle due richieste annuali ESPN fallisce o la stagione inizia l'anno prima (gara di gennaio) → Elo calcolato con quello che c'è oppure "non disponibile", analisi intatta (test in Task 5).
- Storico con meno di 2 partite concluse, o record senza quote di mercato → grafici sostituiti da un messaggio, nessun NaN nel tracciato (test in Task 2 e 3).

---

### Task 1: Metodo di Shin e scelta del de-vig in tutto il motore

**Files:**
- Modify: `src/prediction/probability.js` (nuove `devigShin`, `devig`)
- Modify: `src/prediction/recommendation.js` (`marketProbabilities` e `buildRecommendation` con `method`)
- Modify: `src/prediction/engine.js` (`marketModel`, `analyzeMatch`, `governance.devig`, `mathVersion`)
- Modify: `src/configCore.js` (`devigMethod`), `.env.example`
- Test: `test/shin.test.js`

**Interfaces:**
- Produces: `devigShin(entries, { tolerance = 1e-10, maxIterations = 100 } = {}): null | { probabilities: object|null, z: number|null, converged: boolean }`; `devig(entries, method = 'shin'): null | { probabilities, method: 'shin'|'proportional', fallback: boolean, z: number|null }`; `config.devigMethod: 'shin'|'proportional'`; `buildRecommendation(modelMarkets, odds, confidence, method = 'proportional')` restituisce anche `devigFallbacks: string[]`; `analysis.governance.devig = { requested, oneXtwo: { method, fallback, z } | null, fallbacks: string[] }`.

- [ ] **Step 1: Write the failing test** — `test/shin.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { devig, devigOdds, devigShin } from '../src/prediction/probability.js';
import { DemoProvider } from '../src/providers/demo.js';

const entries = (o1, ox, o2) => [{ key: '1', odd: o1 }, { key: 'X', odd: ox }, { key: '2', odd: o2 }];
const sum = (probabilities) => Object.values(probabilities).reduce((total, value) => total + value, 0);

test('Shin: somma 1, quota più alta → probabilità più bassa', () => {
  const result = devigShin(entries(1.5, 4.2, 6.5));
  assert.equal(result.converged, true);
  assert.ok(Math.abs(sum(result.probabilities) - 1) < 1e-6);
  assert.ok(result.probabilities['1'] > result.probabilities.X && result.probabilities.X > result.probabilities['2']);
  assert.ok(result.z > 0 && result.z < 0.2);
});

test('Shin: corregge il favorite-longshot bias rispetto al proporzionale', () => {
  const shin = devigShin(entries(1.5, 4.2, 6.5)).probabilities;
  const proportional = devigOdds(entries(1.5, 4.2, 6.5));
  assert.ok(shin['1'] > proportional['1'], 'la favorita sale');
  assert.ok(shin['2'] < proportional['2'], 'la sfavorita scende');
});

test('Shin: margine zero → uguale al proporzionale', () => {
  assert.deepEqual(devigShin(entries(2, 4, 4)).probabilities, devigOdds(entries(2, 4, 4)));
  assert.equal(devigShin(entries(2, 4, 4)).z, 0);
});

test('Shin: quote non valide, arbitraggio e mancata convergenza', () => {
  assert.equal(devigShin(entries(1.5, null, 6)), null);
  assert.equal(devigShin([{ key: 'a', odd: 2 }]), null);
  assert.equal(devigShin(entries(3, 3.5, 4)).converged, false, 'somma delle implicite < 1: Shin non definito');
  assert.equal(devigShin(entries(1.5, 4.2, 6.5), { maxIterations: 1 }).converged, false);
});

test('devig: metodo scelto, fallback tracciato', () => {
  assert.equal(devig(entries(1.5, 4.2, 6.5), 'shin').method, 'shin');
  assert.deepEqual(devig(entries(1.5, 4.2, 6.5), 'proportional'), { probabilities: devigOdds(entries(1.5, 4.2, 6.5)), method: 'proportional', fallback: false, z: null });
  const arbitrage = devig(entries(3, 3.5, 4), 'shin');
  assert.deepEqual([arbitrage.method, arbitrage.fallback], ['proportional', true]);
  assert.ok(Math.abs(sum(arbitrage.probabilities) - 1) < 1e-6);
  assert.equal(devig(entries(1.5, null, 6), 'shin'), null);
});

test('configurazione: DEVIG_METHOD predefinito shin, valori ammessi', () => {
  assert.equal(buildConfig({ DEMO_MODE: 'true' }).devigMethod, 'shin');
  assert.equal(buildConfig({ DEMO_MODE: 'true', DEVIG_METHOD: 'proportional' }).devigMethod, 'proportional');
});

test('motore: Shin usato per benchmark e edge, tracciato nella governance', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const shin = analyzeMatch(bundle, { neutral: true }, buildConfig({ DEMO_MODE: 'true' }));
  const proportional = analyzeMatch(bundle, { neutral: true }, buildConfig({ DEMO_MODE: 'true', DEVIG_METHOD: 'proportional' }));
  assert.equal(shin.governance.devig.requested, 'shin');
  assert.equal(shin.governance.devig.oneXtwo.method, 'shin');
  assert.equal(proportional.governance.devig.oneXtwo.method, 'proportional');
  const market = (analysis) => analysis.agents.find((agent) => agent.id === 'market').probabilities;
  assert.notDeepEqual(market(shin), market(proportional));
  const edge = (analysis) => analysis.markets.find((item) => item.key === '1').marketProbability;
  assert.notEqual(edge(shin), edge(proportional));
  assert.deepEqual(shin.governance.devig.fallbacks, []);
});
```

- [ ] **Step 2: Run** `node --test test/shin.test.js` → FAIL (`devigShin` non esportata).

- [ ] **Step 3: Implement**

`src/prediction/probability.js`, dopo `devigOdds`:

```js
/**
 * Metodo di Shin: modella una quota di scommettitori informati (z) e toglie il margine in modo non proporzionale,
 * correggendo il favorite-longshot bias. Bisezione su z ∈ [0, 0,999): tolleranza 1e-10, massimo 100 iterazioni.
 */
export function devigShin(entries, { tolerance = 1e-10, maxIterations = 100 } = {}) {
  const valid = entries.filter((entry) => Number.isFinite(entry.odd) && entry.odd > 1);
  if (valid.length !== entries.length || valid.length < 2) return null;
  const implied = valid.map((entry) => 1 / entry.odd);
  const booksum = implied.reduce((total, value) => total + value, 0);
  const pack = (values) => {
    const total = values.reduce((sum, value) => sum + value, 0);
    return Object.fromEntries(valid.map((entry, index) => [entry.key, round(values[index] / total, 6)]));
  };
  if (Math.abs(booksum - 1) < 1e-12) return { probabilities: pack(implied), z: 0, converged: true };
  if (booksum < 1) return { probabilities: null, z: null, converged: false };
  const probabilities = (z) => implied.map((p) => (Math.sqrt(z * z + 4 * (1 - z) * p * p / booksum) - z) / (2 * (1 - z)));
  const excess = (z) => probabilities(z).reduce((total, value) => total + value, 0) - 1;
  let low = 0;
  let high = 0.999;
  if (excess(high) > 0) return { probabilities: null, z: null, converged: false };
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const middle = (low + high) / 2;
    const value = excess(middle);
    if (Math.abs(value) < tolerance) return { probabilities: pack(probabilities(middle)), z: round(middle, 8), converged: true };
    if (value > 0) low = middle;
    else high = middle;
  }
  return { probabilities: null, z: null, converged: false };
}

/** De-vig con il metodo scelto; se Shin non converge torna al proporzionale e lo dichiara (`fallback`). */
export function devig(entries, method = 'shin') {
  const proportional = devigOdds(entries);
  if (!proportional) return null;
  if (method !== 'shin') return { probabilities: proportional, method: 'proportional', fallback: false, z: null };
  const shin = devigShin(entries);
  if (!shin?.converged) return { probabilities: proportional, method: 'proportional', fallback: true, z: null };
  return { probabilities: shin.probabilities, method: 'shin', fallback: false, z: shin.z };
}
```

(Nota sul test "margine zero": con quote 2/4/4 la somma delle implicite vale esattamente 1, quindi `pack(implied)` coincide con `devigOdds`.)

`src/configCore.js`, accanto a `dataProvider` nell'oggetto restituito (stesso stile di `choice`):

```js
    devigMethod: choice('DEVIG_METHOD', 'shin', ['shin', 'proportional']),
```

`.env.example`: in fondo alla sezione del motore aggiungi

```
# Margine del bookmaker: shin (predefinito, corregge il favorite-longshot bias) oppure proportional.
DEVIG_METHOD=shin
```

`src/prediction/recommendation.js`:

```js
import { devig } from './probability.js';
```

(sostituisce l'import di `devigOdds`) e

```js
function marketProbabilities(odds, method) {
  if (!odds?.values) return { probabilities: {}, fallbacks: [] };
  const values = odds.values;
  const fallbacks = [];
  const run = (name, entries) => {
    const result = devig(entries, method);
    if (result?.fallback) fallbacks.push(name);
    return result?.probabilities || {};
  };
  const oneXtwo = run('1X2', [{ key: '1', odd: values['1'] }, { key: 'X', odd: values.X }, { key: '2', odd: values['2'] }]);
  const probabilities = {
    ...oneXtwo,
    ...(oneXtwo['1'] != null ? { '1X': round(oneXtwo['1'] + oneXtwo.X, 6) } : {}),
    ...(oneXtwo['2'] != null ? { X2: round(oneXtwo.X + oneXtwo['2'], 6) } : {}),
    ...run('GOAL', [{ key: 'GOAL', odd: values.GOAL }, { key: 'NO_GOAL', odd: values.NO_GOAL }]),
    ...run('OVER_1_5', [{ key: 'OVER_1_5', odd: values.OVER_1_5 }, { key: 'UNDER_1_5', odd: values.UNDER_1_5 }]),
    ...run('OVER_2_5', [{ key: 'OVER_2_5', odd: values.OVER_2_5 }, { key: 'UNDER_2_5', odd: values.UNDER_2_5 }])
  };
  return { probabilities, fallbacks };
}

export function buildRecommendation(modelMarkets, odds, confidence, method = 'proportional') {
  const { probabilities: market, fallbacks: devigFallbacks } = marketProbabilities(odds, method);
```

e nel `return` finale aggiungi `devigFallbacks,` accanto a `hasValue`. Il predefinito `'proportional'` mantiene identici i chiamanti esistenti fuori dal motore (es. test di Kelly).

`src/prediction/engine.js`:
- import: aggiungi `devig` all'elenco importato da `./probability.js`;
- sostituisci `marketModel`:

```js
function marketModel(bundle, method) {
  if (!bundle.odds?.values) return { probabilities: null, devig: null };
  const result = devig(['1', 'X', '2'].map((key) => ({ key, odd: bundle.odds.values[key] })), method);
  if (!result) return { probabilities: null, devig: null };
  const p = result.probabilities;
  return { probabilities: { home: p['1'], draw: p.X, away: p['2'] }, devig: { method: result.method, fallback: result.fallback, z: result.z } };
}
```

- in `analyzeMatch`, prima della costruzione di `sources`: `const market = marketModel(bundle, config.devigMethod);` e nella riga del modello di mercato `probabilities: market.probabilities` al posto di `marketModel(bundle)`;
- `const recommendation = buildRecommendation(markets, bundle.odds, confidence, config.devigMethod);`
- in `governance`, dopo `oddsUpdatedAt`:

```js
      devig: { requested: config.devigMethod, oneXtwo: market.devig, fallbacks: recommendation.devigFallbacks },
```

- `mathVersion: '2.3.0'`.

`inferLambdas` e `dataQuality` continuano a usare `oddsProbability` (proporzionale): la spec limita Shin a benchmark, edge e registro.

- [ ] **Step 4: Run** `node --test test/shin.test.js && npm test` → PASS. Se un test esistente confronta numeri del motore calcolati con il proporzionale, aggiorna l'aspettativa solo dopo aver verificato che la differenza viene da Shin (e annota la regola nel ledger).
- [ ] **Step 5: Commit**

```bash
git add src/prediction/probability.js src/prediction/recommendation.js src/prediction/engine.js src/configCore.js .env.example test/shin.test.js
git commit -m "Metodo di Shin per benchmark, edge e registro; DEVIG_METHOD e traccia in governance"
```

---

### Task 2: Timeline dello Storico (Brier mobile e ROI cumulato)

**Files:**
- Modify: `src/tracking/metrics.js` (nuova `timeline`, campo `timeline` in `evaluatePredictions`)
- Test: `test/tracking.test.js` (in fondo)

**Interfaces:**
- Produces: `timeline(records, window = 50): Array<{ kickoff: string, n: number, brier: number, marketBrier: number|null, roi: number|null, bets: number }>`; `evaluatePredictions(...).timeline`.

- [ ] **Step 1: Write the failing test** — in fondo a `test/tracking.test.js` (aggiungi `timeline` all'import da `metrics.js`)

```js
test('timeline: Brier mobile, riferimento mercato e ROI cumulato in ordine di calcio d inizio', () => {
  const record = (kickoff, outcome, goals, odd, marketOutcomes = { home: 0.5, draw: 0.3, away: 0.2 }) => ({
    fixture: { kickoff },
    prediction: { outcomes: { home: 0.6, draw: 0.25, away: 0.15 }, marketOutcomes, recommendation: { key: '1', odd } },
    result: { outcome, goals }
  });
  const records = [
    record('2026-10-03T18:00:00Z', 'away', { home: 0, away: 1 }, 2),
    record('2026-10-01T18:00:00Z', 'home', { home: 2, away: 0 }, 2),
    record('2026-10-02T18:00:00Z', 'home', { home: 1, away: 0 }, null, null)
  ];
  const points = timeline(records, 2);
  assert.deepEqual(points.map((point) => point.kickoff), ['2026-10-01T18:00:00Z', '2026-10-02T18:00:00Z', '2026-10-03T18:00:00Z']);
  const hitBrier = (1 - 0.6) ** 2 + 0.25 ** 2 + 0.15 ** 2;
  const missBrier = 0.6 ** 2 + 0.25 ** 2 + (1 - 0.15) ** 2;
  assert.ok(Math.abs(points[0].brier - hitBrier) < 1e-6);
  assert.ok(Math.abs(points[2].brier - (hitBrier + missBrier) / 2) < 1e-6, 'finestra di 2');
  assert.equal(points[1].marketBrier, points[0].marketBrier, 'record senza mercato: riferimento invariato');
  assert.deepEqual(points.map((point) => [point.bets, point.roi]), [[1, 1], [1, 1], [2, 0]]);
  assert.deepEqual(timeline([]), []);
});
```

- [ ] **Step 2: Run** `node --test test/tracking.test.js` → FAIL (`timeline` non esportata).

- [ ] **Step 3: Implement** — in `src/tracking/metrics.js`, prima di `evaluatePredictions`:

```js
/**
 * Andamento nel tempo (ordine di calcio d'inizio): Brier 1X2 mobile del modello e del mercato sulle ultime `window`
 * partite e ROI cumulato a puntata unitaria sulle indicazioni con quota. Il mercato manca dove mancano le sue quote.
 */
export function timeline(records, window = 50) {
  const ordered = records
    .filter((record) => record?.result?.outcome && normalized(record.prediction?.outcomes))
    .sort((left, right) => String(left.fixture?.kickoff).localeCompare(String(right.fixture?.kickoff)));
  const points = [];
  let profit = 0;
  let bets = 0;
  ordered.forEach((record, index) => {
    const recent = ordered.slice(Math.max(0, index - window + 1), index + 1);
    const model = recent.map((item) => brierScore(normalized(item.prediction.outcomes), item.result.outcome));
    const market = recent.filter((item) => normalized(item.prediction.marketOutcomes))
      .map((item) => brierScore(normalized(item.prediction.marketOutcomes), item.result.outcome));
    const recommendation = record.prediction.recommendation || {};
    const hit = settleMarket(recommendation.key, record.result.goals);
    if (Number(recommendation.odd) > 1 && hit != null) {
      bets += 1;
      profit += hit ? recommendation.odd - 1 : -1;
    }
    points.push({
      kickoff: record.fixture.kickoff,
      n: index + 1,
      brier: round(average(model), 6),
      marketBrier: market.length ? round(average(market), 6) : null,
      roi: bets ? round(profit / bets, 6) : null,
      bets
    });
  });
  return points;
}
```

Nel `return` di `evaluatePredictions`, dopo `goalMarkets`: `timeline: timeline(settled),`.

Nota sul test: `points[1].marketBrier` è uguale a `points[0]` perché il secondo record non ha quote di mercato e la finestra di 2 contiene un solo record con mercato.

- [ ] **Step 4: Run** `node --test test/tracking.test.js && npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/tracking/metrics.js test/tracking.test.js
git commit -m "Storico: timeline con Brier mobile, riferimento di mercato e ROI cumulato"
```

---

### Task 3: Grafici dello Storico

**Files:**
- Modify: `public/app.js` (`renderLineChart`, `renderTimelineCharts`, sezione "Andamento" in `renderPerformance`)
- Modify: `public/styles.css`
- Test: `test/pwa.test.js`

**Interfaces:**
- Consumes: `payload.evaluation.timeline` (Task 2).

- [ ] **Step 1: Failing test** — in `test/pwa.test.js`, nel test della build, dopo le asserzioni del diario:

```js
  assert.match(everything, /Andamento nel tempo/);
  assert.match(everything, /timeline-chart/);
```

Run `node --test test/pwa.test.js` → FAIL.

- [ ] **Step 2: Implement** — `public/app.js`, subito prima di `function renderRecommendationCard`:

```js
/** Grafico a linee SVG con assi in scala; `reference` è una linea orizzontale fissa (es. pareggio a ROI 0). */
function renderLineChart({ points, series, format, reference = null, label }) {
  const width = 340;
  const height = 200;
  const pad = { left: 46, right: 10, top: 12, bottom: 28 };
  const values = series.flatMap((item) => points.map((point) => point[item.key])).filter(Number.isFinite);
  if (reference != null) values.push(reference);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) { min -= 0.05; max += 0.05; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const x = (index) => pad.left + (points.length === 1 ? 0 : index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom);
  const ticks = [0, 1, 2, 3].map((step) => min + (max - min) * step / 3);
  const grid = ticks.map((tick) => `<line class="calib-grid" x1="${pad.left}" y1="${y(tick).toFixed(1)}" x2="${width - pad.right}" y2="${y(tick).toFixed(1)}"/><text class="calib-label" x="${pad.left - 6}" y="${(y(tick) + 3).toFixed(1)}" text-anchor="end">${escapeHtml(format(tick))}</text>`).join('');
  const lines = series.map((item) => {
    let path = '';
    points.forEach((point, index) => {
      if (!Number.isFinite(point[item.key])) return;
      path += `${path ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[item.key]).toFixed(1)} `;
    });
    return path ? `<path class="timeline-line ${item.className}" d="${path.trim()}"/>` : '';
  }).join('');
  const referenceLine = reference == null ? '' : `<line class="calib-diagonal" x1="${pad.left}" y1="${y(reference).toFixed(1)}" x2="${width - pad.right}" y2="${y(reference).toFixed(1)}"/>`;
  const first = points[0];
  const last = points[points.length - 1];
  return `<svg class="timeline-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
    ${grid}${referenceLine}${lines}
    <text class="calib-label" x="${pad.left}" y="${height - 8}">${escapeHtml(shortDateLabel(first.kickoff))}</text>
    <text class="calib-label" x="${width - pad.right}" y="${height - 8}" text-anchor="end">${escapeHtml(shortDateLabel(last.kickoff))} · ${last.n} partite</text>
  </svg>`;
}

function renderTimelineCharts(points) {
  if (!points || points.length < 2) return '<p class="muted">Servono almeno 2 partite concluse per disegnare l’andamento.</p>';
  const last = points[points.length - 1];
  const decimals = (value) => decimal(value, 3);
  return `<div class="timeline-grid">
    <figure class="timeline-figure">
      <figcaption><strong>Brier 1X2 mobile</strong> (più basso è meglio) · <span class="legend model">Motore</span> <span class="legend market">Mercato</span></figcaption>
      ${renderLineChart({ points, series: [{ key: 'brier', className: 'model' }, { key: 'marketBrier', className: 'market' }], format: decimals, label: `Brier mobile: motore ${decimals(last.brier)}${last.marketBrier == null ? '' : `, mercato ${decimals(last.marketBrier)}`}` })}
    </figure>
    <figure class="timeline-figure">
      <figcaption><strong>ROI cumulato</strong> a puntata unitaria · linea tratteggiata = pareggio</figcaption>
      ${points.some((point) => point.roi != null) ? renderLineChart({ points, series: [{ key: 'roi', className: 'model' }], format: (value) => signedPercent(value, 0), reference: 0, label: `ROI cumulato ${last.roi == null ? 'non disponibile' : signedPercent(last.roi)} su ${last.bets} indicazioni` }) : '<p class="muted">Nessuna indicazione con quota da valutare.</p>'}
    </figure>
  </div>`;
}
```

In `renderPerformance`, subito dopo la sezione `'Modello contro benchmark'` (stessa forma `section(...)`):

```js
    ${section('Andamento nel tempo', 'Ultime 50 partite e rendimento cumulato', renderTimelineCharts(evaluation.timeline), { open: true })}
```

`public/styles.css` (in fondo, prima del blocco `@media print` finale se presente):

```css
.timeline-grid { display: grid; gap: 14px; }
.timeline-figure { margin: 0; }
.timeline-figure figcaption { margin-bottom: 6px; color: var(--muted); font-size: 12.5px; }
.timeline-chart { display: block; width: 100%; height: auto; }
.timeline-line { fill: none; stroke-width: 2; }
.timeline-line.model { stroke: var(--accent); }
.timeline-line.market { stroke: var(--away); stroke-dasharray: 4 3; }
.legend::before { display: inline-block; width: 14px; height: 3px; margin-right: 4px; vertical-align: middle; content: ""; }
.legend.model::before { background: var(--accent); }
.legend.market::before { background: var(--away); }
@media (min-width: 900px) { .timeline-grid { grid-template-columns: 1fr 1fr; } }
```

- [ ] **Step 3: Build e test** — `npm run build:pwa && npm test` → PASS
- [ ] **Step 4: Commit**

```bash
git add public/app.js public/styles.css test/pwa.test.js
git commit -m "Storico: grafici di Brier mobile e ROI cumulato"
```

---

### Task 4: Rating Elo (logica pura)

**Files:**
- Create: `src/prediction/elo.js`
- Test: `test/elo.test.js`

**Interfaces:**
- Produces: `ELO_DEFAULTS = { k: 20, homeAdvantage: 60, initial: 1500 }`; `computeElo(matches, options = ELO_DEFAULTS): Map<string, { rating: number, games: number }>` con `matches = [{ date, homeId, awayId, homeGoals, awayGoals, neutral }]`; `eloExpectation(homeRating, awayRating, { neutral = false, homeAdvantage = 60 } = {}): number` (punteggio atteso della squadra di casa, 0–1); `eloForFixture(matches, fixture, options): { home: {rating, games}, away: {rating, games}, expectedHome: number, matches: number }`.

- [ ] **Step 1: Write the failing test** — `test/elo.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeElo, eloExpectation, eloForFixture } from '../src/prediction/elo.js';

const match = (date, homeId, awayId, homeGoals, awayGoals, neutral = false) => ({ date, homeId, awayId, homeGoals, awayGoals, neutral });

test('Elo: valori noti con K=20 e vantaggio casa 60', () => {
  const expected = 1 / (1 + 10 ** (-60 / 400));
  assert.ok(Math.abs(eloExpectation(1500, 1500) - expected) < 1e-12);
  const ratings = computeElo([match('2026-09-01', 'A', 'B', 2, 0)]);
  assert.ok(Math.abs(ratings.get('A').rating - (1500 + 20 * (1 - expected))) < 1e-9);
  assert.ok(Math.abs(ratings.get('B').rating - (1500 - 20 * (1 - expected))) < 1e-9);
  assert.equal(ratings.get('A').games, 1);
});

test('Elo: pareggio, ordine cronologico e somma costante', () => {
  const ratings = computeElo([match('2026-09-08', 'B', 'A', 1, 1), match('2026-09-01', 'A', 'B', 0, 1)]);
  const afterFirst = 1500 + 20 * eloExpectation(1500, 1500);
  assert.ok(ratings.get('B').rating < afterFirst, 'B vince fuori, poi pareggia in casa da favorita e perde punti');
  assert.ok(ratings.get('B').rating > 1500);
  assert.ok(Math.abs(ratings.get('A').rating + ratings.get('B').rating - 3000) < 1e-9);
});

test('Elo: campo neutro senza vantaggio casa', () => {
  assert.equal(eloExpectation(1500, 1500, { neutral: true }), 0.5);
  const ratings = computeElo([match('2026-09-01', 'A', 'B', 1, 0, true)]);
  assert.ok(Math.abs(ratings.get('A').rating - 1510) < 1e-9);
});

test('Elo per la partita: squadra senza partite a 1500, nessun crash', () => {
  const elo = eloForFixture([match('2026-09-01', 'A', 'B', 3, 1)], { homeId: 'A', awayId: 'NUOVA', neutral: false });
  assert.equal(elo.away.rating, 1500);
  assert.equal(elo.away.games, 0);
  assert.equal(elo.matches, 1);
  assert.ok(elo.expectedHome > 0.5 && elo.expectedHome < 1);
  assert.equal(eloForFixture([], { homeId: 'X', awayId: 'Y' }).matches, 0);
});
```

- [ ] **Step 2: Run** `node --test test/elo.test.js` → FAIL (modulo mancante).

- [ ] **Step 3: Implement** — `src/prediction/elo.js`

```js
// Rating Elo della stagione: informativo, non entra nell'ensemble finché lo Storico non dimostra che migliora il Brier.
import { round } from '../utils.js';

export const ELO_DEFAULTS = Object.freeze({ k: 20, homeAdvantage: 60, initial: 1500 });

/** Punteggio atteso della squadra di casa (vittoria = 1, pareggio = 0,5). */
export function eloExpectation(homeRating, awayRating, { neutral = false, homeAdvantage = ELO_DEFAULTS.homeAdvantage } = {}) {
  const advantage = neutral ? 0 : homeAdvantage;
  return 1 / (1 + 10 ** ((awayRating - (homeRating + advantage)) / 400));
}

export function computeElo(matches, { k = ELO_DEFAULTS.k, homeAdvantage = ELO_DEFAULTS.homeAdvantage, initial = ELO_DEFAULTS.initial } = {}) {
  const ratings = new Map();
  const team = (id) => {
    if (!ratings.has(id)) ratings.set(id, { rating: initial, games: 0 });
    return ratings.get(id);
  };
  const ordered = matches
    .filter((item) => item && Number.isFinite(item.homeGoals) && Number.isFinite(item.awayGoals) && item.homeId != null && item.awayId != null)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  for (const item of ordered) {
    const home = team(String(item.homeId));
    const away = team(String(item.awayId));
    const expected = eloExpectation(home.rating, away.rating, { neutral: item.neutral, homeAdvantage });
    const score = item.homeGoals > item.awayGoals ? 1 : item.homeGoals === item.awayGoals ? 0.5 : 0;
    const delta = k * (score - expected);
    home.rating += delta;
    away.rating -= delta;
    home.games += 1;
    away.games += 1;
  }
  return ratings;
}

export function eloForFixture(matches, { homeId, awayId, neutral = false }, options = ELO_DEFAULTS) {
  const ratings = computeElo(matches, options);
  const initial = options.initial ?? ELO_DEFAULTS.initial;
  const pick = (id) => {
    const entry = ratings.get(String(id));
    return { rating: round(entry?.rating ?? initial, 1), games: entry?.games ?? 0 };
  };
  const home = pick(homeId);
  const away = pick(awayId);
  return {
    home,
    away,
    expectedHome: round(eloExpectation(home.rating, away.rating, { neutral, homeAdvantage: options.homeAdvantage ?? ELO_DEFAULTS.homeAdvantage }), 4),
    matches: matches.length
  };
}
```

Nota: nel test del campo neutro, con rating uguali e attesa 0,5, la vittoria vale +20 × 0,5 = 10 → 1510.

- [ ] **Step 4: Run** `node --test test/elo.test.js && npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/prediction/elo.js test/elo.test.js
git commit -m "Rating Elo della stagione (K=20, casa +60, base 1500)"
```

---

### Task 5: Elo dai risultati ESPN, nel bundle e nell'analisi (fuori dall'ensemble)

**Files:**
- Modify: `src/providers/espn.js` (funzione pura `seasonMatchesFromEvents`, metodo `#seasonMatches`, `bundle.elo`, `sourceStatus.elo`)
- Modify: `src/prediction/engine.js` (`context.elo`, fattore "Rating Elo")
- Modify: `public/app.js` (riga Elo nel dettaglio partita)
- Test: `test/elo.test.js` (in fondo), `test/weather.test.js` non va toccato

**Interfaces:**
- Consumes: `eloForFixture`, `ELO_DEFAULTS` (Task 4).
- Produces: `seasonMatchesFromEvents(events, { eventId, kickoff }): { season: string|null, matches: Match[] }`; `bundle.elo: null | { home, away, expectedHome, matches, season, k, homeAdvantage }`; `bundle.sourceStatus.elo = { available: boolean, error: string|null }`; `analysis.context.elo` (uguale a `bundle.elo` o `null`); fattore `{ name: 'Rating Elo', ... }` presente solo con Elo disponibile.

- [ ] **Step 1: Write the failing test** — in fondo a `test/elo.test.js`

```js
import { seasonMatchesFromEvents } from '../src/providers/espn.js';
import { EspnProvider } from '../src/providers/espn.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { buildConfig } from '../src/configCore.js';
import { DemoProvider } from '../src/providers/demo.js';

const espnEvent = (id, date, slug, homeId, awayId, homeScore, awayScore, completed = true, neutral = false) => ({
  id, date, season: { slug },
  competitions: [{ neutralSite: neutral, status: { type: { completed } }, competitors: [
    { homeAway: 'home', team: { id: homeId }, score: homeScore == null ? undefined : { value: homeScore } },
    { homeAway: 'away', team: { id: awayId }, score: awayScore == null ? undefined : String(awayScore) }
  ] }]
});

test('ESPN → partite della stessa stagione, concluse e precedenti al calcio d inizio', () => {
  const events = [
    espnEvent('1', '2026-05-20T18:00Z', '2025-26', 'A', 'B', 1, 0),
    espnEvent('2', '2026-09-01T18:00Z', '2026-27', 'A', 'B', 2, 2),
    espnEvent('3', '2026-09-08T18:00Z', '2026-27', 'B', 'C', 0, 1, true, true),
    espnEvent('4', '2026-10-20T18:00Z', '2026-27', 'C', 'A', null, null, false),
    espnEvent('9', '2026-10-12T18:00Z', '2026-27', 'A', 'C', null, null, false)
  ];
  const { season, matches } = seasonMatchesFromEvents(events, { eventId: '9', kickoff: '2026-10-12T18:00:00Z' });
  assert.equal(season, '2026-27');
  assert.deepEqual(matches.map((item) => [item.homeId, item.awayId, item.homeGoals, item.awayGoals, item.neutral]), [['A', 'B', 2, 2, false], ['B', 'C', 0, 1, true]]);
  assert.deepEqual(seasonMatchesFromEvents(events, { eventId: 'assente', kickoff: '2026-10-12T18:00:00Z' }), { season: null, matches: [] });
});

function fakeEspnFetch({ failYear = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/scoreboard?dates=')) {
      const year = url.match(/dates=(\d{4})&/)?.[1];
      if (year === failYear) return new Response('{}', { status: 500 });
      if (year === '2025') return ok({ events: [espnEvent('1', '2025-12-10T18:00Z', '2025-26', '10', '20', 3, 0)] });
      return ok({ events: [espnEvent('2', '2026-01-05T18:00Z', '2025-26', '20', '10', 1, 1), espnEvent('777', '2026-01-20T18:00Z', '2025-26', '10', '20', null, null, false)] });
    }
    return ok({});
  };
  return { fetchImpl, calls };
}

test('provider: Elo da due anni solari (stagione a cavallo), una richiesta fallita non blocca', async () => {
  const provider = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: fakeEspnFetch().fetchImpl, weather: { forecastAt: async () => null } });
  const elo = await provider.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20', neutral: false });
  assert.equal(elo.matches, 2, 'dicembre 2025 + gennaio 2026');
  assert.equal(elo.season, '2025-26');
  assert.ok(elo.home.rating > elo.away.rating);
  assert.deepEqual([elo.k, elo.homeAdvantage], [20, 60]);
  const partial = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: fakeEspnFetch({ failYear: '2025' }).fetchImpl, weather: { forecastAt: async () => null } });
  const reduced = await partial.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20', neutral: false });
  assert.equal(reduced.matches, 1);
  const cached = fakeEspnFetch();
  const again = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: cached.fetchImpl, weather: { forecastAt: async () => null } });
  await again.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20' });
  await again.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '20', awayId: '10' });
  assert.equal(cached.calls.length, 2, 'risultati della stagione in cache');
});

test('motore: Elo mostrato e tra i fattori, ensemble invariato', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const config = buildConfig({ DEMO_MODE: 'true' });
  const without = analyzeMatch(bundle, { neutral: true }, config);
  const elo = { home: { rating: 1600, games: 8 }, away: { rating: 1450, games: 8 }, expectedHome: 0.7, matches: 40, season: '2026-27', k: 20, homeAdvantage: 60 };
  const withElo = analyzeMatch({ ...bundle, elo }, { neutral: true }, config);
  assert.deepEqual(withElo.summary.outcomes, without.summary.outcomes, 'l Elo non entra nell ensemble');
  assert.deepEqual(withElo.context.elo, elo);
  assert.equal(without.context.elo, null);
  const factor = withElo.factors.find((item) => item.name === 'Rating Elo');
  assert.equal(factor.direction, bundle.fixture.home.name);
  assert.equal(without.factors.some((item) => item.name === 'Rating Elo'), false);
});
```

(Gli `import` aggiunti vanno in testa al file insieme agli altri, non a metà: spostali lì quando incolli.)

- [ ] **Step 2: Run** `node --test test/elo.test.js` → FAIL (`seasonMatchesFromEvents` non esportata).

- [ ] **Step 3: Implement**

`src/providers/espn.js`:
- import in testa: `import { ELO_DEFAULTS, eloForFixture } from '../prediction/elo.js';` e `import { TTLCache } from '../cache.js';` se non già presente (lo è: verifica con `grep -n "TTLCache" src/providers/espn.js`).
- funzione pura esportata, dopo `lineupsFrom`:

```js
/** Partite concluse della stessa stagione della gara (`season.slug`), giocate prima del suo calcio d'inizio. */
export function seasonMatchesFromEvents(events, { eventId, kickoff }) {
  const target = events.find((event) => String(event.id) === String(eventId));
  const season = target?.season?.slug || null;
  if (!season) return { season: null, matches: [] };
  const before = Date.parse(kickoff);
  const matches = [];
  for (const event of events) {
    const competition = event.competitions?.[0];
    if (event.season?.slug !== season || !competition?.status?.type?.completed || !(Date.parse(event.date) < before)) continue;
    const home = competition.competitors?.find((item) => item.homeAway === 'home');
    const away = competition.competitors?.find((item) => item.homeAway === 'away');
    const goals = (team) => Number(team?.score?.value ?? team?.score);
    if (!home?.team?.id || !away?.team?.id || !Number.isFinite(goals(home)) || !Number.isFinite(goals(away))) continue;
    matches.push({ date: event.date, homeId: String(home.team.id), awayId: String(away.team.id), homeGoals: goals(home), awayGoals: goals(away), neutral: Boolean(competition.neutralSite) });
  }
  return { season, matches };
}
```

- nel costruttore: `this.seasonCache = new TTLCache(12 * 3600000, 64);`
- metodi della classe, prima di `getAnalysisBundle`:

```js
  /** Tutte le partite di un anno solare per un campionato (una richiesta), in cache 12 ore. */
  async #yearEvents(slug, year) {
    const key = `${slug}:${year}`;
    const cached = this.seasonCache.get(key);
    if (cached !== undefined) return cached;
    const payload = await this.request(`/site/v2/sports/soccer/${slug}/scoreboard?dates=${year}&limit=1000`);
    return this.seasonCache.set(key, payload.events || []);
  }

  /**
   * Elo della stagione: anno del calcio d'inizio e anno precedente (stagioni europee a cavallo dell'anno).
   * Un anno non disponibile non blocca: si usa quello che c'è. Senza la gara negli eventi → null.
   */
  async seasonElo(slug, { eventId, kickoff, homeId, awayId, neutral = false }) {
    const year = new Date(kickoff).getUTCFullYear();
    const results = await Promise.allSettled([this.#yearEvents(slug, year - 1), this.#yearEvents(slug, year)]);
    const events = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (!events.length) throw new Error('Risultati della stagione non disponibili.');
    const { season, matches } = seasonMatchesFromEvents(events, { eventId, kickoff });
    if (!season) return null;
    return { ...eloForFixture(matches, { homeId, awayId, neutral }), season, k: ELO_DEFAULTS.k, homeAdvantage: ELO_DEFAULTS.homeAdvantage };
  }
```

Nota: nel test di fallimento parziale, l'anno 2025 restituisce 500 e la gara 777 è nel 2026, quindi resta 1 partita (gennaio 2026). Con `request()` che ritenta gli errori 5xx tre volte il test resta veloce (300 + 600 ms): accettabile; se supera 2 s, passa al fake un 404 al posto del 500 e annota la regola.

- in `getAnalysisBundle`, accanto al meteo (che è già saltato in modalità `lite`), calcola l'Elo solo se `!lite`, isolato:

```js
    let elo = null;
    const eloStatus = { available: false, error: lite ? 'Non calcolato nella previsione rapida.' : null };
    if (!lite) {
      try {
        elo = await this.seasonElo(decoded.slug, { eventId: decoded.eventId, kickoff: fixture.kickoff, homeId: fixture.home.id, awayId: fixture.away.id, neutral: Boolean(headerCompetition?.neutralSite) });
        eloStatus.available = Boolean(elo);
        if (!elo) eloStatus.error = 'Stagione non riconosciuta nei risultati ESPN.';
      } catch (error) {
        eloStatus.error = 'Risultati della stagione non disponibili.';
      }
    }
```

e nel bundle restituito `elo,` più `sourceStatus.elo = eloStatus` (stesso punto in cui si imposta `sourceStatus.weather`; nessuna penalità in `sourceErrors`). In `getAnalysisBundle` le variabili si chiamano `decoded` (`{ slug, eventId }`), `fixture` e `headerCompetition`; il blocco va dopo la costruzione di `fixture`.

`src/prediction/engine.js`:
- in `decisiveFactors`, prima di `return factors;`:

```js
  if (bundle.elo) {
    const diff = bundle.elo.expectedHome - 0.5;
    const fewest = Math.min(bundle.elo.home.games, bundle.elo.away.games);
    factors.push({ name: 'Rating Elo', direction: diff > 0.04 ? bundle.fixture.home.name : diff < -0.04 ? bundle.fixture.away.name : 'Neutrale', intensity: Math.abs(diff) > 0.15 ? 'Alta' : Math.abs(diff) > 0.07 ? 'Media' : 'Bassa', certainty: fewest < 5 ? 'Bassa' : fewest < 15 ? 'Media' : 'Medio-alta' });
  }
```

- in `context`: `elo: bundle.elo || null,`.

`public/app.js`, in `renderAnalysis` subito dopo la riga del meteo (`weather-line`):

```js
      ${analysis.context.elo ? `<p class="weather-line">Elo stagione: ${escapeHtml(fixture.home.name)} ${Math.round(analysis.context.elo.home.rating)} (${analysis.context.elo.home.games} gare) · ${escapeHtml(fixture.away.name)} ${Math.round(analysis.context.elo.away.rating)} (${analysis.context.elo.away.games} gare) · attesa casa ${percent(analysis.context.elo.expectedHome, 0)}. Solo informativo.</p>` : ''}
```

- [ ] **Step 4: Run** `node --test test/elo.test.js && npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/providers/espn.js src/prediction/engine.js public/app.js test/elo.test.js
git commit -m "Elo dai risultati ESPN della stagione: nel dettaglio e tra i fattori, fuori dall'ensemble"
```

---

### Task 6: Versione 2.0.0, verifica, misura, rinomina e pubblicazione

**Files:**
- Modify: `src/api.js` (`APP_VERSION = '2.0.0'`), `package.json` (`"version": "2.0.0"`), test che verificano `1.11.0` (porta a `2.0.0`)
- Modify: `README.md` (Novità 2.0.0, riferimenti ai file offline), `AUDIT_PROGETTO.md` (Rilievi 2.0.0 con la misura), `GUIDA_INSTALLAZIONE.md` (`DEVIG_METHOD`, nomi file), `CLAUDE_PROJECT_HANDOFF.md` (moduli `elo.js`, `devigShin`, `timeline`), `ARCHITETTURA_AI.md` se cita il de-vig
- Cartella principale: `Football Engine v1.9.0 - Demo offline.html` → `Football Engine v2.0.0 - Demo offline.html`, idem `Live offline`; i tre `.command` (commenti e percorso di copia in `Aggiorna snapshot live.command`).

- [ ] **Step 1: Versione** — aggiorna `APP_VERSION`, `package.json` e i test (`grep -rn "1\.11\.0" test src package.json`), `npm test` → PASS, commit `Versione 2.0.0`.
- [ ] **Step 2: Misura del segnale "Valore"** — con uno script nel scratchpad (non nel repo) carica `dist/` dello snapshot live corrente (`app/dist/artifact/football-engine-live.html` contiene `__FOOTBALL_SNAPSHOT__.bundles`; più semplice: esegui `node scripts/build-live-snapshot.mjs` e poi, in uno script, importa `analyzeMatch` e per ogni bundle di `snapshot.bundles` conta `summary.recommendation.hasValue` con `DEVIG_METHOD=shin` e `proportional`). Riporta le due percentuali nell'AUDIT e nel resoconto finale. È una misura, non un obiettivo: se Shin non riduce i segnali lo si dichiara.
- [ ] **Step 3: Prova nel browser** (server demo dalla configurazione `demo` di `.claude/launch.json` nella cartella principale; per l'Elo serve il server live o la PWA: `DEMO_MODE=false` con ESPN), 390×844 scuro e 1024 chiaro: Storico con i due grafici leggibili, nessuno scorrimento orizzontale, dettaglio partita reale con la riga Elo e il fattore "Rating Elo", nessun errore in console.
- [ ] **Step 4: Documentazione** — sezioni Novità/Rilievi, `DEVIG_METHOD`, nuovi nomi dei file offline. `npm run build`, `npm test` → PASS, commit.
- [ ] **Step 5: Revisione finale** del ramo (revisore indipendente), correzioni con test RED→GREEN, `npm test`.
- [ ] **Step 6: Chiusura ramo** (merge in main), copia di documenti e HTML offline nella cartella principale con i **nuovi nomi v2.0.0** (eliminando i vecchi file v1.9.0 solo dopo aver verificato le copie), aggiornamento dei `.command`, zip `enterprise-football-engine-v2.0.0.zip` e `documentazione-football-engine-v2.0.0.zip`, zip 1.11.0 in `archivio/`.
- [ ] **Step 7: Pubblicazione** — login GitHub temporaneo dell'utente, push, workflow Pages, verifica online (`sw.js` contiene `2.0.0`, `engine.js` identico a `dist/pwa/engine.js`), ripubblicazione dell'Artifact, logout e pulizia.
- [ ] **Step 8: Rinomina della cartella principale** da `Enterprise Football Prediction Engine v1.9.0` a `Enterprise Football Prediction Engine v2.0.0`, come **ultima azione** (la sessione lavora dentro quella cartella): prima copia la memoria del progetto nella cartella di memoria del nuovo percorso, poi rinomina con un solo `mv` e verifica che il repository git e i `.command` funzionino dal nuovo percorso.
