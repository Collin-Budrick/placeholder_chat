#![allow(clippy::unused_unit)]
#![cfg(feature = "with-webauthn")]

use anyhow::{Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};
use uuid::Uuid;

use storage::Storage;

/// Begin a WebAuthn registration for `user_id`.
/// Returns (reg_id, public_options_json) where `public_options_json` contains
/// a PublicKeyCredentialCreationOptions-like structure the frontend can use.
///
/// This implementation intentionally keeps server-side verification out of scope
/// for Phase A: it generates a challenge, stores a minimal pending state, and
/// returns public options as JSON. In Phase B we will replace this with a full
/// webauthn-rs-backed implementation that validates attestation and counters.
pub fn begin_registration(
    storage: &Storage,
    user_id: &str,
    display_name: &str,
    rp_id: &str,
    rp_name: &str,
    origin: &str,
) -> Result<(String, Value)> {
    let reg_id = Uuid::new_v4().to_string();
    let challenge_raw = Uuid::new_v4().as_bytes().to_vec();
    let challenge_b64 = URL_SAFE_NO_PAD.encode(&challenge_raw);

    // Minimal publicKey options structure suitable for most client libraries.
    let public_key = json!({
        "challenge": challenge_b64,
        "rp": {
            "name": rp_name,
            "id": rp_id
        },
        "user": {
            // WebAuthn requires user.id as bytes; encode user_id as base64 for demo purposes.
            "id": URL_SAFE_NO_PAD.encode(user_id.as_bytes()),
            "name": user_id,
            "displayName": display_name
        },
        "pubKeyCredParams": [
            { "type": "public-key", "alg": -7 },   // ES256
            { "type": "public-key", "alg": -257 }  // RS256
        ],
        "timeout": 60000,
        "attestation": "none"
    });

    // Persist minimal server-side state used to validate the subsequent finish_registration call.
    let state_json = json!({
        "reg_id": reg_id,
        "challenge": challenge_b64,
        "rp_id": rp_id,
        "rp_name": rp_name,
        "origin": origin,
        "user_id": user_id,
        "display_name": display_name
    });

    storage.put_webauthn_reg_state(user_id, &reg_id, &state_json)
        .with_context(|| "storing webauthn registration state")?;

    Ok((reg_id, json!({ "publicKey": public_key })))
}

/// Finish registration: store the credential returned by the client and remove the pending state.
/// For Phase A we accept the client_provided_cred as-is and store it under a generated or provided cred id.
pub fn finish_registration(
    storage: &Storage,
    user_id: &str,
    reg_id: &str,
    client_provided_cred: &Value,
) -> Result<String> {
    // Read pending state (optional sanity check)
    let pending = storage.get_webauthn_reg_state(user_id, reg_id)?;
    if pending.is_none() {
        anyhow::bail!("no pending registration state found for user_id={} reg_id={}", user_id, reg_id);
    }

    // Extract an id from the client credential if present, else generate one.
    let cred_id = client_provided_cred
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Persist credential JSON under "<user_id>/<cred_id>"
    storage.put_webauthn_cred(user_id, &cred_id, client_provided_cred)
        .with_context(|| "storing webauthn credential")?;

    // Remove pending registration state
    storage.delete_webauthn_reg_state(user_id, reg_id)?;

    Ok(cred_id)
}

/// Begin an authentication ceremony (assertion request).
/// Returns (auth_id, public_options_json).
pub fn begin_authentication(
    storage: &Storage,
    user_id: &str,
    rp_id: &str,
    origin: &str,
) -> Result<(String, Value)> {
    let auth_id = Uuid::new_v4().to_string();
    let challenge_raw = Uuid::new_v4().as_bytes().to_vec();
    let challenge_b64 = URL_SAFE_NO_PAD.encode(&challenge_raw);

    // Ideally we'd enumerate stored credentials for the user and fill allowCredentials.
    // Storage currently exposes get_webauthn_cred(user, cred_id) but not a listing API,
    // so for Phase A we return empty allowCredentials (letting the client pick).
    let public_key = json!({
        "challenge": challenge_b64,
        "rpId": rp_id,
        "timeout": 60000,
        "allowCredentials": [],
        "userVerification": "preferred"
    });

    let state_json = json!({
        "auth_id": auth_id,
        "challenge": challenge_b64,
        "rp_id": rp_id,
        "origin": origin,
        "user_id": user_id
    });

    storage.put_webauthn_auth_state(user_id, &auth_id, &state_json)
        .with_context(|| "storing webauthn auth state")?;

    Ok((auth_id, json!({ "publicKey": public_key })))
}

