// Gateway service main entry point
//
// Beginner-friendly explanation:
// - This file is the "main" program for the gateway service.
// - It uses Rust and several libraries to run a web server that handles HTTP
//   routes and WebSocket connections.
// - If you know TypeScript: think of this like the `index.ts` that sets up an
//   Express/Koa/Fastify server, defines routes, middleware, and starts listening.
// - The comments aim to explain "what" each piece does and "why" it's here,
//   not to change any behavior of the program.
//
// High-level mental model:
// - Axum = web framework (like Express in Node/TypeScript).
// - Tokio = async runtime (like Node's event loop but explicit in Rust).
// - AppState = shared state accessible to handlers (like dependency injection).
// - Middleware = code that runs before/after requests (e.g., logging, rate limiting).
// - WebSocket handlers = persistent socket connections to stream messages.
// - Storage/publisher/presence/rate = services used by handlers for persistence,
//   pub/sub, presence tracking, and rate limiting respectively.

use axum::{
    extract::{
        ws::{Message, WebSocketUpgrade},
        Query, State, Path,
    },
    response::{Html, IntoResponse},
    routing::{get, post, delete},
    Router,
    middleware::{self, Next},
};
// axum::http::Request is used below in middleware signatures
use axum::http::Request;
use axum::extract::DefaultBodyLimit;
use anyhow::Result;
use axum::http::{HeaderMap, StatusCode};
use axum::http::header::{ACCEPT, CONTENT_TYPE, AUTHORIZATION, HeaderName};
// futures_util provides helpers to work with async streams
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    net::SocketAddr,
    sync::Arc,
};
use tokio::{net::TcpListener, signal};

// The project uses a small internal pub/sub and storage crates (workspace crates)
use bus::pubsub::{Publisher, Subscriber};
use storage::Storage;
use auth::create_jwt;
use axum::Json;
use std::collections::HashMap;
use serde_json::{json, Value};
// async I/O for logfile writes/reads
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use std::fs as stdfs;

// Cookies helper from axum-extra
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};

 // Argon2 for password hashing - a secure password hashing mechanism.
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::RngCore;

// Observability & CORS
use tower_http::trace::TraceLayer;
use tower_http::cors::CorsLayer;
use tower_http::compression::CompressionLayer;
use tower::timeout::TimeoutLayer;
use axum::error_handling::HandleErrorLayer;
use tower::{BoxError, ServiceBuilder};
use std::time::Duration;
use axum::http::Method;
// Response type used to rebuild responses after reading body
use axum::response::Response;
use http_body_util::BodyExt as _; // for .collect()
use bytes::Bytes;

// A constant used in dev helpers for the administrator email address.
const ADMIN_EMAIL: &str = "admin@example.com";

// Simple helper: check whether an email equals the configured admin email.
// eq_ignore_ascii_case makes the comparison case-insensitive.
fn is_admin_email(email: &str) -> bool {
    email.eq_ignore_ascii_case(ADMIN_EMAIL)
}

// AppState: shared state we attach to the axum Router.
// In TypeScript/Node you might pass these as properties to middleware or use a
// module-level singleton. Here we put them in an Arc so they can be shared across threads.
#[derive(Clone)]
struct AppState {
    publisher: Arc<Publisher>,
    storage: Arc<Storage>,
    presence: Arc<presence::PresenceManager>,
    rate: Arc<rate::RateLimiter>,
    // NNG publisher address (moved into shared state so we don't read env on every connection)
    nng_addr: String,
}

// RoomQuery: used to parse query parameters for WebSocket endpoint (room and token)
#[derive(Deserialize)]
struct RoomQuery {
    room: Option<String>,
    token: Option<String>,
}

// Token extraction helpers: centralize header/cookie parsing so we don't duplicate logic.
// These return Option<String> with the raw token (not verified).
fn header_bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|hv| hv.to_str().ok())
        .and_then(|s| {
            let s_trim = s.trim();
            if s_trim.len() > 7 && s_trim[..7].eq_ignore_ascii_case("bearer ") {
                Some(s_trim[7..].to_string())
            } else {
                None
            }
        })
}

fn cookie_session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("cookie")
        .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
        .and_then(|cookie_header: &str| {
            cookie_header.split(';').find_map(|kv: &str| {
                let kv: &str = kv.trim();
                if let Some(v) = kv.strip_prefix("session=") {
                    Some(v.to_string())
                } else if let Some(v) = kv.strip_prefix("session_token=") {
                    Some(v.to_string())
                } else {
                    None
                }
            })
        })
}

// High-level extractor used across middleware and handlers.
fn extract_token(headers: &HeaderMap) -> Option<String> {
    header_bearer_token(headers).or_else(|| cookie_session_token(headers))
}

// Standard API error type so we return a consistent JSON shape for errors.
#[derive(Serialize)]
struct ApiError {
    message: String,
}


// Centralized admin requirement helper.
// Returns Ok(requester_id) or Err((StatusCode, ApiError)) suitable for returning from handlers.
fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<String, (StatusCode, ApiError)> {
    // Extract token and verify
    let token: String = extract_token(headers).ok_or((StatusCode::UNAUTHORIZED, ApiError { message: "missing authorization".into() }))?;
    let data = auth::verify_jwt(&token).map_err(|_| (StatusCode::UNAUTHORIZED, ApiError { message: "invalid token".into() }))?;
    let requester_id: String = data.claims.sub;

    // Ensure stored user has role "admin"
    match state.storage.get_user(&requester_id) {
        Ok(Some(val)) => {
            if val.get("role").and_then(|r: &serde_json::Value| r.as_str()) != Some("admin") {
                Err((StatusCode::FORBIDDEN, ApiError { message: "admin access required".into() }))
            } else {
                Ok(requester_id)
            }
        }
        Ok(None) => Err((StatusCode::UNAUTHORIZED, ApiError { message: "user not found".into() })),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, ApiError { message: e.to_string() })),
    }
}

/// Rate limiting middleware
///
/// Explanation for beginners:
/// - Middleware is code that runs for each incoming HTTP request before the
///   actual handler (route) runs. It's useful for cross-cutting concerns like
///   logging, authentication, or rate limiting.
/// - This function extracts a rate key (user id or "anon") and uses a token-bucket
///   rate limiter to allow or deny requests. If a client exceeds the limit,
///   it returns HTTP 429 (Too Many Requests).
///
/// Note: This middleware uses `from_fn_with_state` so it receives the AppState.
use axum::body::Body;
async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Derive a rate key:
    // 1. Try to use Authorization Bearer token and verify it to obtain the subject (user id).
    // 2. Fallback: try to parse session cookie from the Cookie header and verify it.
    // 3. Otherwise use "anon" for anonymous clients.
    //
    // In TypeScript you might parse headers and cookies similarly in Express middleware.
    // Use centralized token extraction, then verify JWT to obtain subject (user id).
    // Fallback to "anon" if no token or verification fails.
    let rate_key: String = extract_token(req.headers())
        .and_then(|tok: String| auth::verify_jwt(&tok).ok().map(|data| data.claims.sub))
        .unwrap_or_else(|| "anon".to_string());

    // Allowlist auth & health endpoints so session flows aren't throttled.
    // This is useful because login endpoints may be used by clients during normal flows.
        if let Some(path) = req.uri().path().strip_prefix("") {
        // match starts_with for common auth endpoints
        if path.starts_with("/api/auth/me")
            || path.starts_with("/api/auth/login")
            || path.starts_with("/api/auth/logout")
            || path.starts_with("/api/auth/signup")
            || path.starts_with("/api/auth/check_username")
            || path.starts_with("/api/frontend-logs")
            || path.starts_with("/healthz")
            // Do not throttle WebSocket upgrades; messages are not limited per-frame
            || path.starts_with("/ws")
        {
            // bypass rate limiting for core auth/health endpoints
            let resp: hyper::Response<Body> = next.run(req).await;
            return resp;
        }
    }

    // Check the token bucket on state.rate (RateLimiter).
    // If it's not allowed, return 429 Too Many Requests.
    if !state.rate.allow(&rate_key) {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit").into_response();
    }

    // If allowed, forward the request to the next middleware/handler.
    let resp: hyper::Response<Body> = next.run(req).await;
    resp
}

