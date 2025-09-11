# AGENTS.md

This file guides AI agents working in this repository. It encodes our stack choices, patterns, commands, and safety rules so agents produce small, correct, Bun-first changes across all components (web, gateway, crates, lynx, desktop, mobile).

Note: Bun only. Do not use npm, pnpm, or yarn in commands or instructions.

## Do
- Use Qwik + Qwik City in `apps/web` for routes, SSR loaders/actions, and server utilities.
- Use Tailwind v4 and DaisyUI v5 classes; prefer semantic DaisyUI components (btn, card, alert, table, etc.).
- Reuse helpers in `apps/web/src/lib` (e.g., `http.ts` `api`/`postJson`/`apiFetch`, logging, csrf helpers) instead of new fetch wrappers.
- Validate responses: check `content-type` and `response.ok` before parsing JSON in loaders and actions.
- Prefer small, focused components and small diffs; co-locate logic near usage.
- In SSR, normalize `localhost` to `127.0.0.1` when calling the gateway to avoid IPv6 (::1) quirks.
- For forms in Qwik, prefer Modular Forms + Valibot patterns used in `apps/web/src/routes/signup/`.
- For backend routes, compose per-scope middleware with Axum `route_layer` and `ServiceBuilder` like `apps/gateway/src/main.rs`.
- Use existing tables, storage helpers, and pub/sub APIs from workspace crates when adding backend features.
- Use Bun for all JS/TS tasks; use Cargo for Rust tasks.

## Don’t
- Don’t hard-code colors or theme values; use Tailwind/DaisyUI tokens and utilities, or the styled-system tokens.
- Don’t fetch directly inside components when a loader/action suffices; keep data access in route loaders/actions.
- Don’t introduce new heavy dependencies without approval; prefer existing stack.
- Don’t run full project builds by default; prefer file- or package-scoped checks.
- Don’t parse the same Response body twice; clone once if you must log.
- Don’t guess API shapes; use gateway endpoints documented below and reuse the shared helpers.

## File-Scoped Commands (Bun + Cargo)
Use these targeted commands for faster feedback. Run them from repo root unless noted; use `cd` into the package when needed.

- Type check TS (single file): `cd apps/web && bunx tsc --noEmit src/path/to/File.tsx`
- Format a file: `bunx prettier --write path/to/file.{ts,tsx,js,css,md}`
- Lint a file: `cd apps/web && bunx eslint --fix src/path/to/File.tsx`
- E2E test (single spec): `cd apps/web && bunx playwright test tests/path/to/spec.spec.ts`
- Qwik types for web (project): `cd apps/web && bun run build.types`
- Shared lib build: `cd packages/shared && bun run build`
- Rust format (single file): `cargo fmt -- path/to/file.rs`
- Rust clippy (crate): `cargo clippy -p gateway -- -D warnings`
- Rust check (crate): `cargo check -p gateway`
- Rust tests (crate): `cargo test -p gateway`

Full builds only when explicitly requested:
- Web build (client+ssg): `cd apps/web && bun run build:ssg`
- Dev all: `bun run dev:all`
- Docker dev (web + gateway + traefik): `bun run docker:dev`

## Safety and Permissions

Allowed without prompt:
- Read/list files.
- File-scoped checks: `bunx tsc`, `bunx eslint`, `bunx prettier`, Playwright single-spec.
- Rust checks: `cargo check`, `cargo fmt` (single file), `cargo clippy` (current crate), `cargo test -p <crate>`.

Ask first:
- Package installs/changes: `bun add/remove`, editing lockfiles.
- Running full builds (`bun run build:*`, `bun run docker:*`, `docker compose up`), or starting long-running dev processes.
- Deleting or renaming files, chmod, or changing CI/CD and Docker/Trafik configs.
- Network calls to external services in scripts/tools beyond local dev/gateway.
- `git push` or any release/publish action.

