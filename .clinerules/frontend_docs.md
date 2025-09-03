# Frontend Stack Reference (Qwik + Tailwind v4 + DaisyUI v5 + Auth.js + Modular Forms + Valibot + Vite)

This document centralizes key docs, patterns, and project-specific notes for the web frontend in this repo.

Versions (from apps/web/package.json where applicable)
- Qwik / Qwik City: ^1.16.0
- Tailwind CSS: ^4.1.12
- DaisyUI: ^5.0.50
- Vite: 7.1.3
- TypeScript: 5.9.2
- ESLint: 9.34.0
- Prettier: 3.6.2

Core project files (examples)
- Route guard: apps/web/src/routes/admin/layout.tsx
- Admin users page: apps/web/src/routes/admin/users/index.tsx
- Login page: apps/web/src/routes/login/index.tsx
- Signup page: apps/web/src/routes/signup/index.tsx
- Auth config: apps/web/src/routes/plugin@auth.ts
- HTTP wrapper/logging: apps/web/src/lib/http.ts
- Gateway helpers: apps/web/src/lib/gateway.ts
- Global CSS (Tailwind/DaisyUI): src/global.css (see repo rules)

--------------------------------------------------------------------------------
Qwik + Qwik City

What to use it for
- Routing, SSR loaders/actions, server functions, redirects, request handling.

Key APIs and docs
- routeLoader$: server-only data loading before rendering.
  - Docs: https://github.com/qwikdev/qwik/blob/main/packages/docs/src/routes/docs/(qwikcity)/route-loader/index.mdx
- RequestEvent (redirect/json/text, headers, cookie, env, url, sharedMap).
  - Docs: https://github.com/qwikdev/qwik/blob/main/packages/qwik-city/src/middleware/request-handler/middleware.request-handler.api.md
- Redirect patterns in loaders/handlers.
  - Docs: https://github.com/qwikdev/qwik/blob/main/packages/docs/src/routes/docs/(qwikcity)/guides/redirects/index.mdx
- server$ gotcha: ensure handlers used by UI events are $-wrapped.
  - Docs: https://github.com/qwikdev/qwik/blob/main/packages/docs/src/routes/docs/(qwikcity)/server$/index.mdx

Patterns used in this repo
- Admin guard (apps/web/src/routes/admin/layout.tsx)
  - Validates session expiry and role; redirects to /login with a callbackUrl.
  - Optional improvement: include search params as well:
    throw ev.redirect(302, `/login?callbackUrl=${encodeURIComponent(ev.url.pathname + ev.url.search)}`)
- SSR loader fetch hardening (see Admin Users page)
  - Check content-type and status before json():
    const ct = res.headers.get('content-type') || ''
    const isJSON = ct.includes('application/json')
    const payload = isJSON ? await res.json().catch(() => null) : null
    if (!res.ok) return { error: payload?.message ?? `Failed (status ${res.status})`, status: res.status }
- IPv6/localhost quirk
  - Normalize “localhost” -> “127.0.0.1” when calling the gateway in SSR to avoid ::1 vs 0.0.0.0 issues.

--------------------------------------------------------------------------------
Authentication (Auth.js for Qwik)

What to use it for
- Credentials sign-in, session storage, JWT/session callbacks, protected routes.

Key APIs and docs
- Qwik adapter API (QwikAuth$): https://authjs.dev/reference/qwik
- Credentials provider: https://authjs.dev/getting-started/providers/credentials
- Callbacks (jwt, session, redirect): https://authjs.dev/reference/core
- Sign-in Form/action usage: https://authjs.dev/getting-started/session-management/login

Patterns used in this repo
- plugin@auth.ts (apps/web/src/routes/plugin@auth.ts)
  - Credentials authorize() calls gateway /api/auth/login; lifts gateway session JWT from Set-Cookie into Auth.js token.
  - jwt callback enriches token with gateway and role via /api/auth/me.
  - session callback exposes gateway and role to client.
  - redirect callback allows relative/same-origin URLs only.
