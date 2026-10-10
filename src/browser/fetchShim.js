// Intercetta fetch('/api/...') del frontend ed esegue le API nel browser: stesso codice del server Node.
import { publicError } from '../api.js';
import { createRequestId } from '../provenance.js';

function jsonResponse(status, payload, requestId) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId }
  });
}

export function installApiFetch(api) {
  const nativeFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
  async function apiFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input?.url || String(input);
    const url = new URL(rawUrl, 'http://standalone.local');
    if (!url.pathname.startsWith('/api/')) {
      if (!nativeFetch) throw new TypeError('fetch non disponibile.');
      return nativeFetch(input, init);
    }
    if (init.signal?.aborted) throw new DOMException('Richiesta annullata.', 'AbortError');
    const requestId = createRequestId();
    const method = String(init.method || 'GET').toUpperCase();
    try {
      // Cede il controllo al browser per permettere all'interfaccia di mostrare lo stato di caricamento.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await api.handle({
        method,
        pathname: url.pathname,
        searchParams: url.searchParams,
        readBody: async () => {
          if (!init.body) return {};
          try {
            return JSON.parse(init.body);
          } catch {
            throw Object.assign(new Error('JSON non valido.'), { code: 'validation_error' });
          }
        },
        isAdmin: false,
        requestId
      });
      if (result) return jsonResponse(result.status, result.payload, requestId);
      return jsonResponse(404, { error: 'Endpoint non trovato.', requestId }, requestId);
    } catch (error) {
      const { status, message } = publicError(error);
      console.error('[standalone]', error);
      return jsonResponse(status, { error: message, requestId }, requestId);
    }
  }
  globalThis.fetch = apiFetch;
}
