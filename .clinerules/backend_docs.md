# Backend Reference — gateway & core services

This document captures architecture, patterns, gotchas and actionable guidance for the backend components in this repository (gateway + crates). It mirrors the style of the frontend_docs.md and is intended as a short, high-signal handbook for contributors and maintainers.

Contents
- Quick overview
- Gateway wiring & middleware (Axum + Tower + hyper)
- WebSockets & realtime loop patterns
- Storage model (redb)
- Real-time bus (bus crate / nng/zmq fallbacks)
- Authentication & security (jsonwebtoken, OAuth, WebAuthn)
- Rooms / presence / rate patterns
- Cap’n Proto & IPC notes
- TLS / rustls / tokio-rustls operational notes
- Notable syntactic changes & upgrade gotchas
- Verification checklist + useful commands
- Links & references

---


## Quick overview

Primary components
- apps/gateway — main HTTP/WebSocket gateway (Axum on Tokio, uses tower-http middleware, rustls for TLS in prod).
- crates/storage — embedded DB layer (redb) with tables for messages, users, presence, credentials, rate counters, transient auth state.
- crates/auth — JWT issuance/validation and OAuth/webauthn helpers.
- crates/bus — unified pub/sub API with in-memory dev fallback, optional nng/zmq transports.
- crates/rooms — room messaging, assigns per-room sequence numbers and persists via storage.
- crates/presence / crates/rate — presence manager and in-process rate limiter.
- crates/proto — schema & codegen for binary RPCs (Cap’n Proto).

Design goals
- Simple, explicit middleware composition in gateway (trace, CORS, auth extraction, rate limiting).
- Durable, embeddable message store using redb (single-file DB, MVCC).
- Real-time messages are persisted + published to a transport-agnostic bus (topic framing: `topic\x00payload`).
- Auth: lightweight JWT strategy with refresh tokens persisted in storage; optional OAuth & WebAuthn flows for federated and passkey login.

---

## Gateway wiring & middleware

Core ideas
- Router composition: group routes by responsibility, apply different middleware stacks via `Router::merge` or `Router::route_layer`.
- Use `ServiceBuilder` to compose fallible or ordered middleware (timeout -> HandleErrorLayer).
- Prefer `route_layer` for auth/validation middleware that should only run for matched routes (prevents 404 -> 401 surprises).
- Use `with_state` to supply application state to router and use `State<T>` extractor in handlers.

Common middleware in this repo
- tower_http::trace::TraceLayer — structured request logs.
- tower_http::cors::CorsLayer — configured with allow_origin predicate and allow_credentials(true) when cookies are used (remember Vary header).
- Custom rate-limit middleware — extracts a key (IP, token, user) and delegates to in-process RateLimiter crate or storage counters.
- Auth extraction middleware — lift gateway JWT (cookie or Authorization header) into request extensions for handlers.

Best practices and gotchas
- Don't call res.json() blindly in route loaders. Check content-type and status first:
  ```
  const ct = res.headers.get('content-type') || ''
  const isJSON = ct.includes('application/json')
  const payload = isJSON ? await res.json().catch(() => null) : null
  if (!res.ok) return { error: payload?.message ?? `Failed (status ${res.status})`, status: res.status }
  ```
- For pre-routing transformations (URI rewrites), wrap the Router in a `tower::Layer` (e.g., MapRequestLayer). `Router::layer` runs after routing.
- Use HandleErrorLayer around fallible layers (timeout, concurrency) to produce responses instead of connection closes.

Graceful shutdown
- Use tokio signal + server with graceful shutdown functions. For hyper, hyper-util/GracefulShutdown helpers are available; ensure presence manager and background tasks are shutdown cleanly (presence.shutdown()).

---

## WebSockets & realtime loop patterns

Common pattern used in this repo:
- Accept upgrade via Axum `extract::ws`.
- Create per-connection tasks to:
  - Subscribe to the bus into a tokio::mpsc receiver (bus::Subscriber::connect(...).into_receiver()).
  - Read from WebSocket and publish to rooms via rooms::send_message (assign seq, append to storage, publish).
  - Forward bus messages (topic, payload) to client as JSON or frame format.
- Backpressure: use bounded mpsc channels; if the socket cannot keep up, drop messages or close connection gracefully.

Important: don't block the async runtime in WS loops. Use bounded channels and `try_send` when appropriate. When bridging native blocking libs (nng/zmq), forward messages from a dedicated thread to tokio mpsc using `Handle::current()`.

---

## Storage model (redb)

Overview
- redb is used as an embedded ACID KV store. It's file-backed (db.redb) with MVCC semantics and a serializable isolation level.
- Tables are defined as TableDefinition<&str, Vec<u8>> and JSON blobs are stored in values for flexible schema evolution.

Key tables (in this repo)
- `messages` — key: "<room>/<server_ts:020>/<seq:020>" -> value: JSON-serialized MessageRecord
- `seqs` — per-room sequence u64 (8-byte little endian)
- `users`, `credentials`, `presence`, `rate` — JSON or binary values
- `oauth_state`, `webauthn_*_state` — transient auth flow state

