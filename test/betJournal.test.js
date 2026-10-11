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

test('diario: aggiunta, eliminazione, impostazioni ed eventi corrotti ignorati', async () => {
  const storage = new MemoryLedgerStorage();
  storage.events = [{ type: 'sconosciuto' }, { type: 'delete', id: 'mai-esistita' }, null];
  let next = 0;
  const journal = new BetJournal({ storage, idFactory: () => `id${(next += 1)}` });
  assert.equal(journal.loadErrors, 2);
  const added = await journal.add({ fixtureId: 'f1', match: 'A - B', competition: 'L', kickoff: '2026-10-12T18:00:00Z', marketKey: '1', label: '1', oddTaken: '2,10', stake: '5', placedAt: '2026-10-11T12:00:00Z' });
  assert.equal(added.id, 'id1');
  assert.equal(added.oddTaken, 2.1);
  assert.equal(added.stake, 5);
  await assert.rejects(journal.add({ ...added, oddTaken: '1' }), { code: 'validation_error' });
  await assert.rejects(journal.add({ ...added, stake: '0' }), { code: 'validation_error' });
  await journal.saveSettings({ bankroll: '200' });
  const reopened = new BetJournal({ storage });
  assert.equal(reopened.bets().length, 1);
  assert.equal(reopened.settings().bankroll, 200);
  assert.equal(await reopened.remove('id1'), true);
  assert.equal(await reopened.remove('id1'), false);
  assert.equal(new BetJournal({ storage }).bets().length, 0);
});

test('diario: giocate salvate malformate vengono scartate senza bloccare il diario', () => {
  const storage = new MemoryLedgerStorage();
  storage.events = [
    { type: 'bet', bet: { id: 'x' } },
    { type: 'bet', bet: { id: 'y', fixtureId: 'f', marketKey: '1', oddTaken: 2, stake: 5, kickoff: 'non-una-data', placedAt: '2026-10-11T10:00:00Z' } },
    { type: 'bet', bet: { id: 'z', fixtureId: 'f', marketKey: '1', oddTaken: '2', stake: '5', kickoff: '2026-10-12T10:00:00Z', placedAt: '2026-10-11T10:00:00Z' } }
  ];
  const journal = new BetJournal({ storage });
  assert.equal(journal.loadErrors, 2);
  const bets = journal.bets();
  assert.deepEqual(bets.map((item) => item.id), ['z']);
  assert.equal(bets[0].stake, 5, 'numeri normalizzati anche in rilettura');
});

test('diario: se la scrittura fallisce la giocata non resta in memoria', async () => {
  const failing = { kind: 'test', load: () => [], append: async () => { throw new Error('disco pieno'); } };
  const journal = new BetJournal({ storage: failing, idFactory: () => 'id1' });
  const input = { fixtureId: 'f1', match: 'A - B', kickoff: '2026-10-12T18:00:00Z', marketKey: '1', label: '1', oddTaken: 2, stake: 5 };
  await assert.rejects(journal.add(input), /disco pieno/);
  assert.equal(journal.bets().length, 0);
  await assert.rejects(journal.saveSettings({ bankroll: 100 }), /disco pieno/);
  assert.equal(journal.settings().bankroll, null);
  const ok = new BetJournal({ storage: new MemoryLedgerStorage(), idFactory: () => 'id2' });
  await ok.add(input);
  ok.storage.append = () => { throw new Error('sola lettura'); };
  await assert.rejects(ok.remove('id2'), /sola lettura/);
  assert.equal(ok.bets().length, 1);
});

test('impostazioni: testo non numerico rifiutato, non sostituito in silenzio', () => {
  assert.throws(() => normalizeSettings({ maxStakePct: 'abc' }), { code: 'validation_error' });
  assert.throws(() => normalizeSettings({ bankroll: '1.234,56' }), { code: 'validation_error' });
  assert.throws(() => normalizeSettings({ maxStakePct: 0.0001 }), { code: 'validation_error' });
});
