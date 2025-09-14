// WebSocket endpoint `/ws`
//
// Flow:
// 1) HTTP GET upgrades to WebSocket via `WebSocketUpgrade`.
// 2) We associate a user id (from Bearer token or anonymous) and create a
//    presence heartbeat.
// 3) We subscribe to a pub/sub topic for the room and forward messages to the
//    WebSocket, while also reading incoming messages and publishing them.
use axum::{Router, routing::get, extract::{State, Query}, response::IntoResponse};
use axum::extract::ws::{WebSocketUpgrade, Message};
use crate::state::AppState;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

#[derive(Deserialize)]
struct RoomQuery {
    room: Option<String>,
    token: Option<String>,
}

/// Build router for WebSocket upgrades.
///
/// The `/ws` endpoint accepts a standard WebSocket upgrade request. Clients can
/// include `room=<name>` and `token=<jwt>` as query params. The token can also
/// be supplied via the `Authorization: Bearer <jwt>` header.
pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_handler))
}

/// HTTP handler that performs the WS upgrade and defers to `ws_connect`.
///
/// Steps:
/// 1) Resolve the `room` name (defaults to "general").
/// 2) Read a JWT token from either query `token` or `Authorization` header.
/// 3) Verify token and create a presence heartbeat (or anonymous heartbeat).
/// 4) Accept the upgrade and move the work into `ws_connect`.
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<RoomQuery>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let room: String = q.room.clone().unwrap_or_else(|| "general".to_string());
    let token_opt: Option<String> = q.token.clone().or_else(|| {
        headers
            .get("authorization")
            .and_then(|hv: &axum::http::HeaderValue| hv.to_str().ok())
            .and_then(|s: &str| {
                if s.to_lowercase().starts_with("bearer ") { Some(s[7..].to_string()) } else { None }
            })
    });

    // Determine the user id for presence tracking. If JWT verification fails
    // or no token is provided, we record an anonymous connection.
    let user_id: String = if let Some(token) = token_opt {
        match auth::verify_jwt(&token) {
            Ok(data) => {
                let sub: String = data.claims.sub;
                match state.presence.heartbeat(Some(sub.clone())) { Ok(id) => id, Err(_) => "unknown".to_string() }
            }
            Err(_) => match state.presence.heartbeat(None) { Ok(id) => id, Err(_) => "unknown".to_string() }
        }
    } else { match state.presence.heartbeat(None) { Ok(id) => id, Err(_) => "unknown".to_string() } };

    ws.on_upgrade(move |socket: axum::extract::ws::WebSocket| ws_connect(socket, state, room, user_id))
}

/// Actual WebSocket connection handler that runs until the socket closes.
///
/// Responsibilities:
/// - Subscribe to the NNG pub/sub topic for the room and forward published
///   messages to the client.
/// - Read text messages from the client, persist and publish them using
///   the `rooms::send_message` helper.
/// - On disconnect, abort the forwarding task and mark the user offline.
async fn ws_connect(socket: axum::extract::ws::WebSocket, state: AppState, room: String, user_id: String) {
    let topic: String = format!("room/{}", room);
    let nng_addr: String = state.nng_addr.clone();

    let subscriber: bus::pubsub::Subscriber = match bus::pubsub::Subscriber::connect(&nng_addr, &topic) {
        Ok(s) => s,
        Err(e) => { tracing::error!("failed to create nng subscriber for {}: {:?}", topic, e); return; }
    };

    let (mut ws_writer, mut ws_reader) = socket.split();
    let mut sub_rx: tokio::sync::mpsc::Receiver<(String, Vec<u8>)> = subscriber.into_receiver();
    // Forward task: reads from pub/sub and pushes to the websocket writer.
    let forward_task = tokio::spawn(async move {
        while let Some((_topic, payload)) = sub_rx.recv().await {
            if let Ok(txt) = String::from_utf8(payload) {
                if ws_writer.send(Message::Text(txt.into())).await.is_err() { break; }
            }
        }
    });

    // Read loop: drain client messages. In this basic example we only handle
    // text frames. A real app would also manage pings, binary and backpressure.
    while let Some(Ok(msg)) = ws_reader.next().await {
        match msg {
            Message::Text(text) => {
                let body = serde_json::json!({ "text": text.to_string() });
                let _ = rooms::send_message(&room, body, &state.storage, &state.publisher);
            }
            Message::Close(_) => break,
            _ => break,
        }
    }

    // Cleanup: stop forwarder and mark user offline (best-effort).
    forward_task.abort();
    if user_id != "unknown" { let _ = state.presence.mark_offline(&user_id); }
}
