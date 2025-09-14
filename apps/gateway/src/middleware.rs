// Cross-cutting middleware
//
// These functions run "around" handlers to apply consistent behavior:
// - rate_limit_middleware: derives a per-user or anonymous rate key and throttles
//   requests using an in-process token bucket.
// - csrf_middleware: enforces the double-submit cookie pattern for unsafe
//   methods (POST/PUT/PATCH/DELETE) when a csrf cookie is present.
// - log_post_body_middleware: dev-only, logs POST request/response bodies up to
//   a cap for debugging.
//
// In Axum, middleware are async functions used with `middleware::from_fn(...)`.
// They get the request (and optionally State), and must call `next.run(req)` to
// forward to the next layer/handler.

use axum::{
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    extract::{State},
};
use axum::body::Body;
use crate::state::{AppState, extract_token};

use http_body_util::BodyExt as _; // for .collect()
use bytes::Bytes;
use axum::http::Method;

/// Rate limiting middleware (token bucket per key)
///
/// What this does:
/// - Derives a rate key (usually the authenticated user id from a verified
///   JWT; otherwise falls back to the string "anon").
/// - Skips throttling for a small set of endpoints (auth, logs, health, ws)
///   to avoid interfering with session flows and WebSocket upgrades.
/// - Checks an in-process token bucket and returns HTTP 429 if the client
///   exceeds the configured rate.
///
/// Why it's safe:
/// - Verifying the JWT before using its `sub` (subject/user id) prevents
///   spoofing. If verification fails, we intentionally treat requests as
///   anonymous (the more restrictive path).
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: axum::http::Request<Body>,
    next: Next,
) -> Response {
    // Try to read Authorization: Bearer <token> or session cookie and
    // verify the JWT to get a stable user id. Otherwise default to "anon".
    let rate_key: String = extract_token(req.headers())
        .and_then(|tok: String| auth::verify_jwt(&tok).ok().map(|data| data.claims.sub))
        .unwrap_or_else(|| "anon".to_string());

    // Exempt common auth and health endpoints from throttling to keep the
    // UX smooth during login/signup/logout and health checks.
    if let Some(path) = req.uri().path().strip_prefix("") {
        if path.starts_with("/api/auth/me")
            || path.starts_with("/api/auth/login")
            || path.starts_with("/api/auth/logout")
            || path.starts_with("/api/auth/signup")
            || path.starts_with("/api/auth/check_username")
            || path.starts_with("/api/frontend-logs")
            || path.starts_with("/healthz")
            || path.starts_with("/ws")
        {
            let resp: hyper::Response<Body> = next.run(req).await;
            return resp;
        }
    }

    // Consume a token; deny if no capacity is left.
    if !state.rate.allow(&rate_key) {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit").into_response();
    }

    next.run(req).await
}

/// CSRF protection middleware (double-submit cookie pattern)
///
/// What this does:
/// - For unsafe HTTP methods (POST/PUT/PATCH/DELETE), if a cookie named
///   `csrfToken` is present, require a matching `X-CSRF-Token` header value.
/// - If no `csrfToken` cookie is present, we skip enforcement entirely.
///   This allows token/bearer clients (no cookies) to use the API without
///   extra friction.
///
/// Why this pattern:
/// - Double-submit cookie is a simple, stateless defense against CSRF when
///   cookie-based sessions are used. Attackers can cause the browser to send
///   cookies, but cannot read the cookie to copy its value into a header.
pub async fn csrf_middleware(req: axum::http::Request<Body>, next: Next) -> Response {
    let m: &Method = req.method();
    if matches!(m, &Method::GET | &Method::HEAD | &Method::OPTIONS) {
        return next.run(req).await;
    }

    let headers: &HeaderMap = req.headers();
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

    let csrf_header = headers.get("x-csrf-token").and_then(|hv| hv.to_str().ok()).map(|s| s.to_string());
    if let Some(cookie_val) = csrf_cookie {
        if csrf_header.as_deref() != Some(cookie_val.as_str()) {
            return (StatusCode::FORBIDDEN, "csrf token mismatch").into_response();
        }
    }

    next.run(req).await
}

/// Development middleware: logs POST bodies and responses (size-capped)
///
/// What this does:
/// - Intercepts only POST requests, fully buffers the request body, logs it
///   up to 64 KiB, and then reconstructs the request so downstream extractors
///   still see the original bytes.
/// - Calls the handler and does the same buffering/logging for the response,
///   finally rebuilding the response to return to the client.
///
/// Tradeoffs:
/// - Because it buffers bodies, this should only be used in development and
///   never enabled for large uploads or in production.
pub async fn log_post_body_middleware(req: axum::http::Request<Body>, next: Next) -> impl IntoResponse {
    if req.method() == Method::POST {
        let path = req.uri().path().to_string();
        // Split request into parts and body so we can read the body and then
        // reconstruct the request with the exact same bytes.
        let (parts, body) = req.into_parts();
        let collected = match body.collect().await {
            Ok(col) => col.to_bytes(),
            Err(_) => Bytes::new(),
        };
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
        // Rebuild the request for downstream middleware/handler with the
        // original byte buffer so they can deserialize normally.
        let req = axum::http::Request::from_parts(parts, Body::from(collected));
        let res: Response = next.run(req).await;
        let status = res.status().as_u16();
        // Split and buffer the response to log without losing it
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
        // Reassemble the response and return it to the client
        let res = Response::from_parts(res_parts, Body::from(res_bytes));
        return res;
    }
    next.run(req).await
}
