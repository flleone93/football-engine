import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiStructuredClient, OpenAiStructuredClient, createStructuredAiClient, toGeminiSchema } from '../src/ai/structuredClient.js';

function ledger() {
  return {
    beginCall: () => ({ allowed: true, reservationId: 1 }),
    recordUsage: () => {},
    recordError: () => {}
  };
}

const baseConfig = {
  mode: 'active', apiKey: 'secret', maxInputChars: 10000, maxOutputTokens: 500,
  requestTimeoutMs: 1000, reasoningEffort: 'low'
};

const schema = {
  type: 'object', additionalProperties: false, required: ['agentId'],
  properties: { agentId: { type: 'string' } }
};

test('factory seleziona il provider AI configurato', () => {
  assert.ok(createStructuredAiClient({ ...baseConfig, provider: 'gemini' }, ledger()) instanceof GeminiStructuredClient);
  assert.ok(createStructuredAiClient({ ...baseConfig, provider: 'openai' }, ledger()) instanceof OpenAiStructuredClient);
});

test('Gemini usa Interactions API, chiave backend e JSON Schema', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: 'gemini-test',
      output_text: '{"agentId":"test"}',
      usage: { total_input_tokens: 12, total_output_tokens: 4, total_thought_tokens: 3, total_cached_tokens: 2 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new GeminiStructuredClient({
      ...baseConfig, provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
    }, ledger());
    const result = await client.json({
      agentId: 'test', model: 'gemini-2.5-flash-lite', schemaName: 'test_output', schema,
      system: 'system', user: '{"data":true}'
    });
    assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(captured.options.headers['x-goog-api-key'], 'secret');
    assert.equal(captured.body.response_format.mime_type, 'application/json');
    assert.deepEqual(captured.body.response_format.schema, schema);
    assert.equal(captured.body.store, false);
    assert.equal(result.provider, 'gemini');
    assert.deepEqual(result.data, { agentId: 'test' });
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7, cachedInputTokens: 2 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('lo schema Gemini rimuove keyword JSON Schema non supportate', () => {
  const converted = toGeminiSchema({
    type: 'object', additionalProperties: false, required: ['summary'],
    properties: { summary: { type: 'string', maxLength: 100, description: 'Sintesi' } }
  });
  assert.equal(converted.properties.summary.maxLength, undefined);
  assert.equal(converted.properties.summary.description, 'Sintesi');
  assert.equal(converted.additionalProperties, false);
});

test('OpenAI usa Responses API e Structured Outputs', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: 'openai-test', output_text: '{"agentId":"test"}',
      usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 2 } }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new OpenAiStructuredClient({
      ...baseConfig, provider: 'openai', baseUrl: 'https://api.openai.com/v1'
    }, ledger());
    const result = await client.json({
      agentId: 'test', model: 'gpt-5.6-luna', schemaName: 'test_output', schema,
      system: 'system', user: '{"data":true}'
    });
    assert.equal(captured.url, 'https://api.openai.com/v1/responses');
    assert.equal(captured.options.headers.authorization, 'Bearer secret');
    assert.equal(captured.body.text.format.type, 'json_schema');
    assert.equal(captured.body.text.format.strict, true);
    assert.equal(result.provider, 'openai');
    assert.deepEqual(result.data, { agentId: 'test' });
  } finally {
    global.fetch = originalFetch;
  }
});