## Project Structure
- Web app (Qwik): `apps/web`
  - Routes: `apps/web/src/routes/*`
  - Components: `apps/web/src/components/*`
  - Libs: `apps/web/src/lib/*` (HTTP, logging, csrf, etc.)
  - Global CSS: `apps/web/src/global.css` (Tailwind v4 + DaisyUI v5)
  - Styled system/tokens: `apps/web/styled-system/*`, `apps/web/panda.config.ts`
- Gateway (Axum): `apps/gateway` (see `apps/gateway/src/main.rs`)
- Rust crates (shared services): `crates/*` (storage, auth, bus, rooms, presence, rate, proto, domain, ipc)
- Lynx shell (React via rspeedy): `apps/lynx` (pages in `src/pages/*`)
- Desktop (Tauri + Rust): `apps/desktop`
- Mobile (Rust): `apps/mobile` (see `apps/mobile/src/tokens.rs`, `apps/mobile/lynx.tokens.css`)
- Shared TS library: `packages/shared`
- Infra: `docker-compose*.yml`, `traefik/dynamic.yml`, Dockerfiles under `docker/`
- Scripts: `scripts/*.js|*.mjs|*.ps1` (dev orchestration; many already Bun-friendly)

## File Usage

These pointers help agents find the right files quickly. Each entry lists a path and a concise purpose to guide searches and edits.

### Web (Qwik)
- `apps/web/src/root.tsx`: App root. Sets up QwikCityProvider, `<RouterOutlet>`, `<RouterHead>`, loads `global.css` and theme init script.
- `apps/web/src/routes/layout.tsx`: Global layout wrapper. Adds cache/security headers, enables prerender, declares SSG route list, renders nav/scroll helpers.
- `apps/web/src/routes/index.tsx`: Landing page and examples. Prerendered; showcases components and motion.
- `apps/web/src/routes/login/index.tsx`: Client-only login page. Posts to `/api/auth/login`, shows animated auth UI, handles errors, links to signup.
- `apps/web/src/routes/signup/index.tsx`: Signup form using Modular Forms + Valibot. Checks username availability, posts to `/api/auth/signup` with CSRF, handles 409.
- `apps/web/src/routes/profile/index.tsx`: Profile page. Client-side session check (`/api/auth/me`), shows role, logout button, link to admin.
- `apps/web/src/routes/admin/layout.tsx`: Admin route guard. Client-side gate that validates admin via `/api/auth/me`, redirects to login if not authorized.
- `apps/web/src/routes/admin/users/index.tsx`: Admin users table. Lists users and performs promote/demote/delete via `/api/admin/*` endpoints with CSRF.
- `apps/web/src/components/auth/AuthCard.tsx`: Reusable card wrapper for auth pages. Supports error and borderless states.
- `apps/web/src/components/BackButton.tsx`: Animated back button with safe navigation heuristics (avoids auth/protected bounces).
- `apps/web/src/components/Hero.tsx`: Home page hero component and CTA layout.
- `apps/web/src/lib/http.ts`: HTTP utilities. `api` (ofetch instance with logging), `postJson`, and `apiFetch` (logs request/response); SSR baseURL logic and IPv4 normalization.
- `apps/web/src/lib/log.ts`: Frontend logging helper. Redacts sensitive headers/body and posts entries to `/api/frontend-logs`.
- `apps/web/src/lib/csrf.ts`: CSRF double-submit helpers. Generates `csrfToken` cookie and provides `X-CSRF-Token` header.
- `apps/web/src/global.css`: Tailwind v4 + DaisyUI v5 global styles, animations, utilities, and component theme rules.
- `apps/web/vite.config.ts`: Vite config for Qwik. TLS helpers, optional mkcert, preview headers middleware, PWA optional plugin.
- `apps/web/panda.config.ts` and `apps/web/styled-system/*`: Styled-system tokens and utilities for design-tokens-driven styles.
- `apps/web/playwright.config.ts` and `apps/web/tests/*.spec.ts`: E2E tests and Playwright config.
- `apps/web/scripts/dev-with-env.js`: Starts dev SSR with environment wiring (ports, HTTPS, proxy hints).
- `apps/web/scripts/preview.express.cjs`: Serves built SSG from `dist` for preview behind Traefik.
- `apps/web/scripts/ssg-watch-routes.mjs` / `apps/web/scripts/ssg-route.mjs`: Rebuild SSG on route changes and one-off route builds.

