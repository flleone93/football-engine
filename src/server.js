import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HybridAiOrchestrator } from './ai/orchestrator.js';
import { createApi, EXPENSIVE_ROUTES, failValidation, publicError } from './api.js';
import { TTLCache } from './cache.js';
import { config, validateConfig } from './config.js';
import { createRequestId, auditLog } from './provenance.js';
import { ApiFootballProvider } from './providers/apiFootball.js';
import { DemoProvider } from './providers/demo.js';
import { EspnProvider } from './providers/espn.js';
import { FixedWindowRateLimiter } from './rateLimit.js';
import { JsonlLedgerStorage } from './tracking/fileStorage.js';
import { MemoryLedgerStorage, PredictionLedger } from './tracking/predictionLedger.js';

validateConfig();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const provider = config.dataProvider === 'demo' ? new DemoProvider()
  : config.dataProvider === 'espn' ? new EspnProvider(config)
    : new ApiFootballProvider(config);
const aiOrchestrator = new HybridAiOrchestrator(config);
const analysisCache = new TTLCache(config.cacheTtlMs, config.cacheMaxEntries);
// In demo il registro resta in memoria: lo storico dimostrativo non deve mai mescolarsi con quello live.
const ledger = config.predictionLedger.enabled
  ? new PredictionLedger({
    storage: config.demoMode ? new MemoryLedgerStorage() : new JsonlLedgerStorage(path.resolve(root, config.predictionLedger.path)),
    maxRecords: config.predictionLedger.maxRecords,
    settlementDelayMinutes: config.predictionLedger.settlementDelayMinutes
  })
  : null;
const api = createApi({ config, provider, aiOrchestrator, analysisCache, ledger });
const generalLimiter = new FixedWindowRateLimiter({ limit: config.requestRateLimit });
const expensiveLimiter = new FixedWindowRateLimiter({ limit: config.expensiveRateLimit });

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; ')
};

function hasAdminAccess(request) {
  if (!config.adminApiToken) return false;
  const authorization = String(request.headers.authorization || '');
  const expected = `Bearer ${config.adminApiToken}`;
  const left = Buffer.from(authorization);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendJson(response, status, payload, requestId, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...securityHeaders,
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-request-id': requestId
  });
  response.end(body);
}

async function readBody(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw failValidation('Content-Type application/json obbligatorio.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > config.maxBodyBytes) throw failValidation('Richiesta troppo grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw failValidation('JSON non valido.');
  }
}

async function serveStatic(request, requestPath, response, requestId) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const normalized = path.normalize(relative);
  const target = path.resolve(publicRoot, normalized);
  if (path.relative(publicRoot, target).startsWith('..')) {
    return sendJson(response, 403, { error: 'Accesso negato.', requestId }, requestId);
  }
  try {
    const stats = await fs.stat(target);
    if (!stats.isFile()) return sendJson(response, 404, { error: 'Risorsa non trovata.', requestId }, requestId);
    // Rivalidazione con ETag: dopo un aggiornamento HTML, JS e CSS restano sempre coerenti tra loro.
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const headers = {
      ...securityHeaders,
      etag,
      'cache-control': 'no-cache',
      'x-request-id': requestId
    };
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers);
      return response.end();
    }
    const data = await fs.readFile(target);
    response.writeHead(200, {
      ...headers,
      'content-type': contentTypes[path.extname(target)] || 'application/octet-stream',
      'content-length': data.length
    });
    response.end(data);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return sendJson(response, 404, { error: 'Risorsa non trovata.', requestId }, requestId);
    throw error;
  }
}

function clientKey(request) {
  if (config.trustProxy) return String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() || request.socket.remoteAddress || 'unknown';
  return request.socket.remoteAddress || 'unknown';
}

function enforceRateLimit(request, response, requestId, expensive = false) {
  const limiter = expensive ? expensiveLimiter : generalLimiter;
  const result = limiter.consume(clientKey(request));
  if (result.allowed) return false;
  sendJson(response, 429, { error: 'Troppe richieste. Riprova tra poco.', requestId }, requestId, {
    'retry-after': String(result.retryAfterSeconds),
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': String(result.remaining)
  });
  return true;
}

const server = http.createServer(async (request, response) => {
  const requestId = createRequestId();
  try {
    if (enforceRateLimit(request, response, requestId)) return;
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (EXPENSIVE_ROUTES.has(`${request.method} ${url.pathname}`) && enforceRateLimit(request, response, requestId, true)) return;
    const result = await api.handle({
      method: request.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      readBody: () => readBody(request),
      isAdmin: hasAdminAccess(request),
      requestId
    });
    if (result) return sendJson(response, result.status, result.payload, requestId);
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Metodo non consentito.', requestId }, requestId);
    return await serveStatic(request, url.pathname, response, requestId);
  } catch (error) {
    const { status, message } = publicError(error);
    auditLog('request_error', { requestId, status, code: error.code, path: request.url, message: error.message });
    return sendJson(response, status, { error: message, requestId }, requestId);
  }
});

server.headersTimeout = 15000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 100;

server.listen(config.port, config.host, () => {
  console.log(`Enterprise Football Prediction Engine: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`Modalita: ${provider.mode === 'demo' ? 'DEMO' : `LIVE · ${config.dataProvider}`} · AI: ${aiOrchestrator.effectiveMode()} · Fuso orario: ${config.timezone}`);
  console.log(`Registro previsioni: ${ledger ? `${ledger.storage.kind}${ledger.storage.filePath ? ` (${ledger.storage.filePath})` : ''} · ${ledger.stats().fixturesTracked} partite tracciate` : 'disattivato'}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
