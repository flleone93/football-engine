import { asNumber, clamp, mean, normalizeProbabilities, round, standardDeviation } from '../utils.js';
import { blendOutcomes, calibrateMatrixToOutcomes, devig, devigOdds, exactScores, marketsFromMatrix, outcomesFromMatrix, scoreMatrix, totalGoalsFromOverProbability } from './probability.js';
import { runMonteCarlo } from './monteCarlo.js';
import { buildRecommendation } from './recommendation.js';
import { formFromRecent, oddsMovementFromOdds, scoreGridFromMatrix } from './presentation.js';
import { weatherSummary } from '../providers/weather.js';

function oddsProbability(odds, keys) {
  if (!odds?.values) return null;
  const devigged = devigOdds(keys.map((key) => ({ key, odd: odds.values[key] })));
  return devigged || null;
}

export function dataQuality(bundle) {
  const available = (key, fallback) => bundle.sourceStatus?.[key]?.available ?? fallback;
  const checks = [
    ['Identità partita', 15, Boolean(bundle.fixture?.home?.id && bundle.fixture?.away?.id)],
    ['Statistiche stagionali', 18, available('homeStats', Boolean(bundle.homeStats)) && available('awayStats', Boolean(bundle.awayStats)) && Boolean(bundle.homeStats && bundle.awayStats)],
    ['Forma recente', 15, available('recentHome', Boolean(bundle.recentHome)) && available('recentAway', Boolean(bundle.recentAway)) && Boolean(bundle.recentHome && bundle.recentAway)],
    ['Quote 1X2', 18, available('odds', Boolean(bundle.odds)) && Boolean(oddsProbability(bundle.odds, ['1', 'X', '2']))],
    ['Quote mercati goal', 8, available('odds', Boolean(bundle.odds)) && Boolean(bundle.odds?.values?.OVER_2_5 || bundle.odds?.values?.GOAL)],
    ['Indisponibili', 8, available('injuries', Boolean(bundle.injuries))],
    ['Formazioni', 8, available('lineups', Boolean(bundle.lineups)) && Boolean(bundle.lineups?.confirmed)],
    ['Previsione provider', 6, available('prediction', Boolean(bundle.prediction)) && Boolean(bundle.prediction)],
    ['Arbitro', 4, Boolean(bundle.fixture?.referee)]
  ];
  const rawScore = checks.reduce((sum, [, weight, available]) => sum + (available ? weight : 0), 0);
  const score = Math.max(0, rawScore - Math.min(20, (bundle.sourceErrors?.length || 0) * 3));
  return {
    score,
    checks: checks.map(([name, weight, available]) => ({ name, weight, available })),
    missing: checks.filter(([, , available]) => !available).map(([name]) => name),
    sourceErrors: bundle.sourceErrors || []
  };
}

function validAverage(...values) {
  const result = mean(values.map((value) => asNumber(value)).filter((value) => value != null && value >= 0));
  return result == null ? null : result;
}

function enforceSourceWeightCaps(sources) {
  const adjusted = sources.map((source) => ({ ...source }));
  const h2h = adjusted.find((source) => source.id === 'h2h' && source.probabilities);
  if (!h2h) return adjusted;
  const otherWeight = adjusted
    .filter((source) => source.id !== 'h2h' && source.probabilities)
    .reduce((sum, source) => sum + source.weight, 0);
  h2h.weight = Math.min(h2h.weight, otherWeight * 0.07 / 0.93);
  return adjusted;
}