/// CSRF protection middleware (double-submit cookie pattern)
/// - Checks X-CSRF-Token header equals csrfToken cookie for unsafe methods (POST/PUT/PATCH/DELETE)
/// - If no csrf cookie present, middleware is a no-op (allows Bearer-only clients)
async fn csrf_middleware(req: Request<Body>, next: Next) -> Response {
    // Only enforce for unsafe methods
    use axum::http::Method;
    let m: &Method = req.method();
    if matches!(m, &Method::GET | &Method::HEAD | &Method::OPTIONS) {
        return next.run(req).await;
    }

    let headers = req.headers();
    // Extract csrf cookie if present
    let csrf_cookie: Option<String> = headers
        .get("cookie")
        .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
        .and_then(|cookie_header| {
            cookie_header.split(';').find_map(|kv: &str| {
                let kv: &str = kv.trim();
                if let Some(v) = kv.strip_prefix("csrfToken=") {
                    Some(v.to_string())
                } else {
                    None
                }
            })
        });

    // If no csrf cookie, treat this as a non-cookie request (e.g., token-based API client) — skip check
    let csrf_header = headers.get("x-csrf-token").and_then(|hv| hv.to_str().ok()).map(|s| s.to_string());
    if let Some(cookie_val) = csrf_cookie {
        if csrf_header.as_deref() != Some(cookie_val.as_str()) {
            return (StatusCode::FORBIDDEN, "csrf token mismatch").into_response();
        }
    }

    next.run(req).await
}

//// log_middleware intentionally removed — prefer using tower_http::trace::TraceLayer for structured request tracing.
//// If you need this ad-hoc logger back, we can restore a small dev-only middleware.

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing subscriber (logging)
    tracing_subscriber::fmt::init();

    // Storage initialization. This provides persistence (like a database).
    // The argument "./data" is the on-disk folder used by the storage layer.
    // In TypeScript you'd maybe instantiate a DB client (e.g., new PrismaClient()).
    let storage: Arc<Storage> = Arc::new(Storage::new("./data")?);

    // NNG publisher - address taken from env var NNG_PUB_ADDR or default
    let nng_addr: String =
        std::env::var("NNG_PUB_ADDR").unwrap_or_else(|_| "tcp://127.0.0.1:7777".to_string());
    let publisher: Arc<Publisher> = Arc::new(Publisher::bind(&nng_addr)?);

    // Presence manager: tracks who is online in which room and sweeps dead entries.
    // It needs storage and publisher to persist presence and publish events.
    let presence: Arc<presence::PresenceManager> = Arc::new(presence::PresenceManager::new(
        Arc::clone(&storage),
        Arc::clone(&publisher),
        30, // sweeper interval (seconds)
        60, // timeout (seconds)
    )?);

    // In-process rate limiter: 5 tokens capacity, 1 token/sec refill (tune as needed)
    let rate_limiter: Arc<rate::RateLimiter> = Arc::new(rate::RateLimiter::new(5, 1.0));

    // Construct AppState and wrap shared services in Arcs for thread-safe shared ownership.
    let state = AppState {
        publisher,
        storage,
        presence,
        rate: rate_limiter,
        nng_addr: nng_addr.clone(),
    };

    // Pre-seed admin user and credentials (both dev and prod).
    // Uses env vars ADMIN_EMAIL and ADMIN_PASSWORD when provided.
    if let Err(e) = seed_admin(&state) {
        tracing::error!("admin seed failed: {:?}", e);
    }

    // Router setup: define HTTP routes and attach middleware.
    // Routes map URL paths and methods to handler functions defined below.

    // Build a CORS layer from env / dev defaults.
    // Note: when using cookies across origins, browsers require specific origins (no wildcard).
    // We support an env var CORS_ALLOW_ORIGINS (comma-separated list). If present, we
    // validate incoming Origin headers against that list. Otherwise fall back to a
    // safe dev default list.
    let cors_layer: CorsLayer = {
        // Methods we allow from browsers / clients
        let methods: [Method; 4] = [Method::GET, Method::POST, Method::DELETE, Method::OPTIONS];

        // Build an explicit allowed-origins list (fall back to both localhost forms)
        let allowed_origins: Vec<Vec<u8>> = std::env::var("CORS_ALLOW_ORIGINS")
            .map(|s: String| {
                s.split(',')
                    .map(|s: &str| s.trim().as_bytes().to_vec())
                    .filter(|v: &Vec<u8>| !v.is_empty())
                    .collect()
            })
            .unwrap_or_else(|_| vec![b"http://127.0.0.1:5173".to_vec(), b"http://localhost:5173".to_vec()]);

        // Optional: allow any IP origin on specific ports (e.g., https://192.168.x.x:5173 or https://YOUR.PUBLIC.IP:5173)
        // Configure via CORS_ALLOW_ANY_IP_PORTS=5173,443 (comma-separated list of ports)
        let any_ip_ports: Option<Vec<u16>> = std::env::var("CORS_ALLOW_ANY_IP_PORTS")
            .ok()
            .map(|s| {
                s.split(',')
                    .filter_map(|p| p.trim().parse::<u16>().ok())
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty());

        // Explicit allowed headers (do NOT use wildcard when allow_credentials is true)
        // Include the X-CSRF-Token header so browsers are allowed to send it from the frontend.
        let allow_hdrs = [
            ACCEPT,
            CONTENT_TYPE,
            AUTHORIZATION,
            HeaderName::from_static("x-csrf-token"),
        ];

        CorsLayer::new()
            .allow_methods(methods)
            .allow_headers(allow_hdrs)
            .allow_origin(tower_http::cors::AllowOrigin::predicate(
                move |origin: &axum::http::HeaderValue, _parts: &axum::http::request::Parts| {
                    // 1) Exact match against configured list
                    if allowed_origins
                        .iter()
                        .any(|a: &Vec<u8>| a.as_slice() == origin.as_bytes())
                    {
                        return true;
                    }
                    // 2) If enabled, allow any IP-based origin for a set of ports (useful for LAN/public IPs in dev)
                    if let Some(ref ports) = any_ip_ports {
                        if let Ok(h) = origin.to_str() {
                            if let Ok(u) = url::Url::parse(h) {
                                if let Some(host) = u.host_str() {
                                    if host.parse::<std::net::IpAddr>().is_ok() {
                                        let port = u.port_or_known_default().unwrap_or(0);
                                        return ports.iter().any(|p| *p == port);
                                    }
                                }
                            }
                        }
                    }
                    false
                },
            ))
            .allow_credentials(true)
    };
    // Group auth-related routes. We intentionally keep only the login route in `auth_routes`
    // because `authorize()` is sometimes called server-side and won't include the CSRF cookie.
    // Other auth endpoints are grouped into `auth_protected` and have the CSRF middleware applied.
    let auth_routes = Router::new()
        // Login is intentionally excluded from CSRF checks because server-side authorize() calls
        // do not include the csrf cookie/header.
        .route("/api/auth/login", post(api_login));

    let auth_protected = Router::new()
        .route("/api/auth/signup", post(api_signup))
        .route("/api/auth/check_username", get(api_check_username))
        .route("/api/auth/me", get(api_auth_me))
        .route("/api/auth/logout", post(api_logout))
        .route_layer(middleware::from_fn(csrf_middleware));

    // We'll merge `auth_routes` (contains login) and `auth_protected` (contains the other auth endpoints)

    // Group admin routes that rely on cookie-based auth; apply CSRF middleware to unsafe actions.
    let admin_routes = Router::new()
        .route("/api/admin/users", get(api_admin_list_users))
        .route("/api/admin/users/{id}/promote", post(api_admin_promote_user))
        .route("/api/admin/users/{id}/demote", post(api_admin_demote_user))
        .route("/api/admin/users/{id}", delete(api_admin_delete_user))
        .route_layer(middleware::from_fn(csrf_middleware));

    // Core router: non-auth/dev routes remain on root. Merge grouped routers.
    let base: Router = Router::new()
        .route("/", get(root))
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .route("/rooms/{room}/history", get(get_room_history))
        .route("/rooms/{room}/messages", post(post_room_message))
        // Frontend logs endpoint: accepts JSON log entries and appends NDJSON to a file
        .route("/api/frontend-logs", post(api_frontend_logs).get(get_frontend_logs))
        .route("/auth/dev/login", get(dev_login))
        .route("/auth/dev/login_post", axum::routing::post(dev_login_post))
        .route("/auth/dev/promote", post(api_dev_promote))
        .route("/auth/dev/promote_get", get(api_dev_promote_get))
        .route("/auth/dev/promote_by/{email}", get(api_dev_promote_by))
        .route("/auth/dev/promote_now", get(api_dev_promote_now))
        .route("/auth/dev/set_admin_username", post(api_dev_set_admin_username))
        .route("/auth/dev/reset_rate_now", get(api_dev_reset_rate_now))
        .route("/auth/dev/clear_buckets", get(api_dev_clear_buckets))
        .route("/auth/dev/inspect_token", axum::routing::post(api_dev_inspect_token))
        .route("/auth/dev/set_password", axum::routing::post(api_dev_set_password))
        //.route("/auth/dev/echo", get(api_dev_echo)) // removed dev echo route to avoid router wildcard issues
        .route("/auth/dev/promote_user_by_id/{id}", get(api_dev_promote_user_by_id))
        .route("/auth/dev/dedupe_admins", post(api_dev_dedupe_admins))
        // Merge grouped routers (auth & admin) so their middleware applies to those paths
        .merge(auth_routes)
        .merge(auth_protected)
        .merge(admin_routes)
        .with_state(state.clone());

    // Attach request/response middleware layers
    // Order: rate-limit -> CORS -> trace -> compression -> timeout (with handler) -> body limit
    let body_limit: usize = std::env::var("BODY_LIMIT_BYTES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1 * 1024 * 1024); // 1 MiB default
    async fn handle_timeout_error(err: BoxError) -> Response {
        if err.is::<tower::timeout::error::Elapsed>() {
            (StatusCode::REQUEST_TIMEOUT, "request timed out").into_response()
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    }
    let timeout_stack = ServiceBuilder::new()
        .layer(HandleErrorLayer::new(handle_timeout_error))
        .layer(TimeoutLayer::new(Duration::from_secs(10)));

    let mut app: Router = base
        // Cheap/fast layers first (outermost): body limit, compression, timeout+error mapping, trace
        // Then policy layers: CORS and rate limiting
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit_middleware))
        .layer(cors_layer)
        .layer(TraceLayer::new_for_http())
        .layer(timeout_stack)
        .layer(CompressionLayer::new())
        .layer(DefaultBodyLimit::max(body_limit));

    // Optional: verbose POST body logging (expensive) — enabled only when LOG_POST_BODY=1
    if std::env::var("LOG_POST_BODY").ok().as_deref() == Some("1") {
        app = app.layer(middleware::from_fn(log_post_body_middleware));
    }

    // Bind address to listen on. Default is 0.0.0.0:7000 or override with GATEWAY_ADDR env var.
    let addr: SocketAddr = std::env::var("GATEWAY_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:7000".to_string())
        .parse()?;

    // Attempt to bind the listener first. Only print that we're listening after bind succeeds.
    let listener: TcpListener = match TcpListener::bind(addr).await {
        Ok(l) => {
            println!("listening on http://{}", addr);
            l
        }
        Err(e) => {
            // Emit a clear error to stderr so log collectors capture the bind failure.
            eprintln!("failed to bind {}: {:?}", addr, e);
            return Err(e.into());
        }
    };

    // Clone presence Arc for shutdown handling
    let presence_for_shutdown: Arc<presence::PresenceManager> = Arc::clone(&state.presence);
    axum::serve(
        listener,
        app, // <- no into_service()
    )
    .with_graceful_shutdown(async move {
        // Wait for CTRL+C (SIGINT) and then run shutdown logic.
        let _ = signal::ctrl_c().await;
        tracing::info!("shutdown signal received");
        // Attempt graceful shutdown of presence sweeper. This consumes an Arc clone
        // and awaits the background task to finish.
        presence_for_shutdown.shutdown().await;
    })
    .await?;

    Ok(())
}

