// Metriche post-partita deterministiche: Brier, log loss, RPS, calibrazione e rendimento delle indicazioni.
// Funzioni pure, senza dipendenze Node: usate dal server e dalla demo standalone.
import { round } from '../utils.js';

const OUTCOMES = ['home', 'draw', 'away'];
const EPSILON = 1e-12;

export function outcomeFromGoals(goals) {
  if (!goals || !Number.isFinite(goals.home) || !Number.isFinite(goals.away)) return null;
  if (goals.home > goals.away) return 'home';
  if (goals.home < goals.away) return 'away';
  return 'draw';
}

/** Esito di un mercato al 90': true vinto, false perso, null non valutabile. */
export function settleMarket(key, goals) {
  const outcome = outcomeFromGoals(goals);
  if (!outcome) return null;
  const total = goals.home + goals.away;
  switch (key) {
    case '1': return outcome === 'home';
    case 'X': return outcome === 'draw';
    case '2': return outcome === 'away';
    case '1X': return outcome !== 'away';
    case 'X2': return outcome !== 'home';
    case 'GOAL': return goals.home > 0 && goals.away > 0;
    case 'NO_GOAL': return goals.home === 0 || goals.away === 0;
    case 'OVER_1_5': return total > 1.5;
    case 'UNDER_1_5': return total < 1.5;
    case 'OVER_2_5': return total > 2.5;
    case 'UNDER_2_5': return total < 2.5;
    default: return null;
  }
}