### Gateway (Axum)
- `apps/gateway/src/main.rs`: Gateway server entry. Defines routes (`/api/auth/*`, `/api/admin/*`, `/rooms/*`, `/ws`, `/healthz`, `/api/frontend-logs`), middleware stack (rate limit, CORS, trace, compression, timeout, CSRF), and graceful shutdown.
- `apps/gateway/Cargo.toml`: Gateway crate config. Declares workspace dependencies (axum, tower-http, redb storage, auth, bus, presence, rate).
- `apps/gateway/admin.seed`: Dev seeding file for admin bootstrap (email/password and helper routes in dev).

### Rust Crates
- `crates/storage/src/lib.rs`: redb-backed storage. Message persistence, per-room sequencing, user/presence/rate/auth tables, snapshot and retention sweep.
- `crates/auth/src/lib.rs`: JWT `create_jwt`/`verify_jwt` and optional OAuth/WebAuthn exports. Central auth helpers used by gateway.
- `crates/bus/src/pubsub.rs`: Pub/Sub abstraction. In-memory (tokio broadcast) default; optional nng/zmq shims. `Publisher`/`Subscriber` API.
- `crates/rooms/src/lib.rs`: Room messaging utilities (assign seq, persist, publish). Used by gateway message endpoints.
- `crates/presence/src/lib.rs`: Presence manager (heartbeats, sweeper) and event publication.
- `crates/rate/src/lib.rs`: Token bucket rate limiter keyed by IP/user; in-process implementation.
- `crates/proto/*` and `crates/proto/build.rs`: Cap’n Proto schemas and codegen for binary RPCs.
- `crates/ipc/src/lib.rs`: IPC helpers for local transports where applicable.

### Shared TS Library
- `packages/shared/src/index.ts`: Shared TypeScript utils/types for web and Lynx. Built via `bun run build`.
- `packages/shared/tsconfig.build.json`: Build configuration for emitting `dist/`.

### Lynx Shell
- `apps/lynx/lynx.config.ts`: Lynx/rspeedy configuration for the shell app.
- `apps/lynx/src/pages/*.tsx`: Shell pages (Login, Signup, Home, etc.). Use for embedded/alt UI flows.
- `apps/lynx/package.json`: rspeedy scripts (`build`, `dev`, `preview`).

### Desktop (Tauri)
- `apps/desktop/src/main.rs`: Rust/Tauri app entry and window management.
- `apps/desktop/tauri.conf.json`: Tauri configuration (permissions, bundling, windows, icons).

### Mobile
- `apps/mobile/src/main.rs`: Mobile entry (Rust). Example integration point for tokens and IPC.
- `apps/mobile/src/tokens.rs` / `apps/mobile/lynx.tokens.css`: Generated design tokens for mobile (Rust/CSS consumers).

### Root Qwik Server
Static assets are served by Bun in Docker and Vite during development. There is no standalone Node server adapter in this repo.

### Infra & Docker
- `docker/web.Dockerfile`: Bun-based builder for Qwik app and static runner image (serves `dist` with Bun).
- `docker/gateway.Dockerfile`: Multi-stage Rust build for gateway using cargo-chef and sccache; slim Debian runtime.
- `docker-compose.dev-web.yml`: Dev stack with SSG builder, preview server, gateway, and Traefik (TLS/H3); routes `/` and `/api`.
- `docker-compose.yml` / `docker-compose.prod.yml` / `docker-compose.h3.yml`: Compose variants for local SSR/prod and HTTP/3.
- `traefik/dynamic.yml`: Traefik file provider for TLS certs and reusable middlewares (security, cache, compression).

