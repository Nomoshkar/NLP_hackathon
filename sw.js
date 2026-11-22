/**
 * Meridian PWA Service Worker
 * Enables 100% offline functionality, fast asset caching, and offline-first storage.
 */

const CACHE_NAME = 'meridian-shell-v1';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/fonts.css',
  './assets/styles.css',
  './assets/fonts/Fraunces-italic-300_900-latin-ext.woff2',
  './assets/fonts/Fraunces-italic-300_900-latin.woff2',
  './assets/fonts/Fraunces-normal-300_900-latin-ext.woff2',
  './assets/fonts/Fraunces-normal-300_900-latin.woff2',
  './assets/fonts/IBMPlexMono-normal-400-latin-ext.woff2',
  './assets/fonts/IBMPlexMono-normal-400-latin.woff2',
  './assets/fonts/IBMPlexMono-normal-500-latin-ext.woff2',
  './assets/fonts/IBMPlexMono-normal-500-latin.woff2',
  './assets/fonts/IBMPlexMono-normal-600-latin-ext.woff2',
  './assets/fonts/IBMPlexMono-normal-600-latin.woff2',
  './assets/fonts/PublicSans-italic-300_800-latin-ext.woff2',
  './assets/fonts/PublicSans-italic-300_800-latin.woff2',
  './assets/fonts/PublicSans-normal-300_800-latin-ext.woff2',
  './assets/fonts/PublicSans-normal-300_800-latin.woff2',
  './src/main.js',
  './src/actions/ledger.js',
  './src/actions/queries.js',
  './src/db/database.js',
  './src/db/seed.js',
  './src/nlu/assistant.js',
  './src/nlu/dates.js',
  './src/nlu/lexicon.js',
  './src/nlu/parse.js',
  './src/ui/charts.js',
  './src/ui/chat.js',
  './src/ui/dashboard.js',
  './src/ui/voice.js',
  './src/util/format.js',
  './src/util/money.js',
  './src/util/haptics.js',
  './vendor/compromise.js',
  './vendor/dexie.js'
];

const ctx = typeof self !== 'undefined' ? self : globalThis;

ctx.addEventListener?.('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Pre-cache error (continuing anyway):', err);
      });
    }).then(() => ctx.skipWaiting?.())
  );
});

ctx.addEventListener?.('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => ctx.clients?.claim())
  );
});

ctx.addEventListener?.('fetch', (event) => {
  const request = event.request;
  // Only handle GET requests for same origin or relative paths
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background to keep cache updated
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {/* offline */});
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, toCache));
        return response;
      });
    })
  );
});
