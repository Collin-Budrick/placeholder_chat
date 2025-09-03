use anyhow::Result;
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey, TokenData, Algorithm};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

mod oauth;
pub use oauth::*;
#[cfg(feature = "with-webauthn")]
mod webauthn;
#[cfg(feature = "with-webauthn")]
pub use webauthn::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iat: usize,
    pub exp: usize,
    pub iss: Option<String>,
    pub aud: Option<String>,
}

/// Read JWT secret from env or return a default (dev only).
fn jwt_secret() -> String {
    std::env::var("AUTH_JWT_SECRET").unwrap_or_else(|_| "stack-dev-secret".to_string())
}

/// Create a signed JWT (HS256) for `user_id` with ttl seconds.
pub fn create_jwt(user_id: &str, ttl_secs: usize) -> Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        iat: now,
        exp: now + ttl_secs,
        iss: Some("stack".to_string()),
        aud: Some("stack-web".to_string()),
    };
    let header = Header::default();
    let token = encode(&header, &claims, &EncodingKey::from_secret(jwt_secret().as_bytes()))?;
    Ok(token)
}

/// Verify a JWT and return its claims if valid.
pub fn verify_jwt(token: &str) -> Result<TokenData<Claims>> {
    // Use an explicit Validation that checks expiry and accepts the audience/issuer we mint.
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    // Accept the audience and issuer we set when creating tokens.
    validation.set_audience(&["stack-web"]);
    validation.set_issuer(&["stack"]);
    let data = decode::<Claims>(token, &DecodingKey::from_secret(jwt_secret().as_bytes()), &validation)?;
    Ok(data)
}
