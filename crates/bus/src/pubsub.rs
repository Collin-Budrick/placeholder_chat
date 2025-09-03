/*
A selectable pub/sub implementation.

This file exposes the same public API regardless of feature flags:

- Publisher
  - bind(addr: &str) -> Result<Self>
  - dial(addr: &str) -> Result<Self>
  - publish(&self, topic: &str, payload: &[u8]) -> Result<()>

- Subscriber
  - connect(addr: &str, topic: &str) -> Result<Self>
  - into_receiver(self) -> mpsc::Receiver<(String, Vec<u8>)>

Current state:
- Default (no feature): in-memory tokio::broadcast-based implementation (suitable for dev/tests)
- feature = "with-nng": for now we alias to the in-memory implementation as a shim.
  A true NNG-backed implementation will be added in a follow-up change.

Keeping the shim avoids breaking builds while allowing the gateway to enable the
with-nng feature and still work locally.
*/

use anyhow::Result;
use tokio::sync::mpsc;

#[allow(dead_code)]
mod mem {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use tokio::sync::broadcast;

    static REGISTRY: OnceLock<Mutex<HashMap<String, broadcast::Sender<Vec<u8>>>>> =
        OnceLock::new();

    fn registry() -> &'static Mutex<HashMap<String, broadcast::Sender<Vec<u8>>>> {
        REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub struct Publisher {}

    impl Publisher {
        /// Bind a publisher. `addr` is ignored for the in-memory fallback.
        pub fn bind(_addr: &str) -> Result<Self> {
            Ok(Self {})
        }

        /// Dial a publisher. Kept for API parity with the nng-based implementation.
        pub fn dial(_addr: &str) -> Result<Self> {
            Ok(Self {})
        }

        /// Publish a payload to `topic`.
        pub fn publish(&self, topic: &str, payload: &[u8]) -> Result<()> {
            tracing::debug!(topic = %topic, len = payload.len(), "mem pub: sending payload");
            let mut map = registry().lock().unwrap();
            let tx = map
                .entry(topic.to_string())
                .or_insert_with(|| broadcast::channel(1024).0)
                .clone();

            // If there are no subscribers, broadcast::Sender::send returns Err(SendError).
            // For our in-memory dev fallback we treat "no subscribers" as non-fatal and
            // swallow the error so publishers don't fail simply because no one is listening.
            match tx.send(payload.to_vec()) {
                Ok(_) => Ok(()),
                Err(_send_err) => Ok(()), // no receivers; ignore in dev fallback
            }
        }
    }

    pub struct Subscriber {
        receiver: mpsc::Receiver<(String, Vec<u8>)>,
    }

    impl Subscriber {
        /// Connect to a topic. `addr` is ignored for the in-memory fallback.
        pub fn connect(_addr: &str, topic: &str) -> Result<Self> {
            let (tx, rx) = mpsc::channel(256);

            // Ensure a broadcast sender exists for this topic and subscribe.
            let mut map = registry().lock().unwrap();
            let btx = map
                .entry(topic.to_string())
                .or_insert_with(|| broadcast::channel(1024).0)
                .clone();
            let mut brx = btx.subscribe();

            // Spawn a tokio task to forward from broadcast receiver -> mpsc sender.
            let topic_owned = topic.to_string();
            tokio::spawn(async move {
                loop {
                    match brx.recv().await {
                        Ok(payload) => {
                            tracing::debug!(topic = %topic_owned, len = payload.len(), "mem sub: received payload, forwarding");
                            // best-effort: if receiver closed, stop the task
                            if tx.send((topic_owned.clone(), payload)).await.is_err() {
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            // drop and continue
                            continue;
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            break;
                        }
                    }
                }
            });

            Ok(Self { receiver: rx })
        }

        /// Consume the Subscriber and return the owned receiver for moving into tasks.
        pub fn into_receiver(self) -> mpsc::Receiver<(String, Vec<u8>)> {
            self.receiver
        }

        /// Return the internal receiver to await incoming messages.
        pub fn receiver(&mut self) -> &mut mpsc::Receiver<(String, Vec<u8>)> {
            &mut self.receiver
        }
    }
}

#[allow(dead_code)]
#[cfg(feature = "with-nng")]
mod nng_impl {
    use super::*;
    use anyhow::Result;
    use nng::{Socket, Protocol, Message};
    use nng::options::Options;
    use nng::options::protocol::pubsub::Subscribe;
    use std::thread;
    use tokio::runtime::Handle;