export function inferLambdas(bundle, neutral) {
  const market1x2 = oddsProbability(bundle.odds, ['1', 'X', '2']);
  const over25 = oddsProbability(bundle.odds, ['OVER_2_5', 'UNDER_2_5']);
  const providerHome = bundle.prediction?.expectedHome;
  const providerAway = bundle.prediction?.expectedAway;
  let homeLambda;
  let awayLambda;
  if (bundle.homeStats && bundle.awayStats) {
    const homeFor = neutral ? validAverage(bundle.homeStats.goalsForTotal, bundle.homeStats.goalsForHome) : validAverage(bundle.homeStats.goalsForHome, bundle.homeStats.goalsForTotal);
    const homeAgainst = neutral ? validAverage(bundle.homeStats.goalsAgainstTotal, bundle.homeStats.goalsAgainstHome) : validAverage(bundle.homeStats.goalsAgainstHome, bundle.homeStats.goalsAgainstTotal);
    const awayFor = neutral ? validAverage(bundle.awayStats.goalsForTotal, bundle.awayStats.goalsForAway) : validAverage(bundle.awayStats.goalsForAway, bundle.awayStats.goalsForTotal);
    const awayAgainst = neutral ? validAverage(bundle.awayStats.goalsAgainstTotal, bundle.awayStats.goalsAgainstAway) : validAverage(bundle.awayStats.goalsAgainstAway, bundle.awayStats.goalsAgainstTotal);
    const sample = Math.min(bundle.homeStats.played || 0, bundle.awayStats.played || 0);
    const reliability = clamp(sample / 20, 0.2, 1);
    const homePrior = neutral ? 1.25 : 1.35;
    const awayPrior = neutral ? 1.25 : 1.15;
    const rawHome = (homeFor ?? homePrior) * 0.62 + (awayAgainst ?? homePrior) * 0.38;
    const rawAway = (awayFor ?? awayPrior) * 0.62 + (homeAgainst ?? awayPrior) * 0.38;
    homeLambda = rawHome * reliability + homePrior * (1 - reliability);
    awayLambda = rawAway * reliability + awayPrior * (1 - reliability);
  } else if (providerHome && providerAway) {
    homeLambda = providerHome;
    awayLambda = providerAway;
  } else {
    const total = totalGoalsFromOverProbability(over25?.OVER_2_5);
    const ratio = market1x2 ? Math.exp(Math.log((market1x2['1'] + 0.03) / (market1x2['2'] + 0.03)) * 0.38) : 1.18;
    homeLambda = total * ratio / (1 + ratio);
    awayLambda = total / (1 + ratio);
  }

  const recentHome = bundle.recentHome;
  const recentAway = bundle.recentAway;
  if (recentHome && recentAway) {
    const attackAdjustment = clamp((recentHome.goalsForAverage - recentAway.goalsAgainstAverage) * 0.035, -0.08, 0.08);
    const awayAdjustment = clamp((recentAway.goalsForAverage - recentHome.goalsAgainstAverage) * 0.035, -0.08, 0.08);
    homeLambda *= 1 + attackAdjustment;
    awayLambda *= 1 + awayAdjustment;
    const restDifference = clamp((recentHome.restDays - recentAway.restDays) * 0.012, -0.04, 0.04);
    homeLambda *= 1 + restDifference;
    awayLambda *= 1 - restDifference;
  }

  if (neutral) {
    homeLambda *= 0.96;
    awayLambda *= 1.03;
  }
  return { home: round(clamp(homeLambda, 0.25, 3.8), 3), away: round(clamp(awayLambda, 0.25, 3.8), 3) };
}

function formModel(bundle, neutral) {
  if (!bundle.recentHome || !bundle.recentAway) return null;
  const home = bundle.recentHome;
  const away = bundle.recentAway;
  const difference = (home.ppg - away.ppg) * 0.62
    + (home.goalDifferenceAverage - away.goalDifferenceAverage) * 0.22
    + (neutral ? 0 : 0.16);
  const draw = clamp(0.29 - Math.abs(difference) * 0.035, 0.2, 0.31);
  const homeShare = 1 / (1 + Math.exp(-difference));
  return { home: (1 - draw) * homeShare, draw, away: (1 - draw) * (1 - homeShare) };
}

function h2hModel(bundle) {
  const h2h = bundle.h2h;
  if (!h2h || h2h.matches < 3) return null;
  const smoothed = normalizeProbabilities([h2h.home + 2.5, h2h.draw + 2.5, h2h.away + 2.5]);
  const bounded = normalizeProbabilities(smoothed.map((value) => clamp(value, 0.2, 0.55)));
  return { home: bounded[0], draw: bounded[1], away: bounded[2] };
}

function marketModel(bundle, method) {
  if (!bundle.odds?.values) return { probabilities: null, devig: null };
  const result = devig(['1', 'X', '2'].map((key) => ({ key, odd: bundle.odds.values[key] })), method);
  if (!result) return { probabilities: null, devig: null };
  const p = result.probabilities;
  return { probabilities: { home: p['1'], draw: p.X, away: p['2'] }, devig: { method: result.method, fallback: result.fallback, z: result.z } };
}

