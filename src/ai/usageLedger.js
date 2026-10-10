import { round } from '../utils.js';

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export class AiUsageLedger {
  constructor(config) {
    this.config = config;
    this.day = todayKey();
    this.totals = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };
    this.byAgent = new Map();
    this.errors = [];
    this.pendingTokens = 0;
    this.pendingEstimatedCostUsd = 0;
    this.reservations = new Map();
    this.nextReservationId = 1;
  }

  #rollover() {
    const current = todayKey();
    if (current === this.day) return;
    this.day = current;
    this.totals = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };
    this.byAgent.clear();
    this.errors = [];
    this.pendingTokens = 0;
    this.pendingEstimatedCostUsd = 0;
    this.reservations.clear();
  }

  #estimateCost(usage = {}) {
    const input = Number(usage.inputTokens) || 0;
    const cached = Number(usage.cachedInputTokens) || 0;
    const output = Number(usage.outputTokens) || 0;
    const priceIn = this.config.inputCostPerMillion;
    const priceCached = this.config.cachedInputCostPerMillion ?? priceIn;
    const priceOut = this.config.outputCostPerMillion;
    if (priceIn == null || priceOut == null) return 0;
    const uncachedInput = Math.max(0, input - cached);
    return (uncachedInput * priceIn + cached * priceCached + output * priceOut) / 1_000_000;
  }

  beginCall(agentId, estimate = 0) {
    this.#rollover();
    const estimatedUsage = typeof estimate === 'number'
      ? { inputTokens: estimate, outputTokens: 0, cachedInputTokens: 0 }
      : estimate;
    const estimatedTokens = Math.max(0, Math.round(
      (Number(estimatedUsage?.inputTokens) || 0) + (Number(estimatedUsage?.outputTokens) || 0)
    ));
    const estimatedCostUsd = this.#estimateCost(estimatedUsage);
    if (this.totals.calls >= this.config.dailyCallLimit) return { allowed: false, reason: 'daily_call_limit' };
    if (this.totals.inputTokens + this.totals.outputTokens + this.pendingTokens + estimatedTokens > this.config.dailyTokenLimit) {
      return { allowed: false, reason: 'daily_token_limit' };
    }
    if (this.config.dailyCostLimitUsd > 0
      && this.totals.estimatedCostUsd + this.pendingEstimatedCostUsd + estimatedCostUsd > this.config.dailyCostLimitUsd) {
      return { allowed: false, reason: 'daily_cost_limit' };
    }
    const reservationId = this.nextReservationId++;
    this.reservations.set(reservationId, { tokens: estimatedTokens, estimatedCostUsd });
    this.pendingTokens += estimatedTokens;
    this.pendingEstimatedCostUsd += estimatedCostUsd;
    this.totals.calls += 1;
    const entry = this.byAgent.get(agentId) || { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };
    entry.calls += 1;
    this.byAgent.set(agentId, entry);
    return { allowed: true, reason: null, reservationId };
  }

  #releaseReservation(reservationId) {
    const reserved = this.reservations.get(reservationId) || { tokens: 0, estimatedCostUsd: 0 };
    this.reservations.delete(reservationId);
    this.pendingTokens = Math.max(0, this.pendingTokens - reserved.tokens);
    this.pendingEstimatedCostUsd = Math.max(0, this.pendingEstimatedCostUsd - reserved.estimatedCostUsd);
  }

  recordUsage(agentId, usage = {}, reservationId = null) {
    this.#rollover();
    this.#releaseReservation(reservationId);
    const inputTokens = Number(usage.inputTokens) || 0;
    const outputTokens = Number(usage.outputTokens) || 0;
    const cachedInputTokens = Number(usage.cachedInputTokens) || 0;
    const estimatedCostUsd = this.#estimateCost({ inputTokens, outputTokens, cachedInputTokens });
    const entry = this.byAgent.get(agentId) || { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 };
    entry.inputTokens += inputTokens;
    entry.outputTokens += outputTokens;
    entry.cachedInputTokens += cachedInputTokens;
    entry.estimatedCostUsd += estimatedCostUsd;
    this.byAgent.set(agentId, entry);
    this.totals.inputTokens += inputTokens;
    this.totals.outputTokens += outputTokens;
    this.totals.cachedInputTokens += cachedInputTokens;
    this.totals.estimatedCostUsd += estimatedCostUsd;
    return { ...entry, estimatedCostUsd: round(entry.estimatedCostUsd, 6) };
  }

  recordError(agentId, code, message, reservationId = null) {
    this.#rollover();
    this.#releaseReservation(reservationId);
    this.errors.push({ agentId, code, message: String(message || '').slice(0, 240), timestamp: new Date().toISOString() });
    if (this.errors.length > 200) this.errors.shift();
  }

  snapshot() {
    this.#rollover();
    return {
      day: this.day,
      totals: { ...this.totals, estimatedCostUsd: round(this.totals.estimatedCostUsd, 6) },
      pendingTokens: this.pendingTokens,
      pendingEstimatedCostUsd: round(this.pendingEstimatedCostUsd, 6),
      byAgent: Object.fromEntries([...this.byAgent.entries()].map(([agentId, value]) => [
        agentId,
        { ...value, estimatedCostUsd: round(value.estimatedCostUsd, 6) }
      ])),
      recentErrors: this.errors.slice(-20)
    };
  }
}
