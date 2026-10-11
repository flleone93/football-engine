import { clamp, normalizeProbabilities, round } from '../utils.js';

export function poissonPmf(lambda, goals) {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

export function scoreMatrix(homeLambda, awayLambda, maxGoals = 10, rho = -0.07) {
  const matrix = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      let probability = poissonPmf(homeLambda, home) * poissonPmf(awayLambda, away);
      if (home === 0 && away === 0) probability *= 1 - homeLambda * awayLambda * rho;
      if (home === 0 && away === 1) probability *= 1 + homeLambda * rho;
      if (home === 1 && away === 0) probability *= 1 + awayLambda * rho;
      if (home === 1 && away === 1) probability *= 1 - rho;
      probability = Math.max(0, probability);
      matrix.push({ home, away, probability });
      total += probability;
    }
  }
  return matrix.map((entry) => ({ ...entry, probability: entry.probability / total }));
}

export function outcomesFromMatrix(matrix) {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (const score of matrix) {
    if (score.home > score.away) home += score.probability;
    else if (score.home === score.away) draw += score.probability;
    else away += score.probability;
  }
  return { home, draw, away };
}

export function calibrateMatrixToOutcomes(matrix, target) {
  const current = outcomesFromMatrix(matrix);
  const factors = {
    home: target.home / Math.max(current.home, 1e-9),
    draw: target.draw / Math.max(current.draw, 1e-9),
    away: target.away / Math.max(current.away, 1e-9)
  };
  const adjusted = matrix.map((score) => {
    const outcome = score.home > score.away ? 'home' : score.home === score.away ? 'draw' : 'away';
    return { ...score, probability: score.probability * factors[outcome] };
  });
  const total = adjusted.reduce((sum, score) => sum + score.probability, 0);
  return adjusted.map((score) => ({ ...score, probability: score.probability / total }));
}

export function marketsFromMatrix(matrix) {
  const result = {
    '1': 0, X: 0, '2': 0,
    GOAL: 0, NO_GOAL: 0,
    OVER_1_5: 0, UNDER_1_5: 0,
    OVER_2_5: 0, UNDER_2_5: 0
  };
  for (const score of matrix) {
    const { home, away, probability } = score;
    if (home > away) result['1'] += probability;
    else if (home === away) result.X += probability;
    else result['2'] += probability;
    if (home > 0 && away > 0) result.GOAL += probability;
    else result.NO_GOAL += probability;
    if (home + away > 1.5) result.OVER_1_5 += probability;
    else result.UNDER_1_5 += probability;
    if (home + away > 2.5) result.OVER_2_5 += probability;
    else result.UNDER_2_5 += probability;
  }
  result['1X'] = result['1'] + result.X;
  result.X2 = result.X + result['2'];
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value, 6)]));
}

export function exactScores(matrix, limit = 10) {
  const outcomes = outcomesFromMatrix(matrix);
  return [...matrix]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit)
    .map((score, index) => {
      const outcome = score.home > score.away ? '1' : score.home === score.away ? 'X' : '2';
      const outcomeProbability = outcome === '1' ? outcomes.home : outcome === 'X' ? outcomes.draw : outcomes.away;
      return {
        rank: index + 1,
        score: `${score.home}-${score.away}`,
        outcome,
        probability: round(score.probability, 6),
        contributionToOutcome: round(score.probability / Math.max(outcomeProbability, 1e-9), 6)
      };
    });
}

export function blendOutcomes(sources) {
  const active = sources.filter((source) => source && source.weight > 0 && source.probabilities);
  const totalWeight = active.reduce((sum, source) => sum + source.weight, 0) || 1;
  const combined = [0, 0, 0];
  for (const source of active) {
    const probabilities = normalizeProbabilities([
      source.probabilities.home,
      source.probabilities.draw,
      source.probabilities.away
    ]);
    probabilities.forEach((value, index) => {
      combined[index] += value * source.weight / totalWeight;
    });
  }
  const [home, draw, away] = normalizeProbabilities(combined);
  return { home: round(home, 6), draw: round(draw, 6), away: round(away, 6) };
}

export function totalGoalsFromOverProbability(overProbability) {
  if (!Number.isFinite(overProbability)) return 2.55;
  let low = 0.5;
  let high = 5;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const lambda = (low + high) / 2;
    const under = Math.exp(-lambda) * (1 + lambda + lambda ** 2 / 2);
    if (1 - under < overProbability) low = lambda;
    else high = lambda;
  }
  return clamp((low + high) / 2, 1.3, 4.2);
}

export function devigOdds(entries) {
  const valid = entries.filter((entry) => Number.isFinite(entry.odd) && entry.odd > 1);
  if (valid.length !== entries.length) return null;
  const implied = valid.map((entry) => 1 / entry.odd);
  const normalized = normalizeProbabilities(implied);
  return Object.fromEntries(valid.map((entry, index) => [entry.key, round(normalized[index], 6)]));
}
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
