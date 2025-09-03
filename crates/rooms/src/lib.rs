use anyhow::Result;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use storage::{MessageRecord, Storage};
use bus::pubsub::Publisher;

/// Send a message to `room`.
///
/// Responsibilities:
/// - assign a per-room sequence (by reading the last message seq)
/// - persist the MessageRecord into Storage
/// - publish the serialized MessageRecord on the bus topic `room/{room}`
///
/// Returns the persisted MessageRecord on success.
pub fn send_message(
    room: &str,
    body: Value,
    storage: &Storage,
    publisher: &Publisher,
) -> Result<MessageRecord> {
    tracing::info!(room = %room, "rooms::send_message called");
    // timestamp
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis() as i64;

    // determine next seq atomically
    let seq = storage.next_seq_for_room(room)?;

    let rec = MessageRecord {
        id: format!("{}-{}", now_ms, seq),
        seq,
        room: room.to_string(),
        server_ts: now_ms,
        body,
    };

    // persist
    storage.append_message(&rec)?;

    // publish to bus
    let topic = format!("room/{}", room);
    let bytes = serde_json::to_vec(&rec)?;
    publisher.publish(&topic, &bytes)?;

    Ok(rec)
}

/// Fetch message history for `room`.
/// - `after_ts`: if Some(ts) return messages with server_ts > ts
/// - `limit`: maximum number of messages to return
pub fn fetch_history(
    room: &str,
    after_ts: Option<i64>,
    limit: usize,
    storage: &Storage,
) -> Result<Vec<MessageRecord>> {
    let msgs = storage.scan_messages(room, after_ts, limit)?;
    Ok(msgs)
}

pub fn hello() {
    println!("rooms hello");
}
