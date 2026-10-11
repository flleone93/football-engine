// Pesi delle fonti del motore e soglie del "Valore". Riscritto da scripts/run-backtest.mjs con i valori stimati sul
// banco di prova storico; questi sono i pesi manuali in uso fino alla 2.1.0.
export const DEFAULT_ENSEMBLE = Object.freeze({
  version: 'manuale-2.1',
  generatedAt: null,
  weights: Object.freeze({ poisson: 25, montecarlo: 15, market: 25, form: 18, provider: 10, h2h: 7, elo: 0 }),
  eloDrawBase: 0.3,
  valueThresholds: Object.freeze({ edge: 0.025, ev: 0.03 }),
  metrics: null
});

export const ENSEMBLE = DEFAULT_ENSEMBLE;

const SOURCE_IDS = ['poisson', 'montecarlo', 'market', 'form', 'provider', 'h2h', 'elo'];

/** Pesi utilizzabili: tutte le fonti presenti, numeri ≥ 0 con somma > 0; altrimenti i pesi manuali (fallback). */
export function resolveEnsemble(candidate = ENSEMBLE) {
  const weights = candidate?.weights;
  const valid = weights && SOURCE_IDS.every((id) => Number.isFinite(weights[id]) && weights[id] >= 0) && SOURCE_IDS.some((id) => weights[id] > 0)
    && Number.isFinite(candidate.eloDrawBase) && Number.isFinite(candidate.valueThresholds?.edge) && Number.isFinite(candidate.valueThresholds?.ev);
  return valid ? { config: candidate, fallback: false } : { config: DEFAULT_ENSEMBLE, fallback: true };
}
