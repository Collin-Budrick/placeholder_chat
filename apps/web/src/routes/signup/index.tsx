import { component$, $, useSignal, useOn, useTask$ } from '@builder.io/qwik';
import { animateMotion } from '~/lib/motion-qwik';

export const prerender = false;
import { useNavigate, routeLoader$ } from '@builder.io/qwik-city';
import type { DocumentHead } from '@builder.io/qwik-city';
import { useForm, valiForm$, type InitialValues } from '@modular-forms/qwik';
import * as v from 'valibot';
import { api, apiFetch } from '../../lib/http';
import { csrfHeader } from '../../lib/csrf';
import { AuthCard } from '../../components/auth/AuthCard';
import TypeTitle from '~/components/TypeTitle';
import BackButton from '~/components/BackButton';

const SignupSchema = v.object({
  username: v.pipe(v.string(), v.minLength(2, 'Username must have 2 characters or more.')),
  email: v.pipe(v.string(), v.email('The email address is badly formatted.')),
  password: v.pipe(v.string(), v.minLength(8, 'Your password must have 8 characters or more.')),
});

type SignupForm = v.InferInput<typeof SignupSchema>;

export const useFormLoader = routeLoader$<InitialValues<SignupForm>>(() => ({
  username: '',
  email: '',
  password: '',
}));

