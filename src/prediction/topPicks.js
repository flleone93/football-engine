import { clamp, round } from '../utils.js';

const ALLOWED_LIMITS = new Set([5, 6, 7]);

export function isNeutralFixture(fixture) {
  return /world cup|mondiale|european championship|europei|copa am[eé]rica|club world cup/i.test(fixture?.league?.name || '')
    && /final|semi|quarter|round|ottavi|quarti/i.test(fixture?.league?.round || '');
}

function selectedMarket(analysis) {
  const key = analysis?.summary?.recommendation?.key;
  return analysis?.markets?.find((market) => market.key === key) || null;
}

export function normalizePick(analysis, policy = {}) {
  const market = selectedMarket(analysis);
  if (!market || !Number.isFinite(market.probability) || !Number.isFinite(market.odd) || market.odd <= 1) return null;
  const confidence = Number(analysis.summary.confidence || 0) / 100;
  const dataQuality = Number(analysis.governance?.dataQuality?.score || 0) / 100;
  const robustness = Number(analysis.governance?.robustness || 0);
  if (market.probability < (policy.minProbability ?? 0)) return null;
  if (confidence * 100 < (policy.minConfidence ?? 0)) return null;
  if (dataQuality * 100 < (policy.minDataQuality ?? 0)) return null;
  if (policy.requirePositiveEv && !(market.expectedValue > 0)) return null;
  const riskAdjustedScore = market.probability * (
    0.7 + clamp(confidence, 0, 1) * 0.15 + clamp(dataQuality, 0, 1) * 0.1 + clamp(robustness, 0, 1) * 0.05
  );
  return {
    fixture: analysis.fixture,
    selection: {
      key: market.key,
      label: market.label,
      probability: round(market.probability, 6),
      interval: market.interval,
      odd: round(market.odd, 3),
      marketProbability: market.marketProbability,
      edge: market.edge,
      expectedValue: market.expectedValue,
      hasValue: Boolean(analysis.summary.recommendation.hasValue)
    },
    confidence: analysis.summary.confidence,
    confidenceLabel: analysis.summary.confidenceLabel,
    dataQuality: analysis.governance?.dataQuality?.score || 0,
    robustness: analysis.governance?.robustness || 0,
    xg: analysis.summary.xg,
    exactScore: analysis.summary.exactScore,
    riskAdjustedScore: round(riskAdjustedScore, 6),
    generatedAt: analysis.generatedAt
  };
}

export function rankAnalyses(analyses, policy = {}) {
  return analyses.map((analysis) => normalizePick(analysis, policy)).filter(Boolean)
    .sort((left, right) => right.riskAdjustedScore - left.riskAdjustedScore
      || right.selection.probability - left.selection.probability
      || right.confidence - left.confidence);
}

function multiply(values) {
  return values.reduce((product, value) => product * value, 1);
}

function buildBetSimulation(picks, stake) {
  if (!picks.length) {
    return {
      stake,
      accumulator: null,
      singles: null,
      assumptions: ['Nessuna selezione con quota valida disponibile.']
    };
  }
  const combinedOdd = multiply(picks.map((pick) => pick.selection.odd));
  const combinedProbability = multiply(picks.map((pick) => pick.selection.probability));
  const potentialGrossReturn = stake * combinedOdd;
  const expectedGrossReturn = potentialGrossReturn * combinedProbability;
  const singleStake = stake / picks.length;
  const singlesPotentialGrossReturn = picks.reduce((sum, pick) => sum + singleStake * pick.selection.odd, 0);
  const singlesExpectedGrossReturn = picks.reduce(
    (sum, pick) => sum + singleStake * pick.selection.odd * pick.selection.probability,
    0
  );
  return {
    stake: round(stake, 2),
    accumulator: {
      selections: picks.length,
      combinedOdd: round(combinedOdd, 3),
      modelProbability: round(combinedProbability, 8),
      bookmakerRawProbability: round(1 / combinedOdd, 8),
      potentialGrossReturn: round(potentialGrossReturn, 2),
      potentialNetProfit: round(potentialGrossReturn - stake, 2),
      expectedGrossReturn: round(expectedGrossReturn, 2),
      expectedNetProfit: round(expectedGrossReturn - stake, 2),
      expectedRoi: round((expectedGrossReturn - stake) / stake, 6)
    },
    singles: {
      selections: picks.length,
      stakePerSelection: round(singleStake, 2),
      potentialGrossReturnIfAllWin: round(singlesPotentialGrossReturn, 2),
      expectedGrossReturn: round(singlesExpectedGrossReturn, 2),
      expectedNetProfit: round(singlesExpectedGrossReturn - stake, 2),
      expectedRoi: round((singlesExpectedGrossReturn - stake) / stake, 6)
    },
    assumptions: [
      'La probabilità della multipla assume indipendenza tra gli eventi; partite o mercati correlati possono rendere la stima troppo ottimistica.',
      'La simulazione non include limiti, tasse, variazioni di quota, void, cash-out o regole specifiche del bookmaker.',
      'Rendimento atteso e profitto potenziale sono scenari matematici, non promesse di vincita.'
    ]
  };
}

export function buildTopPicks({ analyses, date, limit = 5, stake = 10, availableFixtures = analyses.length, scannedFixtures = analyses.length, failed = [], bookmaker = null, eligibilityPolicy = {} }) {
  const safeLimit = ALLOWED_LIMITS.has(Number(limit)) ? Number(limit) : 5;
  const safeStake = round(clamp(Number(stake) || 10, 1, 10000), 2);
  const eligible = rankAnalyses(analyses, eligibilityPolicy);
  const picks = eligible
    .slice(0, safeLimit)
    .map((pick, index) => ({ rank: index + 1, ...pick }));
  return {
    date,
    limit: safeLimit,
    generatedAt: new Date().toISOString(),
    bookmaker,
    coverage: {
      availableFixtures,
      scannedFixtures,
      truncatedFixtures: Math.max(0, availableFixtures - scannedFixtures),
      analyzedFixtures: analyses.length,
      eligibleFixtures: eligible.length,
      failedFixtures: failed.length,
      returnedPicks: picks.length,
      complete: picks.length === safeLimit
    },
    picks,
    simulation: buildBetSimulation(picks, safeStake),
    audit: {
      ranking: 'Probabilità corretta per confidenza, qualità dati e robustezza; una sola selezione per partita.',
      eligibilityPolicy,
      excludedWithoutOdds: Math.max(0, analyses.length - eligible.length),
      failed
    }
  };
}
