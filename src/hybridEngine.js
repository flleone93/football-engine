import { applyAiAdjustmentPolicy } from './ai/orchestrator.js';
import { AGENT_IDS } from './ai/schemas.js';
import { buildDataVersion, publicSourceSnapshot, sha256 } from './provenance.js';
import { analyzeMatch } from './prediction/engine.js';
import { round } from './utils.js';

function probabilityShift(left, right) {
  return Math.max(
    Math.abs((left?.home || 0) - (right?.home || 0)),
    Math.abs((left?.draw || 0) - (right?.draw || 0)),
    Math.abs((left?.away || 0) - (right?.away || 0))
  );
}

function scaleAdjustment(adjustment, scale) {
  return {
    home: round((Number(adjustment.home) || 0) * scale, 3),
    away: round((Number(adjustment.away) || 0) * scale, 3)
  };
}

function guardedAiAnalysis({ bundle, baseline, requestedAdjustment, confidencePenalty, options, config }) {
  const maxShift = config.ai.maxProbabilityShiftPp / 100;
  let high = 1;
  let low = 0;
  let best = analyzeMatch(bundle, { ...options, lambdaAdjustment: requestedAdjustment, confidencePenalty }, config);
  let bestScale = 1;
  let shift = probabilityShift(baseline.summary.outcomes, best.summary.outcomes);
  if (shift <= maxShift || maxShift <= 0) {
    if (maxShift <= 0 && shift > 0) {
      best = analyzeMatch(bundle, { ...options, lambdaAdjustment: { home: 0, away: 0 }, confidencePenalty }, config);
      bestScale = 0;
      shift = 0;
    }
    return { analysis: best, probabilityShift: round(shift, 4), probabilityScale: bestScale };
  }
  for (let index = 0; index < 10; index += 1) {
    const middle = (low + high) / 2;
    const candidate = analyzeMatch(bundle, { ...options, lambdaAdjustment: scaleAdjustment(requestedAdjustment, middle), confidencePenalty }, config);
    const candidateShift = probabilityShift(baseline.summary.outcomes, candidate.summary.outcomes);
    if (candidateShift <= maxShift) {
      low = middle;
      best = candidate;
      bestScale = middle;
      shift = candidateShift;
    } else {
      high = middle;
    }
  }
  return { analysis: best, probabilityShift: round(shift, 4), probabilityScale: round(bestScale, 4) };
}

function collectUnconfirmed(aiTrace) {
  const claims = [];
  for (const agent of aiTrace?.agents || []) {
    for (const claim of agent.unsupportedClaims || []) claims.push({ agentId: agent.agentId, claim });
  }
  if (aiTrace?.explanation?.unsupportedClaims) {
    for (const claim of aiTrace.explanation.unsupportedClaims) claims.push({ agentId: 'final_explanation', claim });
  }
  return claims.slice(0, 30);
}

function attachLayers({ bundle, baseline, finalAnalysis, aiTrace, dataVersion, mode, cacheHit }) {
  const realData = publicSourceSnapshot(bundle);
  const statisticalBaseline = {
    generatedAt: baseline.generatedAt,
    summary: baseline.summary,
    markets: baseline.markets,
    exactScores: baseline.exactScores,
    agents: baseline.agents,
    governance: baseline.governance
  };
  const recommendation = {
    label: finalAnalysis.summary.recommendation.label,
    probability: finalAnalysis.summary.recommendation.probability,
    interval: finalAnalysis.summary.recommendation.interval,
    exactScore: finalAnalysis.summary.exactScore,
    xg: finalAnalysis.summary.xg,
    confidence: finalAnalysis.summary.confidence,
    confidenceLabel: finalAnalysis.summary.confidenceLabel
  };
  return {
    ...finalAnalysis,
    cached: Boolean(cacheHit),
    dataVersion,
    analysisMode: mode,
    layers: {
      realData,
      statisticalBaseline,
      qualitativeAssessments: aiTrace,
      unconfirmedInferences: collectUnconfirmed(aiTrace),
      finalRecommendation: recommendation
    }
  };
}

