# Fase 2 — Valore e giocate (v1.11.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Puntata consigliata con Kelly frazionario, diario delle giocate con regolazione automatica e CLV, limiti di perdita con avviso, sezione "Le mie giocate" nello Storico.

**Architecture:** Logica pura in `src/prediction/staking.js` e `src/tracking/betJournal.js` (storage iniettato come il registro previsioni: JSONL sul server, IndexedDB su iPhone, memoria altrove). Il diario non duplica dati: quota di chiusura e risultato si ricavano a ogni lettura dal registro previsioni (`ledger.fixtureSnapshot`). L'interfaccia (`public/app.js`, script incorporato senza import) non calcola nulla: chiede puntate e riepiloghi alle API (`/api/journal*`), così la logica resta una sola e testata.

**Tech Stack:** Node ESM senza dipendenze, `node:test`, frontend vanilla JS in un unico file, CSP rigida (niente stili inline: larghezze via CSSOM).

**Spec:** `docs/superpowers/specs/2026-10-10-ottimizzazione-app-design.md` (sezione 6, più 8 e 9).

## Global Constraints

- Versione: Fase 2 → **1.11.0**. Cartelle e file della cartella principale non si rinominano (solo a v2.0.0).
- Dati gratuiti, nessun server: tutto gira sul telefono; stesse modifiche valgono per server Node, file offline e Artifact.
- La firma "Creata da Leone Francesco" resta in alto a destra.
- Previsioni oneste: nessuna funzione che prometta profitto; limiti di spesa con avviso, **nessun blocco**.
- Kelly: `max(0, (p·o − 1)/(o − 1))`; frazione predefinita **1/4** (scelte 1/8 · 1/4 · 1/2); tetto predefinito **2%** del bankroll; arrotondamento a **0,50 €**; bankroll predefinito vuoto → puntata in % del bankroll.
- CLV = quota presa / quota di chiusura − 1; senza quota di chiusura resta vuoto, **mai stimato**.
- Kelly e CLV con dati mancanti mostrano "—".
- Archiviazione non disponibile: il diario resta per la sessione, con un avviso.
- iPhone 390×844: niente scorrimento orizzontale, tocchi ≥ 44 px.

**Scostamenti motivati dalla spec (da confermare in revisione):**
1. Bankroll, frazione, tetto e limiti si impostano in Storico › "Le mie giocate" › "Bankroll e limiti", non nel tab Impostazioni: il tab Impostazioni esiste solo nell'app iPhone, mentre il diario funziona anche su server, file offline e Artifact.
2. Il diario si esporta con un pulsante dedicato "Esporta diario CSV" nella sua sezione (file separato), invece di un secondo file scaricato insieme al registro: su iPhone due download di fila aprono due fogli di condivisione.
3. Si possono registrare solo giocate **prima del calcio d'inizio** e su partite già analizzate (quindi presenti nel registro): è l'unico modo per avere regolazione automatica e CLV onesti.
4. Nell'Artifact il diario vive in memoria (spec: "memoria negli altri casi").

## Review Focus

