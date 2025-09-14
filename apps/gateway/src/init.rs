// Initialization helpers (one-time startup tasks)
// - seed_admin: ensures an admin user and credentials exist at startup, using
//   a simple file or environment variables to configure email/password.
use anyhow::Result;
use uuid::Uuid;
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use rand::RngCore;
use crate::state::{AppState};

/// Ensure an admin account exists in storage.
///
/// Behavior overview:
/// - Reads a simple seed file (key:value per line) pointed to by
///   `ADMIN_SEED_FILE` (default `/config/admin.seed`). Recognized keys:
///   `username`, `email`, `password`.
/// - Falls back to environment variables `ADMIN_EMAIL` and `ADMIN_PASSWORD` if
///   the file is missing or fields are not provided.
/// - If credentials already exist for the admin email, ensures a user record
///   exists and has `role: "admin"` and a username (defaults to seed username).
/// - If credentials do not exist, creates a new user + Argon2-hashed password.
///
/// Notes:
/// - The default password value is intended only for local development. Always
///   set a secure password (via file or env) for any real environment.
/// - Argon2 with a random salt provides strong password hashing.
pub fn seed_admin(state: &AppState) -> Result<()> {
    use anyhow::Context;
    use std::fs as stdfs;
    let seed_path: String = std::env::var("ADMIN_SEED_FILE").unwrap_or_else(|_| "/config/admin.seed".to_string());
    // Parse seed file into (username, password, email). Any missing values
    // will be handled by fallbacks below.
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

    // Fall back to a sane default username and admin email if not configured.
    let username: String = file_username.unwrap_or_else(|| "admin".to_string());
    let admin_email: String = file_email
        .or_else(|| std::env::var("ADMIN_EMAIL").ok())
        .unwrap_or_else(|| format!("{}@example.com", username))
        .to_lowercase();
    let admin_password: String = file_password
        .or_else(|| std::env::var("ADMIN_PASSWORD").ok())
        .unwrap_or_else(|| "admin12345".to_string());

    // Case 1: credentials already exist for this email — make sure the linked
    // user record exists and is an admin with a username.
    match state.storage.get_credentials(&admin_email) {
        Ok(Some(_)) => {
            // Ensure user record exists and has admin role/username
            if let Ok(Some(cred)) = state.storage.get_credentials(&admin_email) {
                if let Some(user_id) = cred.get("user_id").and_then(|v| v.as_str()) {
                    match state.storage.get_user(user_id) {
                        Ok(Some(mut user)) => {
                            let mut changed = false;
                            if user.get("role").and_then(|v| v.as_str()) != Some("admin") { if let Some(obj) = user.as_object_mut() { obj.insert("role".to_string(), serde_json::Value::String("admin".to_string())); changed = true; } }
                            let has_uname = user.get("username").and_then(|v| v.as_str()).is_some();
                            if !has_uname { if let Some(obj) = user.as_object_mut() { obj.insert("username".to_string(), serde_json::Value::String(username.clone())); changed = true; } }
                            if changed { let _ = state.storage.put_user(user_id, &user); }
                        }
                        Ok(None) => {
                            let user_obj = serde_json::json!({ "id": user_id, "email": admin_email, "username": username, "created_at": chrono::Utc::now().timestamp(), "role": "admin" });
                            let _ = state.storage.put_user(user_id, &user_obj);
                        }
                        Err(_) => {}
                    }
                }
            }
            tracing::info!("admin seed: credentials already exist for {}", admin_email);
            Ok(())
        }
        // Case 2: no credentials exist — create a new user and hash a password.
        Ok(None) => {
            let user_id = Uuid::new_v4().to_string();
            let user_obj = serde_json::json!({ "id": user_id, "email": admin_email, "username": username, "created_at": chrono::Utc::now().timestamp(), "role": "admin" });
            state.storage.put_user(&user_id, &user_obj).context("put_user(admin)")?;

            // Generate a random salt: this makes identical passwords hash
            // differently across users and time (prevents rainbow table reuse).
            let mut salt_bytes: [u8; 16] = [0u8; 16];
            rand::rng().fill_bytes(&mut salt_bytes);
            let salt: SaltString = SaltString::encode_b64(&salt_bytes).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let argon2: Argon2<'_> = Argon2::default();
            let pwd_hash = argon2.hash_password(admin_password.as_bytes(), &salt).map_err(|e| anyhow::anyhow!(e.to_string()))?.to_string();
            let cred_obj = serde_json::json!({ "user_id": user_id, "password_hash": pwd_hash, "created_at": chrono::Utc::now().timestamp() });
            state.storage.put_credentials(&admin_email, &cred_obj).context("put_credentials(admin)")?;
            tracing::info!("admin seed: created admin user {}", admin_email);
            Ok(())
        }
        // Storage errors should not crash startup; log and continue.
        Err(e) => { tracing::error!("admin seed: get_credentials failed: {:?}", e); Ok(()) }
    }
}