export async function runHybridAnalysis({ bundle, options = {}, config, aiOrchestrator, useAi = true, cacheHit = false }) {
  const dataVersion = buildDataVersion(bundle);
  const baseline = analyzeMatch(bundle, { ...options, ai: null }, config);
  const aiMode = aiOrchestrator?.effectiveMode?.() || 'off';
  const shouldUseAi = Boolean(useAi) && !String(aiMode).startsWith('off');
  if (!shouldUseAi) {
    const agents = AGENT_IDS.filter((id) => id !== 'final_explanation').map((agentId) => ({
      agentId,
      status: 'skipped',
      summary: 'AI disattivata, non richiesta o chiave API mancante.',
      confidence: 0,
      evidence: [],
      effects: [],
      unsupportedClaims: [],
      riskFlags: [],
      needsRefresh: false,
      cacheHit: false,
      errorCode: null
    }));
    const explanation = await aiOrchestrator?.runExplanation?.(bundle, baseline, { mode: aiMode, agents: [] }, dataVersion);
    const aiTrace = {
      mode: aiMode,
      provider: config.ai.provider,
      models: {
        default: config.ai.modelDefault,
        challenge: config.ai.modelChallenge,
        explanation: config.ai.modelExplanation
      },
      applied: false,
      agents: [...agents, {
        agentId: 'final_explanation',
        status: explanation?.status || 'skipped',
        summary: explanation?.executiveSummary || 'Spiegazione AI non eseguita.',
        confidence: 0,
        evidence: [],
        effects: [],
        unsupportedClaims: explanation?.unsupportedClaims || [],
        riskFlags: [],
        needsRefresh: false,
        cacheHit: Boolean(explanation?.cacheHit),
        errorCode: explanation?.errorCode || null
      }],
      adjustmentPolicy: { lambdaAdjustment: { home: 0, away: 0 }, confidencePenalty: 0, decisions: [] },
      challenge: null,
      explanation,
      audit: { reason: 'ai_disabled_or_not_requested' }
    };
    const analysis = analyzeMatch(bundle, { ...options, ai: aiTrace }, config);
    return attachLayers({ bundle, baseline, finalAnalysis: analysis, aiTrace, dataVersion, mode: aiMode, cacheHit });
  }

  const runBudget = { remaining: config.ai.maxCallsPerAnalysis };
  const qualitative = await aiOrchestrator.runQualitative(bundle, baseline, dataVersion, runBudget);
  const policy = applyAiAdjustmentPolicy(qualitative.agents, config.ai);
  const shadow = guardedAiAnalysis({
    bundle,
    baseline,
    requestedAdjustment: policy.lambdaAdjustment,
    confidencePenalty: policy.confidencePenalty,
    options,
    config
  });
  const provisional = config.ai.mode === 'active' ? shadow.analysis : baseline;
  const challenge = await aiOrchestrator.runChallenge(bundle, provisional, dataVersion, runBudget);
  const challengePolicy = applyAiAdjustmentPolicy([challenge], config.ai);
  const mergedPenalty = Math.max(policy.confidencePenalty, challengePolicy.confidencePenalty);
  const finalGuarded = config.ai.mode === 'active'
    ? guardedAiAnalysis({
      bundle,
      baseline,
      requestedAdjustment: policy.lambdaAdjustment,
      confidencePenalty: mergedPenalty,
      options,
      config
    })
    : { analysis: baseline, probabilityShift: 0, probabilityScale: 0 };
  const explanation = await aiOrchestrator.runExplanation(bundle, finalGuarded.analysis, {
    ...qualitative,
    adjustmentPolicy: policy,
    challenge,
    mode: aiMode
  }, dataVersion, runBudget);
  const aiTrace = {
    mode: aiMode,
    provider: config.ai.provider,
    models: {
      default: config.ai.modelDefault,
      challenge: config.ai.modelChallenge,
      explanation: config.ai.modelExplanation
    },
    applied: config.ai.mode === 'active',
    agents: qualitative.agents,
    adjustmentPolicy: {
      ...policy,
      probabilityGuardScale: finalGuarded.probabilityScale,
      probabilityShift: finalGuarded.probabilityShift,
      maxProbabilityShift: round(config.ai.maxProbabilityShiftPp / 100, 4),
      finalLambdaAdjustment: finalGuarded.analysis.governance.lambdaAdjustmentApplied
    },
    challenge,
    challengePolicy,
    explanation,
    audit: {
      evidencePackHash: qualitative.evidencePackHash,
      traceHash: sha256({ qualitative, policy, challenge, explanation }),
      modeNote: config.ai.mode === 'shadow' ? 'Gli agenti AI sono stati eseguiti in shadow: nessun numero finale modificato.' : 'Gli aggiustamenti AI accettati sono stati applicati dal backend entro i limiti configurati.'
    }
  };
  const finalAnalysis = analyzeMatch(
    bundle,
    {
      ...options,
      lambdaAdjustment: config.ai.mode === 'active' ? finalGuarded.analysis.governance.lambdaAdjustmentApplied : { home: 0, away: 0 },
      confidencePenalty: config.ai.mode === 'active' ? mergedPenalty : 0,
      ai: aiTrace
    },
    config
  );
  return attachLayers({ bundle, baseline, finalAnalysis, aiTrace, dataVersion, mode: aiMode, cacheHit });
}
