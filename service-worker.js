const CACHE     = 'cinestream-v4';
const API_CACHE = 'cinestream-api-v4';
const IMG_CACHE = 'cinestream-img-v4';

const STATIC = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];
const API_TTL_MS  = 48 * 60 * 60 * 1000; // 48 h — matches app CFG
const IMG_MAX     = 200;                  // max cached images

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => ![CACHE, API_CACHE, IMG_CACHE].includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Helpers ────────────────────────────────────────────────────
function storeWithTimestamp(cacheName, req, res) {
  return caches.open(cacheName).then(c => {
    const headers = new Headers(res.headers);
    headers.set('sw-cached-at', Date.now().toString());
    const stamped = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    return c.put(req, stamped);
  });
}

function isFresh(response, ttl) {
  if (!response) return false;
  const cachedAt = parseInt(response.headers.get('sw-cached-at') || '0', 10);
  return cachedAt && (Date.now() - cachedAt) < ttl;
}

async function trimImageCache() {
  const c = await caches.open(IMG_CACHE);
  const keys = await c.keys();
  if (keys.length > IMG_MAX) {
    await Promise.all(keys.slice(0, keys.length - IMG_MAX).map(k => c.delete(k)));
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET requests (POST, PUT, etc.) — never cache them
  if (e.request.method !== 'GET') return;

  // Skip non-http(s) protocols (chrome-extension://, data:, etc.)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // OMDb API — cache-first with TTL, then network
  if (url.hostname === 'www.omdbapi.com') {
    e.respondWith(
      caches.open(API_CACHE).then(async c => {
        const cached = await c.match(e.request);
        if (isFresh(cached, API_TTL_MS)) return cached;
        try {
          const r = await fetch(e.request);
          if (r.ok) storeWithTimestamp(API_CACHE, e.request, r.clone());
          return r;
        } catch(_) { return cached || new Response('{}', { status: 503 }); }
      })
    );
    return;
  }

  // Images — cache-first, trim to IMG_MAX
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.match(e.request).then(cached => cached ||
        fetch(e.request).then(r => {
          if (r.ok) {
            storeWithTimestamp(IMG_CACHE, e.request, r.clone());
            trimImageCache();
          }
          return r;
        }).catch(() => new Response('', { status: 404 }))
      )
    );
    return;
  }

  // Static — stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
