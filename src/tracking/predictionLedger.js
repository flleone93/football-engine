// Registro append-only delle previsioni pre-partita e dei risultati finali.
// Event sourcing minimale: eventi `prediction` e `settlement`, rigiocati in memoria all'avvio.
// Nessuna dipendenza Node: la persistenza è delegata allo storage (file JSONL sul server, memoria nel browser).
import { round } from '../utils.js';
import { evaluatePredictions, outcomeFromGoals, settleMarket } from './metrics.js';

const PRE_MATCH_STATUSES = new Set(['NS', 'TBD']);
const VOID_STATUSES = new Set(['CANC', 'ABD', 'AWD', 'WO']);
const LEDGER_SCHEMA_VERSION = 1;

export class MemoryLedgerStorage {
  constructor() {
    this.kind = 'memory';
    this.events = [];
  }

  load() {
    return [...this.events];
  }

  append(event) {
    this.events.push(event);
  }
}

function roundedOutcomes(outcomes) {
  if (!outcomes) return null;
  return { home: round(Number(outcomes.home) || 0, 6), draw: round(Number(outcomes.draw) || 0, 6), away: round(Number(outcomes.away) || 0, 6) };
}

function marketOutcomes(analysis) {
  const market = (analysis.agents || []).find((agent) => agent.id === 'market' && agent.probabilities);
  return market ? roundedOutcomes(market.probabilities) : null;
}

export function normalizeResult(result, settledAt = new Date().toISOString()) {
  if (!result) return null;
  const status = String(result.status || '').toUpperCase();
  const isVoid = Boolean(result.void) || VOID_STATUSES.has(status);
  const goals = result.goals && Number.isFinite(Number(result.goals.home)) && Number.isFinite(Number(result.goals.away))
    ? { home: Number(result.goals.home), away: Number(result.goals.away) }
    : null;
  const finished = !isVoid && Boolean(result.finished) && Boolean(goals);
  if (!finished && !isVoid) return null;
  return {
    status,
    finished,
    void: isVoid,
    goals: finished ? goals : null,
    outcome: finished ? outcomeFromGoals(goals) : null,
    settledAt,
    source: result.source || null
  };
}

export class PredictionLedger {
  #predictions = new Map();
  #settlements = new Map();

  constructor({ storage = new MemoryLedgerStorage(), maxRecords = 20000, settlementDelayMinutes = 150, maxPendingAgeDays = 10 } = {}) {
    this.storage = storage;
    this.maxRecords = maxRecords;
    this.settlementDelayMs = settlementDelayMinutes * 60000;
    this.maxPendingAgeMs = maxPendingAgeDays * 86400000;
    this.loadErrors = 0;
    this.#replay();
  }

