import { clamp, round } from '../utils.js';
import { devigOdds } from './probability.js';

export const LABELS = {
  '1': '1 · Vittoria casa', X: 'X · Pareggio', '2': '2 · Vittoria trasferta',
  '1X': '1X · Casa o pareggio', X2: 'X2 · Pareggio o trasferta',
  GOAL: 'Goal · Entrambe segnano', NO_GOAL: 'No Goal · Almeno una non segna',
  OVER_1_5: 'Over 1.5', UNDER_1_5: 'Under 1.5',
  OVER_2_5: 'Over 2.5', UNDER_2_5: 'Under 2.5'
};

function marketProbabilities(odds) {
  if (!odds?.values) return {};
  const values = odds.values;
  const oneXtwo = devigOdds([{ key: '1', odd: values['1'] }, { key: 'X', odd: values.X }, { key: '2', odd: values['2'] }]) || {};
  return {
    ...oneXtwo,
    ...(oneXtwo['1'] != null ? { '1X': round(oneXtwo['1'] + oneXtwo.X, 6) } : {}),
    ...(oneXtwo['2'] != null ? { X2: round(oneXtwo.X + oneXtwo['2'], 6) } : {}),
    ...(devigOdds([{ key: 'GOAL', odd: values.GOAL }, { key: 'NO_GOAL', odd: values.NO_GOAL }]) || {}),
    ...(devigOdds([{ key: 'OVER_1_5', odd: values.OVER_1_5 }, { key: 'UNDER_1_5', odd: values.UNDER_1_5 }]) || {}),
    ...(devigOdds([{ key: 'OVER_2_5', odd: values.OVER_2_5 }, { key: 'UNDER_2_5', odd: values.UNDER_2_5 }]) || {})
  };
}

export function buildRecommendation(modelMarkets, odds, confidence) {
  const market = marketProbabilities(odds);
  const reliability = { '1': 1, X: 0.9, '2': 1, '1X': 0.9, X2: 0.9, GOAL: 0.88, NO_GOAL: 0.88, OVER_1_5: 0.82, UNDER_1_5: 0.82, OVER_2_5: 0.92, UNDER_2_5: 0.92 };
  const candidates = Object.keys(LABELS).map((key) => {
    const probability = modelMarkets[key];
    const odd = odds?.values?.[key] || null;
    const marketProbability = market[key] ?? null;
    const edge = marketProbability == null ? null : probability - marketProbability;
    const expectedValue = odd ? probability * odd - 1 : null;
    const valueScore = edge == null
      ? probability * reliability[key]
      : edge * 3.2 * reliability[key] + probability * 0.08;
    const uncertainty = clamp(0.035 + (100 - confidence) / 1000 + (1 - reliability[key]) * 0.06, 0.04, 0.14);
    return {
      key, label: LABELS[key], probability: round(probability, 6), odd,
      marketProbability: marketProbability == null ? null : round(marketProbability, 6),
      edge: edge == null ? null : round(edge, 6),
      expectedValue: expectedValue == null ? null : round(expectedValue, 4),
      interval: [round(clamp(probability - uncertainty, 0, 1), 4), round(clamp(probability + uncertainty, 0, 1), 4)],
      valueScore
    };
  });
  const valueCandidates = candidates.filter((item) => item.edge >= 0.025 && item.expectedValue >= 0.03);
  const quotedCandidates = candidates.filter((item) => Number.isFinite(item.odd) && item.odd > 1);
  const selectionPool = valueCandidates.length ? valueCandidates : quotedCandidates.length ? quotedCandidates : candidates;
  const selected = [...selectionPool]
    .sort((a, b) => b.valueScore - a.valueScore)[0];
  return {
    ...selected,
    hasValue: valueCandidates.length > 0,
    status: valueCandidates.length > 0
      ? 'Segnale con margine statistico rispetto alla quota disponibile.'
      : 'Esito più robusto del modello; nessun vantaggio di quota sufficiente rilevato.',
    candidates: candidates.sort((a, b) => b.probability - a.probability).map(({ valueScore, ...item }) => item)
  };
}
