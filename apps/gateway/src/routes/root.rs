// Root and health endpoints
// - `/` responds with a simple HTML string (smoke-test endpoint)
// - `/healthz` is used by orchestrators/containers to check liveness
use axum::{routing::get, Router, response::Html};
use crate::state::AppState;

/// Build the router for root/health endpoints.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(root))
        .route("/healthz", get(|| async { "ok" }))
}

/// GET /
/// Minimal HTML so hitting the gateway in a browser shows it is up.
async fn root() -> Html<&'static str> {
    Html("Gateway up")
}
