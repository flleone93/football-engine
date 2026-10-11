# Indicazione sull'esito più probabile (v2.1.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'Indicazione diventa il segno 1X2 più probabile del motore. Sotto compaiono sempre due giocate più sicure: la doppia chance della favorita e l'Over 1.5. Lo Storico misura esattamente ciò che l'app mostra.

**Architecture:** La regola di scelta vive solo in `buildRecommendation` (`src/prediction/recommendation.js`), che restituisce anche `safer`. Tutti gli altri punti (registro, Top del giorno, Kelly, diario, badge) leggono già `summary.recommendation`, quindi si adeguano da soli. Il registro salva `prediction.safer`, le metriche aggiungono `safer`, l'interfaccia mostra la nuova riga.

**Tech Stack:** Node ESM senza dipendenze, `node:test`, frontend vanilla in un unico file incorporato (CSP rigida).

**Spec:** `docs/superpowers/specs/2026-10-11-indicazione-piu-probabile-design.md`

## Global Constraints

- Segno 1X2: probabilità finale più alta; in caso di parità l'ordine è **1, poi 2, poi X**.
- `hasValue` solo se il segno scelto ha edge ≥ 0,025 **ed** EV ≥ 0,03 (soglie invariate).
- Giocate più sicure **sempre entrambe**, in quest'ordine: doppia chance della favorita (`1X` se P(1) ≥ P(2), altrimenti `X2`), poi `OVER_1_5`.
- Quota della doppia chance = 1 / probabilità di mercato senza margine, arrotondata a 2 decimali, con `estimated: true`. Quota dell'Over 1.5 solo se fornita, mai stimata.
- Versione **2.1.0**. Firma "Creata da Leone Francesco" invariata. iPhone 390 px senza scorrimento orizzontale.

## Review Focus

- Partita senza quote → segno più probabile, `hasValue false`, quote delle giocate più sicure vuote, nessun NaN (test in Task 1).
- Probabilità uguali tra 1 e 2, o pareggio favorito → scelta deterministica e doppia chance coerente (test in Task 1).
- Record dello Storico precedenti alla 2.1.0 senza `safer` → ignorati nella nuova metrica, nessun crash (test in Task 2).
- Agente AI che sposta le probabilità → l'Indicazione segue la probabilità finale, non la baseline (verifica in Task 1 tramite `analyzeMatch` con `options` già corrette).
- Top del giorno con il nuovo segno (spesso favorite a quota bassa) → resta funzionante con le soglie esistenti (suite esistente in Task 1).

---

### Task 1: Regola di scelta e giocate più sicure

**Files:**
- Modify: `src/prediction/recommendation.js` (selezione, `hasValue`, `status`, `safer`; rimozione di `valueScore`)
- Test: `test/recommendation.test.js` (nuovo)

**Interfaces:**
- Produces: `buildRecommendation(...)` restituisce `key` del segno più probabile, `hasValue` del segno, `status`, `safer: Array<{ key: '1X'|'X2'|'OVER_1_5', label: string, probability: number, odd: number|null, estimated: boolean }>` (lunghezza 2), più i campi esistenti (`candidates`, `devigFallbacks`, ...).

