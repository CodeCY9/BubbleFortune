const CONFIG = __BF_CONFIG__;
const PREFIX = 'bubble-fortune-v2-';
const CACHE = PREFIX + CONFIG.version;
const STATIC = new Set(CONFIG.staticFiles);
const RUNTIME = new Set(CONFIG.runtimeFiles);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CONFIG.precache)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api') || url.pathname.startsWith('/game') ||
      request.headers.has('authorization')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
    return;
  }
  if (url.search || (!STATIC.has(url.pathname) && !RUNTIME.has(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !/no-store|private/i.test(response.headers.get('cache-control') || '')) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
