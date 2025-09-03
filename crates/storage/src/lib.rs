use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::convert::TryInto;

use redb::{Database, ReadableTable, TableDefinition, ReadableDatabase};

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageRecord {
    pub id: String,
    pub seq: u64,
    pub room: String,
    pub server_ts: i64,
    pub body: Value,
}

/// redb-backed Storage implementation.
/// Messages are stored in a single table where the key is a lexicographically
/// sortable composite string: "<room>/<server_ts:020>/<seq:020>" and the value
/// is the JSON-serialized MessageRecord bytes.
pub struct Storage {
    base: PathBuf,
    db: Database,
}

/// Table definition: key = &str, value = Vec<u8>
const MESSAGES_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("messages");
const SEQS_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("seqs");
const USERS_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("users");
const PRESENCE_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("presence");
const RATE_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("rate");

// Additional tables for auth
const CREDENTIALS_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("credentials");
const OAUTH_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("oauth");
const REFRESH_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("refresh");

// Transient / state tables for auth flows
const WEBAUTHN_REG_STATE_TABLE: TableDefinition<&str, Vec<u8>> =
    TableDefinition::new("webauthn_reg_state");
const WEBAUTHN_AUTH_STATE_TABLE: TableDefinition<&str, Vec<u8>> =
    TableDefinition::new("webauthn_auth_state");
const OAUTH_STATE_TABLE: TableDefinition<&str, Vec<u8>> = TableDefinition::new("oauth_state");

impl Storage {
    /// Create a storage instance rooted at `base_path` (will be created if missing).
    /// Opens or creates a redb database file at `<base_path>/db.redb`.
    pub fn new(base_path: impl AsRef<Path>) -> Result<Self> {
        let base = base_path.as_ref().to_path_buf();
        fs::create_dir_all(&base).with_context(|| format!("creating base path {}", base.display()))?;

        let db_path = base.join("db.redb");
        // Use create which will create or open the file as needed.
        // redb::Database::create will create the file if it doesn't exist.
        let db = Database::create(db_path.clone()).with_context(|| format!("opening redb database {}", db_path.display()))?;

        // Ensure required tables exist by opening them in a write transaction.
        // Opening a table in a write txn will create it if missing.
        {
            let write_txn = db.begin_write()?;
            let _ = write_txn.open_table(MESSAGES_TABLE)?;
            let _ = write_txn.open_table(SEQS_TABLE)?;
            let _ = write_txn.open_table(USERS_TABLE)?;
            let _ = write_txn.open_table(PRESENCE_TABLE)?;
            let _ = write_txn.open_table(RATE_TABLE)?;
            // auth tables
            let _ = write_txn.open_table(CREDENTIALS_TABLE)?;
            let _ = write_txn.open_table(OAUTH_TABLE)?;
            let _ = write_txn.open_table(REFRESH_TABLE)?;
            // auth transient state tables
            let _ = write_txn.open_table(WEBAUTHN_REG_STATE_TABLE)?;
            let _ = write_txn.open_table(WEBAUTHN_AUTH_STATE_TABLE)?;
            let _ = write_txn.open_table(OAUTH_STATE_TABLE)?;
            write_txn.commit()?;
        }

        Ok(Self { base, db })
    }

    fn db_path(&self) -> PathBuf {
        self.base.join("db.redb")
    }

    /// Build a lexicographically sortable key for a message.
    /// Format: "<room>/<server_ts:020>/<seq:020>"
    fn make_key(room: &str, server_ts: i64, seq: u64) -> String {
        // pad server_ts (as unsigned) and seq to fixed width to allow range queries
        // server_ts can be negative theoretically; convert to u128 offset by a large constant would be safer,
        // but for typical usage timestamps are non-negative.
        let mut k = String::with_capacity(room.len() + 1 + 20 + 1 + 20);
        let _ = write!(&mut k, "{}/{:020}/{:020}", room, server_ts, seq);
        k
    }

