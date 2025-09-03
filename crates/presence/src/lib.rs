use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio::time;
use uuid::Uuid;

use bus::pubsub::Publisher;
use storage::Storage;
use serde_json::json;

/// Presence manager: heartbeats + sweeper.
/// - heartbeat(user_id): mark user online (writes storage presence table and publishes presence/online)
/// - mark_offline(user_id): mark offline (remove presence entry and publish presence/offline)
/// - background sweeper will check last_seen and publish offline events for stale users.
pub struct PresenceManager {
    storage: Arc<Storage>,
    publisher: Arc<Publisher>,
    sweep_handle: Mutex<Option<JoinHandle<()>>>,
    shutdown_tx: watch::Sender<bool>,
}

impl PresenceManager {
    /// Create and start a PresenceManager. The sweeper interval and timeout are in seconds.
    pub fn new(storage: Arc<Storage>, publisher: Arc<Publisher>, sweep_interval_secs: u64, timeout_secs: u64) -> Result<Self> {
        let (tx, mut rx) = watch::channel(false);
        let storage_c = storage.clone();
        let publisher_c = publisher.clone();

        let handle = tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(sweep_interval_secs));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Sweep presence
                        if let Ok(entries) = storage_c.list_presence() {
                            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                            for (user_id, last_seen) in entries {
                                if now - last_seen > timeout_secs as i64 {
                                    // mark offline
                                    let _ = storage_c.set_presence(&user_id, false, now);
                                    let _ = publisher_c.publish("presence/offline", &serde_json::to_vec(&json!({"user_id": user_id, "last_seen": last_seen})).unwrap_or_default());
                                }
                            }
                        }
                    }
                    changed = rx.changed() => {
                        if changed.is_ok() && *rx.borrow() {
                            // shutdown requested
                            break;
                        }
                    }
                }
            }
        });

        Ok(Self {
            storage,
            publisher,
            sweep_handle: Mutex::new(Some(handle)),
            shutdown_tx: tx,
        })
    }

    /// Heartbeat for a user_id. Creates a user_id if empty (guest).
    pub fn heartbeat(&self, user_id: Option<String>) -> Result<String> {
        // immediate diagnostic so we can see the heartbeat was invoked
        eprintln!("PRESENCE_DIAG: heartbeat invoked for incoming connection");
        let id = user_id.unwrap_or_else(|| format!("anon-{}", Uuid::new_v4().to_string()));
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
        self.storage.set_presence(&id, true, now)?;
        let payload = serde_json::to_vec(&json!({"user_id": id.clone(), "last_seen": now}))?;
        let res = self.publisher.publish("presence/online", &payload);
        match res {
            Ok(()) => {
                tracing::info!(user = %id, "published presence/online");
                // diagnostics for smoke: stdout marker and diag topic
                eprintln!("PRESENCE_DIAG: online {}", id);
                let _ = self.publisher.publish("presence/diag", &serde_json::to_vec(&json!({"event":"online","user_id": id.clone(), "last_seen": now})).unwrap_or_default());
            }
            Err(e) => tracing::error!(user = %id, err = ?e, "failed publishing presence/online"),
        }
        Ok(id)
    }

    /// Mark a user offline explicitly.
    pub fn mark_offline(&self, user_id: &str) -> Result<()> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
        self.storage.set_presence(user_id, false, now)?;
        let payload = serde_json::to_vec(&json!({"user_id": user_id, "last_seen": now}))?;
        let res = self.publisher.publish("presence/offline", &payload);
        match res {
            Ok(()) => {
                tracing::info!(user = %user_id, "published presence/offline");
                eprintln!("PRESENCE_DIAG: offline {}", user_id);
                let _ = self.publisher.publish("presence/diag", &serde_json::to_vec(&json!({"event":"offline","user_id": user_id, "last_seen": now})).unwrap_or_default());
            }
            Err(e) => tracing::error!(user = %user_id, err = ?e, "failed publishing presence/offline"),
        }
        Ok(())
    }

    /// Shutdown the sweeper and background tasks. Accepts Arc<Self> so callers can invoke it
    /// without needing mutable ownership.
    pub async fn shutdown(self: Arc<Self>) {
        let _ = self.shutdown_tx.send(true);
        // take ownership of the join handle and await it if present
        if let Some(handle) = self.sweep_handle.lock().await.take() {
            let _ = handle.await;
        }
    }
}
