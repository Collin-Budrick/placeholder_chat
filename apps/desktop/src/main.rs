use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::env;

#[derive(Debug, Serialize, Deserialize)]
struct SessionInfo {
    user_id: String,
    token: String,
    exp: usize,
}

#[tauri::command]
async fn create_session(user_id: String, ttl_secs: Option<u64>) -> Result<SessionInfo, String> {
    let ttl = ttl_secs.unwrap_or(60 * 60); // default 1 hour
    match auth::create_jwt(&user_id, ttl as usize) {
        Ok(token) => {
            match auth::verify_jwt(&token) {
                Ok(data) => {
                    let claims = data.claims;
                    Ok(SessionInfo {
                        user_id: claims.sub,
                        token,
                        exp: claims.exp,
                    })
                }
                Err(e) => Err(format!("failed verifying token: {}", e)),
            }
        }
        Err(e) => Err(format!("failed creating token: {}", e)),
    }
}

#[tauri::command]
async fn verify_token(token: String) -> Result<serde_json::Value, String> {
    match auth::verify_jwt(&token) {
        Ok(data) => {
            let json = serde_json::to_value(data.claims).map_err(|e| e.to_string())?;
            Ok(json)
        }
        Err(e) => Err(format!("invalid token: {}", e)),
    }
}

fn main() {
    // Initialize logging if desired
    // simple startup to load the web UI from ../web/dist (configured in tauri.conf.json)
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![create_session, verify_token])
        .setup(|app| {
            // If a dev URL is provided, navigate the main window there (overrides config)
            if let Ok(url) = env::var("TAURI_DEV_URL") {
                if let Some(win) = app.get_webview_window("main") {
                    println!("[desktop] Navigating to dev URL: {}", url);
                    // Best-effort navigate; ignore errors to avoid crashing dev
                    let _ = win.eval(&format!("window.location.replace('{}')", url.replace('"', "%22")));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