function providerModel(bundle) {
  if (!bundle.prediction) return null;
  const [home, draw, away] = normalizeProbabilities([bundle.prediction.home, bundle.prediction.draw, bundle.prediction.away]);
  return { home, draw, away };
}

function sourceConsensus(sources) {
  const active = sources.filter((source) => source.probabilities);
  if (active.length < 2) return 0.62;
  const dispersion = mean(['home', 'draw', 'away'].map((key) => standardDeviation(active.map((source) => source.probabilities[key]))));
  return clamp(1 - dispersion * 4.5, 0.35, 0.98);
}

function scenarioMarkets(lambdaHome, lambdaAway, finalOutcomes) {
  const scenarios = [
    { name: 'Base', direction: 'Centrale', home: lambdaHome, away: lambdaAway },
    { name: 'Scenario favorevole casa', direction: 'Casa', home: lambdaHome * 1.12, away: lambdaAway * 0.92 },
    { name: 'Scenario favorevole trasferta', direction: 'Trasferta', home: lambdaHome * 0.9, away: lambdaAway * 1.12 }
  ];
  return scenarios.map((scenario, index) => {
    const raw = scoreMatrix(scenario.home, scenario.away);
    const outcomes = index === 0 ? finalOutcomes : outcomesFromMatrix(raw);
    const markets = marketsFromMatrix(index === 0 ? calibrateMatrixToOutcomes(raw, finalOutcomes) : raw);
    return {
      name: scenario.name, direction: scenario.direction,
      xg: { home: round(scenario.home, 2), away: round(scenario.away, 2) },
      probabilities: { home: round(outcomes.home, 4), draw: round(outcomes.draw, 4), away: round(outcomes.away, 4) },
      markets: { goal: markets.GOAL, over25: markets.OVER_2_5 }
    };
  });
}

function buildTimeline(lambdaHome, lambdaAway) {
  const firstHalf = outcomesFromMatrix(scoreMatrix(lambdaHome / 2, lambdaAway / 2));
  const totalRate = lambdaHome + lambdaAway;
  const intervalGoal = 1 - Math.exp(-totalRate / 6);
  const firstHalfLeader = firstHalf.home >= firstHalf.away && firstHalf.home >= firstHalf.draw
    ? 'home'
    : firstHalf.away >= firstHalf.draw ? 'away' : 'draw';
  return {
    model: 'homogeneous_rate_baseline',
    first15Goal: round(intervalGoal, 6),
    halfTimeDraw: round(firstHalf.draw, 6),
    halfTimeLeader: firstHalfLeader,
    halfTimeOutcomes: {
      home: round(firstHalf.home, 6), draw: round(firstHalf.draw, 6), away: round(firstHalf.away, 6)
    },
    after75Goal: round(intervalGoal, 6),
    comebackProbability: null,
    caveat: 'Baseline a intensita omogenea: sostituzioni, stato del punteggio e cali fisici richiedono dati evento dedicati.'
  };
}

function competitionFormat(bundle) {
  const rules = bundle.competitionRules || null;
  const round = bundle.fixture?.league?.round || '';
  const inferredKnockout = /final|semi|quarter|round of|ottavi|quarti|sedicesimi/i.test(round);
  const knockout = rules?.knockout ?? inferredKnockout;
  const legs = Number(rules?.legs) || null;
  const rulesConfirmed = Boolean(rules?.confirmed);
  return {
    knockout,
    legs,
    rulesConfirmed,
    extraTime: rules?.extraTime ?? null,
    penalties: rules?.penalties ?? null,
    source: rules?.source || (inferredKnockout ? 'round_name_inference' : 'competition_default')
  };
}