### Scripts
- `scripts/dev-all.js`: Orchestrates dev processes (gateway + web + helpers) for local development.
- `scripts/start-gateway.js`: Launches the Rust gateway in dev (with env defaults and ports).
- `scripts/write-public-ip-env.mjs`: Detects/writes public IP-based env for Traefik/web preview URLs.
- `scripts/ssg-watch-routes.mjs` (under `apps/web/scripts`): Monitors routes and rebuilds SSG output incrementally.
- `scripts/preview.express.cjs` (under `apps/web/scripts`): Static HTTP server for prebuilt `dist` during preview.

### Docs & Tokens
- `.clinerules/frontend_docs.md`: Frontend stack reference (Qwik, Tailwind v4, DaisyUI v5, forms, HTTP, build/dev).
- `.clinerules/backend_docs.md`: Backend reference (Axum wiring, middleware, storage, bus, auth, WS, TLS, gotchas).
- `tokens/tokens.json`: Cross-platform design tokens source.
- `tokens/generator.rs` / `tokens/src/main.rs`: Token codegen utilities and Rust tokenizer.

## Good and Bad Examples

Good (copy patterns):
- Qwik routes with loaders/actions and robust fetch handling:
  - `apps/web/src/routes/admin/users/index.tsx`
  - `apps/web/src/routes/login/index.tsx`
  - `apps/web/src/routes/signup/index.tsx`
- Qwik components and UI composition:
  - `apps/web/src/components/auth/AuthCard.tsx`
  - `apps/web/src/components/*` (theme toggle, router head, etc.)
- HTTP + logging helpers:
  - `apps/web/src/lib/http.ts` (ofetch instance, `postJson`, `apiFetch` + logging)
- Axum router and middleware composition:
  - `apps/gateway/src/main.rs` (grouping, `route_layer`, CORS, rate limiting, CSRF, timeouts)
- Storage/pubsub usage and crate organization:
  - `crates/storage/src/lib.rs`, `crates/bus/src/*`, `crates/auth/src/*`

Avoid (don’t copy):
- Direct `fetch` calls in components without going through loaders/actions or `api`/`apiFetch`.
- Blind `res.json()` without content-type/status checks.
- Hard-coded colors or spacing; prefer Tailwind/DaisyUI tokens and utilities.
- Ad-hoc auth/session parsing; reuse helpers and gateway endpoints.
- Adding new styling systems; stick to Tailwind v4 + DaisyUI for web.

## API Docs (derived from gateway)
Gateway base URL (SSR): `http://127.0.0.1:7000` (or `http://gateway:7000` in Docker). Browser requests may use relative `/api/*` via Traefik/Vite proxy.

Auth endpoints:
- `POST /api/auth/login` — credentials login; issues JWT (cookie or bearer). Use `postJson('/api/auth/login', body)`.
- `POST /api/auth/signup` — create user (CSRF protected when using cookies).
- `GET  /api/auth/check_username?u=<name>` — availability check.
- `GET  /api/auth/me` — returns current session/user.
- `POST /api/auth/logout` — logout (CSRF protected when using cookies).

Admin endpoints (require admin; CSRF for unsafe methods):
- `GET    /api/admin/users` — list users.
- `POST   /api/admin/users/{id}/promote` — grant admin.
- `POST   /api/admin/users/{id}/demote` — revoke admin.
- `DELETE /api/admin/users/{id}` — delete user.

Rooms & realtime:
- `GET  /rooms/{room}/history` — fetch message history.
- `POST /rooms/{room}/messages` — append message.
- `GET  /ws?room=<room>&token=<jwt>` — WebSocket.

Frontend logs:
- `POST /api/frontend-logs` — append JSON log entry (NDJSON store).
- `GET  /api/frontend-logs` — read recent logs (dev tooling).

