/// IPC fast-path helpers (feature-gated).
///
/// This file exposes a tiny, stable API for a shared-memory / local-socket
/// based request/response transport used for fast in-host RPC:
///
/// - bind_server_interprocess(addr: &str, handler)
/// - req_once_interprocess(addr: &str, payload) -> Vec<u8>
///
/// When the feature "with-interprocess" is not enabled the crate provides a
/// trivial hello() symbol to avoid breaking consumers.
///
/// Implementation notes:
/// - Uses `interprocess::local_socket::LocalSocketListener` / `LocalSocketStream`
///   which works with named pipes on Windows and domain sockets on Unix.
/// - Simple framing protocol: u32 BE length prefix followed by payload bytes.
/// - Server spawns a blocking thread to accept connections and dispatch work
///   to the current Tokio runtime via `Handle::current().block_on`.
/// - Client uses `spawn_blocking` to perform synchronous connect/send/recv and
///   return the response to async callers.
///
pub fn hello() {
    println!("ipc hello");
}

#[cfg(feature = "with-interprocess")]
pub mod interprocess_impl {
    use anyhow::Result;
    use std::future::Future;
    use std::io::{Read, Write};
    use std::pin::Pin;
    use std::sync::Arc;
    use std::thread;
    use tokio::runtime::Handle;
    use tokio::task;
    use std::convert::TryInto;

    use interprocess::local_socket::prelude::*;
    use interprocess::local_socket::traits::Stream;
    use interprocess::local_socket::{GenericNamespaced, ListenerOptions};

    type Req = Vec<u8>;
    type Resp = Vec<u8>;

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

    /// Bind a server to `addr` using interprocess local sockets.
    /// `addr` is a platform-specific name (for Windows named pipe name; on Unix it's the socket path).
    /// Spawns a background blocking thread which accepts connections and handles
    /// single-request single-reply interactions.
    pub fn bind_server_interprocess<F, Fut>(addr: &str, handler: F) -> Result<()>
    where
        F: Fn(Req) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Resp> + Send + 'static,
    {
        // Listener created inside the thread to avoid any cross-thread handle issues on some platforms.
        let addr_owned = addr.to_string();
        let handler_arc: Arc<dyn Handler> = Arc::new(handler);
        let handle = Handle::current();

        thread::spawn(move || {
            // Create listener (will create named pipe on Windows or domain socket on Unix)
            // Convert the string name into an interprocess Name using the namespaced form.
            let name = match addr_owned.clone().to_ns_name::<GenericNamespaced>() {
                Ok(n) => n,
                Err(e) => {
                    tracing::error!("ipc: invalid listener name {}: {:?}", &addr_owned, e);
                    return;
                }
            };
            let opts = ListenerOptions::new().name(name);
            let listener = match opts.create_sync() {
                Ok(l) => l,
                Err(e) => {
                    tracing::error!("ipc listener create failed for {}: {:?}", &addr_owned, e);
                    return;
                }
            };

            tracing::info!("ipc listener bound at {}", &addr_owned);

            for mut stream in listener.incoming().filter_map(|r| r.ok()) {
                let handler = handler_arc.clone();
                let handle = handle.clone();

                // Handle each connection in its own thread to avoid long-running handler blocking accept loop.
                thread::spawn(move || {
                    // Read length-prefixed message
                    match read_frame_sync(&mut stream) {
                        Ok(req_bytes) => {
                            // Call the async handler on the captured runtime
                            let fut = handler.call(req_bytes);
                            let resp_bytes = handle.block_on(fut);

                            // Write reply back
                            if let Err(e) = write_frame_sync(&mut stream, &resp_bytes) {
                                tracing::warn!("ipc: failed to send reply: {:?}", e);
                            }
                        }
                        Err(e) => {
                            tracing::warn!("ipc: failed to read request: {:?}", e);
                        }
                    }
                });
            }

            tracing::info!("ipc listener for {} has shut down", addr_owned);
        });

        Ok(())
    }

    /// Synchronous helper: read u32 BE length + payload
    fn read_frame_sync<R: Read>(r: &mut R) -> Result<Vec<u8>> {
        let mut len_buf = [0u8; 4];
        r.read_exact(&mut len_buf)?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut buf = vec![0u8; len];
        r.read_exact(&mut buf)?;
        Ok(buf)
    }

    /// Synchronous helper: write u32 BE length + payload
    fn write_frame_sync<W: Write>(w: &mut W, payload: &[u8]) -> Result<()> {
        let len: u32 = payload.len().try_into().map_err(|_| anyhow::anyhow!("payload too large"))?;
        w.write_all(&len.to_be_bytes())?;
        w.write_all(payload)?;
        w.flush()?;
        Ok(())
    }

    /// Client: perform a single request-response using interprocess local socket.
    /// This runs in a blocking thread so callers can await it.
    pub async fn req_once_interprocess(addr: &str, payload: &[u8]) -> Result<Vec<u8>> {
        let addr_owned = addr.to_string();
        let payload_owned = payload.to_vec();

            let resp = task::spawn_blocking(move || -> Result<Vec<u8>> {
            // Connect to listener - convert to a namespaced Name then connect.
            let name = addr_owned.to_ns_name::<GenericNamespaced>()?;
            let name_owned = name.into_owned();
            let mut stream = LocalSocketStream::connect(name_owned)?;
            // Send request frame
            write_frame_sync(&mut stream, &payload_owned)?;
            // Read reply frame
            let reply = read_frame_sync(&mut stream)?;
            Ok(reply)
        })
        .await?;

        resp.map_err(|e| e.into())
    }
}