function normalized(probabilities) {
  if (!probabilities) return null;
  const values = OUTCOMES.map((key) => Math.max(0, Number(probabilities[key]) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(OUTCOMES.map((key, index) => [key, values[index] / total]));
}

/** Brier multiclasse 1X2 (0 = perfetto, 2 = peggiore). */
export function brierScore(probabilities, outcome) {
  const p = normalized(probabilities);
  if (!p || !outcome) return null;
  return OUTCOMES.reduce((sum, key) => sum + (p[key] - (key === outcome ? 1 : 0)) ** 2, 0);
}

export function logLoss(probabilities, outcome) {
  const p = normalized(probabilities);
  if (!p || !outcome) return null;
  return -Math.log(Math.max(EPSILON, p[outcome]));
}

/** Ranked Probability Score: rispetta l'ordinamento casa > pareggio > trasferta (0 = perfetto, 1 = peggiore). */
export function rankedProbabilityScore(probabilities, outcome) {
  const p = normalized(probabilities);
  if (!p || !outcome) return null;
  const observed = OUTCOMES.map((key) => (key === outcome ? 1 : 0));
  let cumulativeForecast = 0;
  let cumulativeObserved = 0;
  let sum = 0;
  for (let index = 0; index < OUTCOMES.length - 1; index += 1) {
    cumulativeForecast += p[OUTCOMES[index]];
    cumulativeObserved += observed[index];
    sum += (cumulativeForecast - cumulativeObserved) ** 2;
  }
  return sum / (OUTCOMES.length - 1);
}

function binaryBrier(probability, hit) {
  return (probability - (hit ? 1 : 0)) ** 2;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function argmax(probabilities) {
  const p = normalized(probabilities);
  if (!p) return null;
  return OUTCOMES.reduce((best, key) => (p[key] > p[best] ? key : best), OUTCOMES[0]);
}

function scoreSet(records, pick) {
  const rows = records
    .map((record) => ({ probabilities: pick(record), outcome: record.result.outcome }))
    .filter((row) => normalized(row.probabilities));
  if (!rows.length) return { n: 0, brier: null, logLoss: null, rps: null, accuracy: null };
  return {
    n: rows.length,
    brier: round(average(rows.map((row) => brierScore(row.probabilities, row.outcome))), 6),
    logLoss: round(average(rows.map((row) => logLoss(row.probabilities, row.outcome))), 6),
    rps: round(average(rows.map((row) => rankedProbabilityScore(row.probabilities, row.outcome))), 6),
    accuracy: round(rows.filter((row) => argmax(row.probabilities) === row.outcome).length / rows.length, 6)
  };
}

/** Diagramma di affidabilità: ogni probabilità 1X2 pubblicata è un punto (previsto vs osservato). */
export function calibrationBins(records, bins = 10) {
  const buckets = Array.from({ length: bins }, (_, index) => ({
    from: index / bins, to: (index + 1) / bins, n: 0, predictedSum: 0, hits: 0
  }));
  for (const record of records) {
    const p = normalized(record.prediction.outcomes);
    if (!p) continue;
    for (const key of OUTCOMES) {
      const index = Math.min(bins - 1, Math.floor(p[key] * bins));
      buckets[index].n += 1;
      buckets[index].predictedSum += p[key];
      if (record.result.outcome === key) buckets[index].hits += 1;
    }
  }
  return buckets.map((bucket) => ({
    from: round(bucket.from, 2),
    to: round(bucket.to, 2),
    n: bucket.n,
    meanPredicted: bucket.n ? round(bucket.predictedSum / bucket.n, 6) : null,
    observedRate: bucket.n ? round(bucket.hits / bucket.n, 6) : null
  }));
}

/** Expected Calibration Error pesato per numerosità dei bin. */
export function expectedCalibrationError(bins) {
  const total = bins.reduce((sum, bin) => sum + bin.n, 0);
  if (!total) return null;
  return round(bins.reduce((sum, bin) => sum + (bin.n ? bin.n / total * Math.abs(bin.meanPredicted - bin.observedRate) : 0), 0), 6);
}

function recommendationReport(records) {
  const rows = records
    .map((record) => ({ record, hit: settleMarket(record.prediction.recommendation?.key, record.result.goals) }))
    .filter((row) => row.hit != null);
  const build = (subset) => {
    const priced = subset.filter((row) => Number.isFinite(row.record.prediction.recommendation.odd) && row.record.prediction.recommendation.odd > 1);
    const returned = priced.reduce((sum, row) => sum + (row.hit ? row.record.prediction.recommendation.odd : 0), 0);
    return {
      n: subset.length,
      hits: subset.filter((row) => row.hit).length,
      hitRate: subset.length ? round(subset.filter((row) => row.hit).length / subset.length, 6) : null,
      averageProbability: subset.length ? round(average(subset.map((row) => row.record.prediction.recommendation.probability)), 6) : null,
      brier: subset.length ? round(average(subset.map((row) => binaryBrier(row.record.prediction.recommendation.probability, row.hit))), 6) : null,
      flatStake: {
        bets: priced.length,
        staked: priced.length,
        returned: round(returned, 4),
        profit: round(returned - priced.length, 4),
        roi: priced.length ? round((returned - priced.length) / priced.length, 6) : null
      }
    };
  };
  return {
    all: build(rows),
    valueOnly: build(rows.filter((row) => row.record.prediction.recommendation.hasValue))
  };
}

function goalMarketsReport(records) {
  const evaluate = (key) => {
    const rows = records
      .map((record) => ({ probability: record.prediction.markets?.[key], hit: settleMarket(key, record.result.goals) }))
      .filter((row) => Number.isFinite(row.probability) && row.hit != null);
    return {
      n: rows.length,
      brier: rows.length ? round(average(rows.map((row) => binaryBrier(row.probability, row.hit))), 6) : null,
      averagePredicted: rows.length ? round(average(rows.map((row) => row.probability)), 6) : null,
      observedRate: rows.length ? round(rows.filter((row) => row.hit).length / rows.length, 6) : null
    };
  };
  return { OVER_2_5: evaluate('OVER_2_5'), GOAL: evaluate('GOAL') };
}

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

/**
 * Valuta i record già regolati. Ogni record: { prediction: { outcomes, marketOutcomes?, recommendation, markets, ... },
 * result: { goals, outcome }, fixture: { league } }.
 */
export function evaluatePredictions(records) {
  const settled = records.filter((record) => record?.result?.outcome && record?.prediction?.outcomes);
  const model = scoreSet(settled, (record) => record.prediction.outcomes);
  const withMarket = settled.filter((record) => normalized(record.prediction.marketOutcomes));
  const modelOnMarketSample = scoreSet(withMarket, (record) => record.prediction.outcomes);
  const market = scoreSet(withMarket, (record) => record.prediction.marketOutcomes);
  const uniform = scoreSet(settled, () => ({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }));
  const bins = calibrationBins(settled);
  const competitions = new Map();
  for (const record of settled) {
    const name = record.fixture?.league?.name || 'Competizione non indicata';
    if (!competitions.has(name)) competitions.set(name, []);
    competitions.get(name).push(record);
  }
  const skill = (value, reference) => (value == null || !reference ? null : round(1 - value / reference, 6));
  return {
    settled: settled.length,
    model,
    benchmarks: {
      uniform,
      market: {
        ...market,
        modelOnSameSample: modelOnMarketSample,
        brierSkillVsMarket: skill(modelOnMarketSample.brier, market.brier),
        rpsSkillVsMarket: skill(modelOnMarketSample.rps, market.rps)
      },
      brierSkillVsUniform: skill(model.brier, uniform.brier)
    },
    calibration: {
      bins,
      expectedCalibrationError: expectedCalibrationError(bins)
    },
    recommendations: recommendationReport(settled),
    goalMarkets: goalMarketsReport(settled),
    timeline: timeline(settled),
    byCompetition: [...competitions.entries()]
      .map(([name, items]) => ({ name, ...scoreSet(items, (record) => record.prediction.outcomes) }))
      .sort((left, right) => right.n - left.n || left.name.localeCompare(right.name))
  };
}