    #[allow(dead_code)]
    pub struct Publisher {
        sock: Socket,
    }

    impl Publisher {
        /// Bind a publisher (listen) on addr.
        pub fn bind(addr: &str) -> Result<Self> {
            let sock = Socket::new(Protocol::Pub0)?;
            sock.listen(addr)?;
            Ok(Self { sock })
        }

        /// Dial a publisher (connect) to addr.
        pub fn dial(addr: &str) -> Result<Self> {
            let sock = Socket::new(Protocol::Pub0)?;
            sock.dial(addr)?;
            Ok(Self { sock })
        }

        /// Publish a topic + payload as: topic\x00payload
        pub fn publish(&self, topic: &str, payload: &[u8]) -> Result<()> {
            let mut buf = Vec::with_capacity(topic.len() + 1 + payload.len());
            buf.extend_from_slice(topic.as_bytes());
            buf.push(0);
            buf.extend_from_slice(payload);
            let msg = Message::from(buf.as_slice());
            self.sock.send(msg).map_err(|(_m, e)| anyhow::anyhow!(e))?;
            Ok(())
        }
    }

    #[allow(dead_code)]
    pub struct Subscriber {
        receiver: mpsc::Receiver<(String, Vec<u8>)>,
    }

    impl Subscriber {
        /// Connect to a topic on addr and subscribe to the topic prefix.
        /// This spawns a blocking thread to recv from the native nng socket and forwards
        /// messages into a tokio mpsc channel using the current runtime handle.
        pub fn connect(addr: &str, topic: &str) -> Result<Self> {
            let sub_sock = Socket::new(Protocol::Sub0)?;
            sub_sock.dial(addr)?;
            // Subscribe to the topic prefix. Use the pubsub Subscribe option.
            sub_sock.set_opt::<Subscribe>(topic.as_bytes().to_vec())?;

            let (tx, rx) = mpsc::channel(256);

            // Capture a handle to the current runtime so the blocking thread can
            // spawn async tasks to forward into the tokio channel.
            let handle = Handle::current();
            let sub_thread = sub_sock;
            let tx_thread = tx.clone();

            // Spawn a blocking OS thread to receive messages from the native nng socket.
            thread::spawn(move || {
                loop {
                    match sub_thread.recv() {
                        Ok(msg) => {
                            let msg_bytes = msg.as_slice().to_vec();
                            // split at first 0x00 separator
                            if let Some(pos) = msg_bytes.iter().position(|&b| b == 0) {
                                let topic_bytes = msg_bytes[..pos].to_vec();
                                let payload = msg_bytes[pos + 1..].to_vec();
                                let topic_str = String::from_utf8_lossy(&topic_bytes).to_string();
                                let tx_async = tx_thread.clone();
                                // forward into tokio mpsc via the runtime
                                let _ = handle.spawn(async move {
                                    let _ = tx_async.send((topic_str, payload)).await;
                                });
                            } else {
                                // No separator, treat whole message as payload with empty topic
                                let payload = msg_bytes;
                                let tx_async = tx_thread.clone();
                                let _ = handle.spawn(async move {
                                    let _ = tx_async.send((String::new(), payload)).await;
                                });
                            }
                        }
                        Err(_) => {
                            // socket closed or error; stop thread
                            break;
                        }
                    }
                }
            });

            Ok(Self { receiver: rx })
        }

        /// Consume the Subscriber and return the owned receiver for moving into tasks.
        pub fn into_receiver(self) -> mpsc::Receiver<(String, Vec<u8>)> {
            self.receiver
        }