- [ ] **Step 1: Write the failing test** — `test/recommendation.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { buildRecommendation } from '../src/prediction/recommendation.js';
import { DemoProvider } from '../src/providers/demo.js';

// Probabilità reali del motore per Sassuolo–AC Milan (11/10/2026) e quote DraftKings via ESPN.
const SASSUOLO_MILAN = { '1': 0.336204, X: 0.273343, '2': 0.390453, '1X': 0.609547, X2: 0.663796, GOAL: 0.567, NO_GOAL: 0.433, OVER_1_5: 0.768, UNDER_1_5: 0.232, OVER_2_5: 0.518, UNDER_2_5: 0.482 };
const SASSUOLO_MILAN_ODDS = { values: { '1': 3.95, X: 3.6, '2': 1.833, OVER_2_5: 1.69, UNDER_2_5: 2.15 } };
const markets = (p1, px, p2, over15 = 0.75) => ({ '1': p1, X: px, '2': p2, '1X': p1 + px, X2: px + p2, GOAL: 0.5, NO_GOAL: 0.5, OVER_1_5: over15, UNDER_1_5: 1 - over15, OVER_2_5: 0.5, UNDER_2_5: 0.5 });

test('Sassuolo–Milan: Indicazione sul Milan (più probabile), non sul Sassuolo con più edge', () => {
  const result = buildRecommendation(SASSUOLO_MILAN, SASSUOLO_MILAN_ODDS, 60, 'shin');
  assert.equal(result.key, '2');
  assert.equal(result.probability, 0.390453);
  assert.equal(result.hasValue, false, 'il valore è sul Sassuolo, non sul segno indicato');
  assert.match(result.status, /più probabile/);
  const [doubleChance, over] = result.safer;
  assert.equal(doubleChance.key, 'X2');
  assert.equal(doubleChance.probability, 0.663796);
  assert.equal(doubleChance.estimated, true);
  const x2 = result.candidates.find((item) => item.key === 'X2');
  assert.equal(doubleChance.odd, Math.round(100 / x2.marketProbability) / 100);
  assert.deepEqual([over.key, over.probability, over.odd, over.estimated], ['OVER_1_5', 0.768, null, false]);
  assert.ok(result.candidates.find((item) => item.key === '1').edge > 0.1, 'il valore resta visibile nei mercati');
});

test('favorita con valore → hasValue; favorita in casa → doppia chance 1X', () => {
  const result = buildRecommendation(markets(0.55, 0.25, 0.2), { values: { '1': 2.0, X: 3.4, '2': 4.0 } }, 70, 'shin');
  assert.equal(result.key, '1');
  assert.equal(result.hasValue, true);
  assert.equal(result.safer[0].key, '1X');
});

test('pareggio favorito e parità tra 1 e 2: scelte deterministiche', () => {
  const draw = buildRecommendation(markets(0.3, 0.4, 0.3), null, 50, 'shin');
  assert.equal(draw.key, 'X');
  assert.equal(draw.safer[0].key, '1X', 'con P(1) = P(2) vince 1X');
  const tie = buildRecommendation(markets(0.36, 0.28, 0.36), null, 50, 'shin');
  assert.equal(tie.key, '1', 'parità: 1 prima di 2');
  const away = buildRecommendation(markets(0.3, 0.32, 0.38), null, 50, 'shin');
  assert.equal(away.safer[0].key, 'X2');
});

test('senza quote: segno più probabile, nessun valore, quote vuote', () => {
  const result = buildRecommendation(markets(0.2, 0.3, 0.5), null, 50, 'shin');
  assert.equal(result.key, '2');
  assert.equal(result.hasValue, false);
  assert.equal(result.odd, null);
  assert.deepEqual(result.safer.map((pick) => pick.odd), [null, null]);
  assert.ok(result.safer.every((pick) => Number.isFinite(pick.probability)));
});

test('proprietà su tutte le partite demo: il segno indicato non è mai meno probabile di un altro segno 1X2', async () => {
  const provider = new DemoProvider();
  const config = buildConfig({ DEMO_MODE: 'true' });
  for (const fixture of await provider.getFixtures({ days: 14 })) {
    const analysis = analyzeMatch(await provider.getAnalysisBundle(fixture.id), { neutral: false }, config);
    const o = analysis.summary.outcomes;
    const chosen = { '1': o.home, X: o.draw, '2': o.away }[analysis.summary.recommendation.key];
    assert.ok(chosen != null, `${fixture.id}: Indicazione fuori dall'1X2`);
    assert.ok(chosen >= Math.max(o.home, o.draw, o.away) - 1e-6, fixture.id);
    assert.equal(analysis.summary.recommendation.safer.length, 2);
  }
});
```

- [ ] **Step 2: Run** `node --test test/recommendation.test.js` → FAIL (`result.key` vale `'1'`, `safer` assente).

- [ ] **Step 3: Implement** — in `src/prediction/recommendation.js`:
  - nella mappa dei candidati elimina il calcolo di `valueScore` e il campo `valueScore` dall'oggetto restituito (non serve più: la scelta non dipende dall'edge);
  - sostituisci il blocco da `const valueCandidates = ...` fino alla fine della funzione con:

```js
  const byKey = Object.fromEntries(candidates.map((item) => [item.key, item]));
  // Segno 1X2 più probabile; a parità vince l'ordine 1, 2, X (scelta deterministica).
  const selected = ['1', '2', 'X'].map((key) => byKey[key]).reduce((best, item) => (item.probability > best.probability ? item : best));
  const hasValue = selected.edge != null && selected.edge >= 0.025 && selected.expectedValue != null && selected.expectedValue >= 0.03;
  return {
    ...selected,
    hasValue,
    devigFallbacks,
    status: hasValue
      ? 'Esito più probabile, con margine statistico rispetto alla quota.'
      : 'Esito più probabile del modello; la quota non offre un vantaggio sufficiente.',
    safer: saferPicks(byKey),
    candidates: candidates.sort((a, b) => b.probability - a.probability)
  };
}

