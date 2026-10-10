// Service worker dell'app iPhone: guscio dell'app disponibile offline, dati ESPN "rete prima, cache dopo".
const VERSION = '__BUILD_VERSION__';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = 'espn-data-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'engine.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.hostname === 'site.api.espn.com') {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    // Guscio: rete prima (aggiornamenti immediati), cache se offline.
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok && SHELL.some((path) => url.pathname.endsWith(path.replace('./', '/')))) {
          (await caches.open(SHELL_CACHE)).put(event.request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(event.request)) || (await caches.match('index.html'));
      }
    })());
  }
});
