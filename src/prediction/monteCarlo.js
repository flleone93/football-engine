import { mulberry32, round, stableHash } from '../utils.js';

function normal(random) {
  const first = Math.max(random(), 1e-12);
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function poisson(lambda, random) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit && count < 20);
  return count - 1;
}

export function runMonteCarlo({ fixtureId, homeLambda, awayLambda, runs = 50000 }) {
  const random = mulberry32(stableHash(`${fixtureId}:${homeLambda}:${awayLambda}:${runs}`));
  const sigma = 0.12;
  let home = 0; let draw = 0; let away = 0;
  let totalHomeGoals = 0; let totalAwayGoals = 0;
  for (let index = 0; index < runs; index += 1) {
    const pace = Math.exp(normal(random) * sigma - sigma ** 2 / 2);
    const homeVariation = Math.exp(normal(random) * 0.08 - 0.08 ** 2 / 2);
    const awayVariation = Math.exp(normal(random) * 0.08 - 0.08 ** 2 / 2);
    const homeGoals = poisson(homeLambda * pace * homeVariation, random);
    const awayGoals = poisson(awayLambda * pace * awayVariation, random);
    totalHomeGoals += homeGoals; totalAwayGoals += awayGoals;
    if (homeGoals > awayGoals) home += 1;
    else if (homeGoals === awayGoals) draw += 1;
    else away += 1;
  }
  return {
    runs,
    probabilities: { home: round(home / runs, 6), draw: round(draw / runs, 6), away: round(away / runs, 6) },
    averageGoals: { home: round(totalHomeGoals / runs, 3), away: round(totalAwayGoals / runs, 3) }
  };
}