/** Giocate più sicure, sempre entrambe: doppia chance della favorita e Over 1.5. */
function saferPicks(byKey) {
  const doubleChance = byKey['1'].probability >= byKey['2'].probability ? byKey['1X'] : byKey.X2;
  const fairOdd = doubleChance.marketProbability > 0 ? Math.round(100 / doubleChance.marketProbability) / 100 : null;
  const over = byKey.OVER_1_5;
  return [
    { key: doubleChance.key, label: doubleChance.label, probability: doubleChance.probability, odd: fairOdd, estimated: fairOdd != null },
    { key: over.key, label: over.label, probability: over.probability, odd: over.odd > 1 ? over.odd : null, estimated: false }
  ];
}
```

  (Il `candidates.sort(...).map(({ valueScore, ...item }) => item)` precedente diventa un semplice `sort`, perché `valueScore` non esiste più.)

- [ ] **Step 4: Run** `node --test test/recommendation.test.js && npm test`. I test esistenti che si aspettavano la vecchia regola (Top del giorno, motore, previsioni rapide, Kelly) vanno letti uno per uno. Si aggiorna l'aspettativa solo se contraddice la nuova regola della spec, annotando una Ruling nel ledger per ciascuno. Se un test fallisce per un'altra ragione, si indaga con systematic-debugging.
- [ ] **Step 5: Commit**

```bash
git add src/prediction/recommendation.js test/recommendation.test.js
git commit -m "Indicazione sul segno 1X2 più probabile e giocate più sicure (doppia chance e Over 1.5)"
```

---

### Task 2: Registro e Storico delle giocate più sicure

**Files:**
- Modify: `src/tracking/predictionLedger.js` (`prediction.safer` in `record()`)
- Modify: `src/tracking/metrics.js` (`saferReport`, campo `safer` in `evaluatePredictions`)
- Test: `test/tracking.test.js` (in fondo)

**Interfaces:**
- Consumes: `analysis.summary.recommendation.safer` (Task 1).
- Produces: `record.prediction.safer: Array<{ key, probability, odd, estimated }>`; `evaluatePredictions(...).safer = { doubleChance: Report, over15: Report }` con `Report = { n, hits, hitRate: number|null, averageProbability: number|null }`.

- [ ] **Step 1: Write the failing test** — in fondo a `test/tracking.test.js`

```js
test('registro e Storico: giocate più sicure salvate e valutate, record vecchi ignorati', () => {
  const ledger = new PredictionLedger();
  const kickoff = new Date(Date.now() - 5 * HOUR).toISOString();
  const analysis = fakeAnalysis({ id: 's1', kickoff, generatedAt: new Date(Date.now() - 8 * HOUR).toISOString() });
  analysis.summary.recommendation.safer = [{ key: '1X', label: '1X', probability: 0.7, odd: 1.3, estimated: true }, { key: 'OVER_1_5', label: 'Over 1.5', probability: 0.75, odd: null, estimated: false }];
  const record = ledger.record(analysis);
  assert.deepEqual(record.prediction.safer.map((pick) => pick.key), ['1X', 'OVER_1_5']);
  const settled = [
    { ...record, result: { outcome: 'away', goals: { home: 0, away: 1 } } },
    { ...record, result: { outcome: 'home', goals: { home: 2, away: 1 } } },
    { ...record, prediction: { ...record.prediction, safer: undefined }, result: { outcome: 'home', goals: { home: 1, away: 0 } } }
  ];
  const report = evaluatePredictions(settled).safer;
  assert.deepEqual([report.doubleChance.n, report.doubleChance.hits, report.doubleChance.hitRate], [2, 1, 0.5]);
  assert.deepEqual([report.over15.n, report.over15.hits], [2, 1]);
  assert.equal(report.over15.averageProbability, 0.75);
  assert.deepEqual(evaluatePredictions([]).safer.doubleChance, { n: 0, hits: 0, hitRate: null, averageProbability: null });
});
```

- [ ] **Step 2: Run** `node --test test/tracking.test.js` → FAIL (`record.prediction.safer` indefinito).

- [ ] **Step 3: Implement**

`src/tracking/predictionLedger.js`, in `record()`, dentro `prediction`, dopo `odds: ...`:

```js
        safer: (recommendation.safer || []).map((pick) => ({ key: pick.key, probability: round(Number(pick.probability) || 0, 6), odd: Number(pick.odd) > 1 ? pick.odd : null, estimated: Boolean(pick.estimated) })),