export default component$(() => {
  const nav = useNavigate();
  const titleText = useSignal<string>('Sign Up');
  const eraseKey = useSignal<number | null>(null);
  const switchingTo = useSignal<'login' | null>(null);
  const formWrap = useSignal<HTMLElement>();
  const authContainer = useSignal<HTMLElement>();
  const descText = useSignal<HTMLElement>();
  const titleStartKey = useSignal<number>(0);

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

  const [, { Form: MForm, Field }] = useForm<SignupForm>({
    loader: useFormLoader(),
    validate: valiForm$(SignupSchema),
  });

  // username availability signals
  const checkingUsername = useSignal(false);
  const usernameAvailable = useSignal<boolean | null>(null);
  const usernameTryLater = useSignal(false);
  const usernameTimer = useSignal<number | null>(null);
  const usernameCurrent = useSignal('');
  const usernameEditing = useSignal(false);
  const cardError = useSignal(false);
  const usernameTaken = useSignal(false);
  const emailTaken = useSignal(false);
  const emailEditing = useSignal(false);
  const passwordEditing = useSignal(false);

  // Ensure the title types on arrival/resume (belt-and-suspenders with qvisible)
  useTask$(() => {
    try { titleStartKey.value = Date.now(); } catch { /* ignore */ }
  });

  // submission state for the signup form
  const submitting = useSignal(false);
  const serverError = useSignal<string | null>(null);

  const checkUsername = $(async (value?: string) => {
    if (!value || value.trim().length < 2) {
      usernameAvailable.value = null;
      usernameTryLater.value = false;
      serverError.value = null;
      cardError.value = false;
      return;
    }
    checkingUsername.value = true;
    usernameTryLater.value = false;
    try {
      const res = await api<{ available: boolean }>('/api/auth/check_username', {
        query: { u: value.trim() },
      });
      usernameAvailable.value = !!res.available;
      usernameTaken.value = false;
      if (usernameAvailable.value) cardError.value = false;
      serverError.value = null;
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status ?? null;
      if (status === 429) {
        usernameAvailable.value = null;
        usernameTryLater.value = true;
        serverError.value = 'Server busy — please try again in a moment.';
        cardError.value = true;
      } else {
        usernameAvailable.value = null;
        usernameTryLater.value = false;
        serverError.value = 'Unable to check username right now.';
        cardError.value = true;
      }
    } finally {
      checkingUsername.value = false;
    }
  });

  // submission state defined above for handler closures

  const onSubmit$ = $(async (values: SignupForm) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    submitting.value = true;
    try {
      if (usernameAvailable.value === false) {
        cardError.value = true;
        submitting.value = false;
        usernameTaken.value = true;
        serverError.value = 'Username already taken';
        return;
      }
      serverError.value = null;
      const res = await apiFetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(csrfHeader() as any) },
        credentials: 'same-origin',
        body: JSON.stringify(values),
      });
      const ct = res.headers.get('content-type') || '';
      const isJSON = ct.includes('application/json');
      let parsed: any = null;
      if (isJSON) {
        try { parsed = await res.json(); } catch { parsed = null; }
      } else {
        try { const txt = await res.text(); parsed = { text: txt }; } catch { /* ignore */ }
      }

      if (res.ok) {
        submitting.value = false;
        cardError.value = false;
        usernameTaken.value = false;
        emailTaken.value = false;
        try { globalThis.location.assign('/profile'); } catch { await nav('/profile'); }
        return;
      } else {
        const body = parsed;
        const msg = (isJSON ? (body?.message ?? body?.error) : null) ?? (res.status === 409 ? 'Username or email already taken' : `Signup failed (status ${res.status})`);
        serverError.value = msg;
        if (res.status === 409) {
          const lower = String(body?.message || body?.error || '').toLowerCase();
          if (lower.includes('username')) {
            usernameTaken.value = true; cardError.value = true; usernameAvailable.value = false;
          } else if (lower.includes('email')) {
            emailTaken.value = true; cardError.value = true;
          }
        }
      }
    } catch {
      serverError.value = 'Network error during signup';
    } finally {
      submitting.value = false;
    }
  });

  // no-op

  return (
    <main class="min-h-screen grid place-items-center p-6 pt-20 md:pt-24">
      <div class="w-full max-w-2xl" ref={el => (authContainer.value = el)}>
        <div class="mb-4">
          <BackButton class="mb-2" fallbackHref="/login" />
          <TypeTitle
            text={titleText.value}
            class="text-3xl font-semibold tracking-tight"
            startDelayMs={200}
            speedMs={45}
            suppressTyping={false}
            cache={false}
            resetOnReload
            startKey={titleStartKey.value}
            eraseKey={eraseKey.value}
            onErased$={$(() => {
              if (switchingTo.value === 'login') {
                const navDelay = 180;
                setTimeout(() => { try { void nav('/login'); } catch { /* ignore */ } }, navDelay);
              }
            })}
          />
          <p class="text-base-content/70 mt-2" ref={(el) => (descText.value = el as any)}>Create your account. Please enter your details.</p>
        </div>
        <div class="mt-4" ref={formWrap}>
          <AuthCard borderless error={cardError.value}>
            <MForm onSubmit$={onSubmit$}>
              {serverError.value && (
                <div class="alert alert-error mb-3" role="alert">
                  <span>{serverError.value}</span>
                </div>
              )}
              <Field name="username">
                {(field, props) => (
                  <div class="form-control">
                    <label class="label" aria-label="Username">
                      <span class="label-text">Username</span>
                    </label>
                    <input
                      {...props}
                      name="username"
                      type="text"
                      placeholder={(!usernameEditing.value && (usernameAvailable.value === false || usernameTaken.value))
                        ? 'Username already taken'
                        : (!usernameEditing.value && field.error ? field.error : 'Choose a username')}
                      class={`pill-input w-full ${
                        (!usernameEditing.value && (usernameAvailable.value === false || usernameTaken.value || !!field.error))
                          ? 'is-warning ring-1 ring-warning text-warning'
                          : ''
                      }`}
                      required
                      minLength={2}
                      aria-invalid={(!usernameEditing.value && (usernameAvailable.value === false || usernameTaken.value || !!field.error)) ? 'true' : undefined}
                      autoComplete="username"
                      inputMode="text"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellcheck={false as any}
                      onBlur$={$((e: Event, el?: Element) => { try { (props as any).onBlur$?.(e, el as any); } catch { /* ignore */ } ; usernameEditing.value = false; checkUsername((e.target as HTMLInputElement).value); })}
                      onInput$={$((e: Event, el?: Element) => {
                        try { (props as any).onInput$?.(e, el as any); } catch { /* ignore */ }
                        usernameEditing.value = true;
                        usernameCurrent.value = (e.target as HTMLInputElement).value;
                        serverError.value = null; cardError.value = false; usernameTryLater.value = false; usernameTaken.value = false; usernameAvailable.value = null;
                        if (usernameTimer.value) { clearTimeout(usernameTimer.value); usernameTimer.value = null; }
                        usernameTimer.value = (setTimeout(() => { checkUsername((e.target as HTMLInputElement).value); usernameTimer.value = null; }, 300) as unknown) as number;
                      })}
                    />
                    {/* Error text moved into placeholder; no below-field error */}
                  </div>
                )}
              </Field>

              <Field name="email">
                {(field, props) => (
                  <div class="form-control">
                    <label class="label" aria-label="Email">
                      <span class="label-text">Email</span>
                    </label>
                    <input
                      {...props}
                      name="email"
                      type="email"
                      placeholder={emailTaken.value
                        ? 'Email already taken'
                        : (!!field.error && !emailEditing.value ? field.error : 'you@example.com')}
                      class={`pill-input w-full ${ (emailTaken.value || (!!field.error && !emailEditing.value)) ? 'is-warning ring-1 ring-warning text-warning' : ''}`}
                      aria-invalid={(emailTaken.value || (!!field.error && !emailEditing.value)) ? 'true' : undefined}
                      required
                      autoComplete="email"
                      onInput$={$((e: Event, el?: Element) => { try { (props as any).onInput$?.(e, el as any); } catch { /* ignore */ } ; emailEditing.value = true; emailTaken.value = false; serverError.value = null; cardError.value = false; })}
                      onBlur$={$((e: Event, el?: Element) => { try { (props as any).onBlur$?.(e, el as any); } catch { /* ignore */ } ; emailEditing.value = false; })}
                    />
                  </div>
                )}
              </Field>

              <Field name="password">
                {(field, props) => (
                  <div class="form-control">
                    <label class="label" aria-label="Password">
                      <span class="label-text">Password</span>
                    </label>
                    <input
                      {...props}
                      name="password"
                      type="password"
                      placeholder={(field.error && !passwordEditing.value) ? field.error : 'Create a password'}
                      class={`pill-input w-full ${(!passwordEditing.value && field.error) ? 'is-warning ring-1 ring-warning text-warning' : ''}`}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      onInput$={$((e: Event, el?: Element) => { try { (props as any).onInput$?.(e, el as any); } catch { /* ignore */ } ; passwordEditing.value = true; })}
                      onBlur$={$((e: Event, el?: Element) => { try { (props as any).onBlur$?.(e, el as any); } catch { /* ignore */ } ; passwordEditing.value = false; })}
                    />
                  </div>
                )}
              </Field>

              <button type="submit" class="btn-cta w-full mt-5" disabled={submitting.value} aria-busy={submitting.value}>
                {submitting.value ? 'Signing up…' : 'Sign Up'}
              </button>
            </MForm>

            {/* Social auth removed as requested */}

            <p class="text-sm text-center mt-3">
              Already have an account? <a href="/login" class="link" preventdefault:click onClick$={$((e: Event) => {
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
                try { void nav('/login'); } catch { /* ignore */ }
                // Fast safety fallback: if SPA nav fails, force navigation
                setTimeout(() => {
                  try {
                    if ((globalThis.location?.pathname || '') === '/signup') {
                      globalThis.location.assign('/login');
                    }
                  } catch { /* ignore */ }
                }, 220);
              })}>Login</a>
            </p>
          </AuthCard>
        </div>
      </div>
    </main>
  );
});

export const head: DocumentHead = {
  title: 'Sign Up | Stack',
  meta: [
    { name: 'description', content: 'Create your Stack account to start building and personalize your experience.' },
  ],
};