/// WebSocket upgrade handler
///
/// - Reads query params (room, token)
/// - Extracts token from query or Authorization header
/// - Verifies token and creates a presence heartbeat (user id) if available
/// - Upgrades the connection to a WebSocket and delegates to ws_connect
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<RoomQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Default room is "general" if none provided.
    let room: String = q.room.clone().unwrap_or_else(|| "general".to_string());

    // Extract token from query param 'token' or Authorization header 'Bearer <token>'
    // Many clients will send tokens in the Authorization header; some websocket clients
    // may include it as a query param for convenience.
    let token_opt: Option<String> = q.token.clone().or_else(|| {
        headers
            .get("authorization")
            .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
            .and_then(|s: &str| {
                if s.to_lowercase().starts_with("bearer ") {
                    Some(s[7..].to_string())
                } else {
                    None
                }
            })
    });

    // Try verify token and create presence heartbeat with provided user_id.
    // If token is invalid or missing, we still create an anonymous presence entry.
    let user_id: String = if let Some(token) = token_opt {
        match auth::verify_jwt(&token) {
            Ok(data) => {
                let sub: String = data.claims.sub;
                match state.presence.heartbeat(Some(sub.clone())) {
                    Ok(id) => {
                        tracing::info!(user = %id, "presence heartbeat created for authenticated connection");
                        id
                    }
                    Err(e) => {
                        tracing::error!("presence heartbeat failed: {:?}", e);
                        "unknown".to_string()
                    }
                }
            }
            Err(e) => {
                tracing::error!("token verification failed: {:?}", e);
                match state.presence.heartbeat(None) {
                    Ok(id) => id,
                    Err(_) => "unknown".to_string(),
                }
            }
        }
    } else {
        match state.presence.heartbeat(None) {
            Ok(id) => id,
            Err(_) => "unknown".to_string(),
        }
    };

    // Perform the WebSocket upgrade and hand off to ws_connect which runs for the life of the socket.
    ws.on_upgrade(move |socket: axum::extract::ws::WebSocket| ws_connect(socket, state, room, user_id))
}

/// Ensure an admin account exists in storage.
/// - Email taken from ADMIN_EMAIL env or default ADMIN_EMAIL constant.
/// - Password taken from ADMIN_PASSWORD env or default "admin12345".
fn seed_admin(state: &AppState) -> Result<()> {
    use anyhow::Context;
    // Optional seed file, simple key:value per line. Example:
    //   username: admin
    //   password: 11281998
    //   email: admin@example.com
    let seed_path: String = std::env::var("ADMIN_SEED_FILE").unwrap_or_else(|_| "/config/admin.seed".to_string());
    let (file_username, file_password, file_email) = (|| {
        match stdfs::read_to_string(&seed_path) {
            Ok(text) => {
                let mut u: Option<String> = None;
                let mut p: Option<String> = None;
                let mut e: Option<String> = None;
                for line in text.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') { continue; }
                    let mut parts = line.splitn(2, ':');
                    let k = parts.next().unwrap_or("").trim().to_ascii_lowercase();
                    let v = parts.next().unwrap_or("").trim().to_string();
                    match k.as_str() {
                        "username" => u = Some(v),
                        "password" => p = Some(v),
                        "email" => e = Some(v.to_lowercase()),
                        _ => {}
                    }
                }
                (u, p, e)
            }
            Err(_) => (None, None, None),
        }
    })();

    let username: String = file_username.unwrap_or_else(|| "admin".to_string());
    let admin_email: String = file_email
        .or_else(|| std::env::var("ADMIN_EMAIL").ok())
        .unwrap_or_else(|| format!("{}@example.com", username))
        .to_lowercase();
    let admin_password: String = file_password
        .or_else(|| std::env::var("ADMIN_PASSWORD").ok())
        .unwrap_or_else(|| "admin12345".to_string());

    // Check credentials; if present, ensure user exists and has role admin and username "admin".
    match state.storage.get_credentials(&admin_email) {
        Ok(Some(creds)) => {
            let user_id = creds.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if user_id.is_empty() {
                return Ok(());
            }
            match state.storage.get_user(&user_id) {
                Ok(Some(mut user)) => {
                    let mut changed = false;
                    if user.get("role").and_then(|r| r.as_str()) != Some("admin") {
                        if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); changed = true; }
                    }
                    let has_uname = user.get("username").and_then(|v| v.as_str()).is_some();
                    if !has_uname {
                        if let Some(obj) = user.as_object_mut() { obj.insert("username".to_string(), serde_json::Value::String(username.clone())); changed = true; }
                    }
                    if changed { let _ = state.storage.put_user(&user_id, &user); }
                }
                Ok(None) => {
                    // Create minimal admin user record linked to existing credentials
                    let user_obj = serde_json::json!({
                        "id": user_id,
                        "email": admin_email,
                        "username": username,
                        "created_at": chrono::Utc::now().timestamp(),
                        "role": "admin",
                    });
                    let _ = state.storage.put_user(&user_id, &user_obj);
                }
                Err(_) => {}
            }
            tracing::info!("admin seed: credentials already exist for {}", admin_email);
            Ok(())
        }
        Ok(None) => {
            // Create new admin user and credentials
            let user_id = Uuid::new_v4().to_string();
            let user_obj = serde_json::json!({
                "id": user_id,
                "email": admin_email,
                "username": username,
                "created_at": chrono::Utc::now().timestamp(),
                "role": "admin",
            });
            state.storage.put_user(&user_id, &user_obj).context("put_user(admin)")?;

            // Hash password
            let mut salt_bytes: [u8; 16] = [0u8; 16];
            rand::rng().fill_bytes(&mut salt_bytes);
            let salt: SaltString = SaltString::encode_b64(&salt_bytes)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let argon2: Argon2<'_> = Argon2::default();
            let pwd_hash = argon2
                .hash_password(admin_password.as_bytes(), &salt)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?
                .to_string();
            let cred_obj = serde_json::json!({
                "user_id": user_id,
                "password_hash": pwd_hash,
                "created_at": chrono::Utc::now().timestamp(),
            });
            state.storage.put_credentials(&admin_email, &cred_obj).context("put_credentials(admin)")?;
            tracing::info!("admin seed: created admin user {}", admin_email);
            Ok(())
        }
        Err(e) => {
            // Storage not ready? Log and continue.
            tracing::error!("admin seed: get_credentials failed: {:?}", e);
            Ok(())
        }
    }
}