Recommended client usage (web):
- Use `api` (ofetch instance) and `postJson` from `apps/web/src/lib/http.ts` for HTTP calls.
- For SSR loaders/actions, prefer `routeLoader$`/`server$` and inject headers with a helper that adds `Authorization: Bearer <token>` when present.
- Sanitize and whitelist `callbackUrl` paths on auth flows (`/`, `/profile`, `/admin/*`).

## Web Frontend Patterns (from frontend_docs)
- Qwik City loaders/actions: use `routeLoader$` for SSR data and redirect patterns; wrap event handlers in `server$` when needed.
- Auth (Auth.js patterns, if enabled): credentials login posts to gateway and promotes gateway session into Auth.js token/session; session callback exposes `gateway` and `role`.
- Forms: Modular Forms + Valibot. Validate on the server with `formAction$` and on the client with schema.
- Tailwind v4 + DaisyUI v5: `@import "tailwindcss";` in `global.css`, add `@plugin "daisyui";` and other CSS plugins as configured.
- HTTP: prefer `ofetch` via `api` with `onResponseError` logging; for raw fetch, use `apiFetch` so requests are logged.

## Backend Patterns (from backend_docs)
- Router composition: split routes (auth, admin, core) and apply middleware via `route_layer` to avoid 404→401 surprises.
- Middleware order: rate-limit → CORS → trace → compression → timeout (with `HandleErrorLayer`) → body limit.
- CSRF (double-submit cookie) for unsafe methods when cookies are used; auth login is exempt to allow server-side flows.
- Rate limiting: derive key from verified token, cookie, or IP fallback; bypass core auth/health endpoints.
- WebSockets: bounded channels, don’t block runtime; forward from bus to client.
- Storage (redb): persist messages; sequence per room; keep keys stable.
- Auth: JWT issue/verify; refresh tokens; optional OAuth/WebAuthn scaffolding in crates.

## Design System & Tokens
- Web: use Tailwind v4 + DaisyUI v5 classes and theme variables. Prefer semantic classes (`btn-primary`, `card`, `badge`, etc.) with utilities.
- Tokens: prefer Tailwind/DaisyUI theme tokens and the styled-system tokens under `apps/web/styled-system/tokens/*`.
- Cross-platform tokens exist in `tokens/tokens.json` and language-specific variants (e.g., `apps/mobile/src/tokens.rs`, `apps/mobile/lynx.tokens.css`). Reuse generated tokens instead of hard-coding values.

## PR Checklist
- Title: `feat(scope): short description` (or `fix`, `chore`, etc.).
- Web changes: run `bunx prettier`, `bunx eslint`, and `bunx tsc --noEmit` (file or package scope) — all green.
- Rust changes: `cargo fmt`, `cargo clippy -D warnings`, `cargo check`, and relevant `cargo test` — all green.
- Tests: run changed Playwright specs (`cd apps/web && bunx playwright test tests/...`). Add/extend tests for new code paths.
- Diff is small and focused. Include a brief summary of what changed and why.
- Remove excessive logs and stray comments before opening a PR.

## When Stuck
- Ask a clarifying question, propose a short plan, or open a draft PR with notes.
- Don’t push large speculative changes without confirmation.

## Test First Mode (optional)
- New features: write or update unit/e2e tests first, then code to green.
- UI state: prefer component or route tests where practical.
- Regressions: add a failing test that reproduces the bug, then fix to green.

## Tooling Notes
- Bun-only for JS/TS (no npm/pnpm/yarn). Prefer `bunx` for CLIs and `bun run <script>` in package scopes.
- Prefer file/package-scoped commands over repo-wide builds.
- For SSR dev and Docker: use the provided scripts in `package.json` and `scripts/` (`bun run dev:all`, `bun run docker:dev`, etc.).

## Pointers
- More frontend specifics: `.clinerules/frontend_docs.md`
- More backend specifics: `.clinerules/backend_docs.md`
