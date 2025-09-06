import { component$, $, useSignal, useVisibleTask$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';
// import { useLocation } from '@builder.io/qwik-city';
import { AuthCard } from '../../components/auth/AuthCard';
import { csrfHeader } from '~/lib/csrf';
import { useSession, useSignOut } from '~/routes/plugin@auth';
export const prerender = true;

export default component$(() => {
  const session = useSession();
  // const loc = useLocation();
  const signOut = useSignOut();

  // SSG-only gate using resumability: reveal after confirming a session client-side.
  const show = useSignal(false);
  useVisibleTask$(async () => {
    try {
      const res = await fetch('/auth/session', { credentials: 'same-origin' });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && Object.keys(json || {}).length) {
          show.value = true;
          try { sessionStorage.removeItem('postLogin'); } catch {}
          return;
        }
      }
    } catch {}
    try {
      const p = location.pathname + location.search;
      location.replace('/login?callbackUrl=' + encodeURIComponent(p));
    } catch {}
  });

  const displayName =
    session.value?.user?.name ?? (session.value?.user?.email ? session.value.user.email.split('@')[0] : 'there');
  const role = (session.value as any)?.role ?? (session.value?.user as any)?.role;

  // Render SSG markup; reveal content once `show` is true after resume.
  return (
    <main class="min-h-screen flex items-center justify-center p-6">
      {show.value ? (
      <AuthCard title="Profile">
        <h3 class="text-xl font-semibold text-center mb-2">Hi {displayName}</h3>
        <p class="text-sm text-center text-slate-200 mb-4">Manage your account</p>

        <div class="text-sm text-slate-200 mb-4">
          You are logged in.
          {role && (
            <div class="mt-2">
              <span class="badge badge-outline mr-2">Role: {role}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          class="btn btn-secondary w-full"
          aria-label="Logout"
          onClick$={$ (async () => {
            try {
              // If we have the gateway token in the session, call the backend logout endpoint
              const token = (session.value as any)?.gateway;
              const headers: Record<string, string> = {};
              if (token) headers['Authorization'] = `Bearer ${token}`;
              // Use same-origin credentials so cookie-backed sessions (if present) are sent
              await fetch('/api/auth/logout', { method: 'POST', headers: { ...headers, ...csrfHeader() }, credentials: 'same-origin' });
            } catch (err) {
              // best-effort: ignore network errors and proceed to clear Auth.js session
              console.debug('backend logout failed', err);
            }
            // Apply a fade effect for logout view transition
            try {
              const root = document.documentElement;
              root.setAttribute('data-vt-effect', 'fade');
              root.setAttribute('data-vt-nav','1');
              // Hint CSS to hide the incoming login DOM until the VT finishes
              root.setAttribute('data-vt-target','login');
            } catch { /* ignore */ }
            // Clear Auth.js session and navigate to login
            signOut.submit({ redirectTo: '/login' });
          })}
        >
          Logout
        </button>

        {role === 'admin' && (
          <div class="mt-4">
            <a href="/admin/users" class="btn btn-outline btn-sm w-full" role="link" aria-label="Manage Users">
              Manage Users
            </a>
          </div>
        )}
      </AuthCard>
      ) : (
        <div class="text-sm text-base-content/70" aria-busy="true" role="status">
          Loading your profile…
        </div>
      )}
    </main>
  );
});

export const head: DocumentHead = {
  title: 'Your Profile | Stack',
  meta: [
    { name: 'description', content: 'View and manage your Stack profile, account details, and settings.' },
  ],
};