/// Finish authentication: validate the client assertion (lightweight for Phase A) and remove the pending state.
/// This Phase-A implementation does not perform cryptographic verification; it verifies presence of expected fields
/// and relies on Phase B to introduce full verification using webauthn-rs.
pub fn finish_authentication(
    storage: &Storage,
    user_id: &str,
    auth_id: &str,
    client_assertion: &Value,
) -> Result<()> {
    let pending = storage.get_webauthn_auth_state(user_id, auth_id)?;
    if pending.is_none() {
        anyhow::bail!("no pending auth state for user_id={} auth_id={}", user_id, auth_id);
    }

    // Basic structural checks: ensure client provided an "id" and "response"
    if client_assertion.get("id").is_none() || client_assertion.get("response").is_none() {
        anyhow::bail!("malformed client assertion");
    }

    // In a full implementation we'd:
    //  - lookup credential by id
    //  - verify signature & user presence & counters
    //  - update stored counter
    // For Phase A, accept and remove pending state.
    storage.delete_webauthn_auth_state(user_id, auth_id)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn registration_state_lifecycle() -> Result<()> {
        // unique test directory to avoid collisions
        let path = format!("./data/test-webauthn-{}", Uuid::new_v4());
        let storage = Storage::new(&path)?;

        let user_id = "test-user";
        let display = "Test User";
        let rp_id = "localhost";
        let rp_name = "Stack Test RP";
        let origin = "http://localhost:3000";

        // Begin
        let (reg_id, options) = begin_registration(&storage, user_id, display, rp_id, rp_name, origin)?;
        assert!(options.get("publicKey").is_some());

        // Ensure pending state exists
        let pending = storage.get_webauthn_reg_state(user_id, &reg_id)?;
        assert!(pending.is_some());

        // Finish with a fake client-provided credential
        let fake_cred = json!({
            "id": "fake-cred-1",
            "rawId": "ZmFrZS1yY3QtcmF3",
            "response": {
                "attestationObject": {},
                "clientDataJSON": {}
            },
            "type": "public-key"
        });

        let cred_id = finish_registration(&storage, user_id, &reg_id, &fake_cred)?;
        assert_eq!(cred_id, "fake-cred-1");

        // Credential should be stored
        let stored = storage.get_webauthn_cred(user_id, &cred_id)?;
        assert!(stored.is_some());

        // cleanup test dir
        let _ = fs::remove_dir_all(&path);

        Ok(())
    }

    #[test]
    fn auth_state_lifecycle() -> Result<()> {
        let path = format!("./data/test-webauthn-{}", Uuid::new_v4());
        let storage = Storage::new(&path)?;

        let user_id = "auth-user";
        let rp_id = "localhost";
        let origin = "http://localhost:3000";

        let (auth_id, options) = begin_authentication(&storage, user_id, rp_id, origin)?;
        assert!(options.get("publicKey").is_some());

        let pending = storage.get_webauthn_auth_state(user_id, &auth_id)?;
        assert!(pending.is_some());

        let fake_assertion = json!({
            "id": "fake-cred-1",
            "rawId": "ZmFrZS1yY3Q=",
            "response": {
                "clientDataJSON": {},
                "authenticatorData": {},
                "signature": "sig"
            },
            "type": "public-key"
        });

        finish_authentication(&storage, user_id, &auth_id, &fake_assertion)?;

        let pending_after = storage.get_webauthn_auth_state(user_id, &auth_id)?;
        assert!(pending_after.is_none());

        let _ = fs::remove_dir_all(&path);

        Ok(())
    }
}
