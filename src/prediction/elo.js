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
/** Probabilità 1X2 dall'attesa Elo: pareggio massimo a squadre pari, limitato a [0,12; 0,34]. */
export function eloOutcomes(expectedHome, drawBase = 0.3) {
  const e = Math.min(1, Math.max(0, Number(expectedHome)));
  const draw = Math.min(0.34, Math.max(0.12, drawBase * (1 - Math.abs(2 * e - 1)) ** 1.5));
  const home = Math.max(0, e - draw / 2);
  const away = Math.max(0, 1 - e - draw / 2);
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}