- Login page (apps/web/src/routes/login/index.tsx)
  - Uses useSignIn (Auth.js action store) and Qwik City Form.
  - Sanitize callbackUrl to avoid loops/same-origin surprises; whitelist common targets (/, /profile, /admin/*).

--------------------------------------------------------------------------------
Forms & Validation (Modular Forms + Valibot)

What to use it for
- Type-safe forms in Qwik, client/server validation, schema-driven rules.

Key APIs and docs
- useForm (Qwik): initialize with routeLoader$, supports action + validate.
  - https://github.com/fabian-hiller/modular-forms/blob/main/website/src/routes/(layout)/[framework]/guides/create-your-form.mdx
- Server-side actions (formAction$) with schema validation:
  - https://github.com/fabian-hiller/modular-forms/blob/main/website/src/routes/(layout)/[framework]/guides/handle-submission.mdx
- Valibot core: pipe/compose, primitives, transforms, safeParse:
  - https://github.com/fabian-hiller/valibot

Patterns used in this repo
- Signup page (apps/web/src/routes/signup/index.tsx)
  - Validates with Valibot (username/email/password).
  - Username availability check (onBlur) via API (recommend adding debounce + 429 handling if moved to keyup).
  - Response parsing should occur once; avoid double res.json() reads.
- Recommended validation timing
  - validate: valiForm$(Schema)
  - Trigger settings as needed (validateOn, revalidateOn) depending on UX.

--------------------------------------------------------------------------------
Tailwind CSS v4 + DaisyUI v5

What to use it for
- Utility-first styling; DaisyUI components; CSS-first plugin setup with Tailwind v4.

Key docs
- Tailwind v4 upgrade + paradigm:
  - https://tailwindcss.com/docs/upgrade-guide
  - @import "tailwindcss"; use @tailwindcss/postcss or @tailwindcss/vite
  - @theme for tokens, @utility for custom utilities.
- DaisyUI v5 on Tailwind v4:
  - https://daisyui.com/docs/v5/
  - Qwik + Vite install (CSS + Vite plugin): https://github.com/saadeghi/daisyui/blob/master/packages/docs/src/routes/(routes)/docs/install/qwik/+page.md

Project specifics
- Global CSS composition (per repo rules):
  - @import "tailwindcss";
  - @plugin "tailwindcss-animate";
  - @plugin "daisyui";
- Use DaisyUI semantic classes (btn, badge, alert, table, etc.) + Tailwind utilities together.
- Custom Themes (optional):
  - @plugin "daisyui/theme" { name: "..."; tokens... }

--------------------------------------------------------------------------------
HTTP Client & Logging (ofetch + fetch)

What to use it for
- Browser/Node/Bun-friendly fetch wrapper with smart parsing, error shape, and hooks.

Key docs
- https://github.com/unjs/ofetch
  - ofetch.create({ baseURL, headers, retry, timeout, onResponseError })
  - Errors are FetchError with .status and .data

Patterns used in this repo
- apps/web/src/lib/http.ts
  - ofetch instance with Accept: application/json and response logging (frontend logs endpoint).
  - apiFetch wrapper around native fetch with logging and response cloning.
- Recommended DRY helper for Bearer header:
  - withAuthHeaders(session) => { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

--------------------------------------------------------------------------------
Build & Dev (Vite)

What to use it for
- Dev server (HMR), build config, env, PostCSS integration.

Key docs
- Vite config: https://vitejs.dev/config/
- TypeScript in Vite: https://vitejs.dev/guide/features.html#typescript
  - isolatedModules: true; add "vite/client" to tsconfig types if needed.
- Tailwind v4 with Vite (recommended):
  - Use @tailwindcss/vite plugin for better integration/perf.

Patterns used in this repo
- Qwik SSR dev: bun run dev (see scripts/start-web-dev.ps1 for stack launch).
- Env access in loaders via requestEvent.env or import.meta.env as appropriate.

--------------------------------------------------------------------------------
TypeScript, ESLint, Prettier, Bun

TypeScript (5.9.2)
- Docs: https://www.typescriptlang.org/docs/
- tsconfig tips with Vite:
  - "isolatedModules": true
  - Include "types": ["vite/client"] if you rely on import.meta.env shims.

ESLint 9 + typescript-eslint
- ESLint: https://eslint.org/docs/latest/
- typescript-eslint: https://typescript-eslint.io/
- For production quality, enable type-aware rules (recommendedTypeChecked | strictTypeChecked | stylisticTypeChecked) in flat config.

Prettier 3
- Docs: https://prettier.io/docs/en/
- Keep Prettier separate from ESLint formatting; rely on Prettier for code style.

Bun
- Docs: https://bun.sh/docs
- Used for dev server (bun run dev) and scripts; Node-API compatibility mostly fine with TS/ESM.

--------------------------------------------------------------------------------
Security & Robustness Notes

Callback URL sanitization
- Accept only:
  - No callbackUrl => fallback '/'
  - '/' | '/profile' | any path under '/admin'
  - Same-origin only; block '/login', '/logout', external, malformed.
- Example whitelist check in login page handler.

CSRF considerations (same-origin mutations)
- If using cookies for auth at any point, add CSRF double-submit:
  - Client: send X-CSRF-Token header matching a non-HttpOnly cookie.
  - Server: verify equality.
- Apply to /api/auth/signup, /api/admin/*, /api/auth/logout (as relevant in your topology).

Loader JSON parsing guard
- Do not call res.json() blindly; check content-type and res.ok; handle 204 gracefully.

Avoid double reading response bodies
- Parse once and reuse the parsed result; do not call res.json() again on the same Response.

Bearer header DRY helper
- Implement withAuthHeaders(session) and reuse in promote/demote/delete actions.

Session typing
- Define a central Session type to avoid (session.value as any) usage and drift across pages.

--------------------------------------------------------------------------------
Common Recipes

SSR fetch to gateway with cookies + Bearer
- Forward incoming cookies for SSR:
  const cookieHeader = ev.request.headers.get('cookie') ?? ''
- Forward Auth.js-enriched gateway Bearer when present (ev.sharedMap.get('session') or via useSession on client calls).

Admin role enforcement
- onRequest in admin layout checks session expiration and role; redirect to login with callbackUrl.

Users page loader (safe parse)
- Return { users: User[] } on success or { error, status } on error; UI shows error banner.

Signup pattern
- Submit JSON, parse once, show clear user-facing messages (409 => taken; else status).

Username availability
- On blur: current safe default.
- If switching to keyup: debounce 250–400ms, treat 429 as “unknown, try later”, use AbortController.

--------------------------------------------------------------------------------
Notable syntactic changes to watch for (latest releases)

Qwik / Qwik City
- server$ / $ wrapping: code executed on the client that calls server$ must ensure handlers are properly $-wrapped to avoid serialization/runtime errors:
  // Bad: may fail to serialize
  onClick$={() => server$(() => doServerThing())}
  // Good:
  onClick$={$(() => server$(() => doServerThing()))}

- RequestEvent APIs are stable but check method/name changes for newer versions; prefer using RequestEvent methods (redirect/json/text) rather than mutating response objects directly.

Tailwind CSS v4
- CSS-first imports: v4 prefers `@import "tailwindcss";` in your CSS instead of v3's `@tailwind base/components/utilities`. If you still use v3 directives the build may warn or require compatibility flags.
  Old (v3):
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
  New (v4):
    @import "tailwindcss";

- Built-in features: v4 handles imports, nesting and autoprefixing internally. Remove `postcss-import` and `autoprefixer` from PostCSS config when using the new plugin.
- New plugin API: @utility / @theme are CSS-first. Custom utilities now prefer `@utility` over `@layer utilities`.

DaisyUI v5
- CSS-based plugin: DaisyUI v5 integrates using the `@plugin "daisyui"` directive in CSS rather than requiring JS `require('daisyui')` in `tailwind.config.js`. If you previously configured daisyUI in tailwind.config, migrate to CSS plugin usage:
  @import "tailwindcss";
  @plugin "daisyui";

Auth.js (Qwik adapter)
- Config surface: Auth.js consolidated into project-agnostic package names (Auth.js). Callback signatures are similar but pay attention to redirect callback behavior: Auth.js will call redirect and expects safe same-origin relative handling. Keep redirect callback defensive:
  async redirect({ url, baseUrl }) {
    if (url.startsWith('/')) return `${baseUrl}${url}`;
    try { if (new URL(url).origin === baseUrl) return url; } catch { }
    return baseUrl;
  }

- Session strategy: default remains 'jwt' unless adapter used, but cookie options and names may differ between versions — use explicit cookie config in QwikAuth$ if you rely on exact cookie names.

Modular Forms / Valibot
- Valibot pipe/async API: valibot has been moving toward `v.pipe` and `v.pipeAsync` style and `safeParse`/`safeParseAsync` for non-throwing validation. When upgrading, replace older transform chains with `pipe` where applicable:
  const schema = v.pipe(v.string(), v.email());
- Modular Forms Qwik: validation helpers are QRL-based (valiForm$). Watch for any rename of valiForm$ vs valiForm (diffs between framework adapters). Use the Qwik-specific valiForm$.

ofetch
- ofetch auto-parses by default and will throw FetchError for non-ok responses. Newer versions expose `.data` on the thrown error and provide `ignoreResponseError` to avoid thrown errors:
  await ofetch('/url', { ignoreResponseError: true });
- ofetch.create(...) remains the recommended pattern to centralize baseURL, headers, and hooks (onRequest/onResponse/onResponseError).

Vite
- Config helpers: defineConfig continues to be the primary helper; however plugin ecosystems (tailwind's @tailwindcss/vite) are recommended over PostCSS integration when using Tailwind v4.
- import.meta.env typing: ensure `tsconfig` includes `"types": ["vite/client"]` to keep shims available.
- watch `optimizeDeps` changes if third-party ESM packages behave differently in newer Vite releases.

TypeScript / Tooling
- isolatedModules: required for Vite since esbuild transpiles without type-check; enable `tsc --noEmit` in CI or use a type checker plugin.
- Prettier v3: may change some formatting defaults (check project Prettier config).
- ESLint + typescript-eslint: prefer type-aware rules in CI; enable `parserOptions.project` for rules requiring type information if you run type-checked lint.

--------------------------------------------------------------------------------
Reference Links (Quick)
- Qwik City: routeLoader$ (server-only data): see above
- Qwik RequestEvent API: see above
- Qwik server$ gotcha: see above
- Auth.js Qwik adapter + callbacks: https://authjs.dev/reference/qwik
- Tailwind v4 upgrade & @tailwindcss/vite: https://tailwindcss.com/docs/upgrade-guide
- DaisyUI v5 + Tailwind v4 CSS plugin: https://daisyui.com/docs/v5/
- Modular Forms Qwik + Valibot: see above
- Valibot core: https://github.com/fabian-hiller/valibot
- ofetch: https://github.com/unjs/ofetch
- Vite config: https://vitejs.dev/config/
- TypeScript docs: https://www.typescriptlang.org/docs/
- ESLint 9 + typescript-eslint: https://typescript-eslint.io/
- Prettier 3: https://prettier.io/docs/en/
- Bun: https://bun.sh/docs

--------------------------------------------------------------------------------