  #replay() {
    for (const event of this.storage.load()) {
      try {
        if (event?.type === 'prediction' && event.record?.id) this.#predictions.set(event.record.id, event.record);
        else if (event?.type === 'settlement' && event.fixtureId != null && event.result) this.#settlements.set(String(event.fixtureId), event.result);
        else this.loadErrors += 1;
      } catch {
        this.loadErrors += 1;
      }
    }
  }

  #append(event) {
    this.storage.append({ schemaVersion: LEDGER_SCHEMA_VERSION, ...event });
  }

  /**
   * Registra una previsione pubblicata. Solo previsioni realmente pre-partita entrano nel registro:
   * un'analisi calcolata a gara iniziata non può essere valutata senza look-ahead.
   */
  record(analysis, { source = 'engine', predictedAt = analysis?.generatedAt } = {}) {
    const fixture = analysis?.fixture;
    if (!fixture?.id || !fixture.kickoff || !analysis.summary?.outcomes) return null;
    const kickoffMs = Date.parse(fixture.kickoff);
    const predictedMs = Date.parse(predictedAt);
    if (!Number.isFinite(kickoffMs) || !Number.isFinite(predictedMs) || predictedMs >= kickoffMs) return null;
    if (source === 'engine' && fixture.status && !PRE_MATCH_STATUSES.has(String(fixture.status).toUpperCase())) return null;
    const neutral = Boolean(analysis.options?.neutral);
    const id = `${fixture.id}|${analysis.generatedAt}|neutral=${neutral}`;
    if (this.#predictions.has(id)) return this.#predictions.get(id);
    if (this.#predictions.size >= this.maxRecords) return null;
    const recommendation = analysis.summary.recommendation || {};
    const selectedMarket = (analysis.markets || []).find((market) => market.key === recommendation.key);
    const record = {
      id,
      source,
      predictedAt: new Date(predictedMs).toISOString(),
      computedAt: analysis.generatedAt,
      dataVersion: analysis.dataVersion || null,
      mode: analysis.mode || null,
      aiApplied: Boolean(analysis.layers?.qualitativeAssessments?.applied),
      neutral,
      fixture: {
        id: fixture.id,
        kickoff: new Date(kickoffMs).toISOString(),
        league: { id: fixture.league?.id ?? null, name: fixture.league?.name || null, round: fixture.league?.round || null },
        home: { id: fixture.home?.id ?? null, name: fixture.home?.name || null },
        away: { id: fixture.away?.id ?? null, name: fixture.away?.name || null }
      },
      prediction: {
        outcomes: roundedOutcomes(analysis.summary.outcomes),
        marketOutcomes: marketOutcomes(analysis),
        xg: analysis.summary.xg || null,
        exactScore: analysis.summary.exactScore?.score || null,
        confidence: analysis.summary.confidence ?? null,
        dataQuality: analysis.governance?.dataQuality?.score ?? null,
        markets: Object.fromEntries((analysis.markets || []).map((market) => [market.key, round(Number(market.probability) || 0, 6)])),
        recommendation: {
          key: recommendation.key || null,
          label: recommendation.label || null,
          probability: Number.isFinite(recommendation.probability) ? round(recommendation.probability, 6) : null,
          odd: Number.isFinite(selectedMarket?.odd) ? selectedMarket.odd : null,
          edge: recommendation.edge ?? null,
          hasValue: Boolean(recommendation.hasValue)
        }
      }
    };
    this.#predictions.set(id, record);
    this.#append({ type: 'prediction', record });
    return record;
  }

  settle(fixtureId, rawResult, settledAt = new Date().toISOString()) {
    const key = String(fixtureId);
    if (this.#settlements.has(key)) return this.#settlements.get(key);
    const result = normalizeResult(rawResult, settledAt);
    if (!result) return null;
    this.#settlements.set(key, result);
    this.#append({ type: 'settlement', fixtureId: key, result });
    return result;
  }

  hasSource(source) {
    for (const record of this.#predictions.values()) if (record.source === source) return true;
    return false;
  }

  /** Fixture con previsione registrata, gara presumibilmente conclusa e risultato non ancora acquisito. */
  pendingFixtureIds(now = Date.now()) {
    const due = new Map();
    for (const record of this.#predictions.values()) {
      const key = String(record.fixture.id);
      if (this.#settlements.has(key)) continue;
      const kickoff = Date.parse(record.fixture.kickoff);
      if (kickoff + this.settlementDelayMs > now || now - kickoff > this.maxPendingAgeMs) continue;
      if (!due.has(key) || kickoff < due.get(key)) due.set(key, kickoff);
    }
    return [...due.entries()].sort((left, right) => left[1] - right[1]).map(([id]) => id);
  }

  /** Una sola previsione ufficiale per partita: l'ultima pubblicata prima del calcio d'inizio. */
  officialRecords() {
    const latest = new Map();
    for (const record of this.#predictions.values()) {
      const key = String(record.fixture.id);
      const current = latest.get(key);
      if (!current || record.predictedAt > current.predictedAt || (record.predictedAt === current.predictedAt && record.computedAt > current.computedAt)) {
        latest.set(key, record);
      }
    }
    return [...latest.values()]
      .map((record) => ({ ...record, result: this.#settlements.get(String(record.fixture.id)) || null }))
      .sort((left, right) => right.fixture.kickoff.localeCompare(left.fixture.kickoff));
  }

  stats(now = Date.now()) {
    const official = this.officialRecords();
    const settled = official.filter((record) => record.result?.finished);
    return {
      storage: this.storage.kind || 'custom',
      predictionsLogged: this.#predictions.size,
      fixturesTracked: official.length,
      settled: settled.length,
      voided: official.filter((record) => record.result?.void).length,
      awaitingKickoff: official.filter((record) => !record.result && Date.parse(record.fixture.kickoff) > now).length,
      awaitingResult: this.pendingFixtureIds(now).length,
      loadErrors: this.loadErrors
    };
  }

  evaluate() {
    return evaluatePredictions(this.officialRecords().filter((record) => record.result?.finished));
  }

  /** Righe piatte per audit ed export CSV. */
  exportRows() {
    return this.officialRecords().map((record) => {
      const recommendation = record.prediction.recommendation;
      const hit = record.result?.finished ? settleMarket(recommendation.key, record.result.goals) : null;
      return {
        fixtureId: record.fixture.id,
        kickoff: record.fixture.kickoff,
        competition: record.fixture.league.name,
        home: record.fixture.home.name,
        away: record.fixture.away.name,
        predictedAt: record.predictedAt,
        source: record.source,
        aiApplied: record.aiApplied,
        pHome: record.prediction.outcomes.home,
        pDraw: record.prediction.outcomes.draw,
        pAway: record.prediction.outcomes.away,
        marketHome: record.prediction.marketOutcomes?.home ?? null,
        marketDraw: record.prediction.marketOutcomes?.draw ?? null,
        marketAway: record.prediction.marketOutcomes?.away ?? null,
        xgHome: record.prediction.xg?.home ?? null,
        xgAway: record.prediction.xg?.away ?? null,
        recommendation: recommendation.label,
        recommendationKey: recommendation.key,
        recommendationProbability: recommendation.probability,
        recommendationOdd: recommendation.odd,
        recommendationHasValue: recommendation.hasValue,
        status: record.result ? record.result.status : 'PENDING',
        goalsHome: record.result?.goals?.home ?? null,
        goalsAway: record.result?.goals?.away ?? null,
        outcome: record.result?.outcome ?? null,
        recommendationHit: hit
      };
    });
  }
}
