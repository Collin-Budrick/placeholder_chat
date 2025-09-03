use anyhow::Result;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use reqwest::Client as HttpClient;
use serde_json::json;
use serde_json::Value;
use storage::Storage;
use uuid::Uuid;
use url::Url;

/// Create a Google OAuth2 authorization URL and persist PKCE + redirect state.
/// Returns (auth_url, state, pkce_verifier)
/// This is a Phase-A, lightweight implementation that builds the URL manually
/// and stores the transient state in `storage`.
pub fn create_login_url_and_store(
    google_client_id: &str,
    _google_client_secret: &str,
    redirect_url: &str,
    storage: &Storage,
    redirect_to: &str,
) -> Result<(String, String, String)> {
    // generate PKCE verifier (high-entropy) and challenge (sha256, base64-url)
    let mut verifier_bytes = [0u8; 32];
    let mut rng = rand::rng();
    rng.fill_bytes(&mut verifier_bytes);
    let pkce_verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&verifier_bytes);

    // create code challenge (sha256)
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(pkce_verifier.as_bytes());
    let challenge = hasher.finalize();
    let pkce_challenge = URL_SAFE_NO_PAD.encode(&challenge);

    // state (CSRF)
    // generate a UUID-like random state using the same RNG (avoid relying on `Uuid::new_v4`)
    let high = rng.next_u64() as u128;
    let low = rng.next_u64() as u128;
    let uuid_u128 = (high << 64) | low;
    let state = Uuid::from_u128(uuid_u128).to_string();

    // build auth url
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")?;
    url.query_pairs_mut()
        .append_pair("client_id", google_client_id)
        .append_pair("redirect_uri", redirect_url)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state)
        .append_pair("code_challenge", &pkce_challenge)
        .append_pair("code_challenge_method", "S256");

    // persist minimal state: provider, pkce_verifier, redirect_to
    let state_json = json!({
        "provider": "google",
        "pkce_verifier": pkce_verifier,
        "redirect_to": redirect_to
    });
    storage.put_oauth_state(&state, &state_json)?;

    Ok((url.to_string(), state, pkce_verifier))
}

/// Exchange an authorization code directly against Google's token endpoint and
/// return the subject (sub) from the ID token if present.
///
/// Note: This is a lightweight Phase-A helper. Production code must validate
/// the ID token signature and claims according to OIDC rules.
pub async fn exchange_code_for_google_subject(
    google_client_id: &str,
    google_client_secret: &str,
    redirect_url: &str,
    code: &str,
    pkce_verifier: &str,
) -> Result<String> {
    let http = HttpClient::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", google_client_id),
        ("client_secret", google_client_secret),
        ("redirect_uri", redirect_url),
        ("code_verifier", pkce_verifier),
    ];

    let resp = http
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?
        .error_for_status()?;

    let body: Value = resp.json().await?;
    if let Some(id_token) = body.get("id_token").and_then(|v| v.as_str()) {
        // parse payload (unsafe: no signature validation)
        let parts: Vec<&str> = id_token.split('.').collect();
        if parts.len() >= 2 {
            let payload = URL_SAFE_NO_PAD.decode(parts[1])?;
            let v: Value = serde_json::from_slice(&payload)?;
            if let Some(sub) = v.get("sub").and_then(|s| s.as_str()) {
                return Ok(sub.to_string());
            }
        }
    }

    if let Some(at) = body.get("access_token").and_then(|v| v.as_str()) {
        return Ok(at.to_string());
    }

    anyhow::bail!("token response missing id_token and access_token");
}
