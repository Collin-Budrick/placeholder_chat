// App state and shared helpers
//
// This module defines:
// - AppState: the shared services the app uses (storage, pub/sub, presence,
//   rate limiting, and a cached NNG address). We store them in Arc<> so they
//   can be cheaply cloned and used by async handlers across threads.
// - Small, centralized helpers used by multiple modules (admin check, token
//   extraction, and an ApiError JSON shape).
//
// If you're new to Axum: `State(AppState)` is an extractor that injects a clone
// of AppState into handlers. You construct it once in main and attach to the
// router with `.with_state(state.clone())`.

use std::sync::Arc;
use axum::http::{HeaderMap, StatusCode};
use serde::Serialize;

use bus::pubsub::Publisher;
use storage::Storage;

// Exposed so routes can access presence/rate types without re-importing here
pub use presence::PresenceManager;
pub use rate::RateLimiter;

// A constant used in dev helpers for the administrator email address.
/// Default admin email used in dev helpers and seeding logic.
pub const ADMIN_EMAIL: &str = "admin@example.com";

// Simple helper: check whether an email equals the configured admin email (case-insensitive).
/// Case-insensitive comparison helper for the default admin email.
pub fn is_admin_email(email: &str) -> bool {
    email.eq_ignore_ascii_case(ADMIN_EMAIL)
}

// AppState: shared state attached to the axum Router.
/// Shared app state cloned into request handlers via `State(AppState)`.
#[derive(Clone)]
pub struct AppState {
    pub publisher: Arc<Publisher>,
    pub storage: Arc<Storage>,
    pub presence: Arc<PresenceManager>,
    pub rate: Arc<RateLimiter>,
    // NNG publisher address (moved into shared state so we don't read env on every connection)
    pub nng_addr: String,
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

/// High-level extractor used across middleware and handlers.
pub fn extract_token(headers: &HeaderMap) -> Option<String> {
    header_bearer_token(headers).or_else(|| cookie_session_token(headers))
}

/// Standard API error type so we return a consistent JSON shape for errors.
#[derive(Serialize)]
pub struct ApiError {
    pub message: String,
}

/// Centralized admin requirement helper.
/// Returns Ok(requester_id) or Err((StatusCode, ApiError)) suitable for returning from handlers.
pub fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<String, (StatusCode, ApiError)> {
    // Extract token and verify
    let token: String = extract_token(headers)
        .ok_or((StatusCode::UNAUTHORIZED, ApiError { message: "missing authorization".into() }))?;
    let data = auth::verify_jwt(&token)
        .map_err(|_| (StatusCode::UNAUTHORIZED, ApiError { message: "invalid token".into() }))?;
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
