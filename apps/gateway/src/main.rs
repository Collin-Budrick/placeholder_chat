// Gateway entrypoint (Axum + Tokio)
//
// This file wires up shared services (storage/publisher/presence/rate),
// builds the HTTP router from the route modules, attaches middleware layers
// (rate limit, CORS, trace, timeout, compression, body limit), and starts
// listening for requests with graceful shutdown.
//
// If you're new to Rust/Axum:
// - Axum is a web framework. A `Router` maps paths and methods to async
//   handler functions. Extractors map request parts into handler arguments.
// - Tokio is the async runtime. `#[tokio::main]` starts it for `main`.
// - `Arc<T>` is an atomically reference-counted pointer used to share state
//   across tasks/threads safely.
use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::Result;
use axum::{Router, middleware, extract::DefaultBodyLimit};
use tower_http::{trace::TraceLayer, cors::{CorsLayer, AllowOrigin}, compression::CompressionLayer};
use tower::timeout::TimeoutLayer;
use axum::error_handling::HandleErrorLayer;
use tower::{BoxError, ServiceBuilder};
use axum::http::{Method, header::{ACCEPT, CONTENT_TYPE, AUTHORIZATION, HeaderName}};
use tokio::{net::TcpListener, signal};

use bus::pubsub::Publisher;
use storage::Storage;

mod state;
mod middleware;
mod routes;
mod init;

use crate::state::AppState;
use crate::middleware as gw_mw;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    // 1) Construct shared services (our app "state"). These are placed into
    //    an `AppState` later and cloned into handlers via `State(AppState)`.
    let storage: Arc<Storage> = Arc::new(Storage::new("./data")?);
    let nng_addr: String = std::env::var("NNG_PUB_ADDR").unwrap_or_else(|_| "tcp://127.0.0.1:7777".to_string());
    let publisher: Arc<Publisher> = Arc::new(Publisher::bind(&nng_addr)?);
    let presence: Arc<presence::PresenceManager> = Arc::new(presence::PresenceManager::new(
        Arc::clone(&storage), Arc::clone(&publisher), 30, 60,
    )?);
    let rate_limiter: Arc<rate::RateLimiter> = Arc::new(rate::RateLimiter::new(5, 1.0));

    // Bundle the services into our state struct
    let state = AppState { publisher, storage, presence, rate: rate_limiter, nng_addr: nng_addr.clone() };

    // 2) Ensure a usable admin account exists (dev/prod friendly)
    if let Err(e) = init::seed_admin(&state) { tracing::error!("admin seed failed: {:?}", e); }

    // 3) Build the CORS layer. Browsers enforce CORS; APIs need to opt-in to
    //    which origins, methods, and headers are allowed. We prefer an allowlist
    //    from env but default to common localhost dev ports.
    let cors_layer: CorsLayer = {
        let methods: [Method; 4] = [Method::GET, Method::POST, Method::DELETE, Method::OPTIONS];
        let default = vec![
            axum::http::HeaderValue::from_static("http://127.0.0.1:5173"),
            axum::http::HeaderValue::from_static("http://localhost:5173"),
        ];
        let origins: Vec<axum::http::HeaderValue> = std::env::var("CORS_ALLOW_ORIGINS")
            .ok()
            .and_then(|s| {
                let list: Vec<_> = s
                    .split(',')
                    .filter_map(|o| axum::http::HeaderValue::from_str(o.trim()).ok())
                    .collect();
                if list.is_empty() { None } else { Some(list) }
            })
            .unwrap_or(default);
        let allow_hdrs = [ACCEPT, CONTENT_TYPE, AUTHORIZATION, HeaderName::from_static("x-csrf-token")];
        CorsLayer::new()
            .allow_methods(methods)
            .allow_headers(allow_hdrs)
            .allow_origin(AllowOrigin::list(origins))
            .allow_credentials(true)
            .expose_headers([CONTENT_TYPE])
    };

    // 4) Build route tree from the modules and attach our `AppState`.
    let base: Router<_> = routes::all()
        .with_state(state.clone());

    // 5) Compose middleware layers.
    //    - TraceLayer logs requests/responses.
    //    - TimeoutLayer limits handler time; we map the error to 408/500.
    //    - Compression and body limit are applied as last steps.
    async fn handle_timeout_error(err: BoxError) -> axum::response::Response {
        use axum::response::IntoResponse;
        if err.is::<tower::timeout::error::Elapsed>() {
            (axum::http::StatusCode::REQUEST_TIMEOUT, "request timed out").into_response()
        } else {
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    }
    let timeout_stack = ServiceBuilder::new()
        .layer(HandleErrorLayer::new(handle_timeout_error))
        .layer(TimeoutLayer::new(Duration::from_secs(10)));

    let body_limit: usize = std::env::var("BODY_LIMIT_BYTES").ok().and_then(|s| s.parse().ok()).unwrap_or(1 * 1024 * 1024);
    let mut app: Router<_> = base
        // Policy layers (outer): rate limiting and CORS
        .layer(middleware::from_fn_with_state(state.clone(), gw_mw::rate_limit_middleware))
        .layer(cors_layer)
        // Observability and resilience
        .layer(TraceLayer::new_for_http())
        .layer(timeout_stack)
        // Transport-oriented
        .layer(CompressionLayer::new())
        .layer(DefaultBodyLimit::max(body_limit));

    if std::env::var("LOG_POST_BODY").ok().as_deref() == Some("1") {
        // Optional: verbose POST body logging (expensive). Do not enable in prod.
        app = app.layer(middleware::from_fn(gw_mw::log_post_body_middleware));
    }

    // 6) Bind and serve with graceful shutdown.
    let addr: SocketAddr = std::env::var("GATEWAY_ADDR").unwrap_or_else(|_| "0.0.0.0:7000".to_string()).parse()?;
    let listener: TcpListener = match TcpListener::bind(addr).await {
        Ok(l) => { println!("listening on http://{}", addr); l }
        Err(e) => { eprintln!("failed to bind {}: {:?}", addr, e); return Err(e.into()); }
    };

    let presence_for_shutdown: Arc<presence::PresenceManager> = Arc::clone(&state.presence);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = signal::ctrl_c().await;
            tracing::info!("shutdown signal received");
            presence_for_shutdown.shutdown().await;
        })
        .await?;

    Ok(())
}
