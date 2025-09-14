// Dev utilities (local-only helpers)
//
// These endpoints are not meant for production; they help during local
// development to seed users, promote to admin, inspect JWTs, and tweak
// rate-limiter state.
use axum::{Router, routing::{get, post}, extract::{State, Path, Query}, Json};
use axum::http::StatusCode;
use serde_json::json;
use uuid::Uuid;
use crate::state::{AppState, ADMIN_EMAIL, is_admin_email};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use rand::RngCore;

/// Build router for dev-only helpers (unsafe for prod).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/dev/login", get(dev_login))
        .route("/auth/dev/login_post", post(dev_login_post))
        .route("/auth/dev/promote", post(api_dev_promote))
        .route("/auth/dev/promote_get", get(api_dev_promote_get))
        .route("/auth/dev/promote_by/{email}", get(api_dev_promote_by))
        .route("/auth/dev/promote_user_by_id/{id}", get(api_dev_promote_user_by_id))
        .route("/auth/dev/dedupe_admins", post(api_dev_dedupe_admins))
        .route("/auth/dev/promote_now", get(api_dev_promote_now))
        .route("/auth/dev/set_admin_username", post(api_dev_set_admin_username))
        .route("/auth/dev/reset_rate_now", get(api_dev_reset_rate_now))
        .route("/auth/dev/clear_buckets", get(api_dev_clear_buckets))
        .route("/auth/dev/inspect_token", post(api_dev_inspect_token))
        .route("/auth/dev/set_password", post(api_dev_set_password))
}

async fn dev_login(State(_state): State<AppState>) -> Json<serde_json::Value> {
    // Simple instruction message for how to use the POST dev login endpoint
    Json(json!({ "msg": "POST JSON {\"user\":\"alice\",\"email\":\"alice@example.com\"} to /auth/dev/login_post to receive an access token and refresh token (dev only)" }))
}

/// POST /auth/dev/login_post — create/find a user and issue access+refresh
/// This skips password handling and is for local testing only.
async fn dev_login_post(
    State(state): State<AppState>,
    Json(payload): Json<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let resp_value: serde_json::Value = (|| -> anyhow::Result<serde_json::Value> {
        let user_id: String = payload.get("user").cloned().unwrap_or_else(|| Uuid::new_v4().to_string());
        let email: String = payload.get("email").cloned().unwrap_or_else(|| format!("{}@example.com", &user_id));
        let role: &'static str = if is_admin_email(&email) { "admin" } else { "user" };
        let user_obj: serde_json::Value = json!({ "id": user_id, "email": email, "created_at": chrono::Utc::now().timestamp(), "role": role });
        state.storage.put_user(&user_id, &user_obj)?;
        let access: String = auth::create_jwt(&user_id, 3600)?;
        let refresh_id: String = Uuid::new_v4().to_string();
        let expiry: i64 = chrono::Utc::now().checked_add_signed(chrono::Duration::days(30)).unwrap().timestamp();
        state.storage.create_refresh_token(&refresh_id, &user_id, expiry)?;
        Ok(json!({ "access_token": access, "refresh_token": refresh_id, "user_id": user_id }))
    })().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(resp_value))
}

/// POST /auth/dev/promote — promote the configured ADMIN_EMAIL to admin
async fn api_dev_promote(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email = payload.get("email").and_then(|v| v.as_str()).ok_or((StatusCode::BAD_REQUEST, "missing email".to_string()))?.to_string();
    if !is_admin_email(&email) { return Err((StatusCode::FORBIDDEN, "not allowed".to_string())); }
    let cred = match state.storage.get_credentials(&email) { Ok(Some(v)) => v, Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let user_id: String = cred.get("user_id").and_then(|v| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => { if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); } if let Err(e) = state.storage.put_user(&user_id, &user) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); } Ok(Json(json!({ "ok": true }))) }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// GET /auth/dev/promote_get?email=... — promote by query param
async fn api_dev_promote_get(
    State(state): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email: String = q.get("email").cloned().ok_or((StatusCode::BAD_REQUEST, "missing email".to_string()))?;
    if !is_admin_email(&email) { return Err((StatusCode::FORBIDDEN, "not allowed".to_string())); }
    let cred = match state.storage.get_credentials(&email) { Ok(Some(v)) => v, Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let user_id: String = cred.get("user_id").and_then(|v| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => { if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); } if let Err(e) = state.storage.put_user(&user_id, &user) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); } Ok(Json(json!({ "ok": true }))) }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// GET /auth/dev/promote_by/{email} — promote by path segment
