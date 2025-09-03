use anyhow::{Context, Result};
use serde::Deserialize;
use std::fs;
use std::path::Path;

/// Service entry returned by discover::get_services()
#[derive(Debug, Clone, Deserialize)]
pub struct ServiceEntry {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub meta: Option<serde_json::Value>,
}

/// Try to load service catalog from Consul (feature to be implemented).
/// For now this function provides a dev-friendly fallback:
/// 1. If the file "./data/discover.json" exists, parse it as an array of ServiceEntry.
/// 2. Otherwise, return a small hard-coded static catalog.
///
/// This provides a safe local fallback for development and testing while a
/// full Consul client + cache can be implemented later.
pub fn get_services() -> Result<Vec<ServiceEntry>> {
    let path = Path::new("./data/discover.json");
    if path.exists() {
        let s = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
        let v: Vec<ServiceEntry> = serde_json::from_str(&s).with_context(|| "parsing discover.json")?;
        return Ok(v);
    }

    // Static fallback catalog (development)
    let fallback = vec![
        ServiceEntry {
            name: "gateway".to_string(),
            address: "127.0.0.1".to_string(),
            port: 7000,
            meta: None,
        },
        ServiceEntry {
            name: "push-worker".to_string(),
            address: "127.0.0.1".to_string(),
            port: 7010,
            meta: None,
        },
    ];

    Ok(fallback)
}

/// Compatibility helper: simple hello() used by some consumers/tests.
pub fn hello() {
    println!("discover hello");
}
