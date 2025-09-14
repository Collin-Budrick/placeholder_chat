// Auth endpoints (signup/login/me/logout/username check)
//
// Notes for beginners:
// - Axum extractors map request pieces into handler arguments. For example,
//   `State(AppState)` gives you shared services; `CookieJar` lets you read/write
//   cookies; `Json<T>` parses JSON into `T`.
// - We support tolerant login parsing (JSON, x-www-form-urlencoded, crude
//   multipart heuristic) to play nice with dev tools and web forms.
use axum::{Router, routing::{get, post}, extract::{State, Query}, Json, middleware};
use crate::middleware as gw_mw;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use crate::state::{AppState, is_admin_email, ADMIN_EMAIL};
use axum::http::{StatusCode, HeaderMap};
use serde::Deserialize;
use uuid::Uuid;
use rand::RngCore;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Public auth routes (no CSRF), e.g. login forms.
pub fn public() -> Router<AppState> {
    Router::new().route("/api/auth/login", post(api_login))
}

/// CSRF-protected auth routes (cookie-based session flows)
pub fn protected() -> Router<AppState> {
    Router::new()
        .route("/api/auth/signup", post(api_signup))
        .route("/api/auth/check_username", get(api_check_username))
        .route("/api/auth/me", get(api_auth_me))
        .route("/api/auth/logout", post(api_logout))
        .route_layer(middleware::from_fn(gw_mw::csrf_middleware))
}

/// Input shape for login. We accept either:
/// - { email, password }
/// - { username, password }
///
/// The `untagged` enum lets serde pick the matching variant based on fields
/// present in the incoming JSON/map, so callers can use either identifier.
#[derive(Deserialize)]
#[serde(untagged)]
enum AuthPayload {
  ByEmail { email: String, password: String },
  ByUsername { username: String, password: String },
}

/// Expected payload for signup. Unlike login, username is required and must be
/// unique (case-insensitive) across users.
#[derive(Deserialize)]
struct SignupPayload { email: String, password: String, username: String }

/// POST /api/auth/signup
/// Creates a user + Argon2-hashed credentials, sets session cookie, returns basic info.
async fn api_signup(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<SignupPayload>,
) -> Result<(CookieJar, Json<serde_json::Value>), (StatusCode, String)> {
    // 1) Basic input validation (normalize email and enforce minimal length)
    let email: String = payload.email.trim().to_lowercase();
    let password: String = payload.password;
    if email.is_empty() || password.len() < 8 { return Err((StatusCode::BAD_REQUEST, "invalid email or password".into())); }
    // Disallow duplicate email registrations
    match state.storage.get_credentials(&email) { Ok(Some(_)) => return Err((StatusCode::CONFLICT, "email already registered".into())), Ok(None) => {}, Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), }

    // 2) Validate and enforce unique username (case-insensitive)
    let u_trim: &str = payload.username.trim();
    if u_trim.is_empty() || u_trim.len() < 2 { return Err((StatusCode::BAD_REQUEST, "invalid username".into())); }
    match state.storage.list_users() {
        Ok(users) => {
            if users.iter().any(|usr: &serde_json::Value| usr.get("username").and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case(u_trim)).unwrap_or(false)) {
                return Err((StatusCode::CONFLICT, "username already taken".into()));
            }
        }
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }

    // 3) Create user record with role derived from email (admin/user)
    let user_id: String = Uuid::new_v4().to_string();
    let role: &'static str = if is_admin_email(&email) { "admin" } else { "user" };
    let user_obj = serde_json::json!({ "id": user_id, "email": email, "username": u_trim.to_string(), "created_at": chrono::Utc::now().timestamp(), "role": role });
    if let Err(e) = state.storage.put_user(&user_id, &user_obj) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); }

    // 4) Hash password with Argon2 using a random salt, then store credentials
    let mut salt_bytes: [u8; 16] = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt: SaltString = SaltString::encode_b64(&salt_bytes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let argon2: Argon2<'_> = Argon2::default();
    let pwd_hash: String = match argon2.hash_password(password.as_bytes(), &salt) { Ok(ph) => ph.to_string(), Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let cred_obj = serde_json::json!({ "user_id": user_id, "password_hash": pwd_hash, "created_at": chrono::Utc::now().timestamp() });
    if let Err(e) = state.storage.put_credentials(&email, &cred_obj) { return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())); }

    // 5) Issue a signed JWT and set it in an HttpOnly, same-site cookie named `session`
    let token: String = match auth::create_jwt(&user_id, 3600 * 24 * 7) { Ok(t) => t, Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let mut cookie: Cookie<'_> = Cookie::new("session", token);
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    let jar: CookieJar = jar.add(cookie);
    Ok((jar, Json(serde_json::json!({ "userId": user_id, "email": email }))))
}

