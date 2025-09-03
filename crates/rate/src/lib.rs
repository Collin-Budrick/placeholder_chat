use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// Simple token-bucket implementation used by the gateway.
/// Buckets are created on first use and stored in-memory. This is an in-proc
/// limiter suitable for single-host deployments. Persistent counters are kept
/// in Storage separately (gateway is responsible for calling Storage::incr_rate_counter).
pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    refill_per_sec: f64,
    last: Instant,
}

impl TokenBucket {
    fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            capacity,
            tokens: capacity,
            refill_per_sec,
            last: Instant::now(),
        }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last).as_secs_f64();
        if elapsed > 0.0 {
            self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
            self.last = now;
        }
    }

    /// Try consume `amount` tokens. Returns true if tokens were available.
    fn try_consume(&mut self, amount: f64) -> bool {
        self.refill();
        if self.tokens >= amount {
            self.tokens -= amount;
            true
        } else {
            false
        }
    }
}

/// RateLimiter holds token buckets keyed by an arbitrary string (e.g. user or IP).
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, TokenBucket>>,
    capacity: f64,
    refill_per_sec: f64,
}

impl RateLimiter {
    /// Create a new RateLimiter with per-bucket capacity and refill rate (tokens/sec).
    pub fn new(capacity: usize, refill_per_sec: f64) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            capacity: capacity as f64,
            refill_per_sec,
        }
    }

    /// Check and consume a single token for `key`. Returns true if allowed.
    pub fn allow(&self, key: &str) -> bool {
        let mut map = self.buckets.lock().unwrap();
        let bucket = map.entry(key.to_string()).or_insert_with(|| {
            TokenBucket::new(self.capacity, self.refill_per_sec)
        });
        bucket.try_consume(1.0)
    }

    /// Convenience for tests/debugging.
    pub fn hello() {
        println!("rate limiter ready");
    }

    /// Clear all in-memory token buckets (dev-only).
    /// Useful in development to reset rate limiting without restarting the process.
    pub fn clear_buckets(&self) {
        let mut map = self.buckets.lock().unwrap();
        map.clear();
    }
}
