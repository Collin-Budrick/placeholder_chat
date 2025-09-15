import { $, component$, useSignal, useVisibleTask$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';
import { csrfHeader } from '~/lib/csrf';
import { api, postJson } from '~/lib/http';

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string }; created_at?: number };

export const prerender = true;

export default component$(() => {
  const subs = useSignal<Sub[] | null>(null);
  const loading = useSignal<boolean>(true);
  const sending = useSignal<boolean>(false);
  const title = useSignal<string>('Hello');
  const body = useSignal<string>('Test notification');
  const url = useSignal<string>('/');
  const error = useSignal<string | null>(null);
  const userId = useSignal<string>('');

  useVisibleTask$(async () => {
    try {
      const list = await api<Sub[]>('/api/push/subscriptions', { headers: { Accept: 'application/json' } });
      subs.value = Array.isArray(list) ? list : [];
    } catch (err) {
      const message = err instanceof Error ? err.message ?? err.toString() : String(err);
      error.value = message;
    } finally {
      loading.value = false;
    }
  });

  const sendTest = $(async () => {
    sending.value = true; error.value = null;
    try {
      await postJson('/api/push/test', { title: title.value, body: body.value, url: url.value }, { headers: { ...csrfHeader() } });
    } catch (err) {
      const message = err instanceof Error ? err.message ?? err.toString() : String(err);
      error.value = message;
    } finally {
      sending.value = false;
    }
  });

  const sendToUser = $(async () => {
    sending.value = true; error.value = null;
    try {
      await postJson('/api/push/send_to_user', { user_id: userId.value, title: title.value, body: body.value, url: url.value }, { headers: { ...csrfHeader() } });
    } catch (err) {
      const message = err instanceof Error ? err.message ?? err.toString() : String(err);
      error.value = message;
    } finally {
      sending.value = false;
    }
  });

  return (
    <main class="p-6">
      <h1 class="text-2xl font-semibold mb-4">Push Subscriptions</h1>
      {loading.value ? (
        <p class="opacity-70">Loading…</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(subs.value || []).map((s) => (
                <tr key={s.endpoint}>
                  <td class="text-xs break-all">{s.endpoint}</td>
                  <td class="text-xs">{s.created_at ? new Date(s.created_at * 1000).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div class="mt-6 card border border-base-300">
        <div class="card-body gap-3">
          <h2 class="card-title text-base">Send Test Notification</h2>
          {error.value ? <p class="text-error text-sm">{error.value}</p> : null}
          <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input value={title.value} onInput$={$((_event, el) => { title.value = el.value; })} placeholder="Title" class="input input-bordered input-sm" />
            <input value={body.value} onInput$={$((_event, el) => { body.value = el.value; })} placeholder="Body" class="input input-bordered input-sm" />
            <input value={url.value} onInput$={$((_event, el) => { url.value = el.value; })} placeholder="URL" class="input input-bordered input-sm" />
            <input value={userId.value} onInput$={$((_event, el) => { userId.value = el.value; })} placeholder="User ID (optional)" class="input input-bordered input-sm" />
          </div>
          <div class="flex gap-2">
            <button type="button" disabled={sending.value} onClick$={sendTest} class="btn btn-primary btn-sm w-fit">Send to All</button>
            <button type="button" disabled={sending.value || !userId.value} onClick$={sendToUser} class="btn btn-outline btn-sm w-fit">Send to User</button>
          </div>
        </div>
      </div>
    </main>
  );
});

export const head: DocumentHead = {
  title: 'Admin - Push | Stack',
  meta: [{ name: 'description', content: 'List push subscriptions and send a test notification.' }],
};
