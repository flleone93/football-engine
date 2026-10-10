import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { AGENT_SPECS } from '../src/ai/schemas.js';
import { AnthropicStructuredClient, createStructuredAiClient, toClaudeSchema } from '../src/ai/structuredClient.js';
import { AiUsageLedger } from '../src/ai/usageLedger.js';
import { buildConfig, validateConfigObject } from '../src/configCore.js';
import { runHybridAnalysis } from '../src/hybridEngine.js';
import { DemoProvider } from '../src/providers/demo.js';

function anthropicConfig(extra = {}) {
  return buildConfig({ DEMO_MODE: 'true', AI_MODE: 'active', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', ...extra });
}

// Oggetto minimo conforme a uno schema agente (stessa logica del test provider Claude Artifact).
function fromSchema(schema, key = '') {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return key === 'status' && schema.enum.includes('completed') ? 'completed' : schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') : schema.type;
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([name, child]) => [name, fromSchema(child, name)]));
  if (type === 'array') return [];
  if (type === 'number' || type === 'integer') return schema.minimum ?? 0;
  if (type === 'boolean') return false;
  return `Valutazione ${key || 'testo'}`;
}

function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = original; });
}

const okResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

test('configurazione anthropic: chiave, endpoint, modello predefinito Claude Opus 5.5', () => {
  const config = anthropicConfig();
  assert.equal(config.ai.provider, 'anthropic');
  assert.equal(config.ai.apiKey, 'sk-ant-test');
  assert.equal(config.ai.baseUrl, 'https://api.anthropic.com/v1');
  assert.deepEqual([config.ai.modelDefault, config.ai.modelChallenge, config.ai.modelExplanation], ['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5']);
  assert.doesNotThrow(() => validateConfigObject(config));
  assert.throws(() => validateConfigObject(anthropicConfig({ AI_MODEL_DEFAULT: 'gpt-5.6-luna' })), /claude-\*/);
  assert.ok(createStructuredAiClient(config.ai, new AiUsageLedger(config.ai)) instanceof AnthropicStructuredClient);
  assert.equal(new HybridAiOrchestrator(anthropicConfig({ ANTHROPIC_API_KEY: '' })).effectiveMode(), 'off_missing_key');
  assert.equal(new HybridAiOrchestrator(config).effectiveMode(), 'active');
});

test('schema Claude: rimossi i vincoli non supportati, oggetti chiusi, nomi dei campi intatti', () => {
  const converted = toClaudeSchema(AGENT_SPECS.tactical_context.schema);
  const text = JSON.stringify(converted);
  for (const keyword of ['"minimum"', '"maximum"', '"maxLength"', '"maxItems"', '"minItems"']) assert.ok(!text.includes(keyword), keyword);
  assert.equal(converted.additionalProperties, false);
  assert.deepEqual(converted.required, AGENT_SPECS.tactical_context.schema.required);
  assert.equal(converted.properties.effects.items.additionalProperties, false);
  // Un campo che si chiama come una keyword non viene rimosso.
  assert.deepEqual(toClaudeSchema({ type: 'object', properties: { maximum: { type: 'number', maximum: 3 } } }).properties, { maximum: { type: 'number' } });
});

test('richiesta Anthropic: endpoint, intestazioni browser, output strutturato, effort, fallback', async () => {
  const config = anthropicConfig();
  const client = createStructuredAiClient(config.ai, new AiUsageLedger(config.ai));
  let captured;
  const result = await withFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return okResponse({
      id: 'msg_1', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0 }
    });
  }, () => client.json({ agentId: 'tactical_context', model: 'claude-opus-5-5', schemaName: 'x', schema: AGENT_SPECS.tactical_context.schema, system: 'Sei un agente.', user: '{"data":1}' }));
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(captured.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(captured.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(captured.body.model, 'claude-opus-5-5');
  assert.equal(captured.body.system, 'Sei un agente.');
  assert.deepEqual(captured.body.messages, [{ role: 'user', content: '{"data":1}' }]);
  assert.equal(captured.body.output_config.format.type, 'json_schema');
  assert.equal(captured.body.output_config.effort, 'low');
  assert.equal(captured.body.fallbacks, 'default');
  assert.equal(captured.body.max_tokens, 16000);
  assert.equal('thinking' in captured.body, false, 'thinking omesso: su Opus 5.5 è adattivo di default');
  assert.equal('temperature' in captured.body, false);
  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.usage.inputTokens, 1200);
  assert.equal(result.usage.outputTokens, 300);
});

test('risposte Anthropic anomale: errore HTTP, rifiuto e troncamento diventano errori tracciati', async () => {
  const config = anthropicConfig();
  const client = createStructuredAiClient(config.ai, new AiUsageLedger(config.ai));
  const call = () => client.json({ agentId: 'tactical_context', model: 'claude-opus-5-5', schemaName: 'x', schema: { type: 'object', properties: {} }, system: 's', user: 'u' });
  await withFetch(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 }),
    () => assert.rejects(call, { code: 'anthropic_401', message: 'invalid x-api-key' }));
  await withFetch(async () => okResponse({ stop_reason: 'refusal', content: [] }), () => assert.rejects(call, { code: 'anthropic_refusal' }));
  await withFetch(async () => okResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }] }), () => assert.rejects(call, { code: 'anthropic_max_tokens' }));
});

test('pipeline completa con Claude: i sei agenti completano e passano la validazione backend', async () => {
  const config = anthropicConfig();
  const orchestrator = new HybridAiOrchestrator(config);
  const calls = [];
  const analysis = await withFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    const agentId = Object.keys(AGENT_SPECS).find((id) => body.system.startsWith(`Sei ${AGENT_SPECS[id].label}.`)) || 'final_explanation';
    calls.push(agentId);
    const output = { ...fromSchema(body.output_config.format.schema), agentId };
    return okResponse({ id: `msg_${calls.length}`, model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }], usage: { input_tokens: 900, output_tokens: 150 } });
  }, async () => {
    const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
    return runHybridAnalysis({ bundle, options: { neutral: true }, config, aiOrchestrator: orchestrator, useAi: true });
  });
  const trace = analysis.layers.qualitativeAssessments;
  assert.equal(trace.provider, 'anthropic');
  assert.ok(calls.length >= 3, `chiamate: ${calls.join(', ')}`);
  const ran = trace.agents.filter((agent) => agent.status !== 'insufficient_data');
  assert.ok(ran.length >= 2);
  assert.ok(ran.every((agent) => agent.status === 'completed' && agent.provider === 'anthropic'), JSON.stringify(trace.agents.map((agent) => [agent.agentId, agent.status, agent.errorCode])));
  assert.equal(trace.challenge?.status, 'completed');
  assert.equal(trace.explanation?.provider, 'anthropic');
  const usage = orchestrator.usageSnapshot();
  assert.equal(usage.totals.calls, calls.length);
  assert.ok(usage.totals.estimatedCostUsd >= 0);
});