/// Middleware that logs all POST request bodies (up to a safe size) and forwards the request.
async fn log_post_body_middleware(req: Request<Body>, next: Next) -> impl IntoResponse {
    if req.method() == Method::POST {
        let path = req.uri().path().to_string();
        // Take body ownership to read it fully, then put it back
        let (parts, body) = req.into_parts();
        let collected = match body.collect().await {
            Ok(col) => col.to_bytes(),
            Err(_) => Bytes::new(),
        };
        // Limit log size to 64 KiB to avoid blowing logs on large uploads
        let max = 64 * 1024;
        let (to_log, truncated) = if collected.len() > max {
            (collected.slice(0..max), true)
        } else {
            (collected.clone(), false)
        };
        let body_str = match std::str::from_utf8(&to_log) {
            Ok(s) => s,
            Err(_) => "[binary body]",
        };
        if truncated {
            tracing::info!(target: "post_body", path = %path, bytes = collected.len(), body = %body_str, "POST payload (truncated)");
        } else {
            tracing::info!(target: "post_body", path = %path, bytes = collected.len(), body = %body_str, "POST payload");
        }
        // Rebuild request with the original bytes so downstream extractors still work
        let req = Request::from_parts(parts, Body::from(collected));
        // Call downstream
        let res: Response = next.run(req).await;
        let status = res.status().as_u16();
        // Collect response body for logging, then rebuild response
        let (res_parts, res_body) = res.into_parts();
        let res_bytes = match res_body.collect().await {
            Ok(col) => col.to_bytes(),
            Err(_) => Bytes::new(),
        };
        let (res_to_log, res_trunc) = if res_bytes.len() > max {
            (res_bytes.slice(0..max), true)
        } else {
            (res_bytes.clone(), false)
        };
        let res_body_str = match std::str::from_utf8(&res_to_log) {
            Ok(s) => s,
            Err(_) => "[binary body]",
        };
        if res_trunc {
            tracing::info!(target: "post_body", path = %path, status = status, bytes = res_bytes.len(), body = %res_body_str, "POST response (truncated)");
        } else {
            tracing::info!(target: "post_body", path = %path, status = status, bytes = res_bytes.len(), body = %res_body_str, "POST response");
        }
        let res = Response::from_parts(res_parts, Body::from(res_bytes));
        return res;
    }
    next.run(req).await
}

/// Collect frontend logs posted by the SSG web app.
/// Writes NDJSON entries to logs/frontend-api.log
async fn api_frontend_logs(Json(mut entry): Json<Value>) -> impl IntoResponse {
    use tokio::fs as afs;
    // Ensure logs directory exists (async)
    let log_dir = std::path::Path::new("logs");
    if let Err(e) = afs::create_dir_all(log_dir).await {
        tracing::error!("failed to create logs dir: {:?}", e);
    }
    let log_path = log_dir.join("frontend-api.log");
    // Attach timestamp if missing
    if entry.get("ts").is_none() {
        if let Some(obj) = entry.as_object_mut() {
            obj.insert("ts".to_string(), serde_json::Value::String(chrono::Utc::now().to_rfc3339()));
        }
    }
    let line = match serde_json::to_string(&entry) {
        Ok(s) => s + "\n",
        Err(_) => "{}\n".to_string(),
    };
    match afs::OpenOptions::new().create(true).append(true).open(&log_path).await {
        Ok(mut fh) => {
            if let Err(e) = fh.write_all(line.as_bytes()).await {
                tracing::error!("failed to write log line: {:?}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "write-failed").into_response();
            }
            (StatusCode::NO_CONTENT, "").into_response()
        }
        Err(e) => {
            tracing::error!("failed to open log file: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "write-failed").into_response()
        }
    }
}

/// Return the current frontend logs (text)
async fn get_frontend_logs() -> impl IntoResponse {
    let log_path = std::path::Path::new("logs").join("frontend-api.log");
    match tokio::fs::read_to_string(&log_path).await {
        Ok(txt) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            txt,
        )
            .into_response(),
        Err(_) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            String::new(),
        )
            .into_response(),
    }
}

/// Actual WebSocket connection handler that runs while the socket is open.
///
/// Responsibilities:
/// - Subscribe to a pub/sub topic for the room (so messages published to the room are sent to this client)
/// - Spawn a task that forwards pubsub messages to the WebSocket
/// - Read incoming WebSocket messages from the client and persist/publish them via rooms::send_message
/// - On disconnect, clean up and mark the user offline
async fn ws_connect(socket: axum::extract::ws::WebSocket, state: AppState, room: String, user_id: String) {
    // Subscribe to NNG topic room/{room}
    let topic: String = format!("room/{}", room);
    // Use the nng address from shared state to avoid re-reading env on each connection.
    let nng_addr: String = state.nng_addr.clone();

    // Try to create a Subscriber for the topic. If it fails, we cannot proceed with this WS.
    let subscriber: Subscriber = match Subscriber::connect(&nng_addr, &topic) {
        Ok(s) => {
            tracing::info!(topic = %topic, "created subscriber for topic");
            s
        }
        Err(e) => {
            tracing::error!("failed to create nng subscriber for {}: {:?}", topic, e);
            return;
        }
    };

    tracing::info!(user = %user_id, "connection associated with user");

    // Diagnostic publish to verify local pub/sub loop (helps smoke test debugging)
    match serde_json::to_vec(&serde_json::json!({ "diag": "smoke", "room": topic.clone() })) {
        Ok(bytes) => {
            if let Err(e) = state.publisher.publish(&topic, &bytes) {
                tracing::error!("diagnostic publish failed for {}: {:?}", topic, e);
            } else {
                tracing::info!("diagnostic message published to {}", topic);
            }
        }
        Err(e) => {
            tracing::error!("failed to serialize diagnostic payload: {:?}", e);
        }
    }

    // Split the WebSocket into a writer and reader so we can read and write concurrently.
    let (mut ws_writer, mut ws_reader) = socket.split();

    // Forward pubsub -> websocket
    let mut sub_rx: tokio::sync::mpsc::Receiver<(String, Vec<u8>)> = subscriber.into_receiver();
    // Spawn a background task that waits for messages published to the room and writes them to the websocket.
    let forward_task = tokio::spawn(async move {
        while let Some((_topic, payload)) = sub_rx.recv().await {
            tracing::debug!("forward_task: received payload (len={}) for topic", payload.len());
            if let Ok(txt) = String::from_utf8(payload) {
                tracing::debug!(text = %txt, "forwarding to websocket client");
                if ws_writer.send(Message::Text(txt.into())).await.is_err() {
                    // If sending fails, the websocket is closed; stop forwarding.
                    tracing::info!("websocket writer closed, stopping forward task");
                    break;
                }
            }
        }
    });

    // Read incoming messages -> forward to rooms broker
    // This loop reads messages the client sends and then persists/publishes them.
    while let Some(result) = ws_reader.next().await {
        match result {
            Ok(Message::Text(text)) => {
                tracing::debug!(room = %room, text = %text, "received WS text");
                let body = serde_json::json!({ "text": text.to_string() });

                // rooms::send_message persists the message in storage and publishes it via the publisher.
                match rooms::send_message(&room, body, &state.storage, &state.publisher) {
                    Ok(rec) => {
                        tracing::info!(room = %room, seq = rec.seq, id = %rec.id, "rooms::send_message persisted and published");
                    }
                    Err(e) => {
                        tracing::error!("rooms::send_message failed: {:?}", e);
                    }
                }
            }
            Ok(Message::Close(_)) => break, // Client closed the connection
            _ => break, // Other message types (binary, ping/pong) are ignored in this simple example
        }
    }

    // Stop the forward task (best-effort cleanup)
    forward_task.abort();

    // Mark the user offline when the connection ends (best-effort)
    if user_id != "unknown" {
        if let Err(e) = state.presence.mark_offline(&user_id) {
            tracing::error!("failed to mark user offline {}: {:?}", user_id, e);
        } else {
            tracing::info!(user = %user_id, "marked user offline after disconnect");
        }
    }
}

