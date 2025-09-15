/*
  Minimal service worker for offline shell + asset caching.
  This file is used when the Vite PWA plugin is not available.
*/
/* eslint-disable no-restricted-globals */
const SW_VERSION = 'v1';
const SHELL_CACHE = `shell-${SW_VERSION}`;
const ASSETS_CACHE = `assets-${SW_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Only cache safe, static resources. Skip API and WS.
const shouldHandleFetch = (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return false;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return false;
  return true;
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll([
        '/',
        OFFLINE_URL,
        '/favicon.svg',
        '/theme-init.js',
        '/vt.css',
      ]).catch(() => void 0),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, ASSETS_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (!shouldHandleFetch(event.request)) return;

  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests to avoid CSP connect-src issues for cross-origin assets
  if (url.origin !== self.location.origin) return;

  // Navigation requests: NetworkFirst -> offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(req);
          return (
            cached || (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 })
          );
        }
      })(),
    );
    return;
  }

  // Static assets: CacheFirst for images; StaleWhileRevalidate for scripts/styles
  const dest = req.destination;
  if (dest === 'image') {
    event.respondWith(
      caches.open(ASSETS_CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const fetchAndCache = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || fetchAndCache;
        }),
      ),
    );
    return;
  }

  if (dest === 'script' || dest === 'style' || dest === 'worker' || dest === 'font') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
    return;
  }
});