        /// Return the internal receiver to await incoming messages.
        pub fn receiver(&mut self) -> &mut mpsc::Receiver<(String, Vec<u8>)> {
            &mut self.receiver
        }
    }
}

#[allow(dead_code)]
#[cfg(all(feature = "with-zmq", not(feature = "with-nng")))]
mod zmq_impl {
    use super::*;
    use anyhow::Result;
    use std::thread;
    use tokio::runtime::Handle;
    use zmq::Context as ZmqContext;

    #[allow(dead_code)]
    pub struct Publisher {
        sock: zmq::Socket,
    }

    impl Publisher {
        /// Bind a publisher (listen) on addr.
        pub fn bind(addr: &str) -> Result<Self> {
            let ctx = ZmqContext::new();
            let sock = ctx.socket(zmq::PUB)?;
            sock.bind(addr)?;
            Ok(Self { sock })
        }

        /// Dial a publisher (connect) to addr.
        pub fn dial(addr: &str) -> Result<Self> {
            let ctx = ZmqContext::new();
            let sock = ctx.socket(zmq::PUB)?;
            sock.connect(addr)?;
            Ok(Self { sock })
        }

        /// Publish a topic + payload as: topic\x00payload
        pub fn publish(&self, topic: &str, payload: &[u8]) -> Result<()> {
            let mut buf = Vec::with_capacity(topic.len() + 1 + payload.len());
            buf.extend_from_slice(topic.as_bytes());
            buf.push(0);
            buf.extend_from_slice(payload);
            self.sock.send(&buf, 0)?;
            Ok(())
        }
    }

    #[allow(dead_code)]
    pub struct Subscriber {
        receiver: mpsc::Receiver<(String, Vec<u8>)>,
    }

    impl Subscriber {
        /// Connect to a topic on addr and subscribe to the topic prefix.
        /// This spawns a blocking thread to recv from the ZMQ SUB socket and forwards
        /// messages into a tokio mpsc channel using the current runtime handle.
        pub fn connect(addr: &str, topic: &str) -> Result<Self> {
            let ctx = ZmqContext::new();
            let sock = ctx.socket(zmq::SUB)?;
            sock.connect(addr)?;
            // subscribe to the topic prefix
            sock.set_subscribe(topic.as_bytes())?;

            let (tx, rx) = mpsc::channel(256);

            let handle = Handle::current();
            let sub_thread_sock = sock;
            let tx_thread = tx.clone();

            thread::spawn(move || {
                loop {
                    match sub_thread_sock.recv_bytes(0) {
                        Ok(msg_bytes) => {
                            // split at first 0x00 separator
                            if let Some(pos) = msg_bytes.iter().position(|&b| b == 0) {
                                let topic_bytes = msg_bytes[..pos].to_vec();
                                let payload = msg_bytes[pos + 1..].to_vec();
                                let topic_str = String::from_utf8_lossy(&topic_bytes).to_string();
                                let tx_async = tx_thread.clone();
                                let _ = handle.spawn(async move {
                                    let _ = tx_async.send((topic_str, payload)).await;
                                });
                            } else {
                                // No separator, treat whole message as payload with empty topic
                                let payload = msg_bytes;
                                let tx_async = tx_thread.clone();
                                let _ = handle.spawn(async move {
                                    let _ = tx_async.send((String::new(), payload)).await;
                                });
                            }
                        }
                        Err(_) => {
                            break;
                        }
                    }
                }
            });

            Ok(Self { receiver: rx })
        }

        /// Consume the Subscriber and return the owned receiver for moving into tasks.
        pub fn into_receiver(self) -> mpsc::Receiver<(String, Vec<u8>)> {
            self.receiver
        }

        /// Return the internal receiver to await incoming messages.
        pub fn receiver(&mut self) -> &mut mpsc::Receiver<(String, Vec<u8>)> {
            &mut self.receiver
        }
    }
}

#[cfg(not(any(feature = "with-nng", feature = "with-zmq")))]
pub use mem::{Publisher, Subscriber};

#[cfg(feature = "with-nng")]
pub use nng_impl::{Publisher, Subscriber};

#[cfg(all(feature = "with-zmq", not(feature = "with-nng")))]
pub use zmq_impl::{Publisher, Subscriber};