- Quota o puntata digitate con la virgola dalla tastiera italiana ("2,10") → accettate come 2.10, non rifiutate né trasformate in NaN (test in Task 3).
- Doppio tocco su "Aggiungi" → una sola richiesta alla volta (pulsante disattivato durante l'invio, Task 5).
- Giocata su partita non analizzata o già iniziata → messaggio chiaro, nessuna giocata fantasma (test in Task 4).
- Campi bankroll/limiti vuoti, zero o negativi → `null`/predefiniti, mai NaN nei calcoli (test in Task 3).
- Registro con previsioni vecchie senza `prediction.odds` ed eventi del diario corrotti → CLV "—" e righe ignorate, nessun crash (test in Task 2 e 3).

---

### Task 1: Kelly e puntata consigliata

**Files:**
- Create: `src/prediction/staking.js`
- Modify: `src/prediction/recommendation.js:38-45` (campo `kellyFraction` nei candidati)
- Test: `test/staking.test.js`

**Interfaces:**
- Produces: `kellyFraction(probability: number, odd: number): number|null`; `recommendedStake({ probability, odd, settings }): { kellyFraction: number|null, fraction: number|null, stake: number|null, hasStake: boolean }` con `settings = { bankroll: number|null, kellyMultiplier: number, maxStakePct: number }`. Ogni mercato di `analysis.markets` ha `kellyFraction: number|null`.

- [ ] **Step 1: Write the failing test** — `test/staking.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecommendation } from '../src/prediction/recommendation.js';
import { kellyFraction, recommendedStake } from '../src/prediction/staking.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const settings = (extra = {}) => ({ bankroll: null, kellyMultiplier: 0.25, maxStakePct: 0.02, ...extra });

test('Kelly: valori di riferimento', () => {
  near(kellyFraction(0.6, 2), 0.2);
  near(kellyFraction(0.5, 2.2), 0.1 / 1.2);
  assert.equal(kellyFraction(0.4, 2), 0, 'valore atteso negativo → nessuna puntata');
  assert.equal(kellyFraction(0.5, 1), null);
  assert.equal(kellyFraction(0.5, null), null);
  assert.equal(kellyFraction(Number.NaN, 2), null);
  assert.equal(kellyFraction(1.2, 2), null);
});

test('puntata: frazione, tetto e arrotondamento a 0,50 €', () => {
  assert.deepEqual(recommendedStake({ probability: 0.6, odd: 2, settings: settings({ bankroll: 500 }) }), { kellyFraction: 0.2, fraction: 0.02, stake: 10, hasStake: true });
  const small = recommendedStake({ probability: 0.5, odd: 2.2, settings: settings({ bankroll: 1000, kellyMultiplier: 0.125 }) });
  near(small.fraction, 0.1 / 1.2 * 0.125);
  assert.equal(small.stake, 10.5);
  assert.equal(small.hasStake, true);
});

test('puntata: senza bankroll in %, senza valore nessuna puntata', () => {
  const percentOnly = recommendedStake({ probability: 0.6, odd: 2, settings: settings() });
  assert.equal(percentOnly.stake, null);
  assert.equal(percentOnly.fraction, 0.02);
  assert.equal(percentOnly.hasStake, true);
  assert.deepEqual(recommendedStake({ probability: 0.4, odd: 2, settings: settings({ bankroll: 500 }) }), { kellyFraction: 0, fraction: 0, stake: 0, hasStake: false });
  assert.equal(recommendedStake({ probability: 0.51, odd: 2, settings: settings({ bankroll: 10 }) }).hasStake, false, 'sotto 0,25 € arrotonda a zero');
  assert.deepEqual(recommendedStake({ probability: 0.5, odd: null, settings: settings({ bankroll: 500 }) }), { kellyFraction: null, fraction: null, stake: null, hasStake: false });
});

test('mercati: kellyFraction accanto a quota ed EV', () => {
  const result = buildRecommendation({ '1': 0.6, X: 0.25, '2': 0.15, '1X': 0.85, X2: 0.4, GOAL: 0.5, NO_GOAL: 0.5, OVER_1_5: 0.7, UNDER_1_5: 0.3, OVER_2_5: 0.5, UNDER_2_5: 0.5 }, { values: { '1': 2, X: 3.4, '2': 4 } }, 70);
  const home = result.candidates.find((item) => item.key === '1');
  near(home.kellyFraction, 0.2);
  assert.equal(result.candidates.find((item) => item.key === 'GOAL').kellyFraction, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/staking.test.js`
Expected: FAIL — `Cannot find module '../src/prediction/staking.js'`

- [ ] **Step 3: Write minimal implementation** — `src/prediction/staking.js`

```js
// Puntata consigliata con criterio di Kelly frazionario. Funzioni pure, nessuna dipendenza.
// La puntata è un'indicazione di gestione del rischio, non una promessa di profitto.

/** Frazione di Kelly piena: max(0, (p·o − 1)/(o − 1)). null se probabilità o quota non sono utilizzabili. */
export function kellyFraction(probability, odd) {
  const p = Number(probability);
  const o = Number(odd);
  if (odd == null || probability == null || !Number.isFinite(p) || !Number.isFinite(o) || p < 0 || p > 1 || o <= 1) return null;
  return Math.max(0, (p * o - 1) / (o - 1));
}

/**
 * Puntata = bankroll × moltiplicatore × Kelly, con tetto in % del bankroll, arrotondata a 0,50 €.
 * Senza bankroll restituisce solo la frazione (la UI la mostra in % del bankroll).
 */
export function recommendedStake({ probability, odd, settings }) {
  // Arrotondato a 6 decimali: (1,2 − 1)/1 in virgola mobile vale 0,19999999999999996.
  const raw = kellyFraction(probability, odd);
  const kelly = raw == null ? null : Math.round(raw * 1e6) / 1e6;
  if (kelly == null) return { kellyFraction: null, fraction: null, stake: null, hasStake: false };
  const fraction = Math.round(Math.min(kelly * settings.kellyMultiplier, settings.maxStakePct) * 1e6) / 1e6;
  if (!(settings.bankroll > 0)) return { kellyFraction: kelly, fraction, stake: null, hasStake: fraction > 0 };
  const stake = Math.round((settings.bankroll * fraction) * 2) / 2;
  return { kellyFraction: kelly, fraction, stake, hasStake: stake > 0 };
}
```

In `src/prediction/recommendation.js` aggiungi l'import in testa e il campo nel candidato:

```js
import { kellyFraction } from './staking.js';
```

```js
      expectedValue: expectedValue == null ? null : round(expectedValue, 4),
      kellyFraction: odd > 1 ? round(kellyFraction(probability, odd), 6) : null,
```

- [ ] **Step 4: Run tests**

Run: `node --test test/staking.test.js && npm test`
Expected: PASS (tutti, 77+)

- [ ] **Step 5: Commit**

```bash
git add src/prediction/staking.js src/prediction/recommendation.js test/staking.test.js
git commit -m "Kelly frazionario: puntata consigliata e kellyFraction sui mercati"
```

---

### Task 2: Quote nel registro e fotografia della partita

**Files:**
- Modify: `src/tracking/predictionLedger.js` (`record()` salva `prediction.odds`; nuovo metodo `fixtureSnapshot`)
- Test: `test/tracking.test.js` (in fondo)

**Interfaces:**
- Produces: `record.prediction.odds: { [marketKey]: number }` (solo mercati con quota > 1); `ledger.fixtureSnapshot(fixtureId): null | { fixture: { id, kickoff, league:{name}, home:{name}, away:{name} }, closingOdds: object|null, closingAt: string, result: object|null }` — usa l'ultima previsione registrata (tutte sono pre-partita per costruzione).

- [ ] **Step 1: Write the failing test** — aggiungi in fondo a `test/tracking.test.js`

```js
test('registro: salva tutte le quote e fornisce la fotografia della partita', () => {
  const ledger = new PredictionLedger();
  const kickoff = new Date(Date.now() + 6 * HOUR).toISOString();
  ledger.record(fakeAnalysis({ id: 'f9', kickoff, generatedAt: new Date(Date.now() - 2 * HOUR).toISOString() }));
  const later = fakeAnalysis({ id: 'f9', kickoff, generatedAt: new Date(Date.now() - HOUR).toISOString() });
  later.markets = [{ key: '1', probability: 0.5, odd: 1.95 }, { key: 'X', probability: 0.3, odd: null }];
  ledger.record(later);
  const snapshot = ledger.fixtureSnapshot('f9');
  assert.deepEqual(snapshot.closingOdds, { '1': 1.95 });
  assert.equal(snapshot.closingAt, later.generatedAt);
  assert.equal(snapshot.fixture.home.name, 'Casa');
  assert.equal(snapshot.result, null);
  assert.equal(ledger.fixtureSnapshot('sconosciuta'), null);
});

test('registro: previsioni vecchie senza quote → closingOdds null', () => {
  const kickoff = new Date(Date.now() - 5 * HOUR).toISOString();
  const record = { id: 'old|x|neutral=false', source: 'engine', predictedAt: new Date(Date.now() - 8 * HOUR).toISOString(), computedAt: 'x', fixture: { id: 'old', kickoff, league: { name: 'L' }, home: { name: 'A' }, away: { name: 'B' } }, prediction: { outcomes: { home: 0.4, draw: 0.3, away: 0.3 }, recommendation: {} } };
  const storage = { kind: 'memory', load: () => [{ type: 'prediction', record }, { type: 'settlement', fixtureId: 'old', result: { finished: true, void: false, goals: { home: 2, away: 1 }, outcome: 'home' } }], append() {} };
  const snapshot = new PredictionLedger({ storage }).fixtureSnapshot('old');
  assert.equal(snapshot.closingOdds, null);
  assert.deepEqual(snapshot.result.goals, { home: 2, away: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tracking.test.js`
Expected: FAIL — `ledger.fixtureSnapshot is not a function`

- [ ] **Step 3: Implement** — in `record()`, dentro `prediction: { ... }` dopo `markets: ...`:

```js
        odds: Object.fromEntries((analysis.markets || []).filter((market) => Number(market.odd) > 1).map((market) => [market.key, Number(market.odd)])),
```

Nuovo metodo della classe, dopo `officialRecords()`:

```js
  /** Ultima previsione pre-partita di una gara: quote di chiusura (per il CLV) e risultato, se acquisito. */
  fixtureSnapshot(fixtureId) {
    const key = String(fixtureId);
    let latest = null;
    for (const record of this.#predictions.values()) {
      if (String(record.fixture.id) !== key) continue;
      if (!latest || record.predictedAt > latest.predictedAt || (record.predictedAt === latest.predictedAt && record.computedAt > latest.computedAt)) latest = record;
    }
    if (!latest) return null;
    const odds = latest.prediction.odds;
    return {
      fixture: latest.fixture,
      closingOdds: odds && Object.keys(odds).length ? { ...odds } : null,
      closingAt: latest.predictedAt,
      result: this.#settlements.get(key) || null
    };
  }
```

- [ ] **Step 4: Run tests** — `npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/tracking/predictionLedger.js test/tracking.test.js
git commit -m "Registro: quote di tutti i mercati e fotografia della partita per il CLV"
```

---

### Task 3: Diario delle giocate (logica pura)

**Files:**
- Create: `src/tracking/betJournal.js`
- Test: `test/betJournal.test.js`

**Interfaces:**
- Consumes: `settleMarket(key, goals)` da `metrics.js`; `recommendedStake` (Task 1); snapshot di `ledger.fixtureSnapshot` (Task 2); `MemoryLedgerStorage` da `predictionLedger.js`.
- Produces:
  - `DEFAULT_STAKING = { bankroll: null, kellyMultiplier: 0.25, maxStakePct: 0.02, dailyLossLimit: null, weeklyLossLimit: null }`
  - `toNumber(value): number|null` (accetta "2,10")
  - `normalizeSettings(input): settings` (lancia errore `code: 'validation_error'` per valori fuori dominio)
  - `deriveBet(bet, snapshot, now = Date.now()): DerivedBet` con `status: 'open'|'won'|'lost'|'void'`, `closingOdd`, `clv`, `clvFinal`, `profit`, `goals`
  - `summarize(derived): { count, open, settled, won, lost, voided, staked, profit, roi, winRate, avgClv, clvCount }`
  - `periodLosses(derived, now, timeZone): { today, week }` (perdite nette ≥ 0)
  - `limitStatus(losses, settings): { daily: {limit, loss, exceeded}, weekly: {limit, loss, exceeded}, anyExceeded }`
  - `class BetJournal { constructor({ storage, idFactory }) ; settings() ; saveSettings(input) ; add(bet) ; remove(id): boolean ; bets(): Bet[] ; loadErrors }`
  - Bet: `{ id, fixtureId, match, competition, kickoff, marketKey, label, oddTaken, stake, placedAt }`

- [ ] **Step 1: Write the failing test** — `test/betJournal.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { BetJournal, DEFAULT_STAKING, deriveBet, limitStatus, normalizeSettings, periodLosses, summarize, toNumber } from '../src/tracking/betJournal.js';
import { MemoryLedgerStorage } from '../src/tracking/predictionLedger.js';

const HOUR = 3600000;
const NOW = Date.parse('2026-10-11T12:00:00Z');
const bet = (extra = {}) => ({ id: 'b1', fixtureId: 'f1', match: 'Casa - Ospite', competition: 'Lega', kickoff: '2026-10-11T10:00:00Z', marketKey: '1', label: '1 · Vittoria casa', oddTaken: 2.2, stake: 10, placedAt: '2026-10-11T08:00:00Z', ...extra });
const snap = (extra = {}) => ({ fixture: {}, closingOdds: { '1': 2 }, closingAt: '2026-10-11T09:30:00Z', result: null, ...extra });
const finished = (home, away) => ({ finished: true, void: false, goals: { home, away } });

test('numeri: virgola italiana, vuoti e testo', () => {
  assert.equal(toNumber('2,10'), 2.1);
  assert.equal(toNumber(' 15 '), 15);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('abc'), null);
});

test('impostazioni: predefinite, vuoti a null, valori fuori dominio rifiutati', () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_STAKING);
  assert.deepEqual(normalizeSettings({ bankroll: '500,50', kellyMultiplier: '0.5', maxStakePct: '0.05', dailyLossLimit: '', weeklyLossLimit: '100' }), { bankroll: 500.5, kellyMultiplier: 0.5, maxStakePct: 0.05, dailyLossLimit: null, weeklyLossLimit: 100 });
  assert.equal(normalizeSettings({ bankroll: '0' }).bankroll, null);
  assert.throws(() => normalizeSettings({ bankroll: '-5' }), { code: 'validation_error' });
  assert.throws(() => normalizeSettings({ kellyMultiplier: 0.3 }), { code: 'validation_error' });
  assert.throws(() => normalizeSettings({ maxStakePct: 0.5 }), { code: 'validation_error' });
});

test('giocata: aperta, vinta, persa, annullata; CLV solo con quota di chiusura', () => {
  const open = deriveBet(bet({ kickoff: '2026-10-11T18:00:00Z' }), snap(), NOW);
  assert.equal(open.status, 'open');
  assert.equal(open.profit, null);
  assert.equal(open.clvFinal, false, 'prima del calcio d inizio il CLV è provvisorio');
  const won = deriveBet(bet(), snap({ result: finished(2, 1) }), NOW);
  assert.equal(won.status, 'won');
  assert.equal(won.profit, 12);
  assert.ok(Math.abs(won.clv - 0.1) < 1e-9);
  assert.equal(won.clvFinal, true);
  assert.equal(deriveBet(bet(), snap({ result: finished(0, 1) }), NOW).profit, -10);
  const voided = deriveBet(bet(), snap({ result: { finished: false, void: true, goals: null } }), NOW);
  assert.deepEqual([voided.status, voided.profit], ['void', 0]);
  const noClose = deriveBet(bet(), snap({ closingOdds: null }), NOW);
  assert.deepEqual([noClose.closingOdd, noClose.clv], [null, null]);
  assert.equal(deriveBet(bet(), null, NOW).status, 'open', 'registro mancante: resta aperta, nessun crash');
});

test('riepilogo: profitto, ROI, percentuale vinte, CLV medio solo definitivo', () => {
  const derived = [
    deriveBet(bet({ id: 'a' }), snap({ result: finished(2, 1) }), NOW),
    deriveBet(bet({ id: 'b', marketKey: '2', label: '2' }), snap({ result: finished(2, 1), closingOdds: { '2': 2.2 } }), NOW),
    deriveBet(bet({ id: 'c', kickoff: '2026-10-11T18:00:00Z' }), snap(), NOW)
  ];
  const summary = summarize(derived);
  assert.deepEqual([summary.count, summary.open, summary.settled, summary.won, summary.lost], [3, 1, 2, 1, 1]);
  assert.equal(summary.staked, 20);
  assert.equal(summary.profit, 2);
  assert.ok(Math.abs(summary.roi - 0.1) < 1e-9);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.clvCount, 2);
  assert.ok(Math.abs(summary.avgClv - 0.05) < 1e-9);
  assert.deepEqual(summarize([]), { count: 0, open: 0, settled: 0, won: 0, lost: 0, voided: 0, staked: 0, profit: 0, roi: null, winRate: null, avgClv: null, clvCount: 0 });
});

test('limiti di perdita: giorno nel fuso orario e ultimi 7 giorni, solo avviso', () => {
  const derived = [
    deriveBet(bet({ id: 'a', stake: 30 }), snap({ result: finished(0, 1) }), NOW),
    deriveBet(bet({ id: 'b', stake: 20, kickoff: '2026-10-08T10:00:00Z' }), snap({ result: finished(0, 1) }), NOW),
    deriveBet(bet({ id: 'c', stake: 50, kickoff: '2026-09-20T10:00:00Z' }), snap({ result: finished(0, 1) }), NOW)
  ];
  const losses = periodLosses(derived, NOW, 'Europe/Rome');
  assert.deepEqual(losses, { today: 30, week: 50 });
  const status = limitStatus(losses, normalizeSettings({ dailyLossLimit: 25, weeklyLossLimit: 100 }));
  assert.equal(status.daily.exceeded, true);
  assert.equal(status.weekly.exceeded, false);
  assert.equal(status.anyExceeded, true);
  assert.equal(limitStatus(losses, DEFAULT_STAKING).anyExceeded, false, 'senza limiti nessun avviso');
});

test('diario: aggiunta, eliminazione, impostazioni ed eventi corrotti ignorati', () => {
  const storage = new MemoryLedgerStorage();
  storage.events = [{ type: 'sconosciuto' }, { type: 'delete', id: 'mai-esistita' }, null];
  let next = 0;
  const journal = new BetJournal({ storage, idFactory: () => `id${(next += 1)}` });
  assert.equal(journal.loadErrors, 2);
  const added = journal.add({ fixtureId: 'f1', match: 'A - B', competition: 'L', kickoff: '2026-10-12T18:00:00Z', marketKey: '1', label: '1', oddTaken: '2,10', stake: '5', placedAt: '2026-10-11T12:00:00Z' });
  assert.equal(added.id, 'id1');
  assert.equal(added.oddTaken, 2.1);
  assert.equal(added.stake, 5);
  assert.throws(() => journal.add({ ...added, oddTaken: '1' }), { code: 'validation_error' });
  assert.throws(() => journal.add({ ...added, stake: '0' }), { code: 'validation_error' });
  journal.saveSettings({ bankroll: '200' });
  const reopened = new BetJournal({ storage });
  assert.equal(reopened.bets().length, 1);
  assert.equal(reopened.settings().bankroll, 200);
  assert.equal(reopened.remove('id1'), true);
  assert.equal(reopened.remove('id1'), false);
  assert.equal(new BetJournal({ storage }).bets().length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/betJournal.test.js`
Expected: FAIL — `Cannot find module '../src/tracking/betJournal.js'`

- [ ] **Step 3: Implement** — `src/tracking/betJournal.js`

```js
// Diario delle giocate dell'utente: eventi append-only (giocata, eliminazione, impostazioni) su storage iniettato.
// Quota di chiusura e risultato non vengono copiati: si ricavano a ogni lettura dal registro previsioni.
import { round } from '../utils.js';
import { settleMarket } from './metrics.js';
import { MemoryLedgerStorage } from './predictionLedger.js';

const JOURNAL_SCHEMA_VERSION = 1;
const KELLY_MULTIPLIERS = [0.125, 0.25, 0.5];
const WEEK_MS = 7 * 86400000;

export const DEFAULT_STAKING = Object.freeze({ bankroll: null, kellyMultiplier: 0.25, maxStakePct: 0.02, dailyLossLimit: null, weeklyLossLimit: null });

function invalid(message) {
  return Object.assign(new Error(message), { code: 'validation_error' });
}

/** Numero da input utente: accetta la virgola decimale; vuoto o non numerico → null. */
export function toNumber(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function positiveOrNull(value, label) {
  const number = toNumber(value);
  if (number == null || number === 0) return null;
  if (number < 0) throw invalid(`${label} non può essere negativo.`);
  return round(number, 2);
}

export function normalizeSettings(input = {}) {
  const multiplier = toNumber(input.kellyMultiplier) ?? DEFAULT_STAKING.kellyMultiplier;
  if (!KELLY_MULTIPLIERS.includes(multiplier)) throw invalid('Frazione di Kelly ammessa: 1/8, 1/4 o 1/2.');
  const cap = toNumber(input.maxStakePct) ?? DEFAULT_STAKING.maxStakePct;
  if (!(cap > 0 && cap <= 0.1)) throw invalid('Il tetto per giocata deve essere tra lo 0,1% e il 10% del bankroll.');
  return {
    bankroll: positiveOrNull(input.bankroll, 'Il bankroll'),
    kellyMultiplier: multiplier,
    maxStakePct: round(cap, 4),
    dailyLossLimit: positiveOrNull(input.dailyLossLimit, 'Il limite giornaliero'),
    weeklyLossLimit: positiveOrNull(input.weeklyLossLimit, 'Il limite settimanale')
  };
}

function normalizeBet(input, id) {
  const oddTaken = toNumber(input.oddTaken);
  const stake = toNumber(input.stake);
  if (!(oddTaken > 1 && oddTaken <= 1000)) throw invalid('La quota deve essere maggiore di 1.');
  if (!(stake > 0 && stake <= 100000)) throw invalid('La puntata deve essere maggiore di zero.');
  if (!input.fixtureId || !input.marketKey) throw invalid('Partita e mercato sono obbligatori.');
  return {
    id,
    fixtureId: String(input.fixtureId),
    match: String(input.match || ''),
    competition: String(input.competition || ''),
    kickoff: String(input.kickoff || ''),
    marketKey: String(input.marketKey),
    label: String(input.label || input.marketKey),
    oddTaken: round(oddTaken, 3),
    stake: round(stake, 2),
    placedAt: String(input.placedAt || new Date().toISOString())
  };
}

/** Stato attuale di una giocata a partire dalla fotografia del registro (può mancare). */
export function deriveBet(bet, snapshot, now = Date.now()) {
  const closingOdd = Number(snapshot?.closingOdds?.[bet.marketKey]) > 1 ? Number(snapshot.closingOdds[bet.marketKey]) : null;
  const clv = closingOdd ? bet.oddTaken / closingOdd - 1 : null;
  const result = snapshot?.result || null;
  let status = 'open';
  if (result?.void) status = 'void';
  else if (result?.finished) {
    const hit = settleMarket(bet.marketKey, result.goals);
    if (hit != null) status = hit ? 'won' : 'lost';
  }
  const profit = status === 'won' ? round(bet.stake * (bet.oddTaken - 1), 2) : status === 'lost' ? -bet.stake : status === 'void' ? 0 : null;
  return {
    ...bet,
    status,
    goals: result?.goals || null,
    closingOdd,
    clv: clv == null ? null : round(clv, 6),
    clvFinal: clv != null && Date.parse(bet.kickoff) <= now,
    profit
  };
}

export function summarize(derived) {
  const settled = derived.filter((bet) => bet.status === 'won' || bet.status === 'lost');
  const won = settled.filter((bet) => bet.status === 'won').length;
  const staked = round(settled.reduce((sum, bet) => sum + bet.stake, 0), 2);
  const profit = round(settled.reduce((sum, bet) => sum + bet.profit, 0), 2);
  const clvs = derived.filter((bet) => bet.clvFinal).map((bet) => bet.clv);
  return {
    count: derived.length,
    open: derived.filter((bet) => bet.status === 'open').length,
    settled: settled.length,
    won,
    lost: settled.length - won,
    voided: derived.filter((bet) => bet.status === 'void').length,
    staked,
    profit,
    roi: staked > 0 ? round(profit / staked, 6) : null,
    winRate: settled.length ? round(won / settled.length, 6) : null,
    avgClv: clvs.length ? round(clvs.reduce((sum, value) => sum + value, 0) / clvs.length, 6) : null,
    clvCount: clvs.length
  };
}

/** Perdite nette (≥ 0) delle giocate concluse: oggi nel fuso dell'app e negli ultimi 7 giorni, per data della partita. */
export function periodLosses(derived, now = Date.now(), timeZone = 'Europe/Rome') {
  const day = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(value));
  const today = day(now);
  let todayNet = 0;
  let weekNet = 0;
  for (const bet of derived) {
    if (bet.profit == null) continue;
    const kickoff = Date.parse(bet.kickoff);
    if (!Number.isFinite(kickoff) || kickoff > now) continue;
    if (day(kickoff) === today) todayNet += bet.profit;
    if (now - kickoff <= WEEK_MS) weekNet += bet.profit;
  }
  return { today: round(Math.max(0, -todayNet), 2), week: round(Math.max(0, -weekNet), 2) };
}

/** Confronto con i limiti dell'utente: produce solo un avviso, mai un blocco. */
export function limitStatus(losses, settings) {
  const check = (limit, loss) => ({ limit, loss, exceeded: limit != null && loss >= limit });
  const daily = check(settings.dailyLossLimit, losses.today);
  const weekly = check(settings.weeklyLossLimit, losses.week);
  return { daily, weekly, anyExceeded: daily.exceeded || weekly.exceeded };
}

function defaultId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try { return globalThis.crypto.randomUUID(); } catch { /* contesto non sicuro (file locale) */ }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class BetJournal {
  #bets = new Map();
  #settings = { ...DEFAULT_STAKING };

  constructor({ storage = new MemoryLedgerStorage(), idFactory = defaultId } = {}) {
    this.storage = storage;
    this.idFactory = idFactory;
    this.loadErrors = 0;
    for (const event of storage.load()) {
      try {
        if (event?.type === 'bet' && event.bet?.id) this.#bets.set(event.bet.id, event.bet);
        else if (event?.type === 'delete' && event.id) this.#bets.delete(event.id);
        else if (event?.type === 'settings' && event.settings) this.#settings = normalizeSettings(event.settings);
        else this.loadErrors += 1;
      } catch {
        this.loadErrors += 1;
      }
    }
  }

  #append(event) {
    this.storage.append({ schemaVersion: JOURNAL_SCHEMA_VERSION, at: new Date().toISOString(), ...event });
  }

  settings() {
    return { ...this.#settings };
  }

  saveSettings(input) {
    this.#settings = normalizeSettings(input);
    this.#append({ type: 'settings', settings: this.#settings });
    return this.settings();
  }

  add(input) {
    const bet = normalizeBet(input, this.idFactory());
    this.#bets.set(bet.id, bet);
    this.#append({ type: 'bet', bet });
    return { ...bet };
  }

  remove(id) {
    if (!this.#bets.has(id)) return false;
    this.#bets.delete(id);
    this.#append({ type: 'delete', id });
    return true;
  }

  bets() {
    return [...this.#bets.values()].sort((left, right) => right.placedAt.localeCompare(left.placedAt)).map((bet) => ({ ...bet }));
  }
}
```

Nota: nel test "eventi corrotti" il `delete` di un id mai esistito è valido (non è un errore di formato): `loadErrors` conta `{type:'sconosciuto'}` e `null` → 2.

- [ ] **Step 4: Run tests** — `node --test test/betJournal.test.js && npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/tracking/betJournal.js test/betJournal.test.js
git commit -m "Diario delle giocate: regolazione dal registro, CLV, riepilogo e limiti di perdita"
```

---

### Task 4: API del diario e collegamento in tutte le varianti

**Files:**
- Modify: `src/api.js` (parametro `journal`, 5 endpoint, `APP_VERSION = '1.11.0'`)
- Modify: `src/configCore.js` (`betJournal.path`, env `BET_JOURNAL_PATH`, predefinito `data/bet-journal.jsonl`)
- Modify: `src/server.js`, `src/browser/mobileEntry.js`, `src/browser/liveEntry.js`, `src/browser/entry.js`
- Modify: `package.json` (`"version": "1.11.0"`), `.env.example` (riga `BET_JOURNAL_PATH=data/bet-journal.jsonl`)
- Test: `test/journalApi.test.js`

**Interfaces:**
- Consumes: `BetJournal`, `deriveBet`, `summarize`, `periodLosses`, `limitStatus` (Task 3); `recommendedStake` (Task 1); `ledger.fixtureSnapshot` (Task 2); `LABELS` da `recommendation.js`.
- Produces (tutte le risposte includono `requestId`):
  - `GET /api/journal` → `{ enabled, storage, settings, bets: DerivedBet[], summary, losses, limits }` (prima chiama `settleDueResults()`); senza diario `{ enabled: false, bets: [] }`.
  - `POST /api/journal` body `{ fixtureId, marketKey, oddTaken, stake }` → `{ bet }`; errori `validation_error`: partita non analizzata ("Analizza la partita prima di aggiungerla al diario."), partita iniziata ("La partita è già iniziata: si registrano solo giocate pre-partita."), mercato sconosciuto.
  - `POST /api/journal/delete` body `{ id }` → `{ deleted: boolean }`
  - `POST /api/journal/settings` body = impostazioni → `{ settings }`
  - `POST /api/journal/suggest` body `{ probability, odd }` → `{ kellyFraction, fraction, stake, hasStake, settings }`
  - Per tutti i POST senza diario: `{ status: 409, payload: { error: 'Diario delle giocate non disponibile.' } }`.

- [ ] **Step 1: Write the failing test** — `test/journalApi.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { APP_VERSION, createApi } from '../src/api.js';
import { TTLCache } from '../src/cache.js';
import { buildConfig } from '../src/configCore.js';
import { DemoProvider } from '../src/providers/demo.js';
import { BetJournal } from '../src/tracking/betJournal.js';
import { PredictionLedger } from '../src/tracking/predictionLedger.js';

function setup({ journal = new BetJournal() } = {}) {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const api = createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500), ledger: new PredictionLedger(), journal });
  const call = (method, pathname, body) => api.handle({ method, pathname, readBody: async () => body, requestId: 't' });
  return { api, call };
}

test('versione 1.11.0', () => assert.equal(APP_VERSION, '1.11.0'));

test('diario via API: aggiungi dopo l analisi, leggi, elimina', async () => {
  const { call } = setup();
  await assert.rejects(call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: '1', oddTaken: 2, stake: 5 }), { code: 'validation_error', message: /Analizza la partita/ });
  const analysis = (await call('POST', '/api/analyze', { fixtureId: 'demo-france-spain', useAi: false })).payload;
  const quoted = analysis.markets.find((market) => market.odd > 1);
  assert.equal(typeof quoted.kellyFraction, 'number');
  const added = await call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: quoted.key, oddTaken: '2,05', stake: '10' });
  assert.equal(added.status, 200);
  assert.equal(added.payload.bet.match, `${analysis.fixture.home.name} - ${analysis.fixture.away.name}`);
  assert.equal(added.payload.bet.label, quoted.label);
  assert.equal(added.payload.bet.oddTaken, 2.05);
  const listed = (await call('GET', '/api/journal')).payload;
  assert.equal(listed.enabled, true);
  assert.equal(listed.bets.length, 1);
  assert.equal(listed.bets[0].status, 'open');
  assert.equal(listed.bets[0].closingOdd, quoted.odd);
  assert.equal(listed.summary.count, 1);
  assert.equal(listed.limits.anyExceeded, false);
  await assert.rejects(call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: 'NON_ESISTE', oddTaken: 2, stake: 5 }), { code: 'validation_error' });
  assert.deepEqual((await call('POST', '/api/journal/delete', { id: listed.bets[0].id })).payload.deleted, true);
  assert.equal((await call('GET', '/api/journal')).payload.bets.length, 0);
});

test('diario via API: impostazioni e puntata suggerita', async () => {
  const { call } = setup();
  const saved = await call('POST', '/api/journal/settings', { bankroll: '500', kellyMultiplier: 0.25, maxStakePct: 0.02, dailyLossLimit: '', weeklyLossLimit: '50' });
  assert.equal(saved.payload.settings.bankroll, 500);
  const suggestion = (await call('POST', '/api/journal/suggest', { probability: 0.6, odd: '2' })).payload;
  assert.deepEqual([suggestion.kellyFraction, suggestion.fraction, suggestion.stake, suggestion.hasStake], [0.2, 0.02, 10, true]);
  await assert.rejects(call('POST', '/api/journal/settings', { kellyMultiplier: 3 }), { code: 'validation_error' });
});

test('diario via API: partita già iniziata rifiutata', async () => {
  const journal = new BetJournal();
  const { api, call } = setup({ journal });
  const analysis = await api.analyzeFixture('demo-france-spain', false, { useAi: false });
  const realNow = Date.now;
  Date.now = () => Date.parse(analysis.fixture.kickoff) + 60000;
  try {
    await assert.rejects(call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: '1', oddTaken: 2, stake: 5 }), { message: /già iniziata/ });
  } finally {
    Date.now = realNow;
  }
});

test('senza diario: lettura vuota, scritture 409', async () => {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const api = createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500) });
  const read = await api.handle({ method: 'GET', pathname: '/api/journal', requestId: 't' });
  assert.deepEqual([read.payload.enabled, read.payload.bets], [false, []]);
  const write = await api.handle({ method: 'POST', pathname: '/api/journal/settings', readBody: async () => ({}), requestId: 't' });
  assert.equal(write.status, 409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/journalApi.test.js`
Expected: FAIL — versione `1.10.0` e `/api/journal` → 404.

- [ ] **Step 3: Implement in `src/api.js`**

Import in testa:

```js
import { LABELS } from './prediction/recommendation.js';
import { recommendedStake } from './prediction/staking.js';
import { deriveBet, limitStatus, periodLosses, summarize, toNumber } from './tracking/betJournal.js';
```

`export const APP_VERSION = '1.11.0';` e firma `export function createApi({ config, provider, aiOrchestrator, analysisCache, ledger = null, journal = null })`.

Dentro `createApi`, prima di `function meta(`:

```js
  async function journalReport(requestId) {
    if (!journal) return { enabled: false, bets: [], requestId };
    await settleDueResults();
    const now = Date.now();
    const settings = journal.settings();
    const bets = journal.bets().map((bet) => deriveBet(bet, ledger?.fixtureSnapshot(bet.fixtureId) || null, now));
    const losses = periodLosses(bets, now, config.timezone);
    return { enabled: true, storage: journal.storage.kind || 'custom', settings, bets, summary: summarize(bets), losses, limits: limitStatus(losses, settings), requestId };
  }

  function addJournalBet(body) {
    const fixtureId = validateFixtureId(body.fixtureId);
    const marketKey = String(body.marketKey || '');
    if (!LABELS[marketKey]) throw failValidation('Mercato non riconosciuto.');
    const snapshot = ledger?.fixtureSnapshot(fixtureId);
    if (!snapshot) throw failValidation('Analizza la partita prima di aggiungerla al diario.');
    if (Date.parse(snapshot.fixture.kickoff) <= Date.now()) throw failValidation('La partita è già iniziata: si registrano solo giocate pre-partita.');
    return journal.add({
      fixtureId,
      match: `${snapshot.fixture.home.name} - ${snapshot.fixture.away.name}`,
      competition: snapshot.fixture.league?.name || '',
      kickoff: snapshot.fixture.kickoff,
      marketKey,
      label: LABELS[marketKey],
      oddTaken: body.oddTaken,
      stake: body.stake,
      placedAt: new Date(Date.now()).toISOString()
    });
  }
```

In `handle`, prima del blocco `if (pathname.startsWith('/api/'))`:

```js
    if (method === 'GET' && pathname === '/api/journal') {
      return { status: 200, payload: await journalReport(requestId) };
    }
    if (method === 'POST' && pathname.startsWith('/api/journal')) {
      if (!journal) return { status: 409, payload: { error: 'Diario delle giocate non disponibile.', requestId } };
      const body = await readBody();
      if (pathname === '/api/journal') return { status: 200, payload: { bet: addJournalBet(body), requestId } };
      if (pathname === '/api/journal/delete') return { status: 200, payload: { deleted: journal.remove(String(body.id || '')), requestId } };
      if (pathname === '/api/journal/settings') return { status: 200, payload: { settings: journal.saveSettings(body), requestId } };
      if (pathname === '/api/journal/suggest') {
        const settings = journal.settings();
        return { status: 200, payload: { ...recommendedStake({ probability: toNumber(body.probability), odd: toNumber(body.odd), settings }), settings, requestId } };
      }
    }
```

Nota: `Date.parse(...) <= Date.now()` usa `Date.now()` (non `new Date()`) così il test può fissare l'orologio.

`src/configCore.js`, accanto a `predictionLedger`:

```js
    betJournal: Object.freeze({
      path: text('BET_JOURNAL_PATH', 'data/bet-journal.jsonl')
    }),
```

`src/server.js` (dopo la creazione di `ledger`):

```js
import { BetJournal } from './tracking/betJournal.js';
```

```js
const journal = new BetJournal({
  storage: config.demoMode ? new MemoryLedgerStorage() : new JsonlLedgerStorage(path.resolve(root, config.betJournal.path))
});
const api = createApi({ config, provider, aiOrchestrator, analysisCache, ledger, journal });
```

`src/browser/mobileEntry.js`, dentro `ready`:

```js
import { BetJournal } from '../tracking/betJournal.js';
```

```js
  const journalStorage = await openIdbLedgerStorage({ name: 'football-engine-journal' });
  const journal = new BetJournal({ storage: journalStorage });
```

e passa `journal` a `createApi({ ..., ledger, journal })`.

`src/browser/liveEntry.js` e `src/browser/entry.js`: `import { BetJournal } from '../tracking/betJournal.js';` e `createApi({ ..., ledger, journal: new BetJournal() })` (memoria).

`package.json`: `"version": "1.11.0"`. `.env.example`: sotto `PREDICTION_LEDGER_PATH` aggiungi `BET_JOURNAL_PATH=data/bet-journal.jsonl` (il file resta escluso da git grazie a `data/*` in `.gitignore`).

- [ ] **Step 4: Run tests** — `npm test` → PASS (aggiorna eventuali test che verificano `1.10.0`: `grep -rn "1\.10\.0" test` e porta a `1.11.0`).
- [ ] **Step 5: Commit**

```bash
git add src/api.js src/configCore.js src/server.js src/browser/*.js package.json .env.example test/journalApi.test.js test
git commit -m "API del diario: giocate, impostazioni, puntata suggerita; v1.11.0"
```

---

### Task 5: Interfaccia — puntata e "Aggiungi al diario" sulla scheda Indicazione

**Files:**
- Modify: `public/app.js` (`renderAnalysis`, nuove funzioni `renderStakeLine`, `wireJournalForm`, `loadJournal`, avviso limiti)
- Modify: `public/index.html` (div `#journalLimitNotice` subito dopo `#demoNotice`)
- Modify: `public/styles.css` (classi `.journal-form`, `.stake-line`)
- Test: `test/pwa.test.js` (presenze nella build)

**Interfaces:**
- Consumes: `POST /api/journal/suggest`, `POST /api/journal`, `GET /api/journal` (Task 4); `analysis.markets[].kellyFraction`.
- Produces: `state.journal` (ultima risposta di `GET /api/journal`); `loadJournal(): Promise<void>` aggiorna `state.journal` e l'avviso limiti; `renderJournalLimitNotice()`.

- [ ] **Step 1: Write the failing test** — in `test/pwa.test.js`, nel test che legge la build PWA (stesso stile delle verifiche esistenti su `index.html`/`app.js` della build), aggiungi:

```js
  assert.match(html, /id="journalLimitNotice"/);
  assert.match(everything, /Aggiungi al diario/);
  assert.match(everything, /\/api\/journal\/suggest/);
```

(`html` è `dist/pwa/index.html` e `everything` è l’unione di tutti i file .js/.html/.json della build, già definiti nel test della build PWA.)

- [ ] **Step 2: Run** `node --test test/pwa.test.js` → FAIL (stringhe assenti).

- [ ] **Step 3: Implement**

`public/index.html`, dopo il blocco `#demoNotice`:

```html
    <div id="journalLimitNotice" class="notice limit-notice hidden" role="alert"></div>
```

`public/app.js`:
- aggiungi `journal: null` a `state` e `'journalLimitNotice', 'journalResult', 'journalExport'` all'elenco di `elements` (`journalResult` e `journalExport` arrivano nel Task 6; `document.getElementById` restituisce `null` finché non esistono, quindi usa sempre `?.`).
- funzioni nuove (dopo `weatherText`):

```js
const stakeText = (suggestion) => {
  if (!suggestion || suggestion.kellyFraction == null) return '—';
  if (!suggestion.hasStake) return 'Nessuna puntata consigliata';
  return suggestion.stake == null ? `${percent(suggestion.fraction)} del bankroll` : currency(suggestion.stake);
};

async function suggestStake(probability, odd) {
  try {
    return await postJson('/api/journal/suggest', { probability, odd });
  } catch {
    return null;
  }
}

function renderJournalLimitNotice() {
  const limits = state.journal?.limits;
  const node = elements.journalLimitNotice;
  if (!node) return;
  if (!limits?.anyExceeded) { node.classList.add('hidden'); return; }
  const parts = [];
  if (limits.daily.exceeded) parts.push(`oggi hai perso ${currency(limits.daily.loss)} (limite ${currency(limits.daily.limit)})`);
  if (limits.weekly.exceeded) parts.push(`negli ultimi 7 giorni hai perso ${currency(limits.weekly.loss)} (limite ${currency(limits.weekly.limit)})`);
  node.innerHTML = `<strong>Limite di perdita superato:</strong> ${escapeHtml(parts.join('; '))}. Valuta una pausa: la decisione resta tua.`;
  node.classList.remove('hidden');
}

async function loadJournal() {
  try {
    state.journal = await request('/api/journal', { timeout: 60000 });
  } catch {
    state.journal = null;
  }
  renderJournalLimitNotice();
  if (typeof renderJournal === 'function' && !elements.performanceView.hidden) renderJournal();
}
```

Aggiungi anche, subito dopo `request()` (riga ~95), l’aiuto per i POST JSON (stesso stile delle chiamate esistenti a riga ~293):

```js
const postJson = (url, body, options = {}) => request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...options });
```

- nella `pick-card` di `renderAnalysis`, dopo `<p class="pick-note">…</p>` aggiungi:

```js
      <p class="stake-line" data-stake-line>Puntata consigliata: <b>…</b></p>
      ${analysis.markets.some((market) => market.odd > 1) && Date.parse(fixture.kickoff) > Date.now() ? `<details class="journal-form-wrap">
        <summary class="secondary-button">Aggiungi al diario</summary>
        <form class="journal-form" data-journal-form>
          <label>Mercato<select name="marketKey">${analysis.markets.filter((market) => market.odd > 1).map((market) => `<option value="${escapeHtml(market.key)}" data-probability="${market.probability}" data-odd="${market.odd}" ${market.key === recommendation.key ? 'selected' : ''}>${escapeHtml(market.label)} · ${decimal(market.odd)}</option>`).join('')}</select></label>
          <label>Quota presa<input name="oddTaken" inputmode="decimal" autocomplete="off" required></label>
          <label>Puntata (€)<input name="stake" inputmode="decimal" autocomplete="off" required></label>
          <button class="primary-button" type="submit">Salva giocata</button>
          <p class="muted small" data-journal-status role="status"></p>
        </form>
      </details>` : ''}
```

- in fondo a `renderAnalysis` (dopo il cablaggio esistente) chiama `wireStakeAndJournal(analysis)`:

```js
function wireStakeAndJournal(analysis) {
  const recommendation = analysis.summary.recommendation;
  const selected = analysis.markets.find((market) => market.key === recommendation.key);
  const line = elements.analysisResult.querySelector('[data-stake-line] b');
  if (line) {
    if (!(selected?.odd > 1)) line.textContent = '—';
    else suggestStake(selected.probability, selected.odd).then((suggestion) => { line.textContent = stakeText(suggestion); });
  }
  const form = elements.analysisResult.querySelector('[data-journal-form]');
  if (!form) return;
  const status = form.querySelector('[data-journal-status]');
  let stakeEdited = false;
  const fill = async ({ keepOdd = false } = {}) => {
    const option = form.marketKey.selectedOptions[0];
    if (!keepOdd) form.oddTaken.value = decimal(option.dataset.odd);
    const suggestion = await suggestStake(Number(option.dataset.probability), form.oddTaken.value);
    if (!stakeEdited) form.stake.value = suggestion?.stake ? decimal(suggestion.stake) : '';
    status.textContent = `Suggerimento: ${stakeText(suggestion)}`;
  };
  form.marketKey.addEventListener('change', () => fill());
  form.oddTaken.addEventListener('change', () => fill({ keepOdd: true }));
  form.stake.addEventListener('input', () => { stakeEdited = true; });
  fill();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await postJson('/api/journal', { fixtureId: analysis.fixture.id, marketKey: form.marketKey.value, oddTaken: form.oddTaken.value, stake: form.stake.value });
      status.textContent = 'Giocata salvata nel diario (Storico › Le mie giocate).';
      elements.appStatus.textContent = status.textContent;
      loadJournal();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
```


- in `boot()`, dopo il caricamento di meta e partite: `loadJournal();` (non bloccante).

`public/styles.css` (in fondo, prima delle media query di stampa se presenti):

```css
.stake-line { color: var(--muted); font-size: 13px; }
.stake-line b { color: var(--text); font-family: var(--font-data); }
.journal-form-wrap > summary { list-style: none; width: 100%; }
.journal-form-wrap > summary::-webkit-details-marker { display: none; }
.journal-form { display: grid; gap: 10px; margin-top: 10px; }
.journal-form label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; font-weight: 600; }
.journal-form input { width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); font-size: 16px; }
.limit-notice { border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
```

- [ ] **Step 4: Build e test**

Run: `npm run build:pwa && npm test` → PASS

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/index.html public/styles.css test/pwa.test.js
git commit -m "Scheda Indicazione: puntata Kelly e Aggiungi al diario; avviso limiti"
```

---

### Task 6: Interfaccia — "Le mie giocate" nello Storico

**Files:**
- Modify: `public/index.html` (in `#performanceView`, dopo `.performance-actions`: `<div id="journalResult" class="journal-result"></div>`)
- Modify: `public/app.js` (`renderJournal`, `exportJournalCsv`, form "Bankroll e limiti", elimina giocata; `loadPerformance` chiama anche `loadJournal`)
- Modify: `public/styles.css`
- Test: `test/pwa.test.js`

**Interfaces:**
- Consumes: `state.journal`, `loadJournal`, `section()`, `csvCell()`, `downloadFile()`, `POST /api/journal/delete`, `POST /api/journal/settings`.

- [ ] **Step 1: Failing test** — in `test/pwa.test.js` aggiungi:

```js
  assert.match(html, /id="journalResult"/);
  assert.match(everything, /Le mie giocate/);
  assert.match(everything, /Esporta diario CSV/);
```

Run `node --test test/pwa.test.js` → FAIL.

- [ ] **Step 2: Implement** — `public/app.js`, dopo `exportPerformanceCsv`:

```js
const BET_STATUS = { open: 'In corso', won: 'Vinta', lost: 'Persa', void: 'Annullata' };

function betRow(bet) {
  const clv = bet.clv == null ? '—' : `${signedPercent(bet.clv)}${bet.clvFinal ? '' : ' (provvisorio)'}`;
  const profit = bet.profit == null ? '—' : `${bet.profit >= 0 ? '+' : ''}${currency(bet.profit)}`;
  return `<div class="record-row bet-row">
    <div><strong>${escapeHtml(bet.match)}</strong><small>${escapeHtml(bet.label)} · quota ${decimal(bet.oddTaken)} · ${currency(bet.stake)} · ${escapeHtml(formatDateTime(bet.kickoff, { dateStyle: 'short' }))}</small><small>Chiusura ${bet.closingOdd ? decimal(bet.closingOdd) : '—'} · CLV ${escapeHtml(clv)}</small></div>
    <div class="record-side"><span class="${bet.status === 'won' ? 'signal-positive' : bet.status === 'lost' ? 'signal-negative' : 'signal-muted'}">${BET_STATUS[bet.status]}${bet.goals ? ` ${bet.goals.home}-${bet.goals.away}` : ''}</span><b>${escapeHtml(profit)}</b><button class="link-button" type="button" data-delete-bet="${escapeHtml(bet.id)}" aria-label="Elimina la giocata ${escapeHtml(bet.match)}">Elimina</button></div>
  </div>`;
}

function renderJournal() {
  const node = elements.journalResult;
  const payload = state.journal;
  if (!node) return;
  if (!payload?.enabled) { node.innerHTML = ''; return; }
  const { summary, settings, bets } = payload;
  const fractionOptions = [[0.125, '1/8'], [0.25, '1/4'], [0.5, '1/2']].map(([value, label]) => `<option value="${value}" ${settings.kellyMultiplier === value ? 'selected' : ''}>${label}</option>`).join('');
  const num = (value) => (value == null ? '' : String(value).replace('.', ','));
  node.innerHTML = section('Le mie giocate', 'Profitto, ROI e CLV delle giocate registrate', `
    ${payload.storage === 'memory' ? '<div class="notice" role="note">Il diario resta solo per questa sessione: l’archiviazione del browser non è disponibile qui.</div>' : ''}
    <div class="metric-grid">
      <article class="metric-card"><span>Giocate</span><strong>${summary.count}</strong></article>
      <article class="metric-card"><span>Profitto</span><strong class="${summary.profit > 0 ? 'signal-positive' : summary.profit < 0 ? 'signal-negative' : ''}">${currency(summary.profit)}</strong></article>
      <article class="metric-card"><span>ROI</span><strong>${summary.roi == null ? '—' : signedPercent(summary.roi)}</strong></article>
      <article class="metric-card"><span>CLV medio</span><strong>${summary.avgClv == null ? '—' : signedPercent(summary.avgClv)}</strong></article>
      <article class="metric-card"><span>Vinte</span><strong>${summary.winRate == null ? '—' : percent(summary.winRate, 0)}</strong></article>
      <article class="metric-card"><span>In corso</span><strong>${summary.open}</strong></article>
    </div>
    <div class="record-list">${bets.map(betRow).join('') || '<p class="muted">Nessuna giocata: apri una partita e tocca “Aggiungi al diario”.</p>'}</div>
    <details class="nested"><summary>Bankroll e limiti</summary>
      <form class="journal-form" data-journal-settings>
        <label>Bankroll (€, vuoto = puntate in %)<input name="bankroll" inputmode="decimal" value="${num(settings.bankroll)}"></label>
        <label>Frazione di Kelly<select name="kellyMultiplier">${fractionOptions}</select></label>
        <label>Tetto per giocata (% del bankroll)<input name="maxStakePct" inputmode="decimal" value="${num(Math.round(settings.maxStakePct * 1000) / 10)}"></label>
        <label>Limite di perdita giornaliero (€)<input name="dailyLossLimit" inputmode="decimal" value="${num(settings.dailyLossLimit)}"></label>
        <label>Limite di perdita settimanale (€)<input name="weeklyLossLimit" inputmode="decimal" value="${num(settings.weeklyLossLimit)}"></label>
        <button class="primary-button" type="submit">Salva</button>
        <p class="muted small" data-settings-status role="status">Al superamento di un limite compare un avviso: nessun blocco, decidi tu.</p>
      </form>
    </details>
    <button id="journalExport" class="secondary-button" type="button" ${bets.length ? '' : 'disabled'}>Esporta diario CSV</button>`, { open: true, badge: `${summary.count}` });
  node.querySelectorAll('[data-delete-bet]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Eliminare questa giocata dal diario?')) return;
    button.disabled = true;
    try {
      await postJson('/api/journal/delete', { id: button.dataset.deleteBet });
      await loadJournal();
    } catch (error) {
      elements.appStatus.textContent = error.message;
      button.disabled = false;
    }
  }));
  const form = node.querySelector('[data-journal-settings]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statusNode = form.querySelector('[data-settings-status]');
    const pct = String(form.maxStakePct.value).trim().replace(',', '.');
    try {
      await postJson('/api/journal/settings', {
        bankroll: form.bankroll.value, kellyMultiplier: Number(form.kellyMultiplier.value),
        maxStakePct: pct ? Number(pct) / 100 : '', dailyLossLimit: form.dailyLossLimit.value, weeklyLossLimit: form.weeklyLossLimit.value
      });
      statusNode.textContent = 'Salvato.';
      await loadJournal();
    } catch (error) {
      statusNode.textContent = error.message;
    }
  });
  node.querySelector('#journalExport')?.addEventListener('click', exportJournalCsv);
}

async function exportJournalCsv() {
  const bets = state.journal?.bets || [];
  if (!bets.length) return;
  const headers = ['placedAt', 'kickoff', 'competition', 'match', 'market', 'oddTaken', 'stake', 'closingOdd', 'clv', 'clvFinal', 'status', 'goals', 'profit'];
  const rows = bets.map((bet) => [bet.placedAt, bet.kickoff, bet.competition, bet.match, bet.label, bet.oddTaken, bet.stake, bet.closingOdd, bet.clv, bet.clvFinal, BET_STATUS[bet.status], bet.goals ? `${bet.goals.home}-${bet.goals.away}` : '', bet.profit]);
  const csv = [headers.join(';'), ...rows.map((row) => row.map(csvCell).join(';'))].join('\r\n');
  try {
    await downloadFile(`diario-giocate-${dateKey(new Date())}.csv`, `﻿${csv}`, 'text/csv');
  } catch (error) {
    elements.appStatus.textContent = error.message;
  }
}
```

- in `loadPerformance()`, accanto a `state.performance = await request(...)`, avvia anche `loadJournal()` (in parallelo: `await Promise.all([..., loadJournal()])` oppure chiamalo subito dopo), e chiama `renderJournal()` nel ramo di successo.
- Se `.link-button` non esiste in `styles.css`, aggiungi:

```css
.link-button { min-height: 44px; padding: 0 4px; border: 0; color: var(--bad); background: transparent; font-size: 12.5px; font-weight: 600; }
.journal-result { display: grid; gap: 12px; margin-bottom: 12px; }
.bet-row small { display: block; }
.bet-row .record-side b { font-family: var(--font-data); }
```

- `public/index.html`: `<div id="journalResult" class="journal-result"></div>` subito dopo il `div.performance-actions`.

- [ ] **Step 3: Build e test** — `npm run build:pwa && npm test` → PASS
- [ ] **Step 4: Commit**

```bash
git add public/app.js public/index.html public/styles.css test/pwa.test.js
git commit -m "Storico: Le mie giocate con riepilogo, bankroll e limiti, export diario"
```

---

### Task 7: Verifica nel browser, documentazione, revisione e pubblicazione

**Files:**
- Modify: `README.md` (sezione "Novità 1.11.0"), `AUDIT_PROGETTO.md` ("Rilievi 1.11.0"), `GUIDA_INSTALLAZIONE.md` (riga `BET_JOURNAL_PATH`), `CLAUDE_PROJECT_HANDOFF.md` (moduli `staking.js`, `betJournal.js`, endpoint `/api/journal*`)
- Copia delle `.md` e dei due HTML offline nella cartella principale; zip `enterprise-football-engine-v1.11.0.zip` e `documentazione-football-engine-v1.11.0.zip`; spostare gli zip 1.10.0 in `archivio/` (mai cancellarli).

- [ ] **Step 1: Prova nel browser** con il server in demo (`.claude/launch.json` già usato in Fase 1 oppure `DEMO_MODE=true node src/server.js`):
  - 390×844 e 1024 px, tema chiaro e scuro; nessuno scorrimento orizzontale (`document.documentElement.scrollWidth <= innerWidth`), nessun errore in console;
  - apri una partita → riga "Puntata consigliata" valorizzata (in % senza bankroll); "Aggiungi al diario" con quota "2,05" e puntata → messaggio di conferma;
  - Storico → "Le mie giocate" mostra la giocata con chiusura e CLV provvisorio; imposta bankroll 500 → la puntata torna in euro; imposta limite giornaliero e verifica che l'avviso compaia solo quando superato (simulabile con una giocata persa nella demo archiviata o fidandosi dei test unitari: dichiaralo nel resoconto);
  - elimina la giocata; esporta il diario CSV.
- [ ] **Step 2: Documentazione** e `npm run build` (demo, live snapshot, PWA) → `npm test` verde.
- [ ] **Step 3: Revisione finale** del ramo con un revisore indipendente (skill `superpowers:requesting-code-review`), correggi i rilievi importanti, `npm test`.
- [ ] **Step 4: Chiusura ramo** (`superpowers:finishing-a-development-branch`), push su GitHub con login temporaneo dell'utente, attesa del workflow Pages, verifica online (`sw.js` contiene `1.11.0`, `engine.js` online identico a `dist/pwa/engine.js`), ripubblicazione dell'Artifact `https://claude.ai/artifact/TEoB1n8Mkv8aDVSH4GHnEU` da `dist/artifact/football-engine-live.html`, logout e pulizia.
