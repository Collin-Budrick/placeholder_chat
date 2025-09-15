/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { setupServiceWorker } from '@builder.io/qwik-city/service-worker';
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
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

// Blog (read-mostly): SWR with 48h TTL
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && /^\/blog\//.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'blog',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 48 * 60 * 60 })],
  }),
);

// Docs (rarely changes): SWR with 7d TTL
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && /^\/docs\//.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'docs',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
);

// Products/catalog (should stay fresh-ish): SWR with 60m TTL
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && /^\/products\//.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'products',
    plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 })],
  }),
);

// API background sync for simple POST actions (likes/comments/cart). Keep narrow to avoid sensitive endpoints.
try {
  const apiQueue = new BackgroundSyncPlugin('api-queue', {
    maxRetentionTime: 24 * 60,
    callbacks: {
      queueDidReplay: async () => {
        try {
          const bc = new BroadcastChannel('app-events');
          bc.postMessage({ type: 'bg-sync:replayed', queue: 'api-queue' });
          bc.close();
        } catch {}
      },
      requestWillEnqueue: async () => {
        try {
          const bc = new BroadcastChannel('app-events');
          bc.postMessage({ type: 'bg-sync:queued', queue: 'api-queue' });
          bc.close();
        } catch {}
      },
    },
  });
  registerRoute(
    ({ url, request }) =>
      url.origin === self.location.origin &&
      request.method === 'POST' &&
      (/^\/api\/likes\b/.test(url.pathname) ||
        /^\/api\/comments\b/.test(url.pathname) ||
        /^\/api\/cart\b/.test(url.pathname) ||
        /^\/api\/orders\b/.test(url.pathname)),
    new NetworkFirst({ cacheName: 'api-post', plugins: [apiQueue] }),
    'POST',
  );
} catch {}

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

// Push Notifications: display basic notifications from server payload
self.addEventListener('push', (event) => {
  try {
    const data = (event.data && event.data.json && event.data.json()) || {};
    const title = data.title || 'Notification';
    const options: NotificationOptions = {
      body: data.body || '',
      icon: data.icon || '/favicon.svg',
      badge: data.badge || '/favicon.svg',
      data: { url: data.url || '/', ...data },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // If JSON parse fails, show a generic notification
    const text = event.data ? String(event.data) : 'Update available';
    event.waitUntil(self.registration.showNotification('Notification', { body: text }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      const client = allClients.find((c: any) => 'focus' in c);
      if (client) {
        (client as any).navigate(url);
        return (client as any).focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
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
