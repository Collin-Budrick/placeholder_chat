import { $, component$, useSignal, useVisibleTask$ } from '@builder.io/qwik';
import { postJson } from '~/lib/http';
import { csrfHeader } from '~/lib/csrf';

export default component$(() => {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const enabled = useSignal<boolean>(false);
  const busy = useSignal<boolean>(false);
  const error = useSignal<string | null>(null);
  const hasPermission = useSignal<NotificationPermission>('default');

  useVisibleTask$(async () => {
    if (!supported || import.meta.env.VITE_ENABLE_PUSH !== '1') return;
    try {
      hasPermission.value = Notification.permission;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      enabled.value = !!sub;
    } catch {}
  });

  const doSubscribe = $(async () => {
    if (!supported) return;
    busy.value = true; error.value = null;
    try {
      if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch {}
      }
      hasPermission.value = Notification.permission;
      if (Notification.permission !== 'granted') {
        error.value = 'Permission not granted';
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let key = import.meta.env.VITE_PUSH_PUBLIC_KEY as string | undefined;
      if (!key) {
        // Try fetching from the gateway
        try {
          const res = await fetch('/api/push/public-key', { headers: { Accept: 'application/json' } });
          if (res.ok) {
            const j = await res.json().catch(() => null) as any;
            if (j && typeof j.publicKey === 'string' && j.publicKey.length > 0) key = j.publicKey;
          }
        } catch {}
      }
      if (!key) { error.value = 'Missing VAPID public key'; return; }
      const appServerKey = urlBase64ToUint8Array(key);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
      // send to backend
      await postJson('/api/push/subscribe', sub, { headers: { ...csrfHeader() } });
      enabled.value = true;
    } catch (e: any) {
      error.value = String(e?.message || e);
    } finally {
      busy.value = false;
    }
  });

  const doUnsubscribe = $(async () => {
    if (!supported) return;
    busy.value = true; error.value = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await postJson('/api/push/unsubscribe', { endpoint: sub.endpoint }, { headers: { ...csrfHeader() } });
        } catch {}
        await sub.unsubscribe();
      }
      enabled.value = false;
    } catch (e: any) {
      error.value = String(e?.message || e);
    } finally {
      busy.value = false;
    }
  });

  return (
    <div class="mt-4">
      <div class="card border border-base-300 bg-base-100">
        <div class="card-body gap-3">
          <h3 class="card-title text-base">Notifications</h3>
          {!supported || import.meta.env.VITE_ENABLE_PUSH !== '1' ? (
            <p class="text-sm opacity-70">Push not supported or disabled.</p>
          ) : (
            <>
              <p class="text-sm opacity-80">Enable push notifications for updates and messages.</p>
              {error.value ? <p class="text-error text-sm">{error.value}</p> : null}
              <div class="flex items-center gap-2">
                {!enabled.value ? (
                  <button disabled={busy.value} onClick$={doSubscribe} class="btn btn-primary btn-sm">Enable</button>
                ) : (
                  <button disabled={busy.value} onClick$={doUnsubscribe} class="btn btn-outline btn-sm">Disable</button>
                )}
                <span class="text-xs opacity-70">Permission: {hasPermission.value}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
