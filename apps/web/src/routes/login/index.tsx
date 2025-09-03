import { component$, useSignal, $, useOn, useTask$ } from '@builder.io/qwik';
import { animateMotion } from '~/lib/motion-qwik';

export const prerender = false;
import { useNavigate } from '@builder.io/qwik-city';
import type { DocumentHead } from '@builder.io/qwik-city';
import { AuthCard } from '../../components/auth/AuthCard';
import TypeTitle from '~/components/TypeTitle';
import BackButton from '~/components/BackButton';
// Note: login now uses a plain POST form to Auth.js credentials callback.

// No server onRequest: this page is fully SSG + client logic

export default component$(() => {
  const nav = useNavigate();
  const titleText = useSignal<string>('Log in');
  const eraseKey = useSignal<number | null>(null);
  const formWrap = useSignal<HTMLElement>();
  const authContainer = useSignal<HTMLElement>();
  const descText = useSignal<HTMLElement>();
  const titleStartKey = useSignal<number>(0);
  const emailEditing = useSignal(false);
  const passwordEditing = useSignal(false);

  // Ensure the title types on arrival/resume (belt-and-suspenders with qvisible)
  useTask$(() => {
    try { titleStartKey.value = Date.now(); } catch { /* ignore */ }
  });

  // Motion One: fade/slide in the whole auth area on visibility
  useOn('qvisible', $(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = authContainer.value; if (!root) return;
    void animateMotion(root, { opacity: [0,1], y: [24,0] }, { duration: 0.45, easing: 'cubic-bezier(.22,.9,.37,1)' } as any);
    // Kick the TypeTitle to type on arrival
    try { titleStartKey.value = Date.now(); } catch { /* ignore */ }
    // Ensure any previous title-typing cache is cleared for auth pages
    try {
      const ls = globalThis.localStorage;
      ls?.removeItem('typetitle:/login|Log in');
      ls?.removeItem('typetitle:/signup|Sign Up');
    } catch { /* ignore */ }
  }));


  // Client-only sign-in against gateway
  const submitting = useSignal(false);
  const serverError = useSignal<string | null>(null);

  // no-op task (kept for parity)

  return (
    <main id="login-root" class="min-h-screen grid place-items-center p-6 pt-20 md:pt-24">
      <div class="w-full max-w-2xl" ref={el => (authContainer.value = el)}>
        <div class="mb-4">
          <BackButton class="mb-2" fallbackHref="/" />
          <TypeTitle
            text={titleText.value}
            class="text-3xl font-semibold tracking-tight"
            startDelayMs={200}
            speedMs={45}
            cache={false}
            resetOnReload
            suppressTyping={false}
            startKey={titleStartKey.value}
            eraseKey={eraseKey.value}
            onErased$={$(() => { /* No-op: immediate nav handled on click */ })}
          />
          <p class="text-base-content/70 mt-2" ref={(el) => (descText.value = el as any)}>Welcome back. Please enter your details.</p>
        </div>
        <div class="mt-4" ref={formWrap}>
          <AuthCard borderless>
            <form action="/auth/callback/credentials" method="post" onSubmit$={$(() => {
              try {
                // Pre-fade the login card for responsiveness (no VTs)
                const el = authContainer.value; if (el) el.classList.add('auth-fade-out');
                // Mark that a login just occurred so /profile can wait for the session
                try { sessionStorage.setItem('postLogin', '1'); } catch { /* ignore */ }
              } catch { /* ignore */ }
            })}>
              <input type="hidden" name="callbackUrl" value="/profile" />
              {/* No server-side form action; we call signIn.submit in onSubmit$ */}

              {serverError.value && (
                <div class="alert alert-error mb-3" role="alert" aria-live="polite">
                  <span>{serverError.value}</span>
                </div>
              )}

              {/* Removed hidden username decoy to allow browser autofill on the visible field */}

              <div class="form-control">
                <label class="label" for="username">
                  <span class="label-text">Username</span>
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder={serverError.value && !emailEditing.value ? (serverError.value || 'Invalid username or password') : 'yourusername'}
                  class={`pill-input w-full ${serverError.value && !emailEditing.value ? 'is-warning ring-1 ring-warning text-warning' : ''}`}
                  autoComplete="username"
                  inputMode="text"
                  aria-invalid={serverError.value && !emailEditing.value ? 'true' : undefined}
                  onInput$={$(() => { emailEditing.value = true; })}
                  onBlur$={$(() => { emailEditing.value = false; })}
                  required
                />
              </div>

              <div class="form-control mt-3">
                <label class="label" for="password">
                  <span class="label-text">Password</span>
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder={serverError.value && !passwordEditing.value ? (serverError.value || 'Invalid username or password') : 'Enter your password'}
                  class={`pill-input w-full ${serverError.value && !passwordEditing.value ? 'is-warning ring-1 ring-warning text-warning' : ''}`}
                  autoComplete="current-password"
                  minLength={8}
                  aria-invalid={serverError.value && !passwordEditing.value ? 'true' : undefined}
                  onInput$={$(() => { passwordEditing.value = true; })}
                  onBlur$={$(() => { passwordEditing.value = false; })}
                  required
                />
              </div>

              <button
                type="submit"
                class="btn-cta w-full mt-5"
                disabled={submitting.value}
                aria-busy={submitting.value}
              >
                {submitting.value ? 'Signing in…' : 'Login'}
              </button>
            </form>
            {/* Social auth removed as requested */}
              <p class="text-sm text-center mt-6 text-base-content/70">
                Don’t have an account? <a href="/signup" class="link" preventdefault:click onClick$={$((e: Event) => {
                  e.preventDefault();
                  const el = formWrap.value;
                  if (el) {
                    // Quick fade for responsiveness
                    void animateMotion(el, { opacity: [1, 0], y: [0, 8] }, { duration: 0.2, easing: 'ease-out', fill: 'forwards' } as any);
                  }
                  const desc = descText.value;
                  if (desc) {
                    void animateMotion(desc, { opacity: [1, 0], y: [0, 6] }, { duration: 0.18, easing: 'ease-out', fill: 'forwards' } as any);
                  }
                  // Navigate immediately (no view transitions)
                  try { void nav('/signup'); } catch { /* ignore */ }
                  // Fast safety fallback: if SPA nav fails, force navigation
                  setTimeout(() => {
                    try {
                      if ((globalThis.location?.pathname || '') === '/login') {
                        globalThis.location.assign('/signup');
                      }
                    } catch { /* ignore */ }
                  }, 220);
                })}>Sign Up</a>
              </p>
          </AuthCard>
        </div>
      </div>
    </main>
  );
});

export const head: DocumentHead = {
  title: 'Log in | Stack',
  meta: [
    {
      name: 'description',
      content: 'Log in to your Stack account to access your profile and personalized features.',
    },
  ],
};