function buildProgression(bundle, lambdas, regulationOutcomes) {
  const format = competitionFormat(bundle);
  if (!format.knockout) return { applicable: false, format, reason: 'not_knockout' };
  if (!format.rulesConfirmed) return { applicable: false, format, reason: 'competition_rules_unconfirmed' };
  if (format.legs !== 1) return { applicable: false, format, reason: 'aggregate_score_required' };
  const extraTimeProbability = format.extraTime ? regulationOutcomes.draw : 0;
  const extraTimeOutcomes = outcomesFromMatrix(scoreMatrix(lambdas.home / 3, lambdas.away / 3, 8, -0.03));
  const penaltiesProbability = format.penalties
    ? regulationOutcomes.draw * (format.extraTime ? extraTimeOutcomes.draw : 1)
    : 0;
  const homeQualification = regulationOutcomes.home + regulationOutcomes.draw * (
    format.extraTime ? extraTimeOutcomes.home + extraTimeOutcomes.draw * 0.5 : 0.5
  );
  const awayQualification = regulationOutcomes.away + regulationOutcomes.draw * (
    format.extraTime ? extraTimeOutcomes.away + extraTimeOutcomes.draw * 0.5 : 0.5
  );
  const total = homeQualification + awayQualification;
  return {
    applicable: true,
    format,
    extraTime: round(extraTimeProbability, 6),
    penalties: round(penaltiesProbability, 6),
    qualification: {
      home: round(homeQualification / total, 6),
      away: round(awayQualification / total, 6)
    },
    extraTimeOutcomes: {
      home: round(extraTimeOutcomes.home, 6), draw: round(extraTimeOutcomes.draw, 6), away: round(extraTimeOutcomes.away, 6)
    },
    penaltySplitAssumption: '50/50 in assenza di un modello portieri/rigoristi validato.'
  };
}

function uncertaintyReport(outcomes) {
  const values = [outcomes.home, outcomes.draw, outcomes.away];
  const entropy = -values.reduce((sum, value) => sum + (value > 0 ? value * Math.log(value) : 0), 0) / Math.log(3);
  const favoriteWin = Math.max(outcomes.home, outcomes.away);
  return {
    normalizedEntropy: round(entropy, 6),
    favoriteNonWinRisk: round(1 - favoriteWin, 6),
    level: entropy >= 0.94 ? 'Alta' : entropy >= 0.82 ? 'Media' : 'Bassa'
  };
}

function decisiveFactors(bundle, lambdas, sources, neutral) {
  const factors = [];
  const formDiff = (bundle.recentHome?.ppg ?? 1.5) - (bundle.recentAway?.ppg ?? 1.5);
  factors.push({ name: 'Forma recente', direction: formDiff > 0.12 ? bundle.fixture.home.name : formDiff < -0.12 ? bundle.fixture.away.name : 'Neutrale', intensity: Math.abs(formDiff) > 0.6 ? 'Alta' : 'Media', certainty: bundle.recentHome ? 'Medio-alta' : 'Bassa' });
  factors.push({ name: 'Produzione offensiva attesa', direction: lambdas.home > lambdas.away ? bundle.fixture.home.name : bundle.fixture.away.name, intensity: Math.abs(lambdas.home - lambdas.away) > 0.45 ? 'Alta' : 'Media', certainty: bundle.homeStats ? 'Media' : 'Bassa' });
  const injuryDiff = (bundle.injuries?.home?.length || 0) - (bundle.injuries?.away?.length || 0);
  factors.push({ name: 'Indisponibilità note', direction: injuryDiff > 0 ? bundle.fixture.away.name : injuryDiff < 0 ? bundle.fixture.home.name : 'Neutrale', intensity: Math.abs(injuryDiff) >= 2 ? 'Alta' : 'Bassa', certainty: 'Media-bassa' });
  factors.push({ name: neutral ? 'Campo neutro' : 'Fattore campo', direction: neutral ? 'Neutrale' : bundle.fixture.home.name, intensity: neutral ? 'Bassa' : 'Media', certainty: 'Alta' });
  factors.push({ name: 'Consenso dei modelli', direction: sources.every((source) => !source.probabilities) ? 'Non disponibile' : 'Controllo incrociato', intensity: 'Media', certainty: 'Media' });
  return factors;
}

function marketMovementNote(odds) {
  if (!odds?.opening) return 'Disponibile un solo snapshot; nessuna serie storica dello stesso operatore.';
  const moves = ['1', 'X', '2'].filter((key) => odds.opening[key] && odds.values?.[key])
    .map((key) => `${key} ${odds.opening[key].toFixed(2)}→${odds.values[key].toFixed(2)}`);
  return `Apertura→attuale (${odds.bookmaker}): ${moves.join(' · ')}. Solo informativo, non entra nelle probabilità.`;
}

