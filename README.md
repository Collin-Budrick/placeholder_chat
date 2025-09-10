# goguma_chat

Website, App, and Desktop application for a chat app created with performance in mind. Using LynxJS, Qwik (SSR), SolidJS server islands, Tauri, Rust, and more.

## Prerequisites

- Bun 1.x installed and on PATH (https://bun.sh)
- Node.js 18+ (some tooling/scripts invoke `node` and `vite`)
- Rust toolchain + Cargo (stable) for the gateway and desktop app

Install dependencies (workspace root):

```sh
bun install
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
