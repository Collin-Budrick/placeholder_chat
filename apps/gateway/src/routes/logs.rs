// Frontend logs endpoints
//
// The web app posts JSON log entries to `/api/frontend-logs`. We store them
// as NDJSON into `logs/frontend-api.log` for quick local inspection, and
// provide a GET endpoint to read them back in dev.
use axum::{routing::get, routing::post, Router, response::IntoResponse, Json};
use crate::state::AppState;
use serde_json::Value;
use axum::http::StatusCode;
use tokio::io::AsyncWriteExt;

/// Build router for the frontend logs API.
///
/// Endpoints:
/// - POST /api/frontend-logs — append a single JSON log entry as NDJSON.
/// - GET  /api/frontend-logs  — return the full NDJSON log as text/plain.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/frontend-logs", post(api_frontend_logs).get(get_frontend_logs))
}

/// Collect frontend logs posted by the SSG web app.
///
/// What it does:
/// - Ensures a `logs/` directory exists.
/// - Adds a timestamp field `ts` if the payload doesn’t include one.
/// - Appends the JSON as a single NDJSON line to `logs/frontend-api.log`.
/// - Returns 204 No Content on success.
///
/// Why NDJSON:
/// - Each line is a complete JSON object, which makes it easy to stream,
///   tail, and process without loading the entire file.
async fn api_frontend_logs(Json(mut entry): Json<Value>) -> impl IntoResponse {
    use tokio::fs as afs;
    let log_dir = std::path::Path::new("logs");
    if let Err(e) = afs::create_dir_all(log_dir).await {
        tracing::error!("failed to create logs dir: {:?}", e);
    }
    let log_path = log_dir.join("frontend-api.log");
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
///
/// Returns a `text/plain` response of the NDJSON file. If the file doesn’t
/// exist yet, returns an empty string (200 OK) for convenience in dev.
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