function workflowAgents(bundle, quality, neutral, ai = null) {
  const aiById = Object.fromEntries((ai?.agents || []).map((agent) => [agent.agentId, agent]));
  const aiState = (id, missingNote) => {
    const agent = aiById[id];
    if (!agent) return [false, missingNote];
    const active = agent.status === 'completed' || agent.status === 'insufficient_data';
    const label = {
      completed: 'Completato',
      insufficient_data: 'Dati insufficienti per questa partita',
      skipped: 'AI non attiva: inserisci una chiave nelle Impostazioni',
      error: 'Errore'
    }[agent.status] || agent.status;
    return [active, `${label}${agent.cacheHit ? ' · cache' : ''}${agent.errorCode ? ` · ${agent.errorCode}` : ''}`];
  };
  const [tacticalActive, tacticalNote] = aiState('tactical_context', 'AI non eseguita o dati tattici insufficienti.');
  const [newsActive, newsNote] = aiState('news_intelligence', 'Nessun feed editoriale verificabile configurato.');
  const [competitionActive, competitionNote] = aiState('competition_context', 'Regolamento strutturato non disponibile.');
  const [challengeActive, challengeNote] = aiState('challenge_bias', 'Fallback challenge deterministico.');
  const [explanationActive, explanationNote] = aiState('final_explanation', 'Spiegazione deterministica.');
  return [
    ['Chief Prediction Orchestrator', true, 'Coordina sequenza, completezza e pubblicazione.'],
    ['Data Acquisition', true, 'Fixture, statistiche, quote e disponibilità dal provider configurato.'],
    ['Data Quality', true, `Qualità rilevata ${quality.score}/100; dati mancanti separati dalle inferenze.`],
    ['Entity Resolution', true, 'Identificativi univoci di squadre, competizione e fixture.'],
    ['Feature Engineering', true, 'Forma, medie goal, riposo, assenze e fattore campo.'],
    ['Squad Strength', Boolean(bundle.homeStats && bundle.awayStats), 'Forza stagionale regredita verso la media.'],
    ['Lineups & Tactical AI', tacticalActive, tacticalNote, null],
    ['Recent Form', Boolean(bundle.recentHome && bundle.recentAway), 'Ultime dieci gare e giorni di recupero.'],
    ['Home & Away', !neutral, neutral ? 'Disattivato: campo neutro selezionato.' : 'Medie specifiche casa/trasferta.'],
    ['Weather & Pitch', Boolean(bundle.weather), bundle.weather ? `${weatherSummary(bundle.weather)} · ${bundle.weather.city} · solo informativo` : 'Previsione meteo non disponibile.', 'weather'],
    ['Referee', Boolean(bundle.fixture.referee), bundle.fixture.referee || 'Designazione non disponibile.', 'referee'],
    ['Competition Context AI', competitionActive, competitionNote],
    ['Historical Matchup', Boolean(bundle.h2h), 'Peso massimo limitato al 7%.'],
    ['Poisson / Dixon-Coles', true, 'Distribuzione completa dei risultati esatti.'],
    ['Monte Carlo', true, 'Incertezza su ritmo e produzione offensiva.'],
    ['Market Odds', Boolean(bundle.odds), bundle.odds?.bookmaker || 'Quote non disponibili.', 'odds'],
    ['Market Movement', Boolean(bundle.odds?.opening), marketMovementNote(bundle.odds)],
    ['News Intelligence AI', newsActive, newsNote],
    ['Model Ensemble', true, 'Pesi rinormalizzati sui soli modelli disponibili.'],
    ['Calibration & Consensus', true, 'Coerenza strutturale 1X2 e penalizzazione della dispersione; calibrazione empirica richiede storico persistente.'],
    ['Challenge & Bias Detection AI', challengeActive, challengeNote],
    ['Final Explanation AI', explanationActive, explanationNote],
    ['Robustness', true, 'Scenari casa, base e trasferta.'],
    ['Audit', true, 'Timestamp, fonti, pesi, esclusioni e limitazioni pubblicati.']
  ].map(([name, active, note, sourceKey = null]) => {
    const sourceError = sourceKey ? bundle.sourceStatus?.[sourceKey]?.error : null;
    const status = active ? 'active' : sourceError ? 'unavailable_source' : 'inactive';
    return { name, active, status, note: status === 'unavailable_source' ? sourceError : note };
  });
}

