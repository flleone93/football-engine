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

/** Campo facoltativo: vuoto → null; testo non numerico → errore (mai sostituito in silenzio). */
function parseField(value, label) {
  if (value == null || String(value).trim() === '') return null;
  const number = toNumber(value);
  if (number == null) throw invalid(`${label}: numero non valido.`);
  return number;
}

function positiveOrNull(value, label) {
  const number = parseField(value, label);
  if (number == null || number === 0) return null;
  if (number < 0) throw invalid(`${label} non può essere negativo.`);
  return round(number, 2);
}

export function normalizeSettings(input = {}) {
  const multiplier = parseField(input.kellyMultiplier, 'Frazione di Kelly') ?? DEFAULT_STAKING.kellyMultiplier;
  if (!KELLY_MULTIPLIERS.includes(multiplier)) throw invalid('Frazione di Kelly ammessa: 1/8, 1/4 o 1/2.');
  const cap = parseField(input.maxStakePct, 'Tetto per giocata') ?? DEFAULT_STAKING.maxStakePct;
  if (!(cap >= 0.001 && cap <= 0.1)) throw invalid('Il tetto per giocata deve essere tra lo 0,1% e il 10% del bankroll.');
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
  if (!Number.isFinite(Date.parse(input.kickoff))) throw invalid('Data della partita non valida.');
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
        // Ogni giocata riletta passa dalla stessa validazione dell'inserimento: una riga malformata viene scartata.
        if (event?.type === 'bet' && event.bet?.id) this.#bets.set(event.bet.id, normalizeBet(event.bet, event.bet.id));
        else if (event?.type === 'delete' && event.id) this.#bets.delete(event.id);
        else if (event?.type === 'settings' && event.settings) this.#settings = normalizeSettings(event.settings);
        else this.loadErrors += 1;
      } catch {
        this.loadErrors += 1;
      }
    }
  }

  /** Scrive prima su storage (anche asincrono) e solo dopo aggiorna la memoria: nessuna giocata fantasma. */
  async #append(event) {
    await this.storage.append({ schemaVersion: JOURNAL_SCHEMA_VERSION, at: new Date().toISOString(), ...event });
  }

  settings() {
    return { ...this.#settings };
  }

  async saveSettings(input) {
    const settings = normalizeSettings(input);
    await this.#append({ type: 'settings', settings });
    this.#settings = settings;
    return this.settings();
  }

  async add(input) {
    const bet = normalizeBet(input, this.idFactory());
    await this.#append({ type: 'bet', bet });
    this.#bets.set(bet.id, bet);
    return { ...bet };
  }

  async remove(id) {
    if (!this.#bets.has(id)) return false;
    await this.#append({ type: 'delete', id });
    this.#bets.delete(id);
    return true;
  }

  bets() {
    return [...this.#bets.values()].sort((left, right) => right.placedAt.localeCompare(left.placedAt)).map((bet) => ({ ...bet }));
  }
}