/// GET /api/auth/check_username?u=<name>
/// Case-insensitive availability check.
async fn api_check_username(
    State(state): State<AppState>,
    Query(q): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Read `u` from query string and normalize whitespace
    let username: String = q.get("u").cloned().unwrap_or_default();
    let username_trim: &str = username.trim();
    // Empty strings are not available
    if username_trim.is_empty() { return Ok(Json(serde_json::json!({ "available": false }))); }
    match state.storage.list_users() {
        Ok(users) => {
            // Case-insensitive check against all users’ `username` field
            let taken: bool = users.iter().any(|usr: &serde_json::Value| usr.get("username").and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case(username_trim)).unwrap_or(false));
            Ok(Json(serde_json::json!({ "available": !taken })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// POST /api/auth/login
/// Validates credentials and sets `session` cookie with a signed JWT.
async fn api_login(
    State(state): State<AppState>,
    jar: CookieJar,
    req: axum::http::Request<axum::body::Body>,
) -> Result<(CookieJar, Json<serde_json::Value>), (StatusCode, String)> {
    use axum::http::header::CONTENT_TYPE;
    // 1) Tolerant parsing. We accept JSON, URL-encoded, or a simple multipart
    //    heuristic (for dev). We convert all of them into an AuthPayload.
    let ct: String = req.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let bytes = axum::body::to_bytes(req.into_body(), 64 * 1024).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let payload: AuthPayload = if ct.contains("application/json") {
        serde_json::from_slice(&bytes).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    } else if ct.contains("application/x-www-form-urlencoded") {
        let form_map: std::collections::HashMap<String, String> = url::form_urlencoded::parse(&bytes).into_owned().collect();
        let password = form_map.get("password").cloned().ok_or((StatusCode::BAD_REQUEST, "missing password".to_string()))?;
        if let Some(u) = form_map.get("username").cloned() { AuthPayload::ByUsername { username: u, password } }
        else if let Some(e) = form_map.get("email").cloned() { AuthPayload::ByEmail { email: e, password } }
        else { return Err((StatusCode::BAD_REQUEST, "missing email or username".to_string())); }
    } else if ct.contains("multipart/form-data") {
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
        serde_json::from_slice(&bytes).map_err(|e| (StatusCode::UNSUPPORTED_MEDIA_TYPE, e.to_string()))?
    };

    // 2) Resolve the identifier. If a username is given, find its email.
    //    We also include a dev-friendly fallback: username "admin" maps to
    //    ADMIN_EMAIL to simplify local testing.
    let (email, password): (String, String) = match payload {
        AuthPayload::ByEmail { email, password } => (email.trim().to_lowercase(), password),
        AuthPayload::ByUsername { username, password } => {
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
            let email = match email_opt { Some(e) => e, None if uname.eq_ignore_ascii_case("admin") => ADMIN_EMAIL.to_string(), None => return Err((StatusCode::UNAUTHORIZED, "invalid credentials".to_string())), };
            (email, password)
        }
    };

    // 3) Authenticate by verifying the Argon2 password hash stored in credentials
    tracing::debug!(content_type = %ct, has_email = %(!email.is_empty()), "api_login invoked");
    let creds_val: serde_json::Value = match state.storage.get_credentials(&email) {
        Ok(Some(v)) => v,
        Ok(None) => return Err((StatusCode::UNAUTHORIZED, "invalid credentials".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let user_id: String = creds_val.get("user_id").and_then(|v| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?.to_string();
    let stored_hash: &str = creds_val.get("password_hash").and_then(|v| v.as_str()).ok_or((StatusCode::INTERNAL_SERVER_ERROR, "malformed credentials".to_string()))?;
    let parsed_hash: PasswordHash<'_> = PasswordHash::new(stored_hash).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_err() { return Err((StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "invalid credentials" }).to_string())); }

    // 4) Ensure a user record exists for this credentials entry (safety for seeded admin)
    match state.storage.get_user(&user_id) {
        Ok(Some(_)) => {}
        Ok(None) => {
            let uname_guess = email.split('@').next().unwrap_or("user");
            let role = if is_admin_email(&email) { "admin" } else { "user" };
            let user_obj = serde_json::json!({ "id": user_id, "email": email, "username": uname_guess, "created_at": chrono::Utc::now().timestamp(), "role": role });
            let _ = state.storage.put_user(&user_id, &user_obj);
        }
        Err(_) => {}
    }

    // 5) Issue new JWT and set as session cookie
    let token: String = match auth::create_jwt(&user_id, 3600 * 24 * 7) { Ok(t) => t, Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())), };
    let mut cookie: Cookie<'_> = Cookie::new("session", token);
    cookie.set_path("/"); cookie.set_http_only(true); cookie.set_same_site(SameSite::Lax);
    let jar: CookieJar = jar.add(cookie);
    Ok((jar, Json(serde_json::json!({ "userId": user_id, "email": email }))))
}

/// POST /api/auth/logout — removes the `session` cookie
async fn api_logout(jar: CookieJar) -> (CookieJar, StatusCode) {
    let mut cookie: Cookie<'_> = Cookie::new("session", "");
    cookie.set_path("/");
    let jar: CookieJar = jar.remove(cookie);
    (jar, StatusCode::NO_CONTENT)
}

/// GET /api/auth/me — resolves current user via Bearer or session cookie
async fn api_auth_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // 1) Get token from Authorization header or from the `session` cookie
    let token_opt: Option<String> = headers.get("authorization").and_then(|hv| hv.to_str().ok()).map(|s| s.to_string());
    let token: Option<String> = if let Some(s) = token_opt {
        if s.to_lowercase().starts_with("bearer ") { Some(s[7..].to_string()) } else { None }
    } else if let Some(cookie_header) = headers.get("cookie").and_then(|hv| hv.to_str().ok()) {
        cookie_header.split(';').find_map(|kv: &str| { let kv = kv.trim(); if kv.starts_with("session=") { Some(kv.trim_start_matches("session=").to_string()) } else { None } })
    } else { None };
    let token: String = match token { Some(t) => t, None => return Err((StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "missing token" }).to_string())), };
    // 2) Verify JWT and load user document
    let user_id: String = match auth::verify_jwt(&token) { Ok(data) => data.claims.sub, Err(_) => return Err((StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "invalid token" }).to_string())), };
    match state.storage.get_user(&user_id) {
        Ok(Some(val)) => Ok(Json(val)),
        Ok(None) => Err((StatusCode::NOT_FOUND, serde_json::json!({ "message": "user not found" }).to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