export function analyzeMatch(bundle, options, config) {
  const generatedAt = new Date().toISOString();
  const neutral = Boolean(options?.neutral);
  const quality = dataQuality(bundle);
  const baseLambdas = inferLambdas(bundle, neutral);
  const requestedAdjustment = options?.lambdaAdjustment || {};
  const lambdas = {
    home: round(clamp(baseLambdas.home + (Number(requestedAdjustment.home) || 0), 0.25, 3.8), 3),
    away: round(clamp(baseLambdas.away + (Number(requestedAdjustment.away) || 0), 0.25, 3.8), 3)
  };
  const poissonMatrix = scoreMatrix(lambdas.home, lambdas.away);
  const poisson = outcomesFromMatrix(poissonMatrix);
  const monteCarlo = runMonteCarlo({ fixtureId: bundle.fixture.id, homeLambda: lambdas.home, awayLambda: lambdas.away, runs: config.monteCarloRuns });
  const market = marketModel(bundle, config.devigMethod);
  const sources = enforceSourceWeightCaps([
    { id: 'poisson', agent: 'Poisson/Dixon-Coles', weight: 25, probabilities: poisson },
    { id: 'montecarlo', agent: 'Monte Carlo', weight: 15, probabilities: monteCarlo.probabilities },
    { id: 'market', agent: 'Market Odds', weight: 25, probabilities: market.probabilities },
    { id: 'form', agent: 'Recent Form', weight: 18, probabilities: formModel(bundle, neutral) },
    { id: 'provider', agent: 'External Prediction', weight: 10, probabilities: providerModel(bundle) },
    { id: 'h2h', agent: 'Historical Matchup', weight: 7, probabilities: h2hModel(bundle) }
  ]);
  const finalOutcomes = blendOutcomes(sources);
  const calibratedMatrix = calibrateMatrixToOutcomes(poissonMatrix, finalOutcomes);
  const markets = marketsFromMatrix(calibratedMatrix);
  const consensus = sourceConsensus(sources);
  const robustness = clamp(0.8 - Math.abs(lambdas.home - lambdas.away) * 0.06, 0.58, 0.86);
  let confidence = quality.score * 0.45 + consensus * 100 * 0.3 + robustness * 100 * 0.15 + 10;
  if (!bundle.lineups?.confirmed) confidence -= 7;
  if (!bundle.fixture.referee) confidence -= 2;
  confidence -= clamp(Number(options?.confidencePenalty) || 0, 0, 25);
  if (config.demoMode) confidence = Math.min(confidence, 72);
  confidence = Math.round(clamp(confidence, 25, 88));
  const recommendation = buildRecommendation(markets, bundle.odds, confidence, config.devigMethod);
  const scenarios = scenarioMarkets(lambdas.home, lambdas.away, finalOutcomes);
  const progression = buildProgression(bundle, lambdas, finalOutcomes);
  const timeline = buildTimeline(lambdas.home, lambdas.away);
  const uncertainty = uncertaintyReport(finalOutcomes);
  const activeSources = sources.filter((source) => source.probabilities);
  const activeWeight = activeSources.reduce((sum, source) => sum + source.weight, 0);
  const sourceKeyByModel = { market: 'odds', provider: 'prediction', h2h: 'h2h', form: 'recentHome' };
  const agents = sources.map((source) => ({
    id: source.id, name: source.agent, active: Boolean(source.probabilities),
    unavailableReason: source.probabilities ? null : (bundle.sourceStatus?.[sourceKeyByModel[source.id]]?.error || null),
    effectiveWeight: source.probabilities ? round(source.weight / activeWeight, 4) : 0,
    probabilities: source.probabilities ? Object.fromEntries(Object.entries(source.probabilities).map(([key, value]) => [key, round(value, 4)])) : null
  }));
  const modelLeans = activeSources.map((source) => {
    const entries = Object.entries(source.probabilities);
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  });
  const disagreements = [...new Set(modelLeans)].length > 1
    ? ['I modelli non concordano tutti sull’esito principale: la confidenza è stata ridotta.']
    : ['I modelli concordano sull’esito principale, ma la dispersione resta incorporata negli intervalli.'];
  const riskFlags = [
    ...quality.missing.map((item) => `Dato mancante: ${item}.`),
    ...(bundle.injuries?.home?.length || bundle.injuries?.away?.length ? ['Le indisponibilità sono conteggiate con impatto prudenziale: il provider non misura automaticamente la centralità tattica.'] : []),
    ...(!bundle.lineups?.confirmed ? ['Formazioni non ufficiali: aggiornare l’analisi vicino al calcio d’inizio.'] : []),
    ...(!bundle.fixture.referee ? ['Arbitro non disponibile: mercati disciplinari a bassa affidabilità.'] : []),
    ...bundle.sourceErrors
  ];
  const challenge = [
    'Campioni recenti ridotti e possibile recency bias.',
    'Le quote sono un benchmark, non il risultato del modello.',
    'Gli scontri diretti ricevono un peso massimo limitato al 7%.',
    'Un gol, un rigore o un’espulsione precoce possono invalidare rapidamente lo scenario base.'
  ];
  return {
    generatedAt,
    fixture: bundle.fixture,
    mode: config.demoMode ? 'demo' : 'live',
    options: { neutral },
    summary: {
      favorite: finalOutcomes.home >= finalOutcomes.away ? bundle.fixture.home.name : bundle.fixture.away.name,
      outcomes: finalOutcomes,
      xg: lambdas,
      confidence,
      confidenceLabel: confidence >= 75 ? 'Alta' : confidence >= 55 ? 'Media' : 'Bassa',
      uncertainty,
      exactScore: exactScores(calibratedMatrix, 1)[0],
      recommendation: {
        key: recommendation.key,
        label: recommendation.label,
        probability: recommendation.probability,
        interval: recommendation.interval,
        hasValue: recommendation.hasValue,
        status: recommendation.status,
        edge: recommendation.edge,
        expectedValue: recommendation.expectedValue,
        action: recommendation.hasValue ? 'consider' : 'observe'
      }
    },
    markets: recommendation.candidates,
    exactScores: exactScores(calibratedMatrix, 10),
    scoreGrid: scoreGridFromMatrix(calibratedMatrix),
    simulation: monteCarlo,
    progression,
    timeline,
    scenarios,
    factors: decisiveFactors(bundle, lambdas, sources, neutral),
    agents,
    workflow: workflowAgents(bundle, quality, neutral, options?.ai),
    governance: {
      dataQuality: quality,
      consensus: round(consensus, 4), robustness: round(robustness, 4),
      disagreements, challenge, riskFlags,
      bookmaker: bundle.odds?.bookmaker || null,
      oddsMovement: oddsMovementFromOdds(bundle.odds),
      oddsUpdatedAt: bundle.odds?.updatedAt || null,
      devig: { requested: config.devigMethod, oneXtwo: market.devig, fallbacks: recommendation.devigFallbacks },
      calibration: {
        type: 'structural_matrix_to_ensemble',
        empiricallyBacktested: false,
        note: 'La matrice score e coerente con l’ensemble 1X2; non e applicata una curva empirica per competizione senza uno storico validato.'
      },
      mathVersion: '2.3.0',
      lambdaBaseline: baseLambdas,
      lambdaAdjustmentApplied: { home: round(lambdas.home - baseLambdas.home, 3), away: round(lambdas.away - baseLambdas.away, 3) },
      disclaimer: 'Previsione probabilistica, non garanzia di risultato o profitto. Solo per maggiorenni; gioca responsabilmente.'
    },
    context: {
      injuries: bundle.injuries,
      lineupsConfirmed: Boolean(bundle.lineups?.confirmed),
      providerAdvice: bundle.prediction?.advice || null,
      referee: bundle.fixture.referee || null,
      sourceStatus: bundle.sourceStatus || null,
      form: { home: formFromRecent(bundle.recentHome), away: formFromRecent(bundle.recentAway) },
      standings: bundle.standingsContext || { home: null, away: null },
      weather: bundle.weather || null
    }
  };
}