Patterns
- Compose lexicographic keys to allow efficient range scans per-room (pad timestamps and seq to fixed width).
- Use `begin_read()` for readers and `begin_write()` for writers. To create tables, open them in a write txn and commit.
- For retention, use `extract_if` in a write transaction to remove old keys.

Durability & commit semantics
- redb supports different commit strategies. Default is 1PC+C (one-phase plus checksum). Be aware of the difference vs 2PC if you target extremely adversarial crash guarantees.

Snapshots
- `Storage::snapshot(dest)` simply copies the redb file to `dest` — useful for backups.

Performance tips
- Keep value blobs compact. If message bodies grow, consider compression or chunking.
- Use `scan_messages(room, after_ts, limit)` to implement history paging without loading entire room.

---

## Real-time messaging bus (crates/bus)

API
- Publisher: bind(addr) | dial(addr) | publish(topic, payload)
- Subscriber: connect(addr, topic) -> into_receiver() | receiver()

Transport choices
- Default (no features): in-memory tokio::broadcast-based implementation. Good for local dev/test.
- Optional features:
  - `with-nng` -> nng-backed transport (native sockets). The code includes `nng_impl` which constructs messages as `topic\x00payload` and uses a blocking thread + tokio Handle to forward into mpsc.
  - `with-zmq` -> ZeroMQ PUB/SUB binding with same key framing.

Framing rule
- All transports publish `topic\x00payload` (topic prefix + 0x00 separator) to allow prefix subscriptions.

Operational notes
- Native transports (nng/zmq) often require a blocking recv thread that hands off to async runtime; this pattern exists in the repo.
- Publishers should treat "no subscribers" as non-fatal (broadcast::Sender::send returns Err when there are no receivers). In dev fallback, publisher swallows that error.

Example dev fallback (mem)
- tokio::broadcast channel per-topic, forwarding to mpsc receiver.

---

## Authentication & security

JWT (jsonwebtoken)
- `auth::create_jwt(user_id, ttl_secs)` — HS256 by default; secret from `AUTH_JWT_SECRET` with a dev default `stack-dev-secret`.
- `auth::verify_jwt(token)` — uses `Validation` with `set_audience(["stack-web"])` and `set_issuer(["stack"])`.
- Best practice: require `AUTH_JWT_SECRET` in non-dev environments and rotate secrets carefully. Cache EncodingKey/DecodingKey if used frequently.

Cookies vs Bearer
- Gateway forwards cookies (for SSR) and sets Authorization headers where useful. When forwarding to backend, prefer a small helper:
  ```
  function withAuthHeaders(session) {
    const t = session?.gateway;
    return { Accept: 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
  }
  ```
- If you use cookies for auth, add CSRF protection for unsafe methods — double-submit cookie or CSRF header verified server-side.

OAuth (oauth2-rs)
- Implement authorization code + PKCE for web flows; store transient `oauth_state` in Storage for CSRF/PKCE validation (key -> JSON { provider, pkce_verifier, redirect, expires_at }).
- After token exchange, link `provider:subject -> user_id` in OAUTH_TABLE.

WebAuthn
- Store transient registration/auth state (`webauthn_reg_state`, `webauthn_auth_state`) keyed like `<user_id>/<id>`.
- Persist credentials under `CREDENTIALS_TABLE` with key `<user_id>/<cred_id>`.

Refresh tokens
- Store refresh tokens as JSON in `REFRESH_TABLE` with `token_id -> { user_id, expiry }`. Revoke by removing key.