    /// Append a message record to the messages table.
    pub fn append_message(&self, rec: &MessageRecord) -> Result<()> {
        let bytes = serde_json::to_vec(rec)?;
        let key = Self::make_key(&rec.room, rec.server_ts, rec.seq);

        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(MESSAGES_TABLE)?;
            table.insert(key.as_str(), &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Scan messages for `room`, returning up to `limit` records with server_ts > after_ts.
    /// If after_ts is None, returns latest `limit` records (descending by key order).
    pub fn scan_messages(&self, room: &str, after_ts: Option<i64>, limit: usize) -> Result<Vec<MessageRecord>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(MESSAGES_TABLE)?;

        let mut out = Vec::new();

        if let Some(after) = after_ts {
            // Start just after the given timestamp
            let start_key = Self::make_key(room, after + 1, 0);
            // iterate from start_key upwards
            let iter = table.range(start_key.as_str()..)?;
            for pair in iter {
                let (_k, v) = pair?;
                if out.len() >= limit {
                    break;
                }
                let bytes = v.value();
                if bytes.is_empty() {
                    continue;
                }
                if let Ok(rec) = serde_json::from_slice::<MessageRecord>(bytes.as_slice()) {
                    // ensure room matches (defensive)
                    if rec.room == room {
                        out.push(rec);
                    }
                }
            }
        } else {
            // No after_ts: return the latest `limit` records for the room.
            // Iterate in ascending order and maintain a bounded deque of size `limit`
            // so we never retain more than `limit` records in memory.
            use std::collections::VecDeque;
            let mut deque: VecDeque<MessageRecord> = VecDeque::with_capacity(limit);
            let iter = table.iter()?;
            for pair in iter {
                let (_k, v) = pair?;
                let bytes = v.value();
                if bytes.is_empty() {
                    continue;
                }
                if let Ok(rec) = serde_json::from_slice::<MessageRecord>(bytes.as_slice()) {
                    if rec.room == room {
                        deque.push_back(rec);
                        if deque.len() > limit {
                            deque.pop_front();
                        }
                    }
                }
            }
            // Convert deque to Vec preserving ascending order
            out = deque.into_iter().collect();
        }

        Ok(out)
    }

    /// Snapshot the redb file by copying it to the destination directory as-is.
    pub fn snapshot(&self, dest: impl AsRef<Path>) -> Result<()> {
        let dest = dest.as_ref();
        fs::create_dir_all(dest).with_context(|| format!("creating snapshot dir {}", dest.display()))?;
        let db_file = self.db_path();
        if db_file.exists() {
            let filename = db_file.file_name().unwrap();
            let to = dest.join(filename);
            fs::copy(&db_file, &to).with_context(|| format!("copy {} -> {}", db_file.display(), to.display()))?;
        }
        Ok(())
    }

    /// Retention sweep: delete messages older than `keep_days`.
    /// This scans entries and removes those with server_ts < cutoff.
    pub fn retention_sweep(&self, keep_days: u64) -> Result<()> {
        let cutoff = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_secs() as i64
            - (keep_days as i64 * 86400);

        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(MESSAGES_TABLE)?;
            // Use extract_if to remove entries older than cutoff. We can use extract_if which
            // returns an iterator of removed pairs; we don't need to collect them.
            // The predicate receives (&key, &value) where key is &str.
            let mut extractor = table.extract_if(|_k, v| {
                // In a write-context the value is provided as an owned Vec<u8>, so use as_slice().
                let bytes = v.as_slice();
                if bytes.is_empty() {
                    return false;
                }
                if let Ok(rec) = serde_json::from_slice::<MessageRecord>(bytes) {
                    rec.server_ts < cutoff
                } else {
                    // If malformed, remove it.
                    true
                }
            })?;

            // consume the iterator to perform removals
            while let Some(removed_res) = extractor.next() {
                let _removed = removed_res?;
                // noop; extractor performs removals as items are read
            }
        }
        write_txn.commit()?;
        Ok(())
    }

    //
    // New: per-room sequence management, users, presence and rate counters
    //

