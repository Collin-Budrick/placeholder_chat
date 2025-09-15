import { component$, useVisibleTask$ } from '@builder.io/qwik';

async function subscribe(reg: ServiceWorkerRegistration, vapidKeyBase64: string) {
  const vapid = urlBase64ToUint8Array(vapidKeyBase64);
  const sub = await reg.pushManager.getSubscription();
  if (sub) return sub;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default component$(() => {
  useVisibleTask$(async () => {
    try {
      if (import.meta.env.VITE_ENABLE_PUSH !== '1') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      // Ensure SW is ready
      const reg = await navigator.serviceWorker.ready;
      // Request permission if not yet decided
      if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch {}
      }
      if (Notification.permission !== 'granted') return;
      let vapidKey = import.meta.env.VITE_PUSH_PUBLIC_KEY as string | undefined;
      if (!vapidKey) {
        try {
          const res = await fetch('/api/push/public-key', { headers: { Accept: 'application/json' } });
          if (res.ok) {
            const j = await res.json().catch(() => null) as any;
            if (j && typeof j.publicKey === 'string' && j.publicKey.length > 0) vapidKey = j.publicKey;
          }
        } catch {}
        if (!vapidKey) return;
      }
      const sub = await subscribe(reg, vapidKey);
      // Send subscription to backend for the current user/session
      try {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sub),
          credentials: 'include',
        });
      } catch {}
    } catch {}
  });
  return null;
});