Security tips
- Avoid double-parsing JSON; parse once and reuse result.
- Sanitize callbackUrl for login redirect — whitelist allowed paths (/ , /profile, /admin/*).
- JWT clock skew: consider small leeway when validating `exp`.

---

## Rooms service, presence and rate limiting

Rooms
- send_message(room, body): allocate seq via `storage.next_seq_for_room(room)`, build MessageRecord, `storage.append_message()`, then `publisher.publish(topic_for_room, message_bytes)`.
- fetch_history: `storage.scan_messages(room, after_ts, limit)`.

Presence
- PresenceManager tracks heartbeat timestamps and sweeper task that expires stale presence.
- Presence events are published to bus to notify subscribers.

Rate limiting
- In-memory token bucket keyed by string (IP/token/user). Middleware extracts key and calls RateLimiter.allow(key).
- Storage also has `incr_rate_counter/get_rate_counter/list_rate_counters/reset_rate_counter` for longer-term counting.

---

## Cap’n Proto & IPC (crates/proto, crates/ipc)

Cap’n Proto
- This repo uses capnproto schemas for some binary RPCs. Typical workflow:
  - .capnp schemas in crates/proto/schema/
  - codegen to Rust via `capnpc` build script (crate includes `build.rs`).
  - Use generated builders/readers for zero-copy payloads.
- Tip: keep schema stable across services; bump version when incompatible changes are required.

IPC
- There are examples using platform IPC transports (interprocess or local sockets). Use them for local daemons or workers when latency or binary protocol matters.
- For cross-process pub/sub, prefer bus transport (nng/zmq) or domain sockets depending on deployment.

---

## TLS, rustls, tokio-rustls

rustls (core guidance)
- Use TLS1.3 by default, configure ALPN (http/1.1, h2) when using hyper/axum.
- Certificates: load PEM/DER; prefer PKCS8 for private keys where required.
- Session resumption via tickets increases throughput and reduces handshake costs — safe but be aware of ticket reuse semantics per RFC 8446 Appendix C.4.

tokio-rustls integration
- Typical pattern:
  - Build `rustls::ServerConfig` (or ClientConfig).
  - Wrap `TcpListener` accept stream with `tokio_rustls::TlsAcceptor::from(Arc::new(cfg))`.
  - Use `acceptor.accept(stream).await` to upgrade to TLS Stream for hyper/axum.
- If `tokio-rustls` crate isn't present in the docs index, rely on standard rustls examples + tokio bindings.

Performance & PQ
- rustls roadmap includes experimental post-quantum hybrid key exchange (e.g., X25519MLKEM768 + X25519) and ECH support; be cautious and test interop.

---

## Notable syntactic changes & upgrade notes

Axum (0.7 -> 0.8)
- Router<S> type model and `with_state` changes; prefer `route_layer` for per-route middleware and `layer` for app-wide layers.
- `HandleErrorLayer` recommended for fallible middleware.

Hyper (1.x / roadmap)
- Body refactor and connection type splits for http1/http2; hyper-util provides higher-level utilities (graceful shutdown).
- Keep an eye on runtime + executor feature flag changes.

tower-http
- CORS builder semantics changed across versions; ensure allow_origin predicate is used when dynamic origins are required and remember Vary header when allow_credentials is true.

Tokio
- Use spawn_blocking for CPU-bound crypto (password hashing) to avoid blocking runtime threads.
- Lock MSRV compatibility when using LTS versions listed in repo.

tracing
- Use `#[instrument]` and `.instrument()` correctly; avoid entering spans manually across async futures.

redb
- Commit strategy differences (1PC+C vs 2PC) and extract_if semantics. AccessGuard `.value()` is the standard read API.

jsonwebtoken
- `Validation` API: set_audience / set_issuer; include leeway if tokens might have clock drift.

nng / zmq
- Native sockets require explicit threading or AIO usage. Common pattern: run native socket recv loop on a blocking thread and forward messages to tokio via mpsc and `Handle::current()`.

---

## Recommended doc structure in repo (what we’ll produce in backend_docs.md)
- Overview
- Crate map (what each crate does)
- Gateway wiring (code pointers + snippets)
- Storage (schema, example key patterns)
- Bus (dev fallback, production transports)
- Auth & security (JWT, OAuth, WebAuthn, CSRF)
- Rooms/presence/rate (flow diagrams + code snippets)
- Proto & IPC (capnp usage)
- TLS & ops (env var list, backups, graceful shutdown)
- Notable syntax changes
- References (links to the Context7 docs we used)

---

## Verification checklist & commands

Quick checks after writing the doc
- Search for references to each crate we discussed:
  - ripgrep / simple file search: `rg "jsonwebtoken|redb|tokio-rustls|nng|axum" -n`
- Run the gateway dev script locally (PowerShell script provided in repo rules):
  - `.\scripts\start-web-dev.ps1` (Windows PowerShell)
  - Inspect logs: `logs/gateway-dev.out.log`, `logs/web-dev.out.log`
- Test a local WS connection and message flow using example smoke scripts:
  - `scripts/ws-smoke-local.ps1`

---

## References / authoritative docs (selected)
- Axum docs (middleware/extractors): https://github.com/tokio-rs/axum
- Hyper docs & roadmap: https://github.com/hyperium/hyper
- Tower HTTP: https://github.com/tower-rs/tower-http
- Tokio: https://docs.rs/tokio/latest/tokio
- Tracing: https://github.com/tokio-rs/tracing
- Serde: https://serde.rs
- redb: https://github.com/cberner/redb
- rustls: https://github.com/rustls/rustls
- jsonwebtoken (Rust): https://github.com/Keats/jsonwebtoken
- nng (rust wrapper): https://docs.rs/nng/latest/nng

---

Verification (what I will do next, if you want)
- Populate remaining crate-specific examples (rooms, presence, rate, proto).
- Insert more inline code snippets from gateway and crates (e.g., example of rate middleware).
- Finalize and create `backend_docs.md` at repo root and run a short verification pass (search, lint doc links).

If you want the completed file committed now, I have written the draft (this file). I will run one final pass to add a couple of inline code references from `apps/gateway/src/main.rs` and `crates/rooms/src/lib.rs` if you want — say "include sample code from rooms and gateway" and I will add them before finalizing.

</response>
</plan_mode_respond>
