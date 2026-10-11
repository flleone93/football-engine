// Banco di prova: probabilità di ogni fonte sulle partite ricostruite, stima dei pesi e regole fissate nella spec.
import { analyzeMatch, mixOutcomes } from '../prediction/engine.js';
import { eloOutcomes } from '../prediction/elo.js';
import { brierScore, logLoss, outcomeFromGoals, rankedProbabilityScore } from '../tracking/metrics.js';

const KEYS = ['home', 'draw', 'away'];
const SIGN = { home: '1', draw: 'X', away: '2' };

export function collectRows(rows, config) {
  return rows.map(({ match, bundle }) => {
    const analysis = analyzeMatch(bundle, { neutral: match.neutral, weights: { poisson: 1 } }, config);
    const sources = Object.fromEntries(analysis.agents.filter((agent) => agent.id !== 'elo').map((agent) => [agent.id, agent.probabilities]));
    return {
      seasonYear: match.seasonYear,
      outcome: outcomeFromGoals({ home: match.homeGoals, away: match.awayGoals }),
      odds: match.odds,
      sources,
      market: sources.market || null,
      eloExpected: analysis.context.elo?.expectedHome ?? null
    };
  });
}

export function withEloSource(rows, drawBase) {
  return rows.map((row) => ({ ...row, sources: { ...row.sources, elo: row.eloExpected == null ? null : eloOutcomes(row.eloExpected, drawBase) } }));
}

const blended = (row, weights) => mixOutcomes(row.sources, weights);

export function scoreRows(rows, weights) {
  let n = 0; let brier = 0; let loss = 0; let rps = 0; let correct = 0;
  for (const row of rows) {
    const p = blended(row, weights);
    if (!p || !row.outcome) continue;
    n += 1;
    brier += brierScore(p, row.outcome);
    loss += logLoss(p, row.outcome);
    rps += rankedProbabilityScore(p, row.outcome);
    const top = KEYS.reduce((best, key) => (p[key] > p[best] ? key : best), 'home');
    if (top === row.outcome) correct += 1;
  }
  return n ? { n, brier: brier / n, logLoss: loss / n, rps: rps / n, accuracy: correct / n } : { n: 0, brier: null, logLoss: null, rps: null, accuracy: null };
}

/** Discesa a coordinate sul simplesso (pesi ≥ 0, somma 1), passo 0,05 dimezzato fino a 0,001, partenza uniforme. */
export function fitWeights(rows, ids) {
  let weights = Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));
  let best = scoreRows(rows, weights).logLoss;
  let step = 0.05;
  while (step >= 0.001) {
    let improved = false;
    for (const to of ids) {
      for (const from of ids) {
        if (to === from) continue;
        const move = Math.min(step, weights[from]);
        if (move <= 1e-12) continue;
        const candidate = { ...weights, [to]: weights[to] + move, [from]: weights[from] - move };
        const loss = scoreRows(rows, candidate).logLoss;
        if (loss < best - 1e-12) { weights = candidate; best = loss; improved = true; }
      }
    }
    if (!improved) step /= 2;
  }
  const rounded = Object.fromEntries(ids.map((id) => [id, Math.round(weights[id] * 10000) / 10000]));
  const total = Object.values(rounded).reduce((sum, value) => sum + value, 0);
  return { weights: Object.fromEntries(ids.map((id) => [id, rounded[id] / total])), logLoss: best };
}

export function chooseDrawBase(rows) {
  let best = { drawBase: 0.3, loss: Infinity };
  for (let index = 0; index <= 12; index += 1) {
    const drawBase = Math.round((0.22 + index * 0.01) * 100) / 100;
    const loss = scoreRows(withEloSource(rows, drawBase), { elo: 1 }).logLoss;
    if (loss != null && loss < best.loss) best = { drawBase, loss };
  }
  return best.drawBase;
}

/** Segnali "Valore" sul segno più probabile (stessa regola della 2.1.0) e ROI a quota di chiusura. */
export function valueSignals(rows, weights, edge, ev) {
  let signals = 0; let profit = 0;
  for (const row of rows) {
    const p = blended(row, weights);
    if (!p || !row.market || !row.odds || !row.outcome) continue;
    const sign = ['home', 'away', 'draw'].reduce((best, key) => (p[key] > p[best] ? key : best), 'home');
    const odd = Number(row.odds[SIGN[sign]]);
    if (!(odd > 1)) continue;
    const signEdge = p[sign] - row.market[sign];
    const signEv = p[sign] * odd - 1;
    if (signEdge >= edge && signEv >= ev) {
      signals += 1;
      profit += row.outcome === sign ? odd - 1 : -1;
    }
  }
  return { signals, roi: signals ? profit / signals : null };
}

export function chooseValueThresholds(rows, weights, current) {
  const base = valueSignals(rows, weights, current.edge, current.ev);
  if (!(base.signals >= 50 && base.roi < 0)) return { ...current, changed: false, reason: `ROI ${base.roi == null ? 'n.d.' : base.roi.toFixed(3)} su ${base.signals} segnali: soglie invariate.` };
  for (let edge = 0.03; edge <= 0.1 + 1e-9; edge += 0.01) {
    const rounded = Math.round(edge * 100) / 100;
    const result = valueSignals(rows, weights, rounded, current.ev);
    if (result.signals >= 30 && result.roi >= 0) return { edge: rounded, ev: current.ev, changed: true, reason: `ROI ${result.roi.toFixed(3)} su ${result.signals} segnali con edge ≥ ${rounded}.` };
  }
  return { edge: 0.1, ev: current.ev, changed: true, reason: 'nessuna soglia fino a 0,10 dà ROI ≥ 0 con almeno 30 segnali: edge 0,10.' };
}

export function decideElo(withElo, withoutElo) {
  return withElo.logLoss <= withoutElo.logLoss - 0.002;
}
