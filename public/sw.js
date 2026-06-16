const CACHE_PREFIX = 'bolao-do-ti-';
const CACHE_NAME = `${CACHE_PREFIX}v3-pwa-20260616`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/?source=pwa',
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/app-icon-192.png',
  '/app-icon-512.png',
  '/team-assets.js',
  '/head-to-head-data.js',
  '/competition-history-data.js'
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    APP_SHELL.map(async resource => {
      const request = new Request(resource, { cache: 'reload' });
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`Falha ao cachear ${resource}: ${response.status}`);
      }
      await cache.put(request, response);
    })
  );

  const successful = results.filter(result => result.status === 'fulfilled').length;
  if (!successful) {
    throw new Error('Nenhum asset essencial do PWA foi cacheado.');
  }
}

async function matchAppShellFallback() {
  return (await caches.match('/?source=pwa'))
    || (await caches.match('/index.html'))
    || caches.match('/');
}

self.addEventListener('install', event => {
  event.waitUntil(
    cacheAppShell()
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CLEAR_OLD_CACHES') return;

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const shouldAlwaysRefresh = request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.json')
    || url.pathname.endsWith('.webmanifest');

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy.clone());
            cache.put('/index.html', copy);
          });
          return response;
        })
        .catch(() => matchAppShellFallback())
    );
    return;
  }

  if (shouldAlwaysRefresh) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