    /// Get next per-room sequence atomically.
    /// This reads the current seq for `room` from the SEQS_TABLE, increments it, stores it back and returns it.
    pub fn next_seq_for_room(&self, room: &str) -> Result<u64> {
        // begin write txn and open table, then drop table before committing to satisfy borrow rules
        let write_txn = self.db.begin_write()?;
        let mut table = write_txn.open_table(SEQS_TABLE)?;
        // read current value
        let curr = match table.get(room)? {
            Some(v) => {
                let b = v.value();
                if b.len() == 8 {
                    u64::from_le_bytes(b.try_into().unwrap())
                } else {
                    0
                }
            }
            None => 0,
        };
        let next = curr.wrapping_add(1);
        table.insert(room, &next.to_le_bytes().to_vec())?;
        // drop the table so we can consume the transaction
        drop(table);
        write_txn.commit()?;
        Ok(next)
    }

    /// Set the sequence for a room explicitly (used for migrations or repairs).
    pub fn set_seq_for_room(&self, room: &str, seq: u64) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        let mut table = write_txn.open_table(SEQS_TABLE)?;
        table.insert(room, &seq.to_le_bytes().to_vec())?;
        drop(table);
        write_txn.commit()?;
        Ok(())
    }

    /// Store or update a user record (JSON blob).
    pub fn put_user(&self, user_id: &str, user_json: &Value) -> Result<()> {
        let bytes = serde_json::to_vec(user_json)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(USERS_TABLE)?;
            table.insert(user_id, &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Retrieve a user record if present.
    pub fn get_user(&self, user_id: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(USERS_TABLE)?;
            match table.get(user_id)? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }

    /// List all users (returns vector of user JSON values).
    pub fn list_users(&self) -> Result<Vec<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(USERS_TABLE)?;
        let mut out = Vec::new();
        let iter = table.iter()?;
        for pair in iter {
            let (_k, v) = pair?;
            let bytes = v.value();
            if bytes.is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_slice::<Value>(bytes.as_slice()) {
                out.push(val);
            }
        }
        Ok(out)
    }

    /// Delete a user record and any associated credential entries that reference the user_id.
    /// This will remove the user JSON from USERS_TABLE and scan the CREDENTIALS_TABLE for
    /// credential records whose JSON contains a "user_id" equal to the given user_id and remove them.
    pub fn delete_user(&self, user_id: &str) -> Result<()> {
        // Remove user entry
        {
            let write_txn = self.db.begin_write()?;
            {
                let mut table = write_txn.open_table(USERS_TABLE)?;
                // ignore missing key errors - remove will return Ok even if absent
                let _ = table.remove(user_id);
            }
            write_txn.commit()?;
        }

        // Remove credential entries that reference this user_id (best-effort)
        {
            let write_txn = self.db.begin_write()?;
            {
                let mut table = write_txn.open_table(CREDENTIALS_TABLE)?;
                // Use extract_if to remove entries whose value JSON has "user_id" == user_id
                let mut extractor = table.extract_if(|_k, v| {
                    let bytes = v.as_slice();
                    if bytes.is_empty() {
                        return false;
                    }
                    if let Ok(val) = serde_json::from_slice::<Value>(bytes) {
                        if let Some(uid) = val.get("user_id").and_then(|v| v.as_str()) {
                            return uid == user_id;
                        }
                    }
                    false
                })?;

                // consume iterator to perform removals
                while let Some(_removed_res) = extractor.next() {
                    // noop; extractor performs removals as items are read
                }
            }
            write_txn.commit()?;
        }

        Ok(())
    }

    /// Store credentials by email. Value must include user_id and password_hash.
    pub fn put_credentials(&self, email: &str, cred_json: &Value) -> Result<()> {
        let bytes = serde_json::to_vec(cred_json)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(CREDENTIALS_TABLE)?;
            table.insert(email, &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }
 
    /// Retrieve credentials by email.
    pub fn get_credentials(&self, email: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(CREDENTIALS_TABLE)?;
        match table.get(email)? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }
 
    /// Set presence for a user (timestamp ms). If `online` is true, mark online timestamp, else remove.
    pub fn set_presence(&self, user_id: &str, online: bool, ts_ms: i64) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(PRESENCE_TABLE)?;
            if online {
                // store as JSON: { "last_seen": ts_ms }
                let obj = serde_json::json!({ "last_seen": ts_ms });
                let bytes = serde_json::to_vec(&obj)?;
                table.insert(user_id, &bytes)?;
            } else {
                // Remove presence on offline for simplicity
                table.remove(user_id)?;
            }
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Get presence record for a user (returns last_seen timestamp if present).
    pub fn get_presence(&self, user_id: &str) -> Result<Option<i64>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(PRESENCE_TABLE)?;
            match table.get(user_id)? {
            Some(v) => {
                let bytes = v.value();
                if let Ok(val) = serde_json::from_slice::<Value>(bytes.as_slice()) {
                    if let Some(n) = val.get("last_seen").and_then(|v| v.as_i64()) {
                        return Ok(Some(n));
                    }
                }
                Ok(None)
            }
            None => Ok(None),
        }
    }

    /// List all presence entries (user_id, last_seen)
    /// Iterates the PRESENCE_TABLE and returns a Vec of (user_id, last_seen).
    pub fn list_presence(&self) -> Result<Vec<(String, i64)>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(PRESENCE_TABLE)?;
        let mut out = Vec::new();
        let iter = table.iter()?;
        for pair in iter {
            let (k, v) = pair?;
            // AccessGuard provides `.value()` to access the underlying key/value.
            let key = k.value().to_string();
            let bytes = v.value();
            if bytes.is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_slice::<Value>(bytes.as_slice()) {
                if let Some(n) = val.get("last_seen").and_then(|v| v.as_i64()) {
                    out.push((key, n));
                }
            }
        }
        Ok(out)
    }

    /// Store or update a webauthn credential for a user.
    /// Key format: "<user_id>/<cred_id>"
    pub fn put_webauthn_cred(&self, user_id: &str, cred_id: &str, cred_json: &Value) -> Result<()> {
        let key = format!("{}/{}", user_id, cred_id);
        let bytes = serde_json::to_vec(cred_json)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(CREDENTIALS_TABLE)?;
            table.insert(key.as_str(), &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Retrieve a webauthn credential for a user.
    pub fn get_webauthn_cred(&self, user_id: &str, cred_id: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(CREDENTIALS_TABLE)?;
        let key = format!("{}/{}", user_id, cred_id);
        match table.get(key.as_str())? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }

    /// Transient state helpers for auth flows
    /// Store a webauthn registration pending state (key: "<user_id>/<reg_id>")
    pub fn put_webauthn_reg_state(&self, user_id: &str, reg_id: &str, state_json: &Value) -> Result<()> {
        let key = format!("{}/{}", user_id, reg_id);
        let bytes = serde_json::to_vec(state_json)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(WEBAUTHN_REG_STATE_TABLE)?;
            table.insert(key.as_str(), &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn get_webauthn_reg_state(&self, user_id: &str, reg_id: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(WEBAUTHN_REG_STATE_TABLE)?;
        let key = format!("{}/{}", user_id, reg_id);
        match table.get(key.as_str())? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }

    pub fn delete_webauthn_reg_state(&self, user_id: &str, reg_id: &str) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(WEBAUTHN_REG_STATE_TABLE)?;
            let key = format!("{}/{}", user_id, reg_id);
            table.remove(key.as_str())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Transient state for authentication (key: "<user_id>/<auth_id>")
    pub fn put_webauthn_auth_state(&self, user_id: &str, auth_id: &str, state_json: &Value) -> Result<()> {
        let key = format!("{}/{}", user_id, auth_id);
        let bytes = serde_json::to_vec(state_json)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(WEBAUTHN_AUTH_STATE_TABLE)?;
            table.insert(key.as_str(), &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn get_webauthn_auth_state(&self, user_id: &str, auth_id: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(WEBAUTHN_AUTH_STATE_TABLE)?;
        let key = format!("{}/{}", user_id, auth_id);
        match table.get(key.as_str())? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }

    pub fn delete_webauthn_auth_state(&self, user_id: &str, auth_id: &str) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(WEBAUTHN_AUTH_STATE_TABLE)?;
            let key = format!("{}/{}", user_id, auth_id);
            table.remove(key.as_str())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// OAuth state (for CSRF/PKCE): key = state -> JSON { provider, pkce_verifier, redirect, expires_at }
    pub fn put_oauth_state(&self, state: &str, state_json: &Value) -> Result<()> {
        let bytes = serde_json::to_vec(state_json)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(OAUTH_STATE_TABLE)?;
            table.insert(state, &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn get_oauth_state(&self, state: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(OAUTH_STATE_TABLE)?;
        match table.get(state)? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }

    pub fn delete_oauth_state(&self, state: &str) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(OAUTH_STATE_TABLE)?;
            table.remove(state)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Link an OAuth provider subject to a user_id.
    /// Key format: "<provider>:<subject>" -> user_id (as bytes)
    pub fn link_oauth(&self, provider: &str, subject: &str, user_id: &str) -> Result<()> {
        let key = format!("{}:{}", provider, subject);
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(OAUTH_TABLE)?;
            table.insert(key.as_str(), &user_id.as_bytes().to_vec())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Find a user_id linked to an OAuth provider subject.
    pub fn find_user_by_oauth(&self, provider: &str, subject: &str) -> Result<Option<String>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(OAUTH_TABLE)?;
        let key = format!("{}:{}", provider, subject);
                match table.get(key.as_str())? {
            Some(v) => {
                let b = v.value();
                let s = String::from_utf8_lossy(b.as_slice()).to_string();
                Ok(Some(s))
            }
            None => Ok(None),
        }
    }

    /// Create a refresh token record: key = token_id, value = JSON { user_id, expiry }
    pub fn create_refresh_token(&self, token_id: &str, user_id: &str, expiry_unix: i64) -> Result<()> {
        let obj = serde_json::json!({ "user_id": user_id, "expiry": expiry_unix });
        let bytes = serde_json::to_vec(&obj)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(REFRESH_TABLE)?;
            table.insert(token_id, &bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Get refresh token record as JSON value.
    pub fn get_refresh_token(&self, token_id: &str) -> Result<Option<Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(REFRESH_TABLE)?;
        match table.get(token_id)? {
            Some(v) => {
                let bytes = v.value();
                let val = serde_json::from_slice(bytes.as_slice())?;
                Ok(Some(val))
            }
            None => Ok(None),
        }
    }

    /// Revoke a refresh token.
    pub fn revoke_refresh_token(&self, token_id: &str) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(REFRESH_TABLE)?;
            table.remove(token_id)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Increment a rate counter by `delta`. Returns new value.
    pub fn incr_rate_counter(&self, key: &str, delta: u64) -> Result<u64> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(RATE_TABLE)?;
            let curr = match table.get(key)? {
                Some(v) => {
                    let b = v.value();
                    if b.len() == 8 {
                        u64::from_le_bytes(b.try_into().unwrap())
                    } else {
                        0
                    }
                }
                None => 0,
            };
            let next = curr.wrapping_add(delta);
            table.insert(key, &next.to_le_bytes().to_vec())?;
            drop(table);
            write_txn.commit()?;
            return Ok(next);
        }
    }

    /// Read rate counter value.
    pub fn get_rate_counter(&self, key: &str) -> Result<u64> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(RATE_TABLE)?;
        match table.get(key)? {
            Some(v) => {
                let b = v.value();
                if b.len() == 8 {
                    Ok(u64::from_le_bytes(b.try_into().unwrap()))
                } else {
                    Ok(0)
                }
            }
            None => Ok(0),
        }
    }

    /// List all rate counters as (key, value).
    pub fn list_rate_counters(&self) -> Result<Vec<(String, u64)>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(RATE_TABLE)?;
        let mut out = Vec::new();
        let iter = table.iter()?;
        for pair in iter {
            let (k, v) = pair?;
            let key = k.value().to_string();
            let b = v.value();
            if b.len() == 8 {
                let val = u64::from_le_bytes(b.as_slice().try_into().unwrap());
                out.push((key, val));
            }
        }
        Ok(out)
    }

    /// Reset a rate counter to zero.
    pub fn reset_rate_counter(&self, key: &str) -> Result<()> {
        let write_txn = self.db.begin_write()?;
            {
            let mut table = write_txn.open_table(RATE_TABLE)?;
            table.insert(key, &0u64.to_le_bytes().to_vec())?;
            drop(table);
        }
        write_txn.commit()?;
        Ok(())
    }
}

// Simple convenience constructor for tests/dev
impl Default for Storage {
    fn default() -> Self {
        Self::new("./data").expect("creating default storage")
    }
}
