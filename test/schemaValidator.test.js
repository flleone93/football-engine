import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJsonSchema } from '../src/ai/schemaValidator.js';
import { assessmentSchema } from '../src/ai/schemas.js';

const valid = {
  agentId: 'tactical_context', status: 'insufficient_data', summary: 'Dati insufficienti.', confidence: 0,
  evidence: [], effects: [], unsupportedClaims: [], riskFlags: [], needsRefresh: true
};

test('validatore backend accetta un output agente conforme', () => {
  assert.equal(assertJsonSchema(valid, assessmentSchema), valid);
});

test('validatore backend respinge campi extra e valori fuori range', () => {
  assert.throws(() => assertJsonSchema({ ...valid, inventedProbability: 0.9 }, assessmentSchema), /campo non ammesso/);
  assert.throws(() => assertJsonSchema({ ...valid, confidence: 2 }, assessmentSchema), /sopra il massimo/);
});
