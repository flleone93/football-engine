import { clamp, round } from '../utils.js';
import { devig } from './probability.js';
import { ENSEMBLE } from './ensembleWeights.js';
import { kellyFraction } from './staking.js';

export const LABELS = {
  '1': '1 · Vittoria casa', X: 'X · Pareggio', '2': '2 · Vittoria trasferta',
  '1X': '1X · Casa o pareggio', X2: 'X2 · Pareggio o trasferta',
  GOAL: 'Goal · Entrambe segnano', NO_GOAL: 'No Goal · Almeno una non segna',
  OVER_1_5: 'Over 1.5', UNDER_1_5: 'Under 1.5',
  OVER_2_5: 'Over 2.5', UNDER_2_5: 'Under 2.5'
};

function marketProbabilities(odds, method) {
  if (!odds?.values) return { probabilities: {}, fallbacks: [] };
  const values = odds.values;
  const fallbacks = [];
  const run = (name, entries) => {
    const result = devig(entries, method);
    if (result?.fallback) fallbacks.push(name);
    return result?.probabilities || {};
  };
  const oneXtwo = run('1X2', [{ key: '1', odd: values['1'] }, { key: 'X', odd: values.X }, { key: '2', odd: values['2'] }]);
  const probabilities = {
    ...oneXtwo,
    ...(oneXtwo['1'] != null ? { '1X': round(oneXtwo['1'] + oneXtwo.X, 6) } : {}),
    ...(oneXtwo['2'] != null ? { X2: round(oneXtwo.X + oneXtwo['2'], 6) } : {}),
    ...run('GOAL', [{ key: 'GOAL', odd: values.GOAL }, { key: 'NO_GOAL', odd: values.NO_GOAL }]),
    ...run('OVER_1_5', [{ key: 'OVER_1_5', odd: values.OVER_1_5 }, { key: 'UNDER_1_5', odd: values.UNDER_1_5 }]),
    ...run('OVER_2_5', [{ key: 'OVER_2_5', odd: values.OVER_2_5 }, { key: 'UNDER_2_5', odd: values.UNDER_2_5 }])
  };
  return { probabilities, fallbacks };
}

export function buildRecommendation(modelMarkets, odds, confidence, method = 'proportional') {
  const { probabilities: market, fallbacks: devigFallbacks } = marketProbabilities(odds, method);
  const reliability = { '1': 1, X: 0.9, '2': 1, '1X': 0.9, X2: 0.9, GOAL: 0.88, NO_GOAL: 0.88, OVER_1_5: 0.82, UNDER_1_5: 0.82, OVER_2_5: 0.92, UNDER_2_5: 0.92 };
  const candidates = Object.keys(LABELS).map((key) => {
    const probability = modelMarkets[key];
    const odd = odds?.values?.[key] || null;
    const marketProbability = market[key] ?? null;
    const edge = marketProbability == null ? null : probability - marketProbability;
    const expectedValue = odd ? probability * odd - 1 : null;
    const uncertainty = clamp(0.035 + (100 - confidence) / 1000 + (1 - reliability[key]) * 0.06, 0.04, 0.14);
    return {
      key, label: LABELS[key], probability: round(probability, 6), odd,
      marketProbability: marketProbability == null ? null : round(marketProbability, 6),
      edge: edge == null ? null : round(edge, 6),
      expectedValue: expectedValue == null ? null : round(expectedValue, 4),
      kellyFraction: odd > 1 ? round(kellyFraction(probability, odd), 6) : null,
      interval: [round(clamp(probability - uncertainty, 0, 1), 4), round(clamp(probability + uncertainty, 0, 1), 4)]
    };
  });
  const byKey = Object.fromEntries(candidates.map((item) => [item.key, item]));
  // Segno 1X2 più probabile; a parità vince l'ordine 1, 2, X (scelta deterministica).
  const selected = ['1', '2', 'X'].map((key) => byKey[key]).reduce((best, item) => (item.probability > best.probability ? item : best));
  const { edge: edgeThreshold, ev: evThreshold } = ENSEMBLE.valueThresholds;
  const hasValue = selected.edge != null && selected.edge >= edgeThreshold && selected.expectedValue != null && selected.expectedValue >= evThreshold;
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
  // Quota reale del bookmaker se disponibile; altrimenti quota equa (senza margine) stimata dalle quote 1X2.
  const realOdd = doubleChance.odd > 1 ? doubleChance.odd : null;
  const fairOdd = realOdd == null && doubleChance.marketProbability > 0 ? Math.round(100 / doubleChance.marketProbability) / 100 : null;
  const over = byKey.OVER_1_5;
  return [
    { key: doubleChance.key, label: doubleChance.label, probability: doubleChance.probability, odd: realOdd ?? fairOdd, estimated: realOdd == null && fairOdd != null },
    { key: over.key, label: over.label, probability: over.probability, odd: over.odd > 1 ? over.odd : null, estimated: false }
  ];
}
