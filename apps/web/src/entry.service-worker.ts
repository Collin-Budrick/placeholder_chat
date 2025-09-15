/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { setupServiceWorker } from '@builder.io/qwik-city/service-worker';import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

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
  const notifyQueue = (type: 'bg-sync:queued' | 'bg-sync:replayed') => {
    try {
      const bc = new BroadcastChannel('app-events');
      bc.postMessage({ type, queue: 'api-queue' });
      bc.close();
    } catch {}
  };
  const apiQueue = new BackgroundSyncPlugin('api-queue', {
    maxRetentionTime: 24 * 60,
    onSync: async ({ queue }) => {
      await queue.replayRequests();
      notifyQueue('bg-sync:replayed');
    },
  });
  const originalFetchDidFail = apiQueue.fetchDidFail?.bind(apiQueue);
  apiQueue.fetchDidFail = async (options) => {
    notifyQueue('bg-sync:queued');
    return originalFetchDidFail ? originalFetchDidFail(options) : undefined;
  };
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
  const fetchEvent = 'request' in event ? (event as FetchEvent) : undefined;
  const request = fetchEvent?.request;
  if (request?.mode === 'navigate') {
    try {
      const resp = await matchPrecache('/offline.html');
      if (resp) return resp;
    } catch {}
  }
  return Response.error();
});

// Push Notifications: display basic notifications from server payload
self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil((async () => {
    try {
      const payload = event.data?.json?.() as Record<string, unknown> | undefined;
      const record = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
      const titleValue = record.title;
      const bodyValue = record.body;
      const iconValue = record.icon;
      const badgeValue = record.badge;
      const urlValue = record.url;
      const title = typeof titleValue === 'string' && titleValue.length > 0 ? titleValue : 'Notification';
      const options: NotificationOptions = {
        body: typeof bodyValue === 'string' ? bodyValue : '',
        icon: typeof iconValue === 'string' ? iconValue : '/favicon.svg',
        badge: typeof badgeValue === 'string' ? badgeValue : '/favicon.svg',
        data: { url: typeof urlValue === 'string' ? urlValue : '/', ...record },
      };
      await self.registration.showNotification(title, options);
    } catch {
      try {
        const fallback = (await event.data?.text?.()) ?? 'Update available';
        await self.registration.showNotification('Notification', { body: fallback });
      } catch {
        await self.registration.showNotification('Notification', { body: 'Update available' });
      }
    }
  })());
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const url = typeof data?.url === 'string' ? data.url : '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const windowClient = allClients.find((client): client is WindowClient => 'focus' in client);
    if (windowClient) {
      try {
        await windowClient.navigate?.(url);
      } catch {}
      return windowClient.focus();
    }
    return self.clients.openWindow(url);
  })());
});

// Support immediate activation when prompted from the client
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  try {
    if (typeof event.data === 'string' && event.data === 'SKIP_WAITING') {
      void self.skipWaiting();
    }
  } catch {}
});

export default {};
