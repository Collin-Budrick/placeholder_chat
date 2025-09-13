# Placeholder_Chat

Website, App, and Desktop application for a chat app created with performance in mind. Using LynxJS, Qwik (SSR), SolidJS server islands, Tauri, Rust, and more.

For contributors: please read AGENTS.md first — it captures our stack, patterns, and safety rules to keep diffs small and correct.

See: [AGENTS.md](AGENTS.md)

## Prerequisites

- Bun 1.x installed and on PATH (https://bun.sh)
- Node.js 18+ (some tooling/scripts invoke `node` and `vite`)
- Rust toolchain + Cargo (stable) for the gateway and desktop app

Install dependencies (workspace root):

```sh
bun install
```

### Web (apps/web) Scripts

Run these from `apps/web` unless noted.

- build: `bunx vite build` — client build (writes `dist/`).
- build:client: `bunx vite build` — alias of build.
- build.types: `bunx -p typescript@5.9.2 tsc --incremental --noEmit` — typecheck only.
- build:ssg: `bunx vite build && bunx vite build -c adapters/static/vite.config.ts` — client + SSG/SSR builds (also writes visualizer reports: `dist/stats.html`, `server/stats-ssg.html`).
- dev:web: `bun ../../scripts/dev-env.js` — local SSR dev via Vite.
- dev:web:nohmr: `bun ../../scripts/dev-nohmr.js` — run SSR dev without HMR.
- dev.public: `vite --mode ssr --host 0.0.0.0` — bind dev server on all interfaces.
- dev.debug: `bun --inspect-brk ./node_modules/vite/bin/vite.js --mode ssr --force` — debug SSR dev.
- docker:dev: `bun ./scripts/docker-dev-proxy.cjs` — HTTPS via Traefik (5173), gateway, Vite (5174).
- docker:prod: `bun ./scripts/docker-prod-proxy.cjs` — prod-like HTTPS preview via Traefik.
- fmt:fix: `bunx -p prettier@3.6.2 prettier --write "**/*.{md,json,css,scss,html,yaml,yml}"` — format non-code files (Prettier intentionally not used for TS/JS).
- fmt:check: `bunx -p prettier@3.6.2 prettier --check "**/*.{md,json,css,scss,html,yaml,yml}"` — check non-code formatting.
- biome:check: `biome check src --max-diagnostics=500` — lint and diagnostics for source code.
- biome:fix: `biome check --write src --max-diagnostics=500` — apply Biome fixes/formatting for code.
- test.e2e: `bunx -p @playwright/test@1.55.0 playwright test` — run Playwright tests in `tests/`.


### Analyze unused files/exports with Knip

From the repo root, a convenience script is available to run Knip against the web app:

```powershell
bun run knip
```

It executes (Windows/PowerShell):

```powershell
& { Set-Location 'apps/web'; Set-Item -Path Env:KNIP -Value '1'; bunx knip }
```

Cross‑platform alternative (run from the web app):

```bash
cd apps/web && KNIP=1 bunx knip
```

## Develop (all services)

Run the full dev stack (shared package watch, gateway, web/Vite, Lynx launcher, desktop auto-run):

```sh
bun run dev:all
```

What happens:
- Starts TypeScript watch for `packages/shared`.
- Runs the Rust gateway in dev mode.
- Starts the web app (Vite, SSR mode). Default dev URL is https://localhost:5173 (auto-discovered across 5173–5180).
- Launches the Lynx explorer helper and the desktop app once the dev URL is available.
- Writes a combined log to `logs/dev-all.log`. Stop with Ctrl+C.

Useful env vars:
- `WEB_FORCE_URL` or `DEV_SERVER_URL` or `LAN_DEV_URL`: override the dev URL the stack should use (e.g. `https://192.168.1.10:5173`).
- `NO_HTTPS=1`: prefer `http` scheme for local URLs (default is `https`).
- `NO_HMR=1`: disable Vite HMR/WebSocket for bfcache/fire-drill testing. The dev server will run without HMR and avoid injecting the client.
- `LYNX_QR_PORT` (default `3000`), `LYNX_HOST`, `LYNX_PORT_RANGE` (e.g. `5173-5180`).
- `WAIT_TIMEOUT_MS` (default `120000`), `WAIT_POLL_MS` (default `400`).

Troubleshooting:
- If the desktop app fails to start, ensure Rust is installed and any platform prerequisites for Tauri/GUI apps are set up.
- For HTTPS warnings locally, trust the self-signed certificate in your browser or set `NO_HTTPS=1`.

## Production Preview (build + HTTPS preview)

Build and run a production-like preview server over HTTPS:

```sh
bun run prod:all
```

What happens:
- Builds `packages/shared` and the web preview/SSR bundle.
- Starts a local HTTPS proxy to `vite preview` so you get TLS + HSTS.
- Listens on `HOST` (default `0.0.0.0`) and `PORT`/`WEB_PORT` (default `5173`).

Performance checks:
- For the most production‑like perf, prefer the Docker prod preview: `bun run docker:prod`.
- That stack serves SSG on `5174` behind Traefik TLS on `5173` (same routing as real prod).
- Run Lighthouse against `https://<LAN-IP>:5173/` for realistic results (H2/H3, edge compression, cache headers).

TLS options:
- Provide your own certs with env vars (any of):
  - `DEV_TLS_KEY_FILE` + `DEV_TLS_CERT_FILE`
  - or `TLS_KEY_FILE` + `TLS_CERT_FILE`
  - or `SSL_KEY_FILE` + `SSL_CERT_FILE`
- If none are provided, an in-memory self-signed cert is used (browser will warn).

## Run With Docker

This repo includes Bun-driven helper scripts and Compose files for both dev (with HMR) and prod (SSG preview) behind Traefik with HTTPS on port `5173`.

### Docker + Bun Scripts

Recommended first-time setup for trusted HTTPS on your LAN (Windows PowerShell step is optional but recommended):

```sh
# 1) Generate a LAN-trusted dev certificate with mkcert (host machine)
bun run mkcert:lan

# 2) Open firewall for TCP/UDP 5173 (Windows)
pwsh scripts/windows-open-ports.ps1 -Port 5173

# 3) Launch dev (web + gateway + Traefik, HTTPS via 5173)
bun run docker:dev
```

Open `https://<your-lan-ip>:5173/` from phones/laptops on the same network. The web app proxies `/api` to the Rust gateway inside Docker.

Available scripts (Bun only):

```sh
# Write PUBLIC_IP/HMR_HOST into .env (called by other scripts automatically)
bun run docker:env

# Dev: web (Vite+HMR, SSR), gateway, Traefik (HTTPS 5173); direct Vite HTTP at 5174
bun run docker:dev

# Dev (SSG + live reload, no HMR): fast static rebuild loop
bun run docker:dev:ssg

# Prod preview: SSG web on 5174, Traefik fronts HTTPS on 5173, gateway behind /api
bun run docker:prod

# Build gateway images with BuildKit + cargo-chef cache
bun run docker:build:gateway:dev   # dev base (sccache, cargo)
bun run docker:build:gateway:prod  # minimal runtime image

# Force a clean rebuild of gateway images (still benefits from cache mounts)
bun run docker:rebuild-gateway

# Safely prune caches (prompts): BuildKit + named volumes (cargo-*/sccache)
bun run docker:cache:prune
# Non-interactive examples:
bun scripts/docker-cache-prune.mjs --buildkit --yes
bun scripts/docker-cache-prune.mjs --volumes  --yes
bun scripts/docker-cache-prune.mjs --all      --dry-run

# Legacy/advanced (optional)
bun run docker:up      # base compose
bun run docker:uph3    # base + HTTP/3 overlay
bun run docker:devall  # monolithic dev-all compose
```

Ports and endpoints:
- HTTPS entry (Traefik): `5173/tcp` (and `5173/udp` for HTTP/3). Visit `https://localhost:5173/` or `https://<LAN-IP>:5173/`.
- Vite dev server (HTTP): `5174` (direct access: `http://localhost:5174/`).
- Gateway service: proxied at `https://<LAN-IP>:5173/api`.

TLS/certificates:
- `bun run mkcert:lan` installs mkcert’s local CA (host) and generates `apps/web/certs/dev.(crt|key)` covering `localhost`, `127.0.0.1`, and your `PUBLIC_IP` from `.env`.
- Traefik loads that cert and serves HTTPS for both dev and prod composes.
- For other devices, install mkcert’s root CA on those devices to avoid warnings (`mkcert -CAROOT`).

## Documentation

- Frontend Guide: Qwik + Tailwind v4 + DaisyUI v5 + Auth.js + Modular Forms + Valibot + Vite
  - `.clinerules/frontend_docs.md`
  - Direct link: [.clinerules/frontend_docs.md](.clinerules/frontend_docs.md)
- Backend Guide: Axum gateway, redb storage, bus, JWT auth, WebSockets, TLS/rustls notes
  - `.clinerules/backend_docs.md`
  - Direct link: [.clinerules/backend_docs.md](.clinerules/backend_docs.md)

## Compression Policy (Traefik vs build‑time)

- With Traefik (including HTTP/3 overlay), prefer compression at the edge and skip build‑time precompression.
  - Default compose files enable Traefik compression; Vite’s build‑time compression stays disabled by default.
  - Leave `ASSET_COMPRESSION` unset in Docker to avoid duplicate work.
- For static hosting without Traefik, enable precompressed assets:
  - Set `ASSET_COMPRESSION=1` to emit Brotli (`.br`) files (default),
  - Optionally add `ASSET_GZIP=1` to also emit `.gz` files.
  - Note: Don’t enable both edge compression and build‑time compression for the same environment.

## CI / Cache Hygiene

Build caches (sccache, BuildKit, cargo registry/git) will grow over time. Prune monthly to keep runners healthy.

- Safe monthly prune examples:

  ```sh
  # BuildKit only (Docker layer cache)
  bun scripts/docker-cache-prune.mjs --buildkit --yes

  # Named volumes (cargo-*/sccache) — keeps image layers
  bun scripts/docker-cache-prune.mjs --volumes --yes

  # All caches (use with care on CI runners)
  bun scripts/docker-cache-prune.mjs --all --yes
  ```

- Tip: schedule in CI or a local cron; the script is idempotent and prints what it removes.

## Gateway Performance Notes

- Docker builds: The gateway image is built in release mode with `cargo-chef` and `sccache` for fast incremental rebuilds. See `docker/gateway.Dockerfile`.
- Bare‑metal runs: To enable architecture‑specific optimizations on your local machine, you can run the gateway with:

  ```sh
  RUSTFLAGS="-C target-cpu=native" cargo run -p gateway --release
  ```

  Do not set this in shared Docker images or CI, since it embeds host‑specific instructions.

- Logging baseline: For cleaner logs under load, set a quieter default filter:

  ```sh
  # Shell (affects all binaries using `tracing_subscriber` env filter)
  export RUST_LOG="warn,tower_http=info"

  # Or override only docker-compose runs
  RUST_LOG="warn,tower_http=info" bun run docker:dev
  ```

  Compose files default to this baseline, but you can override by exporting `RUST_LOG`.