/// GET /rooms/{room}/history
///
/// Returns stored messages for a room. Accepts query params:
/// - after_ts (optional): only messages after this timestamp (i64)
/// - limit (optional): max number of messages to return (default 50)
async fn get_room_history(
    State(state): State<AppState>,
    Path(room): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Parse optional after_ts and limit
    let after_ts: Option<i64> = q
        .get("after_ts")
        .and_then(|s: &String| s.parse::<i64>().ok());
    let limit: usize = q
        .get("limit")
        .and_then(|s: &String| s.parse::<usize>().ok())
        .unwrap_or(50);

    // Use rooms::fetch_history to read persisted history from storage
    match rooms::fetch_history(&room, after_ts, limit, &*state.storage) {
        Ok(msgs) => Ok(Json(serde_json::to_value(&msgs).unwrap_or_else(|_| serde_json::json!([])))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// POST /rooms/{room}/messages
///
/// Accepts a JSON payload representing a message (generic JSON). This endpoint:
/// - Extracts 'Authorization: Bearer <token>' for auth (optional)
/// - Uses token to derive rate key (user id or "anon")
/// - Enforces per-user rate limiting
/// - Increments a persisted counter (best-effort)
/// - Calls rooms::send_message to persist and publish the message
async fn post_room_message(
    State(state): State<AppState>,
    Path(room): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Extract token from Authorization header 'Bearer <token>'
    let token_opt: Option<String> = headers
        .get("authorization")
        .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
        .and_then(|s: &str| {
            if s.to_lowercase().starts_with("bearer ") {
                Some(s[7..].to_string())
            } else {
                None
            }
        });

    // Derive rate key (user id if authenticated, otherwise "anon")
    let rate_key: String = if let Some(token) = token_opt {
        match auth::verify_jwt(&token) {
            Ok(data) => data.claims.sub,
            Err(_) => "anon".to_string(),
        }
    } else {
        "anon".to_string()
    };

    // Rate limit check (in-proc token bucket)
    if !state.rate.allow(&rate_key) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "rate limit".to_string()));
    }

    // Persist a rate counter (best-effort). This records per-key counts in redb.
    let _ = state.storage.incr_rate_counter(&rate_key, 1);

    // Forward to rooms::send_message which persists and publishes
    match rooms::send_message(&room, payload, &*state.storage, &*state.publisher) {
        Ok(rec) => Ok(Json(serde_json::to_value(&rec).unwrap_or_else(|_| serde_json::json!({})))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Return current rate counters from storage as JSON.
///
/// This function is marked with #[allow(dead_code)] because it might only be used
/// during debugging/metrics collection.
#[allow(dead_code)]
async fn get_metrics(State(state): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Read persisted rate counters from storage and return as JSON map.
    match state.storage.list_rate_counters() {
        Ok(vec) => {
            let map: serde_json::Map<String, serde_json::Value> = vec
                .into_iter()
                .map(|(k, v)| (k, serde_json::Value::from(v)))
                .collect();
            Ok(Json(serde_json::Value::Object(map)))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev helper: GET /auth/dev/login
///
/// Explains how to call the POST dev login to obtain tokens.
async fn dev_login(State(_state): State<AppState>) -> Json<serde_json::Value> {
    // Dev helper: instruct how to POST to /auth/dev/login_post
    Json(serde_json::json!({
        "msg": "POST JSON {\"user\":\"alice\",\"email\":\"alice@example.com\"} to /auth/dev/login_post to receive an access token and refresh token (dev only)"
    }))
}

/// Dev login POST: creates or finds a user and issues a short-lived JWT + refresh token.
///
/// Accepts JSON: { "user": "<id>", "email": "<email>" }
async fn dev_login_post(
    State(state): State<AppState>,
    Json(payload): Json<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Execute main logic in a closure returning anyhow::Result so we can use `?`
    // This pattern helps keep error handling tidy in a function that must return
    // a specific Result type for axum handlers.
    let resp_value: serde_json::Value = (|| -> anyhow::Result<serde_json::Value> {
        // Determine user id (use provided or generate a UUID)
        let user_id: String = payload.get("user").cloned().unwrap_or_else(|| Uuid::new_v4().to_string());
        let email: String = payload.get("email").cloned().unwrap_or_else(|| format!("{}@example.com", &user_id));

        // Persist user in storage (simple JSON blob)
        // Determine role by hard-coded admin email
        let role: &'static str = if is_admin_email(&email) { "admin" } else { "user" };
        let user_obj: serde_json::Value = json!({
            "id": user_id,
            "email": email,
            "created_at": chrono::Utc::now().timestamp(),
            "role": role
        });
        state.storage.put_user(&user_id, &user_obj)?;

        // Issue access token (1 hour)
        let access: String = create_jwt(&user_id, 3600)?;

        // Create refresh token and persist (30 days)
        let refresh_id: String = Uuid::new_v4().to_string();
        let expiry: i64 = chrono::Utc::now().checked_add_signed(chrono::Duration::days(30)).unwrap().timestamp();
        state.storage.create_refresh_token(&refresh_id, &user_id, expiry)?;

        let resp: serde_json::Value = json!({
            "access_token": access,
            "refresh_token": refresh_id,
            "user_id": user_id
        });

        Ok(resp)
    })()
    .map_err(|e: anyhow::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(resp_value))
}

/// Dev-only: promote a user to admin by email (only allowed for the configured ADMIN_EMAIL)
///
/// This is a convenience for local development. Do not expose this in production.
async fn api_dev_promote(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email = payload
        .get("email")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "missing email".to_string()))?
        .to_string();

    // Only allow promoting the hard-coded admin email for dev purposes
    if !is_admin_email(&email) {
        return Err((StatusCode::FORBIDDEN, "not allowed".to_string()));
    }

    // Find credentials to get the user_id
    let cred: serde_json::Value = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let user_id: String = cred
        .get("user_id")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();

    // Load user record
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &user) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev GET promote (convenience for curl on Windows)
///
/// Similar to api_dev_promote but reads email from query params for simple curl usage.
async fn api_dev_promote_get(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email: String = q.get("email").cloned().ok_or((StatusCode::BAD_REQUEST, "missing email".to_string()))?;
    // Only allow promoting the hard-coded admin email for dev purposes
    if !is_admin_email(&email) {
        return Err((StatusCode::FORBIDDEN, "not allowed".to_string()));
    }
    // Find credentials to get the user_id
    let cred: serde_json::Value = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };
    let user_id: String = cred
        .get("user_id")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();
    // Load user record
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &user) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev-by-path: promote a user to admin by email via path segment (avoids JSON quoting on clients)
async fn api_dev_promote_by(
    State(state): State<AppState>,
    Path(email): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Only allow promoting the hard-coded admin email for dev purposes
    if !is_admin_email(&email) {
        return Err((StatusCode::FORBIDDEN, "not allowed".to_string()));
    }

    // Find credentials to get the user_id
    let cred = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };
    let user_id: String = cred
        .get("user_id")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();

    // Load user record
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &user) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev-only: promote a user to admin by id (dev-only, no auth checks)
///
/// WARNING: This endpoint performs no auth checks — it exists for local testing only.
async fn api_dev_promote_user_by_id(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Dev helper: promote the given user id to admin (no requester auth checks - dev only)
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &user) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true, "promoted": user_id })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Deduplicate admins (dev-only maintenance)
///
/// This scans users by email and merges duplicates, picking a canonical user id to keep.
/// It writes a backup file with the deleted records so you can recover if needed.
async fn api_dev_dedupe_admins(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Dev-only maintenance: dedupe user records by email.
    // Strategy:
    //  - For each email with >1 users, choose a keep_id:
    //    * Prefer credentials mapping.user_id if present and found in the group
    //    * Else pick the oldest user (by created_at)
    //  - Backup all deleted user records and the mapping into ./data/admin_dedupe_backup_<ts>.json
    //  - If credentials pointed to a deleted id, update the credential to point to keep_id
    match state.storage.list_users() {
        Ok(users) => {
            use serde_json::Value as JVal;
            let mut by_email: std::collections::HashMap<String, Vec<JVal>> = std::collections::HashMap::new();
            for u in users.into_iter() {
                let email: String = u.get("email").and_then(|v: &JVal| v.as_str()).unwrap_or("").to_string();
                by_email.entry(email).or_default().push(u);
            }

            let mut backup: Vec<serde_json::Value> = Vec::new();
            for (email, mut group) in by_email.into_iter() {
                if group.len() <= 1 {
                    continue;
                }

                // Try to prefer credential-mapped user_id
                let mut keep_id: Option<String> = None;
                if let Ok(Some(cred)) = state.storage.get_credentials(&email) {
                    if let Some(mapped) = cred.get("user_id").and_then(|v: &JVal| v.as_str()) {
                        // check if mapped id exists in this group
                        if group.iter().any(|u: &JVal| u.get("id").and_then(|v: &JVal| v.as_str()) == Some(mapped)) {
                            keep_id = Some(mapped.to_string());
                        }
                    }
                }

                // If no credential mapping or it didn't match group, pick oldest by created_at
                if keep_id.is_none() {
                    group.sort_by_key(|u: &JVal| u.get("created_at").and_then(|v: &JVal| v.as_i64()).unwrap_or(0));
                    if let Some(first) = group.first() {
                        if let Some(id) = first.get("id").and_then(|v: &JVal| v.as_str()) {
                            keep_id = Some(id.to_string());
                        }
                    }
                }

                let keep_id: String = match keep_id {
                    Some(v) => v,
                    None => {
                        // fallback: skip this group to avoid accidental deletions
                        continue;
                    }
                };

                // Delete others and record backup info
                let mut deleted_for_email: Vec<serde_json::Value> = Vec::new();
                for u in group.into_iter() {
                    if let Some(id) = u.get("id").and_then(|v| v.as_str()) {
                        if id == keep_id {
                            continue;
                        }
                        // Record full user object in backup entry
                        deleted_for_email.push(u.clone());
                        let _ = state.storage.delete_user(id);
                    }
                }

                if !deleted_for_email.is_empty() {
                    backup.push(serde_json::json!({
                        "email": email,
                        "kept": keep_id,
                        "deleted": deleted_for_email
                    }));

                    // Ensure credentials for this email point to the kept id
                    if let Ok(Some(cred)) = state.storage.get_credentials(&email) {
                        let cred_user_id: &str = cred.get("user_id").and_then(|v: &JVal| v.as_str()).unwrap_or("");
                        if cred_user_id != keep_id {
                            // update credential mapping to point to keep_id while preserving other fields
                            let mut new_cred: JVal = cred.clone();
                            if let Some(map) = new_cred.as_object_mut() {
                                map.insert("user_id".to_string(), serde_json::Value::String(keep_id.clone()));
                            }
                            let _ = state.storage.put_credentials(&email, &new_cred);
                        }
                    }
                }
            }

            // write backup file
            let ts: String = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
            let path: String = format!("./data/admin_dedupe_backup_{}.json", ts);
            if let Ok(json) = serde_json::to_string_pretty(&backup) {
                let _ = std::fs::write(&path, json);
            }

            Ok(Json(serde_json::json!({ "ok": true, "deleted_groups": backup.len(), "backup": path })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

//// api_dev_echo removed (dev-only helper). Restore later if needed.

/// Dev convenience: promote the hard-coded ADMIN_EMAIL without any client quoting
/// Usage: GET /auth/dev/promote_now
async fn api_dev_promote_now(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email: String = ADMIN_EMAIL.to_string();

    // Find credentials to get the user_id
    let cred: serde_json::Value = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let user_id: String = cred
        .get("user_id")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();

    // Load user record and promote
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &user) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true, "promoted": email })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev convenience: reset rate counter for the hard-coded ADMIN_EMAIL (dev-only)
/// Usage: GET /auth/dev/reset_rate_now
async fn api_dev_reset_rate_now(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Look up credentials for admin email to find user_id
    let email: String = ADMIN_EMAIL.to_string();
    let cred: serde_json::Value = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };
    let user_id: String = cred
        .get("user_id")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();

    // Reset rate counter for this user id (best-effort)
    match state.storage.reset_rate_counter(&user_id) {
        Ok(_) => Ok(Json(serde_json::json!({ "ok": true, "reset": user_id }))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev convenience: clear in-memory token buckets in the rate limiter (dev-only)
async fn api_dev_clear_buckets(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Clear in-memory buckets (best-effort)
    state.rate.clear_buckets();
    Ok(Json(serde_json::json!({ "ok": true, "cleared": true })))
}

/// Dev inspect token: verify a JWT and return decoded claims or the verification error.
/// POST JSON: { "token": "<jwt>" }
async fn api_dev_inspect_token(
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token: String = payload
        .get("token")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "missing token".to_string()))?
        .to_string();

    match auth::verify_jwt(&token) {
        Ok(data) => {
            // Return the claims JSON so we can inspect sub/exp/iat/iss/aud
            Ok(Json(serde_json::json!({
                "ok": true,
                "claims": {
                    "sub": data.claims.sub,
                    "iat": data.claims.iat,
                    "exp": data.claims.exp,
                    "iss": data.claims.iss,
                    "aud": data.claims.aud
                }
            })))
        }
        Err(e) => {
            tracing::error!("inspect_token verify failed: {:?}", e);
            Err((StatusCode::BAD_REQUEST, e.to_string()))
        }
    }
}
 
/// Dev convenience: set a password for a user (dev-only)
/// - Creates the user if missing and stores an Argon2 password hash in credentials table.
async fn api_dev_set_password(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "missing email".to_string()))?
        .trim()
        .to_lowercase();
    let password = payload
        .get("password")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "missing password".to_string()))?;
    if password.len() < 8 {
        return Err((StatusCode::BAD_REQUEST, "password too short".to_string()));
    }

    // Ensure user exists or create one
    let user_id = match state.storage.get_credentials(&email) {
        Ok(Some(cred)) => cred.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        _ => {
            let id = Uuid::new_v4().to_string();
            let role = if is_admin_email(&email) { "admin" } else { "user" };
            let user_obj = serde_json::json!({
                "id": id,
                "email": email,
                "created_at": chrono::Utc::now().timestamp(),
                "role": role
            });
            state.storage.put_user(&id, &user_obj).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            id
        }
    };

    // Hash password using Argon2
    let mut salt_bytes: [u8; 16] = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt: SaltString = SaltString::encode_b64(&salt_bytes)
        .map_err(|e: password_hash::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let argon2: Argon2<'_> = Argon2::default();
    let pwd_hash: String = match argon2.hash_password(password.as_bytes(), &salt) {
        Ok(ph) => ph.to_string(),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let cred_obj: serde_json::Value = serde_json::json!({
        "user_id": user_id,
        "password_hash": pwd_hash,
        "created_at": chrono::Utc::now().timestamp()
    });
    state.storage.put_credentials(&email, &cred_obj).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true, "email": email })))
}

