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

This repo includes a Traefik gateway and dev containers for the web app and Lynx tool. To run the stack with HTTPS on port 5173 (and HTTP/3/UDP when supported), use the base compose file plus the HTTP/3 overlay:

```sh
docker compose -f docker-compose.yml -f docker-compose.h3.yml up -d --force-recreate
```

Notes:
- Traefik listens on `5173/tcp` and `5173/udp`. Visit `https://localhost:5173/` or `https://<your-lan-ip>:5173/`.
- Dev certificates are mounted from `apps/web/certs` (self-signed). Your browser may prompt to trust them.
- To stop the stack: `docker compose down` (use the same `-f` files if needed).

## Documentation

- Frontend Guide: Qwik + Tailwind v4 + DaisyUI v5 + Auth.js + Modular Forms + Valibot + Vite
  - `.clinerules/frontend_docs.md`
  - Direct link: [.clinerules/frontend_docs.md](.clinerules/frontend_docs.md)
- Backend Guide: Axum gateway, redb storage, bus, JWT auth, WebSockets, TLS/rustls notes
  - `.clinerules/backend_docs.md`
  - Direct link: [.clinerules/backend_docs.md](.clinerules/backend_docs.md)