```

`src/tracking/metrics.js`, prima di `evaluatePredictions`:

```js
/** Giocate più sicure mostrate dall'app (doppia chance della favorita e Over 1.5): quante sono andate a segno. */
function saferReport(records) {
  const build = (match) => {
    const rows = records.flatMap((record) => (Array.isArray(record.prediction?.safer) ? record.prediction.safer : [])
      .filter((pick) => match(pick.key))
      .map((pick) => ({ probability: pick.probability, hit: settleMarket(pick.key, record.result.goals) })))
      .filter((row) => row.hit != null && Number.isFinite(row.probability));
    const hits = rows.filter((row) => row.hit).length;
    return {
      n: rows.length,
      hits,
      hitRate: rows.length ? round(hits / rows.length, 6) : null,
      averageProbability: rows.length ? round(average(rows.map((row) => row.probability)), 6) : null
    };
  };
  return { doubleChance: build((key) => key === '1X' || key === 'X2'), over15: build((key) => key === 'OVER_1_5') };
}
```

Nel `return` di `evaluatePredictions`, dopo `recommendations: ...`: `safer: saferReport(settled),`.

- [ ] **Step 4: Run** `node --test test/tracking.test.js && npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/tracking/predictionLedger.js src/tracking/metrics.js test/tracking.test.js
git commit -m "Storico: giocate più sicure salvate nel registro e valutate"
```

---

### Task 3: Interfaccia — riga "Giocate più sicure", Condividi e Storico

**Files:**
- Modify: `public/app.js` (scheda Indicazione, `shareText`, sezione "Indicazioni principali")
- Modify: `public/styles.css`
- Test: `test/pwa.test.js`

**Interfaces:**
- Consumes: `summary.recommendation.safer` (Task 1), `evaluation.safer` (Task 2).

- [ ] **Step 1: Failing test** — in `test/pwa.test.js`, nel test della build, dopo le asserzioni dei grafici:

```js
  assert.match(everything, /Giocate più sicure/);
  assert.match(everything, /quota stimata/);
```

Run `node --test test/pwa.test.js` → FAIL.

- [ ] **Step 2: Implement** — `public/app.js`:
  - nella `pick-card` di `renderAnalysis`, subito dopo `<p class="pick-note">…</p>` e prima della riga `stake-line`:

```js
      ${recommendation.safer?.length ? `<div class="safer-picks"><p class="kicker">Giocate più sicure</p>${recommendation.safer.map((pick) => `<div class="safer-pick"><span>${escapeHtml(pick.label)}</span><b>${percent(pick.probability, 0)}</b><small>${pick.odd ? `${pick.estimated ? 'quota stimata' : 'quota'} ${decimal(pick.odd)}` : 'quota non disponibile'}</small></div>`).join('')}</div>` : ''}
```

  - in `shareText`, dopo la riga dell'Indicazione:

```js
  const safer = (summary.recommendation.safer || []).map((pick) => `${pick.label} ${percent(pick.probability, 0)}`).join(' · ');
