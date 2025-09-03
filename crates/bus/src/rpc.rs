/*
Minimal RPC scaffolding.

This module provides a small, in-process REQ/REP implementation suitable for
development and tests. It exposes a stable API that can later be replaced with
a real transport-backed implementation (e.g., NNG Req/Rep) behind a feature flag.

API:
- RpcServer::bind(addr, handler) -> registers a handler for an address and
  serves requests in the background.
- req_once(addr, payload) -> sends a request to `addr` and awaits a response.

The implementation uses a global registry mapping addresses -> mpsc::Sender of
(request, oneshot::Sender<response>). This keeps the interface synchronous from
the caller's perspective while remaining async-friendly.

When compiled with feature "with-nng" a native NNG-backed req/rep implementation
is available (both server and client). The default without the feature remains
the in-process mpsc/oneshot registry.
*/

use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tokio::sync::{mpsc, oneshot};

type Req = Vec<u8>;
type Resp = Vec<u8>;

static RPC_REGISTRY: OnceLock<Mutex<HashMap<String, mpsc::Sender<(Req, oneshot::Sender<Resp>)>>>> =
    OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, mpsc::Sender<(Req, oneshot::Sender<Resp>)>>> {
    RPC_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Bind a server to `addr` with the provided async handler function. The handler
/// receives the request bytes and should return response bytes. This function
/// spawns a background tokio task to run the handler loop and returns when the
/// address is registered.
///
/// If an address is already bound, an error is returned.
pub fn bind_server<F, Fut>(addr: &str, handler: F) -> Result<()>
where
    F: Fn(Req) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Resp> + Send + 'static,
{
    let mut map = registry().lock().unwrap();
    if map.contains_key(addr) {
        return Err(anyhow!("address already bound: {}", addr));
    }

    // mpsc channel for incoming requests
    let (tx, mut rx) = mpsc::channel::<(Req, oneshot::Sender<Resp>)>(256);
    map.insert(addr.to_string(), tx);

    // Clone addr for logging/context if needed
    let addr_owned = addr.to_string();

    // Spawn background task to process requests
    tokio::spawn(async move {
        while let Some((req, resp_tx)) = rx.recv().await {
            // Call the handler and send response if possible.
            let resp = handler(req).await;
            // best-effort send; ignore if receiver dropped
            let _ = resp_tx.send(resp);
        }
        tracing::info!("rpc server for {} has shut down", addr_owned);
    });

    Ok(())
}

/// Send a single request to `addr` and await the response. Returns an error if
/// the address is not bound or the response channel is closed.
pub async fn req_once(addr: &str, payload: &[u8]) -> Result<Vec<u8>> {
    let map = registry().lock().unwrap();
    let tx = match map.get(addr) {
        Some(tx) => tx.clone(),
        None => return Err(anyhow!("no rpc server bound at {}", addr)),
    };
    drop(map);

    let (resp_tx, resp_rx) = oneshot::channel();
    // Send request; if send fails, server receiver likely closed.
    tx.send((payload.to_vec(), resp_tx))
        .await
        .map_err(|e| anyhow!("failed to send rpc request: {}", e))?;

    // Await response
    let resp = resp_rx.await.map_err(|_| anyhow!("response channel closed"))?;
    Ok(resp)
}

/// Unbind a server at `addr`. Returns true if a server was removed.
pub fn unbind_server(addr: &str) -> bool {
    let mut map = registry().lock().unwrap();
    map.remove(addr).is_some()
}

/// Convenience no-op used by existing callers/tests that expect a simple symbol.
pub fn hello_rpc() {
    println!("bus::rpc placeholder");
}

#[cfg(feature = "with-nng")]
mod nng_impl {
    use super::*;
    use anyhow::Result;
    use nng::{Socket, Protocol, Message};
    use std::sync::Arc;
    use std::future::Future;
    use std::pin::Pin;
    use tokio::runtime::Handle;
    use tokio::task;

    // Erase future type for handler
    trait Handler: Send + Sync + 'static {
        fn call(&self, req: Req) -> Pin<Box<dyn Future<Output = Resp> + Send>>;
    }

    impl<F, Fut> Handler for F
    where
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Resp> + Send + 'static,
    {
        fn call(&self, req: Req) -> Pin<Box<dyn Future<Output = Resp> + Send>> {
            Box::pin((self)(req))
        }
    }

    /// NNG-backed server using nng::Socket with Protocol::Rep0.
    /// Spawns a blocking thread that recv()s messages and dispatches to the async handler.
    pub fn bind_server<F, Fut>(addr: &str, handler: F) -> Result<()>
    where
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Resp> + Send + 'static,
    {
        let sock = Socket::new(Protocol::Rep0)?;
        sock.listen(addr)?;

        let addr_owned = addr.to_string();
        let handler_arc: Arc<dyn Handler> = Arc::new(handler);
        let handle = Handle::current();

        std::thread::spawn(move || {
            loop {
                match sock.recv() {
                    Ok(msg) => {
                        let req_bytes = msg.as_slice().to_vec();
                        let handler = handler_arc.clone();
                        let fut = handler.call(req_bytes);
                        // Block on the runtime to execute the async handler and get response bytes.
                        let resp_bytes = handle.block_on(fut);
                        // Send back as NNG message (best-effort)
                        let reply = Message::from(resp_bytes.as_slice());
                        let _ = sock.send(reply);
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
            tracing::info!("nng rpc server for {} has shut down", addr_owned);
        });

        Ok(())
    }

    /// NNG-backed client: perform one request-response using Protocol::Req0.
    pub async fn req_once(addr: &str, payload: &[u8]) -> Result<Vec<u8>> {
        let addr_owned = addr.to_string();
        let payload_owned = payload.to_vec();

        let resp = task::spawn_blocking(move || -> Result<Vec<u8>> {
            let sock = Socket::new(Protocol::Req0)?;
            sock.dial(&addr_owned)?;
            let msg = Message::from(payload_owned.as_slice());
            sock.send(msg).map_err(|(_m, e)| anyhow::anyhow!(e))?;
            let reply = sock.recv()?;
            Ok(reply.as_slice().to_vec())
        })
        .await?;

        resp.map_err(|e| e.into())
    }
}


#[cfg(feature = "with-nng")]
pub use nng_impl::{bind_server as bind_server_nng, req_once as req_once_nng};

#[cfg(feature = "with-zmq")]
mod zmq_impl {
    use super::*;
    use anyhow::Result;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Arc;
    use std::thread;
    use tokio::runtime::Handle;
    use tokio::task;
    use zmq::Context as ZmqContext;

    // Erase future type for handler (same shape as other impls)
    trait Handler: Send + Sync + 'static {
        fn call(&self, req: Req) -> Pin<Box<dyn Future<Output = Resp> + Send>>;
    }

    impl<F, Fut> Handler for F
    where
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Resp> + Send + 'static,
    {
        fn call(&self, req: Req) -> Pin<Box<dyn Future<Output = Resp> + Send>> {
            Box::pin((self)(req))
        }
    }

    /// ZMQ-backed server using REP socket. Spawns a blocking thread that recv()s
    /// messages and dispatches to the async handler via the current Tokio runtime.
    pub fn bind_server<F, Fut>(addr: &str, handler: F) -> Result<()>
    where
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Resp> + Send + 'static,
    {
        let addr_owned = addr.to_string();
        let handler_arc: Arc<dyn Handler> = Arc::new(handler);
        let handle = Handle::current();

        // Spawn a blocking OS thread and create the ZMQ socket inside it.
        thread::spawn(move || {
            let ctx = ZmqContext::new();
            let sock = match ctx.socket(zmq::REP) {
                Ok(s) => s,
                Err(_) => return,
            };
            if sock.bind(&addr_owned).is_err() {
                return;
            }

            loop {
                match sock.recv_bytes(0) {
                    Ok(msg) => {
                        let handler = handler_arc.clone();
                        let fut = handler.call(msg);
                        // Block on the runtime to execute the async handler and get response bytes.
                        let resp_bytes = handle.block_on(fut);
                        // best-effort send; ignore errors
                        let _ = sock.send(resp_bytes, 0);
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
            tracing::info!("zmq rpc server for {} has shut down", addr_owned);
        });

        Ok(())
    }

    /// ZMQ-backed client: perform one request-response using REQ socket.
    pub async fn req_once(addr: &str, payload: &[u8]) -> Result<Vec<u8>> {
        let addr_owned = addr.to_string();
        let payload_owned = payload.to_vec();

        let resp = task::spawn_blocking(move || -> Result<Vec<u8>> {
            let ctx = ZmqContext::new();
            let sock = ctx.socket(zmq::REQ)?;
            sock.connect(&addr_owned)?;
            sock.send(&payload_owned, 0)?;
            let reply = sock.recv_bytes(0)?;
            Ok(reply)
        })
        .await?;

        resp.map_err(|e| e.into())
    }
}

#[cfg(feature = "with-zmq")]
pub use zmq_impl::{bind_server as bind_server_zmq, req_once as req_once_zmq};

#[cfg(feature = "with-ipc")]
mod ipc_impl {
    use super::*;
    use anyhow::Result;
    use std::future::Future;

    /// Thin wrapper that delegates to the ipc crate's interprocess implementation.
    pub fn bind_server<F, Fut>(addr: &str, handler: F) -> Result<()>
    where
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Resp> + Send + 'static,
    {
        // Delegate to crates/ipc
        ipc::interprocess_impl::bind_server_interprocess(addr, handler)
    }

    /// Thin async wrapper for a single request using the ipc interprocess transport.
    pub async fn req_once(addr: &str, payload: &[u8]) -> Result<Vec<u8>> {
        ipc::interprocess_impl::req_once_interprocess(addr, payload).await
    }
}

#[cfg(feature = "with-ipc")]
pub use ipc_impl::{bind_server as bind_server_ipc, req_once as req_once_ipc};
