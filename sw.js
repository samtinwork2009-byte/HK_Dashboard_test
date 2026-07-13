/* ============================================================
   sw.js — Service Worker for Hong Kong City Dashboard
   PWA: offline cache + background sync
   ============================================================ */

const CACHE_NAME  = 'hk-dashboard-v5';
const STATIC_URLS = [
  '/',
  '/index.html',
  '/css/tokens.css',
  '/css/base.css',
  '/js/core.js',
  '/js/weather.js',
  '/js/transport.js',
  '/js/health.js',
  '/js/environment.js',
  '/js/cctv.js',
  '/js/bus.js',
  '/js/tides.js',
  '/js/parking.js',
  '/js/ferry.js',
  '/js/holidays.js',
  '/js/climate.js',
  '/js/beach.js',
  '/js/map.js',
  '/js/app.js',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
];

/* ── Install: cache all static assets ───────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_URLS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ─────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Fetch: cache-first for static, network-first for API ───── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  const networkOnlyHosts = [
    'rt.data.gov.hk',
    'data.etabus.gov.hk',
    'data.etagmb.gov.hk'
  ];
  const isNetworkOnlyAPI = networkOnlyHosts.some(host => url.hostname.includes(host));

  if (isNetworkOnlyAPI) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // API calls: network-first with cache fallback.
  // Avoid serving stale traffic responses from cache on subsequent polling.
  const isAPI = [
    'data.weather.gov.hk',
    'api.data.gov.hk',
    'datagovhk.blob.core.windows.net',
    'www.ha.org.hk',
    'api.allorigins.win',
    'tdcctv.data.one.gov.hk',
  ].some(host => url.hostname.includes(host));

  if (isAPI) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const networkPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.ok) {
                cache.put(event.request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => null);

          if (cachedResponse) {
            // Always return cached response immediately, but update cache in the background.
            event.waitUntil(networkPromise);
            return cachedResponse;
          }

          return networkPromise.then(response => response || new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }));
        });
      })
    );
    return;
  }

  const isStaticAsset = ['document', 'script', 'style', 'image', 'font', 'manifest'].includes(event.request.destination);
  if (!isStaticAsset) return;

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
