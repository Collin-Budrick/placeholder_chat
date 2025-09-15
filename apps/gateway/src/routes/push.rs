// use std::time::Duration;

use axum::{Router, routing::{get, post}, extract::{State}, Json};
use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use anyhow::Result;

use crate::state::AppState;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PushKeys { pub p256dh: String, pub auth: String }

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PushSubscription {
    pub endpoint: String,
    #[serde(default, rename = "expirationTime")]
    pub expiration_time: Option<i64>,
    pub keys: PushKeys,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PushMessage { pub title: Option<String>, pub body: Option<String>, pub url: Option<String>, pub icon: Option<String>, pub badge: Option<String> }

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/push/subscribe", post(subscribe))
        .route("/api/push/unsubscribe", post(unsubscribe))
        .route("/api/push/subscriptions", get(list_subscriptions))
        .route("/api/push/public-key", get(public_key))
        .route("/api/push/test", post(send_test))
        .route("/api/push/send_to_user", post(send_to_user))
}

async fn subscribe(State(state): State<AppState>, headers: HeaderMap, Json(sub): Json<PushSubscription>) -> axum::response::Response {
    use axum::response::IntoResponse;
    // Try to map subscription to a user (if authorized)
    let user_id = crate::state::extract_token(&headers).and_then(|t| auth::verify_jwt(&t).ok().map(|d| d.claims.sub));
    let obj = serde_json::json!({
        "endpoint": sub.endpoint,
        "keys": { "p256dh": sub.keys.p256dh, "auth": sub.keys.auth },
        "created_at": chrono::Utc::now().timestamp(),
        "user_id": user_id,
    });
    let user_opt = obj.get("user_id").and_then(|v| v.as_str());
    if let Err(e) = state.storage.put_push_subscription_with_user(
        obj.get("endpoint").and_then(|v| v.as_str()).unwrap_or_default(),
        user_opt,
        &obj,
    ) {
        tracing::error!("push subscribe storage failed: {:?}", e);
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "persist failed").into_response();
    }
    (axum::http::StatusCode::NO_CONTENT, "").into_response()
}

async fn send_test(State(state): State<AppState>, Json(msg): Json<PushMessage>) -> axum::response::Response {
    use axum::response::IntoResponse;
    match send_to_all(&state, msg).await {
        Ok(count) => (axum::http::StatusCode::OK, format!("sent to {count} subscriptions")).into_response(),
        Err(e) => { tracing::error!("push send failed: {:?}", e); (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "send failed").into_response() },
    }
}

async fn send_to_all(state: &AppState, msg: PushMessage) -> Result<usize> {
    let subs_vals = state.storage.list_push_subscriptions()?;
    let total = subs_vals.len();
    tracing::info!("push broadcast simulated: to={} title={:?}", total, msg.title);
    Ok(total)
}

#[derive(Debug, Deserialize)]
struct UnsubReq { endpoint: String }

async fn unsubscribe(State(state): State<AppState>, Json(req): Json<UnsubReq>) -> axum::response::Response {
    use axum::response::IntoResponse;
    match state.storage.delete_push_subscription(&req.endpoint) {
        Ok(_) => (axum::http::StatusCode::NO_CONTENT, "").into_response(),
        Err(e) => { tracing::error!("unsubscribe failed: {:?}", e); (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "unsubscribe failed").into_response() }
    }
}

async fn list_subscriptions(State(state): State<AppState>, headers: HeaderMap) -> axum::response::Response {
    use axum::response::IntoResponse;
    // Admin-only
    if let Err((code, err)) = crate::state::require_admin(&state, &headers) {
        return (code, axum::Json(err)).into_response();
    }
    match state.storage.list_push_subscriptions() {
        Ok(list) => (axum::http::StatusCode::OK, axum::Json(list)).into_response(),
        Err(e) => { tracing::error!("list_subscriptions failed: {:?}", e); (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "list failed").into_response() }
    }
}

/// GET /api/push/public-key
/// Returns the VAPID public key so clients can subscribe when the key is not baked into the build env.
async fn public_key() -> axum::response::Response {
    use axum::response::IntoResponse;
    match std::env::var("VAPID_PUBLIC_KEY") {
        Ok(pk) if !pk.is_empty() => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({ "publicKey": pk })),
        )
            .into_response(),
        _ => (axum::http::StatusCode::NO_CONTENT, "").into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct SendToUserReq { user_id: String, title: Option<String>, body: Option<String>, url: Option<String>, icon: Option<String>, badge: Option<String> }

async fn send_to_user(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<SendToUserReq>) -> axum::response::Response {
    use axum::response::IntoResponse;
    // Admin only
    if let Err((code, err)) = crate::state::require_admin(&state, &headers) {
        return (code, axum::Json(err)).into_response();
    }
    let msg = PushMessage { title: req.title, body: req.body, url: req.url, icon: req.icon, badge: req.badge };
    match send_to_user_internal(&state, msg, req.user_id).await {
        Ok(n) => (axum::http::StatusCode::OK, format!("sent to {n} subscriptions for user")).into_response(),
        Err(e) => { tracing::error!("send_to_user failed: {:?}", e); (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "send failed").into_response() }
    }
}

async fn send_to_user_internal(state: &AppState, msg: PushMessage, user_id: String) -> Result<usize> {
    let subs_vals = state.storage.list_push_subscriptions_for_user(&user_id)?;
    let total = subs_vals.len();
    tracing::info!("push user simulated: user_id={} to={} title={:?}", user_id, total, msg.title);
    Ok(total)
}
