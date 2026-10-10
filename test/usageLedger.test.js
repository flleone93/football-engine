import test from 'node:test';
import assert from 'node:assert/strict';
import { AiUsageLedger } from '../src/ai/usageLedger.js';

const ledgerConfig = {
  dailyCallLimit: 1,
  dailyTokenLimit: 10000,
  dailyCostLimitUsd: 10,
  inputCostPerMillion: 10,
  cachedInputCostPerMillion: 1,
  outputCostPerMillion: 20
};

test('il ledger riserva il budget prima delle chiamate concorrenti', () => {
  const ledger = new AiUsageLedger(ledgerConfig);
  const first = ledger.beginCall('agent_a', 1000);
  const second = ledger.beginCall('agent_b', 1000);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'daily_call_limit');
});

test('i token cached non vengono conteggiati due volte nel costo', () => {
  const ledger = new AiUsageLedger(ledgerConfig);
  const reservation = ledger.beginCall('agent_a', 2000);
  ledger.recordUsage('agent_a', { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 }, reservation.reservationId);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.pendingTokens, 0);
  assert.equal(snapshot.pendingEstimatedCostUsd, 0);
  assert.equal(snapshot.totals.estimatedCostUsd, 0.0084);
});

test('il costo stimato viene riservato prima delle chiamate concorrenti', () => {
  const ledger = new AiUsageLedger({
    ...ledgerConfig,
    dailyCallLimit: 10,
    dailyTokenLimit: 1_000_000,
    dailyCostLimitUsd: 0.005
  });
  const first = ledger.beginCall('agent_a', { inputTokens: 400, outputTokens: 20 });
  const second = ledger.beginCall('agent_b', { inputTokens: 100, outputTokens: 10 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'daily_cost_limit');
  assert.equal(ledger.snapshot().pendingEstimatedCostUsd, 0.0044);
});
