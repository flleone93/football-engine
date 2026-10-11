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

export const ENSEMBLE = Object.freeze({
  "version": "dati-2026-10-11",
  "generatedAt": "2026-10-11T16:20:01.665Z",
  "trainSeason": 2025,
  "testSeason": 2026,
  "matches": {
    "train": 5249,
    "test": 1757
  },
  "weights": {
    "poisson": 0,
    "montecarlo": 2,
    "market": 97.3,
    "form": 0.6,
    "provider": 0,
    "h2h": 0,
    "elo": 0
  },
  "eloDrawBase": 0.34,
  "valueThresholds": {
    "edge": 0.025,
    "ev": 0.03
  },
  "metrics": {
    "current": {
      "n": 1757,
      "brier": 0.6188580872969118,
      "logLoss": 1.0312454088061935,
      "rps": 0.21135325881141043,
      "accuracy": 0.4746727376209448
    },
    "fitted": {
      "n": 1757,
      "brier": 0.6037188582801744,
      "logLoss": 1.008512209358357,
      "rps": 0.20413798650506074,
      "accuracy": 0.4871940808195788
    },
    "fittedWithElo": {
      "n": 1757,
      "brier": 0.603253201111328,
      "logLoss": 1.007921328444726,
      "rps": 0.20390618851631304,
      "accuracy": 0.48947068867387594
    },
    "market": {
      "n": 1724,
      "brier": 0.6032391654710566,
      "logLoss": 1.007727272903587,
      "rps": 0.20355620158196788,
      "accuracy": 0.49071925754060325
    },
    "useElo": false,
    "valueBefore": {
      "signals": 364,
      "roi": -0.11742032967032973
    },
    "valueAfter": {
      "signals": 0,
      "roi": null
    },
    "underdogGap": {
      "before": 0.03928844724137937,
      "after": 0.0014577644827586237
    },
    "thresholdReason": "ROI n.d. su 0 segnali: soglie invariate."
  }
});

const SOURCE_IDS = ['poisson', 'montecarlo', 'market', 'form', 'provider', 'h2h', 'elo'];

/** Pesi utilizzabili: tutte le fonti presenti, numeri ≥ 0 con somma > 0; altrimenti i pesi manuali (fallback). */
export function resolveEnsemble(candidate = ENSEMBLE) {
  const weights = candidate?.weights;
  const valid = weights && SOURCE_IDS.every((id) => Number.isFinite(weights[id]) && weights[id] >= 0) && SOURCE_IDS.some((id) => weights[id] > 0)
    && Number.isFinite(candidate.eloDrawBase) && Number.isFinite(candidate.valueThresholds?.edge) && Number.isFinite(candidate.valueThresholds?.ev);
  return valid ? { config: candidate, fallback: false } : { config: DEFAULT_ENSEMBLE, fallback: true };
}

/** Soglie del "Valore" solo se valide; altrimenti quelle manuali (stesso controllo dei pesi). */
export function valueThresholdsFrom(candidate = ENSEMBLE) {
  const thresholds = candidate?.valueThresholds;
  return Number.isFinite(thresholds?.edge) && Number.isFinite(thresholds?.ev) ? { edge: thresholds.edge, ev: thresholds.ev } : { ...DEFAULT_ENSEMBLE.valueThresholds };
}

/** Pesi da usare quando mancano le quote: i manuali, migliori sul banco di prova a mercato nascosto (log loss 1,0544 contro 1,0558). */
export const NO_MARKET_WEIGHTS = DEFAULT_ENSEMBLE.weights;
