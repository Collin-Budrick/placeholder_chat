// Admin endpoints (require requester is admin)
//
// - GET    /api/admin/users
// - POST   /api/admin/users/{id}/promote
// - POST   /api/admin/users/{id}/demote
// - DELETE /api/admin/users/{id}
//
// We apply CSRF protection to unsafe methods via a route layer.
use axum::{routing::get, routing::post, routing::delete, Router, extract::{State, Path}, Json, middleware};
use crate::middleware as gw_mw;
use axum::http::{HeaderMap, StatusCode};
use crate::state::{AppState, require_admin};

/// Build router for admin-only APIs.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/users", get(api_admin_list_users))
        .route("/api/admin/users/{id}/promote", post(api_admin_promote_user))
        .route("/api/admin/users/{id}/demote", post(api_admin_demote_user))
        .route("/api/admin/users/{id}", delete(api_admin_delete_user))
        .route_layer(middleware::from_fn(gw_mw::csrf_middleware))
}

async fn api_admin_list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Verify requester is an admin via JWT + stored role
    let _user_id = match require_admin(&state, &headers) { Ok(id) => id, Err((status, e)) => return Err((status, e.message)) };
    match state.storage.list_users() {
        Ok(users) => Ok(Json(serde_json::to_value(users).unwrap_or_else(|_| serde_json::json!([])))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// POST /api/admin/users/{id}/promote — elevate a user to admin role
async fn api_admin_promote_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Admin-only guard
    let _ = match require_admin(&state, &headers) { Ok(id) => id, Err((status, e)) => return Err((status, e.message)) };
    match state.storage.get_user(&user_id) {
        Ok(Some(mut target)) => {
            if target.get("role").and_then(|r: &serde_json::Value| r.as_str()) == Some("admin") {
                return Ok(Json(serde_json::json!({ "ok": true, "already_admin": true })));
            }
            // Mutate role in place and persist
            if let Some(obj) = target.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); }
            if let Err(e) = state.storage.put_user(&user_id, &target) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); }
            Ok(Json(serde_json::json!({ "ok": true, "promoted": user_id })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// POST /api/admin/users/{id}/demote — change admin to regular user
async fn api_admin_demote_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let requester_id = match require_admin(&state, &headers) { Ok(id) => id, Err((status, e)) => return Err((status, e.message)) };
    // Prevent self-demotion as a safety guard
    if requester_id == user_id { return Err((StatusCode::BAD_REQUEST, "cannot demote your own admin account".to_string())); }
    match state.storage.get_user(&user_id) {
        Ok(Some(mut target)) => {
            if target.get("role").and_then(|r: &serde_json::Value| r.as_str()) != Some("admin") {
                return Ok(Json(serde_json::json!({ "ok": true, "already_user": true })));
            }
            // Optional: prevent demoting the last remaining admin
            if let Ok(users) = state.storage.list_users() {
                let admin_count: usize = users.iter().filter(|u| u.get("role").and_then(|r| r.as_str()) == Some("admin")).count();
                if admin_count <= 1 { return Err((StatusCode::BAD_REQUEST, "cannot demote the last admin".to_string())); }
            }
            if let Some(obj) = target.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("user".to_string())); }
            if let Err(e) = state.storage.put_user(&user_id, &target) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); }
            Ok(Json(serde_json::json!({ "ok": true, "demoted": user_id })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// DELETE /api/admin/users/{id} — remove a non-admin user (safety checks apply)
async fn api_admin_delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let requester_id = match require_admin(&state, &headers) { Ok(id) => id, Err((status, e)) => return Err((status, e.message)) };
    // Disallow deleting self
    if requester_id == user_id { return Err((StatusCode::BAD_REQUEST, "cannot delete your own admin account".to_string())); }
    match state.storage.get_user(&user_id) {
        Ok(Some(target)) => {
            // Disallow deleting admins
            if target.get("role").and_then(|r| r.as_str()) == Some("admin") {
                return Err((StatusCode::BAD_REQUEST, "cannot delete another admin".to_string()));
            }
        }
        Ok(None) => return Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
    match state.storage.delete_user(&user_id) { Ok(_) => Ok(StatusCode::NO_CONTENT), Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())) }
}
