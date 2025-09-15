/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { setupServiceWorker } from '@builder.io/qwik-city/service-worker';
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// Initialize Qwik City's service worker hooks (routing-aware)
setupServiceWorker();

// Injected at build time by vite-plugin-pwa (injectManifest)
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// Pages: prefer network, fall back to cached page
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'pages',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
);

// Qwik route data JSON
registerRoute(
  ({ url }) => /\/[^?]*q-data\.json$/i.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'q-data',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 })],
  }),
);

// Static assets (JS/CSS/workers)
registerRoute(
  ({ request }) => ['script', 'style', 'worker'].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: 'assets',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

// Images (same-origin only)
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

// Offline fallback for navigations
setCatchHandler(async ({ event }) => {
  if (event.request.mode === 'navigate') {
    try {
      const resp = await matchPrecache('/offline.html');
      if (resp) return resp;
    } catch {}
  }
  return Response.error();
});

// Support immediate activation when prompted from the client
self.addEventListener('message', (event) => {
  try {
    if ((event.data as any) === 'SKIP_WAITING') {
      void self.skipWaiting();
    }
  } catch {}
});

export default {};
