$ErrorActionPreference = "Stop"

$dirs = @(
  'crates/domain',
  'crates/bus',
  'crates/ipc',
  'crates/rooms',
  'crates/presence',
  'crates/storage',
  'crates/discover',
  'crates/auth',
  'crates/rate',
  'apps/gateway',
  'apps/push-worker',
  'apps/mobile',
  'apps/desktop'
)

foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $d 'src') | Out-Null
}

# crates/domain
$domainCargo = @'
[package]
name = "domain"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
anyhow = "1"
proto = { path = "../proto" }
'@
Set-Content -Path 'crates/domain/Cargo.toml' -Value $domainCargo -Encoding UTF8

$domainLib = @'
pub mod types {
    use serde::{Serialize, Deserialize};
    #[derive(Debug, Serialize, Deserialize)]
    pub struct User { pub id: String, pub name: String }
}

pub fn hello() { println!("domain hello"); }
'@
Set-Content -Path 'crates/domain/src/lib.rs' -Value $domainLib -Encoding UTF8

# crates/bus
$busCargo = @'
[package]
name = "bus"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
proto = { path = "../proto" }
capnp = "0.18"
'@
Set-Content -Path 'crates/bus/Cargo.toml' -Value $busCargo -Encoding UTF8

$busLib = @'
pub mod rpc;
pub mod pubsub;
pub mod codecs;

pub fn hello() { println!("bus hello"); }
'@
Set-Content -Path 'crates/bus/src/lib.rs' -Value $busLib -Encoding UTF8

# crates/ipc
$ipcCargo = @'
[package]
name = "ipc"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
'@
Set-Content -Path 'crates/ipc/Cargo.toml' -Value $ipcCargo -Encoding UTF8

$ipcLib = @'
/// ShmIPC wrapper and NNG IPC fallback (impl TODO)
pub fn hello() { println!("ipc hello"); }
'@
Set-Content -Path 'crates/ipc/src/lib.rs' -Value $ipcLib -Encoding UTF8

# crates/rooms
$roomsCargo = @'
[package]
name = "rooms"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
proto = { path = "../proto" }
storage = { path = "../storage" }
'@
Set-Content -Path 'crates/rooms/Cargo.toml' -Value $roomsCargo -Encoding UTF8

$roomsLib = @'
/// Room broker: handles SendMessage/FetchHistory/Join RPCs (skeleton)
pub fn hello() { println!("rooms hello"); }
'@
Set-Content -Path 'crates/rooms/src/lib.rs' -Value $roomsLib -Encoding UTF8

# crates/presence
$presenceCargo = @'
[package]
name = "presence"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
'@
Set-Content -Path 'crates/presence/Cargo.toml' -Value $presenceCargo -Encoding UTF8

$presenceLib = @'
/// Presence service: heartbeats and sweeper (skeleton)
pub fn hello() { println!("presence hello"); }
'@
Set-Content -Path 'crates/presence/src/lib.rs' -Value $presenceLib -Encoding UTF8

# crates/storage
$storageCargo = @'
[package]
name = "storage"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
'@
Set-Content -Path 'crates/storage/Cargo.toml' -Value $storageCargo -Encoding UTF8

$storageLib = @'
/// redb adapter and append-only buckets (skeleton)
pub fn hello() { println!("storage hello"); }
'@
Set-Content -Path 'crates/storage/src/lib.rs' -Value $storageLib -Encoding UTF8

# crates/discover
$discoverCargo = @'
[package]
name = "discover"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
'@
Set-Content -Path 'crates/discover/Cargo.toml' -Value $discoverCargo -Encoding UTF8

$discoverLib = @'
/// Discovery client (Consul/Serf) skeleton
pub fn hello() { println!("discover hello"); }
'@
Set-Content -Path 'crates/discover/src/lib.rs' -Value $discoverLib -Encoding UTF8

# crates/auth
$authCargo = @'
[package]
name = "auth"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
serde = { version = "1.0", features = ["derive"] }
'@
Set-Content -Path 'crates/auth/Cargo.toml' -Value $authCargo -Encoding UTF8

$authLib = @'
/// Auth helpers: passkeys/webauthn, OIDC/PKCE, JWT helpers (skeleton)
pub fn hello() { println!("auth hello"); }
'@
Set-Content -Path 'crates/auth/src/lib.rs' -Value $authLib -Encoding UTF8

# crates/rate
$rateCargo = @'
[package]
name = "rate"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
'@
Set-Content -Path 'crates/rate/Cargo.toml' -Value $rateCargo -Encoding UTF8

$rateLib = @'
/// Token bucket rate limiter (skeleton)
pub fn hello() { println!("rate hello"); }
'@
Set-Content -Path 'crates/rate/src/lib.rs' -Value $rateLib -Encoding UTF8

# apps/gateway
$gwCargo = @'
[package]
name = "gateway"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
tracing = "0.1"
tracing-subscriber = "0.3"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
proto = { path = "../../crates/proto" }
anyhow = "1"
'@
Set-Content -Path 'apps/gateway/Cargo.toml' -Value $gwCargo -Encoding UTF8

$gwMain = @'
use axum::{routing::get, Router, response::Html};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let app = Router::new().route("/", get(root));
    let addr = SocketAddr::from(([127,0,0,1], 7000));
    println!("Gateway listening on {}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn root() -> Html<&'static str> {
    Html("Gateway up")
}
'@
Set-Content -Path 'apps/gateway/src/main.rs' -Value $gwMain -Encoding UTF8

# apps/push-worker
$pwCargo = @'
[package]
name = "push-worker"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
'@
Set-Content -Path 'apps/push-worker/Cargo.toml' -Value $pwCargo -Encoding UTF8

$pwMain = @'
#[tokio::main]
async fn main() {
    println!("push-worker (stub) running");
}
'@
Set-Content -Path 'apps/push-worker/src/main.rs' -Value $pwMain -Encoding UTF8

# apps/mobile (Slint/lynx skeleton)
$mobileCargo = @'
[package]
name = "mobile_app"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
'@
Set-Content -Path 'apps/mobile/Cargo.toml' -Value $mobileCargo -Encoding UTF8

$mobileMain = @'
#[tokio::main]
async fn main() {
    println!("mobile (slint) stub running");
}
'@
Set-Content -Path 'apps/mobile/src/main.rs' -Value $mobileMain -Encoding UTF8

# apps/desktop (Tauri wrapper skeleton)
$desktopCargo = @'
[package]
name = "desktop_app"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
'@
Set-Content -Path 'apps/desktop/Cargo.toml' -Value $desktopCargo -Encoding UTF8

$desktopMain = @'
#[tokio::main]
async fn main() {
    println!("desktop (tauri) stub running");
}
'@
Set-Content -Path 'apps/desktop/src/main.rs' -Value $desktopMain -Encoding UTF8

Write-Host "Created crates and app skeletons."