async fn api_dev_promote_by(
    State(state): State<AppState>,
    Path(email): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !is_admin_email(&email) { return Err((StatusCode::FORBIDDEN, "not allowed".to_string())); }
    let cred = match state.storage.get_credentials(&email) { Ok(Some(v)) => v, Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let user_id: String = cred.get("user_id").and_then(|v| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => { if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); } if let Err(e) = state.storage.put_user(&user_id, &user) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); } Ok(Json(json!({ "ok": true }))) }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// GET /auth/dev/promote_user_by_id/{id} — promote by user id
async fn api_dev_promote_user_by_id(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => { if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); } if let Err(e) = state.storage.put_user(&user_id, &user) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); } Ok(Json(json!({ "ok": true, "promoted": user_id }))) }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// POST /auth/dev/dedupe_admins — merge duplicate users by email, with backup
async fn api_dev_dedupe_admins(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match state.storage.list_users() {
        Ok(users) => {
            use serde_json::Value as JVal;
            let mut by_email: std::collections::HashMap<String, Vec<JVal>> = std::collections::HashMap::new();
            // 1) Group users by email (case-sensitive as stored)
            for u in users.into_iter() {
                let email: String = u.get("email").and_then(|v: &JVal| v.as_str()).unwrap_or("").to_string();
                by_email.entry(email).or_default().push(u);
            }
            let mut backup: Vec<serde_json::Value> = Vec::new();
            for (email, mut group) in by_email.into_iter() {
                if group.len() <= 1 { continue; }
                // 2) Choose a canonical keep_id. Prefer the credentials-mapped id when present.
                let mut keep_id: Option<String> = None;
                if let Ok(Some(cred)) = state.storage.get_credentials(&email) {
                    if let Some(mapped) = cred.get("user_id").and_then(|v: &JVal| v.as_str()) {
                        if group.iter().any(|u: &JVal| u.get("id").and_then(|v: &JVal| v.as_str()) == Some(mapped)) { keep_id = Some(mapped.to_string()); }
                    }
                }
                // 3) If no mapping, pick the oldest record (smallest created_at)
                if keep_id.is_none() { group.sort_by_key(|u: &JVal| u.get("created_at").and_then(|v: &JVal| v.as_i64()).unwrap_or(0)); if let Some(first) = group.first() { if let Some(id) = first.get("id").and_then(|v| v.as_str()) { keep_id = Some(id.to_string()); } } }
                let keep_id: String = match keep_id { Some(v) => v, None => { continue; } };
                // 4) Delete others and record full objects in a backup list
                let mut deleted_for_email: Vec<serde_json::Value> = Vec::new();
                for u in group.into_iter() {
                    if let Some(id) = u.get("id").and_then(|v| v.as_str()) { if id == keep_id { continue; } deleted_for_email.push(u.clone()); let _ = state.storage.delete_user(id); }
                }
                if !deleted_for_email.is_empty() {
                    backup.push(json!({ "email": email, "kept": keep_id, "deleted": deleted_for_email }));
                    // 5) Ensure credentials point to the kept id
                    if let Ok(Some(cred)) = state.storage.get_credentials(&email) {
                        let cred_user_id: &str = cred.get("user_id").and_then(|v: &JVal| v.as_str()).unwrap_or("");
                        if cred_user_id != keep_id {
                            let mut new_cred: JVal = cred.clone();
                            if let Some(map) = new_cred.as_object_mut() { map.insert("user_id".to_string(), serde_json::Value::String(keep_id.clone())); }
                            let _ = state.storage.put_credentials(&email, &new_cred);
                        }
                    }
                }
            }
            // 6) Write a human-readable backup for safety/inspection
            let ts: String = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
            let path: String = format!("./data/admin_dedupe_backup_{}.json", ts);
            if let Ok(json) = serde_json::to_string_pretty(&backup) { let _ = std::fs::write(&path, json); }
            Ok(Json(json!({ "ok": true, "deleted_groups": backup.len(), "backup": path })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// GET /auth/dev/promote_now — promote ADMIN_EMAIL without quoting
async fn api_dev_promote_now(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email: String = ADMIN_EMAIL.to_string();
    let cred: serde_json::Value = match state.storage.get_credentials(&email) { Ok(Some(v)) => v, Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let user_id: String = cred.get("user_id").and_then(|v: &serde_json::Value| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => { if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); } if let Err(e) = state.storage.put_user(&user_id, &user) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); } Ok(Json(json!({ "ok": true, "promoted": email }))) }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// GET /auth/dev/reset_rate_now — reset rate counter for ADMIN_EMAIL
async fn api_dev_reset_rate_now(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email: String = ADMIN_EMAIL.to_string();
    let cred: serde_json::Value = match state.storage.get_credentials(&email) { Ok(Some(v)) => v, Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let user_id: String = cred.get("user_id").and_then(|v: &serde_json::Value| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    // Clear in-memory token buckets (dev convenience); storage counters left intact
    state.rate.clear_buckets();
    Ok(Json(json!({ "ok": true, "reset": user_id })))
}

/// GET /auth/dev/clear_buckets — clear in-memory token buckets
async fn api_dev_clear_buckets(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    state.rate.clear_buckets();
    Ok(Json(json!({ "ok": true, "cleared": true })))
}

/// POST /auth/dev/inspect_token — verify and return JWT claims
async fn api_dev_inspect_token(
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token: String = payload.get("token").and_then(|v| v.as_str()).ok_or((StatusCode::BAD_REQUEST, "missing token".to_string()))?.to_string();
    match auth::verify_jwt(&token) {
        Ok(data) => Ok(Json(json!({ "ok": true, "claims": { "sub": data.claims.sub, "iat": data.claims.iat, "exp": data.claims.exp, "iss": data.claims.iss, "aud": data.claims.aud } }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, e.to_string())),
    }
}

/// POST /auth/dev/set_password — set Argon2 password for a user (creates if missing)
async fn api_dev_set_password(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email = payload.get("email").and_then(|v| v.as_str()).ok_or((StatusCode::BAD_REQUEST, "missing email".to_string()))?.trim().to_lowercase();
    let password = payload.get("password").and_then(|v| v.as_str()).ok_or((StatusCode::BAD_REQUEST, "missing password".to_string()))?;
    if password.len() < 8 { return Err((StatusCode::BAD_REQUEST, "password too short".to_string())); }
    let user_id = match state.storage.get_credentials(&email) { Ok(Some(cred)) => cred.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string(), _ => {
        let id = Uuid::new_v4().to_string();
        let role = if is_admin_email(&email) { "admin" } else { "user" };
        let user_obj = serde_json::json!({ "id": id, "email": email, "created_at": chrono::Utc::now().timestamp(), "role": role });
        state.storage.put_user(&id, &user_obj).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        id
    } };

    let mut salt_bytes: [u8; 16] = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt: SaltString = SaltString::encode_b64(&salt_bytes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let argon2: Argon2<'_> = Argon2::default();
    let pwd_hash: String = match argon2.hash_password(password.as_bytes(), &salt) { Ok(ph) => ph.to_string(), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let cred_obj: serde_json::Value = serde_json::json!({ "user_id": user_id, "password_hash": pwd_hash, "created_at": chrono::Utc::now().timestamp() });
    state.storage.put_credentials(&email, &cred_obj).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "ok": true, "email": email })))
}

/// POST /auth/dev/set_admin_username — ensure ADMIN_EMAIL’s username is "admin"
async fn api_dev_set_admin_username(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let email = ADMIN_EMAIL.to_string();
    let cred = match state.storage.get_credentials(&email) { Ok(Some(v)) => v, Ok(None) => return Err((StatusCode::NOT_FOUND, "credentials not found".to_string())), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let user_id = cred.get("user_id").and_then(|v| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    match state.storage.get_user(&user_id) {
        Ok(Some(mut user)) => {
            if let Some(obj) = user.as_object_mut() { obj.insert("username".to_string(), serde_json::Value::String("admin".to_string())); }
            if let Err(e) = state.storage.put_user(&user_id, &user) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); }
            Ok(Json(serde_json::json!({ "ok": true, "user_id": user_id, "username": "admin" })))
        }
        Ok(None) => Err((StatusCode::NOT_FOUND, "user not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