```

  e nel testo restituito aggiungi `${safer ? `\nPiù sicure: ${safer}` : ''}` subito dopo la parte `Indicazione: …`.

  - nella sezione `'Indicazioni principali'` di `renderPerformance`, dentro `<div class="recommendation-grid">` dopo le due card esistenti:

```js
${evaluation.safer ? `${renderSaferCard('Doppia chance della favorita', evaluation.safer.doubleChance)}${renderSaferCard('Over 1.5', evaluation.safer.over15)}` : ''}
```

  e la funzione, subito dopo `renderRecommendationCard`:

```js
function renderSaferCard(title, report) {
  return `<article class="top-ticket-card"><span>${escapeHtml(title)}</span><strong>${report.n ? `${report.hits}/${report.n} a segno` : 'Ancora nessuna'}</strong><dl>
    <dt>Frequenza</dt><dd>${report.hitRate == null ? '—' : percent(report.hitRate)}</dd>
    <dt>Probabilità media</dt><dd>${report.averageProbability == null ? '—' : percent(report.averageProbability)}</dd>
  </dl></article>`;
}
```

  `public/styles.css` (in fondo):

```css
/* ---------- Giocate più sicure (2.1) ---------- */
.safer-picks { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid var(--line); }
.safer-pick { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 2px 10px; }
.safer-pick b { font-family: var(--font-data); font-size: 16px; }
.safer-pick small { grid-column: 1 / -1; color: var(--muted); font-size: 12px; }
```

- [ ] **Step 3: Build e test** — `npm run build:pwa && npm test` → PASS
- [ ] **Step 4: Commit**

```bash
git add public/app.js public/styles.css test/pwa.test.js
git commit -m "Scheda Indicazione: giocate più sicure; Condividi e Storico aggiornati"
```

---

### Task 4: Versione 2.1.0, verifica, revisione e pubblicazione

**Files:**
- Modify: `src/api.js` (`APP_VERSION = '2.1.0'`), `package.json`, `test/journalApi.test.js` (asserzione di versione)
- Modify: `README.md` (Novità 2.1.0), `AUDIT_PROGETTO.md` (Rilievi 2.1.0 con le misure prima/dopo), `CLAUDE_PROJECT_HANDOFF.md` (versione, regola dell'Indicazione)

- [ ] **Step 1:** versione 2.1.0 in `src/api.js`, `package.json` e nel test della versione; `npm test` → PASS; commit `Versione 2.1.0`.
- [ ] **Step 2: Misura** — con lo script nel scratchpad sullo snapshot reale (dopo `node scripts/build-live-snapshot.mjs`): numero di partite in cui il segno indicato non è il più probabile, che deve essere **0** (prima era 90 su 104), e percentuale di "Valore" sul segno indicato (prima 85%). Le due cifre vanno nell'AUDIT e nel resoconto.
- [ ] **Step 3: Verifica nel simulatore iPhone** — servire la build PWA in locale (preview del server live su `localhost`) e aprirla nel simulatore. Su una partita reale con la favorita in trasferta: Indicazione sul segno più probabile, riga "Giocate più sicure" con doppia chance e Over 1.5, nessuno scorrimento orizzontale. Controllo nel browser anche lo Storico, con la nuova card.
- [ ] **Step 4: Documentazione**, `npm run build`, `npm test` → PASS, commit.
- [ ] **Step 5: Revisione finale** del ramo con un revisore indipendente; correzioni dei rilievi importanti con test RED→GREEN.
- [ ] **Step 6: Chiusura** — merge in main, copia nella cartella principale di documenti e HTML offline (nomi v2.0.0 invariati: la rinomina delle cartelle avviene solo sulle versioni principali), zip `…-v2.1.0.zip`, zip 2.0.0 in `archivio/`.
- [ ] **Step 7: Pubblicazione** — login GitHub temporaneo dell'utente, push, verifica online (`sw.js` con `2.1.0`, `engine.js` identico), ripubblicazione dell'Artifact, logout e pulizia; verifica finale nel simulatore sulla versione online.