#[derive(Deserialize)]
#[serde(untagged)]
enum AuthPayload {
  ByEmail { email: String, password: String },
  ByUsername { username: String, password: String },
}

/// Payload used specifically for signup where username is required.
#[derive(Deserialize)]
struct SignupPayload {
  email: String,
  password: String,
  username: String,
}

/// POST /api/auth/signup
///
/// - Validates email and password
/// - Hashes the password using Argon2 and stores credentials
/// - Creates a user record in storage
/// - Issues a JWT (stored as cookie) and returns some user info in JSON
///
/// Notes for TypeScript devs:
/// - Instead of `async function(req, res)`, axum maps function arguments from request parts.
/// - Instead of `res.cookie(...)` like in Express, we use CookieJar to manage cookies.
async fn api_signup(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<SignupPayload>,
) -> Result<(CookieJar, Json<serde_json::Value>), (StatusCode, String)> {
    // Trim and normalize email (lowercase)
    let email: String = payload.email.trim().to_lowercase();
    let password: String = payload.password;

    // Basic validation: non-empty email and password length >= 8
    if email.is_empty() || password.len() < 8 {
        return Err((StatusCode::BAD_REQUEST, "invalid email or password".into()));
    }

    // Check if email already exists
    match state.storage.get_credentials(&email) {
        Ok(Some(_)) => return Err((StatusCode::CONFLICT, "email already registered".into())),
        Ok(None) => {}
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }

    // Validate username (required) and ensure uniqueness (case-insensitive)
    let u_trim: &str = payload.username.trim();
    if u_trim.is_empty() || u_trim.len() < 2 {
        return Err((StatusCode::BAD_REQUEST, "invalid username".into()));
    }
    match state.storage.list_users() {
        Ok(users) => {
            if users.iter().any(|usr: &serde_json::Value| {
                usr.get("username")
                    .and_then(|v: &serde_json::Value| v.as_str())
                    .map(|s: &str| s.eq_ignore_ascii_case(u_trim))
                    .unwrap_or(false)
            }) {
                return Err((StatusCode::CONFLICT, "username already taken".into()));
            }
        }
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }

    // Create user id and persist user + credentials
    let user_id: String = Uuid::new_v4().to_string();
    // Determine role by hard-coded admin email
    let role: &'static str = if is_admin_email(&email) { "admin" } else { "user" };
    let user_obj: serde_json::Value = serde_json::json!({
        "id": user_id,
        "email": email,
        "username": u_trim.to_string(),
        "created_at": chrono::Utc::now().timestamp(),
        "role": role
    });
    if let Err(e) = state.storage.put_user(&user_id, &user_obj) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    // Hash password using Argon2 (secure password hashing)
    // Generate salt bytes using rand::thread_rng so we don't rely on getrandom directly.
    let mut salt_bytes: [u8; 16] = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt: SaltString = SaltString::encode_b64(&salt_bytes)
        .map_err(|e: password_hash::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let argon2: Argon2<'_> = Argon2::default();
    let pwd_hash: String = match argon2.hash_password(password.as_bytes(), &salt) {
        Ok(ph) => ph.to_string(),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let cred_obj: serde_json::Value = serde_json::json!({
        "user_id": user_id,
        "password_hash": pwd_hash,
        "created_at": chrono::Utc::now().timestamp()
    });
    if let Err(e) = state.storage.put_credentials(&email, &cred_obj) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    // Issue JWT and set cookie
    // We create a session cookie that is HttpOnly to prevent JS access (security).
    let token: String = match create_jwt(&user_id, 3600 * 24 * 7) {
        Ok(t) => t,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };
    let mut cookie: Cookie<'_> = Cookie::new("session", token);
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    let jar: CookieJar = jar.add(cookie);

    Ok((jar, Json(serde_json::json!({ "userId": user_id, "email": email }))))
}

/// GET /api/auth/check_username?u=<username>
/// Returns { available: true|false }
async fn api_check_username(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let username: String = q.get("u").cloned().unwrap_or_default();
    let username_trim: &str = username.trim();
    if username_trim.is_empty() {
        return Ok(Json(serde_json::json!({ "available": false })));
    }
    match state.storage.list_users() {
        Ok(users) => {
            let taken: bool = users.iter().any(|usr: &serde_json::Value| {
                usr.get("username")
                    .and_then(|v: &serde_json::Value| v.as_str())
                    .map(|s: &str| s.eq_ignore_ascii_case(username_trim))
                    .unwrap_or(false)
            });
            Ok(Json(serde_json::json!({ "available": !taken })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
    
/// POST /api/auth/login
///
/// - Validates credentials by comparing provided password with stored Argon2 hash
/// - Accepts multiple content types (application/json, application/x-www-form-urlencoded,
///   multipart/form-data (dev heuristic)) for compatibility with Qwik actions in dev.
/// - Issues a JWT in a cookie on successful login
async fn api_login(
    State(state): State<AppState>,
    jar: CookieJar,
    req: Request<Body>,
) -> Result<(CookieJar, Json<serde_json::Value>), (StatusCode, String)> {
    // Read content-type for tolerant parsing
    let ct: String = req
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    // Read body bytes (bounded to avoid unbounded memory use)
    let bytes = axum::body::to_bytes(req.into_body(), 64 * 1024)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Parse into AuthPayload (supports username or email) from several common shapes
    let payload: AuthPayload = if ct.contains("application/json") {
        serde_json::from_slice(&bytes).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    } else if ct.contains("application/x-www-form-urlencoded") {
        // Parse URL-encoded form into map (use `url::form_urlencoded` to avoid adding serde_urlencoded)
        let form_map: std::collections::HashMap<String, String> =
            url::form_urlencoded::parse(&bytes).into_owned().collect();
        let password = form_map.get("password").cloned().ok_or((StatusCode::BAD_REQUEST, "missing password".to_string()))?;
        if let Some(u) = form_map.get("username").cloned() {
            AuthPayload::ByUsername { username: u, password }
        } else if let Some(e) = form_map.get("email").cloned() {
            AuthPayload::ByEmail { email: e, password }
        } else {
            return Err((StatusCode::BAD_REQUEST, "missing email or username".to_string()));
        }
    } else if ct.contains("multipart/form-data") {
        // Dev-only lightweight multipart heuristic
        let s: String = String::from_utf8_lossy(&bytes).to_string();
        let extract = |s: &str, name: &str| -> Option<String> {
            let marker: String = format!("name=\"{}\"", name);
            let idx: usize = s.find(&marker)?;
            let after: &str = &s[idx..];
            let dbl: &'static str = "\r\n\r\n";
            let i: usize = after.find(dbl)?;
            let rest: &str = &after[i + dbl.len()..];
            let end: usize = rest.find("\r\n").unwrap_or(rest.len());
            Some(rest[..end].to_string())
        };
        let password: String = extract(&s, "password").ok_or((StatusCode::BAD_REQUEST, "missing password".to_string()))?;
        if let Some(u) = extract(&s, "username") { AuthPayload::ByUsername { username: u, password } }
        else if let Some(e) = extract(&s, "email") { AuthPayload::ByEmail { email: e, password } }
        else { return Err((StatusCode::BAD_REQUEST, "missing email or username".to_string())); }
    } else {
        // Unexpected content-type: try JSON as a best-effort
        serde_json::from_slice(&bytes).map_err(|e| (StatusCode::UNSUPPORTED_MEDIA_TYPE, e.to_string()))?
    };

    // Normalize identifiers and resolve email when username is provided
    let (email, password): (String, String) = match payload {
        AuthPayload::ByEmail { email, password } => (email.trim().to_lowercase(), password),
        AuthPayload::ByUsername { username, password } => {
            // Find user by username (case-insensitive) to resolve email used for credentials storage
            let uname = username.trim();
            if uname.is_empty() { return Err((StatusCode::BAD_REQUEST, "invalid username".to_string())); }
            let email_opt: Option<String> = match state.storage.list_users() {
                Ok(users) => users.iter().find_map(|usr: &serde_json::Value| {
                    let u = usr.get("username").and_then(|v| v.as_str());
                    if u.map(|s| s.eq_ignore_ascii_case(uname)).unwrap_or(false) {
                        usr.get("email").and_then(|v| v.as_str()).map(|s| s.to_lowercase())
                    } else { None }
                }),
                Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
            };
            // Dev-friendly fallback: if username is "admin" but no username is set on the admin user,
            // map to the configured ADMIN_EMAIL so dev admin can log in with username.
            let email = match email_opt {
                Some(e) => e,
                None if uname.eq_ignore_ascii_case("admin") => ADMIN_EMAIL.to_string(),
                None => return Err((StatusCode::UNAUTHORIZED, "invalid credentials".to_string())),
            };
            (email, password)
        }
    };

    // Dev-friendly log: content-type and whether fields are present (do not log actual password)
    tracing::debug!(content_type = %ct, has_email = %(!email.is_empty()), "api_login invoked");

    // Fetch credentials
    let creds_val: serde_json::Value = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::UNAUTHORIZED, "invalid credentials".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let user_id: String = creds_val
        .get("user_id")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();

    let stored_hash: &str = creds_val
        .get("password_hash")
        .and_then(|v: &serde_json::Value| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?;

    // Verify password using Argon2 verify_password
    let parsed_hash: PasswordHash<'_> = PasswordHash::new(stored_hash)
        .map_err(|e: password_hash::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_err()
        {
        tracing::info!("login failed for email (invalid password): {}", email);
        return Err((StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "invalid credentials" }).to_string()));
    }

    // Ensure a user record exists for this credentials record (belt-and-suspenders for seeded admin)
    match state.storage.get_user(&user_id) {
        Ok(Some(_)) => { /* ok */ }
        Ok(None) => {
            let uname_guess = email.split('@').next().unwrap_or("user");
            let role = if is_admin_email(&email) { "admin" } else { "user" };
            let user_obj = serde_json::json!({
                "id": user_id,
                "email": email,
                "username": uname_guess,
                "created_at": chrono::Utc::now().timestamp(),
                "role": role,
            });
            if let Err(e) = state.storage.put_user(&user_id, &user_obj) {
                tracing::warn!("login: failed to create missing user record: {:?}", e);
            }
        }
        Err(e) => {
            tracing::warn!("login: get_user failed: {:?}", e);
        }
    }

    // Issue JWT and set cookie
    let token: String = match create_jwt(&user_id, 3600 * 24 * 7) {
        Ok(t) => t,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };
    let mut cookie: Cookie<'_> = Cookie::new("session", token);
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    let jar: CookieJar = jar.add(cookie);

    Ok((jar, Json(serde_json::json!({ "userId": user_id, "email": email }))))
}

/// POST /api/auth/logout
///
/// Remove session cookie by setting it to empty and returning 204 No Content.
async fn api_logout(jar: CookieJar) -> (CookieJar, StatusCode) {
    // Remove session cookie
    let mut cookie: Cookie<'_> = Cookie::new("session", "");
    cookie.set_path("/");
    let jar: CookieJar = jar.remove(cookie);
    (jar, StatusCode::NO_CONTENT)
}

/// Return the authenticated user's information (requires valid session token in cookie or Authorization header)
///
/// - Accepts a Bearer token in the Authorization header or a session cookie
/// - Verifies JWT and returns user object from storage
async fn api_auth_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Try Authorization header 'Bearer <token>' first
    let token_opt: Option<String> = headers
        .get("authorization")
        .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
        .map(|s: &str| s.to_string());

    // If no Authorization header, check cookie header for "session=<token>"
    let token: Option<String> = if let Some(s) = token_opt {
        if s.to_lowercase().starts_with("bearer ") {
            Some(s[7..].to_string())
        } else {
            None
        }
    } else if let Some(cookie_header) = headers.get("cookie").and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok()) {
        // simple parse for session cookie
        cookie_header.split(';').find_map(|kv: &str| {
            let kv: &str = kv.trim();
            if kv.starts_with("session=") {
                Some(kv.trim_start_matches("session=").to_string())
            } else {
                None
            }
        })
    } else {
        None
    };

    let token: String = match token {
        Some(t) => t,
        None => return Err((StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "missing token" }).to_string())),
    };

    let user_id: String = match auth::verify_jwt(&token) {
        Ok(data) => data.claims.sub,
        Err(e) => {
            tracing::error!("token verification failed: {:?}", e);
            return Err((StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "invalid token" }).to_string()));
        }
    };

    match state.storage.get_user(&user_id) {
        Ok(Some(val)) => Ok(Json(val)),
        Ok(None) => Err((StatusCode::NOT_FOUND, serde_json::json!({ "message": "user not found" }).to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Admin: list users
///
/// - Requires the requester to be an admin user (checks stored user.role)
/// - Returns the list of users from storage
async fn api_admin_list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Centralized admin check
    let _user_id: String = match require_admin(&state, &headers) {
        Ok(id) => id,
        Err((status, api_err)) => return Err((status, api_err.message)),
    };

    // Fetch all users
    match state.storage.list_users() {
        Ok(users) => Ok(Json(serde_json::to_value(users).unwrap_or_else(|_| serde_json::json!([])))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Admin: promote a user to admin by id
///
/// - Requires requester to be an admin
/// - Loads and updates the target user's role to "admin"
async fn api_admin_promote_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Centralized admin check
    let _requester_id: String = match require_admin(&state, &headers) {
        Ok(id) => id,
        Err((status, api_err)) => return Err((status, api_err.message)),
    };

    // Load target user record
    match state.storage.get_user(&user_id) {
        Ok(Some(mut target)) => {
            if target.get("role").and_then(|r: &serde_json::Value| r.as_str()) == Some("admin") {
                return Ok(Json(serde_json::json!({ "ok": true, "already_admin": true })));
            }
            if let Some(obj) = target.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &target) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true, "promoted": user_id })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Admin: demote an admin to user by id
///
/// - Prevents self-demote and demoting the last remaining admin.
/// - Requires the requester to be an admin.
async fn api_admin_demote_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Centralized admin check
    let requester_id: String = match require_admin(&state, &headers) {
        Ok(id) => id,
        Err((status, api_err)) => return Err((status, api_err.message)),
    };

    // Prevent self-demote (safety)
    if requester_id == user_id {
        return Err((StatusCode::BAD_REQUEST, "cannot demote your own admin account".to_string()));
    }

    // Load target user record
    match state.storage.get_user(&user_id) {
        Ok(Some(mut target)) => {
            // If already a non-admin, return ok (idempotent)
            if target.get("role").and_then(|r: &serde_json::Value| r.as_str()) != Some("admin") {
                return Ok(Json(serde_json::json!({ "ok": true, "already_user": true })));
            }

            // Optional: prevent demoting last remaining admin
            // Count current admins; if only one and it's the target, forbid demotion
            if let Ok(users) = state.storage.list_users() {
                let admin_count: usize = users.iter().filter(|u: &<std::slice::Iter<'_, serde_json::Value> as Iterator>::Item| u.get("role").and_then(|r| r.as_str()) == Some("admin")).count();
                if admin_count <= 1 {
                    return Err((StatusCode::BAD_REQUEST, "cannot demote the last admin".to_string()));
                }
            }

            if let Some(obj) = target.as_object_mut() {
                obj.insert("role".to_string(), serde_json::Value::String("user".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &target) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true, "demoted": user_id })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Admin: delete a user by id
///
/// - Requires requester to be admin
/// - Prevents deleting yourself or other admins
async fn api_admin_delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Centralized admin check
    let requester_id: String = match require_admin(&state, &headers) {
        Ok(id) => id,
        Err((status, api_err)) => return Err((status, api_err.message)),
    };

    // Prevent deleting self (safety)
    if requester_id == user_id {
        return Err((StatusCode::BAD_REQUEST, "cannot delete your own admin account".to_string()));
    }

    // Prevent deleting another admin
    match state.storage.get_user(&user_id) {
        Ok(Some(target)) => {
            if target.get("role").and_then(|r| r.as_str()) == Some("admin") {
                return Err((StatusCode::BAD_REQUEST, "cannot delete another admin".to_string()));
            }
        }
        Ok(None) => return Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }

    match state.storage.delete_user(&user_id) {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Dev convenience: set the configured ADMIN_EMAIL user's username to "admin" (dev-only)
/// Usage: POST /auth/dev/set_admin_username
async fn api_dev_set_admin_username(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email = ADMIN_EMAIL.to_string();

    // Find credentials to get the user_id
    let cred = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let user_id = cred
        .get("user_id")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?
        .to_string();

    // Load user record and set username
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() {
                obj.insert("username".to_string(), serde_json::Value::String("admin".to_string()));
            }
            if let Err(e) = state.storage.put_user(&user_id, &user) {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
            Ok(Json(serde_json::json!({ "ok": true, "user_id": user_id, "username": "admin" })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Simple root handler that returns a static HTML string
async fn root() -> Html<&'static str> {
    Html("Gateway up")
}

