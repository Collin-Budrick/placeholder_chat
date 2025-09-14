// Room history + message endpoints
//
// - GET /rooms/{room}/history: read stored messages with simple pagination.
// - POST /rooms/{room}/messages: append a message to storage and publish to
//   the room topic (pub/sub). We rate-limit per authenticated user or "anon".
use axum::{routing::get, routing::post, Router, extract::{State, Path, Query}, Json};
use axum::http::StatusCode;
use std::collections::HashMap;
use crate::state::AppState;

/// Build router for room history + message APIs.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/rooms/{room}/history", get(get_room_history))
        .route("/rooms/{room}/messages", post(post_room_message))
}

/// GET /rooms/{room}/history
/// Returns stored messages for a room. Query params:
/// - after_ts: i64, optional lower bound timestamp
/// - limit: usize, optional max items (default 50)
async fn get_room_history(
    State(state): State<AppState>,
    Path(room): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Parse optional pagination params; invalid values are ignored gracefully
    let after_ts: Option<i64> = q.get("after_ts").and_then(|s| s.parse::<i64>().ok());
    let limit: usize = q.get("limit").and_then(|s| s.parse::<usize>().ok()).unwrap_or(50);

    // Delegate to the rooms crate which reads messages from storage
    match rooms::fetch_history(&room, after_ts, limit, &*state.storage) {
        Ok(msgs) => Ok(Json(serde_json::to_value(&msgs).unwrap_or_else(|_| serde_json::json!([])))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// POST /rooms/{room}/messages
/// Persists a message (arbitrary JSON) and publishes it to subscribers.
/// Rate-limited by user-id (derived from Bearer token) or "anon".
async fn post_room_message(
    State(state): State<AppState>,
    Path(room): Path<String>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Support Authorization: Bearer <token> for user identification
    let token_opt: Option<String> = headers
        .get("authorization")
        .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
        .and_then(|s: &str| {
            if s.to_lowercase().starts_with("bearer ") {
                Some(s[7..].to_string())
            } else { None }
        });

    // Derive the per-user rate key: JWT sub or "anon"
    let rate_key: String = if let Some(token) = token_opt {
        match auth::verify_jwt(&token) { Ok(data) => data.claims.sub, Err(_) => "anon".to_string() }
    } else { "anon".to_string() };

    // Enforce rate limiting; persist a counter for basic metrics
    if !state.rate.allow(&rate_key) { return Err((StatusCode::TOO_MANY_REQUESTS, "rate limit".to_string())); }
    let _ = state.storage.incr_rate_counter(&rate_key, 1);

    // Persist + publish via rooms helper; return the stored record
    match rooms::send_message(&room, payload, &*state.storage, &*state.publisher) {
        Ok(rec) => Ok(Json(serde_json::to_value(&rec).unwrap_or_else(|_| serde_json::json!({})))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
