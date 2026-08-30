//! Google OAuth 2.0 (Authorization Code + PKCE) for desktop integrations.
//!
//! Auth URL always includes `access_type=offline` and `prompt=consent` so Google
//! returns a `refresh_token` even when the user has previously authorized the app.

use oauth2::{
    basic::BasicClient, AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenUrl,
};
use serde::Deserialize;

use super::providers::{scopes_joined, ProviderMeta};

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

/// Credentials for the Google Desktop OAuth client (integrations only — not user login).
pub struct GoogleOAuthCredentials {
    pub client_id: String,
    pub client_secret: String,
}

impl GoogleOAuthCredentials {
    /// Load from env for local `tauri dev`.
    /// Release builds should bake these via `build.rs` / `option_env!` later.
    pub fn from_env() -> Result<Self, String> {
        let client_id = std::env::var("GOOGLE_INTEGRATIONS_CLIENT_ID")
            .map_err(|_| {
                "Missing GOOGLE_INTEGRATIONS_CLIENT_ID — add it to .env (Google Cloud → OAuth Desktop client)".to_string()
            })?
            .trim()
            .to_string();
        let client_secret = std::env::var("GOOGLE_INTEGRATIONS_CLIENT_SECRET")
            .map_err(|_| {
                "Missing GOOGLE_INTEGRATIONS_CLIENT_SECRET — add it to .env (Google Cloud → OAuth Desktop client)".to_string()
            })?
            .trim()
            .to_string();
        if client_id.is_empty() || client_secret.is_empty() {
            return Err("GOOGLE_INTEGRATIONS_CLIENT_ID / SECRET must not be empty".into());
        }
        Ok(Self {
            client_id,
            client_secret,
        })
    }
}

/// In-flight PKCE session pieces needed to finish the code exchange.
pub struct AuthPending {
    pub auth_url: String,
    pub csrf_state: String,
    pub pkce_verifier: PkceCodeVerifier,
    pub redirect_uri: String,
    pub scopes: String,
}

#[derive(Debug, Clone)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub scopes: String,
}

fn build_client(
    creds: &GoogleOAuthCredentials,
    redirect_uri: &str,
) -> Result<BasicClient, String> {
    let client = BasicClient::new(
        ClientId::new(creds.client_id.clone()),
        Some(ClientSecret::new(creds.client_secret.clone())),
        AuthUrl::new(GOOGLE_AUTH_URL.to_string()).map_err(|e| e.to_string())?,
        Some(TokenUrl::new(GOOGLE_TOKEN_URL.to_string()).map_err(|e| e.to_string())?),
    )
    .set_redirect_uri(
        RedirectUrl::new(redirect_uri.to_string()).map_err(|e| e.to_string())?,
    );
    Ok(client)
}

/// Build the Google authorize URL for a provider (PKCE + offline + consent).
pub fn build_auth_request(
    creds: &GoogleOAuthCredentials,
    provider: &ProviderMeta,
    redirect_uri: &str,
) -> Result<AuthPending, String> {
    let client = build_client(creds, redirect_uri)?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let mut auth = client.authorize_url(CsrfToken::new_random);
    for scope in &provider.scopes {
        auth = auth.add_scope(Scope::new(scope.clone()));
    }

    // Non-negotiable: without these, re-consent often omits refresh_token.
    let (auth_url, csrf_token) = auth
        .set_pkce_challenge(pkce_challenge)
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .url();

    Ok(AuthPending {
        auth_url: auth_url.to_string(),
        csrf_state: csrf_token.secret().clone(),
        pkce_verifier,
        redirect_uri: redirect_uri.to_string(),
        scopes: scopes_joined(provider),
    })
}

#[derive(Debug, Deserialize)]
struct GoogleTokenJson {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Exchange authorization code + PKCE verifier for tokens.
/// Fails if Google does not return a `refresh_token`.
pub async fn exchange_code(
    creds: &GoogleOAuthCredentials,
    redirect_uri: &str,
    code: String,
    pkce_verifier: PkceCodeVerifier,
    fallback_scopes: &str,
) -> Result<TokenSet, String> {
    let form = [
        ("code", code.as_str()),
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", pkce_verifier.secret()),
    ];

    let response = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    let status = response.status();
    let body: GoogleTokenJson = response
        .json()
        .await
        .map_err(|e| format!("Token exchange parse failed: {e}"))?;

    if let Some(err) = body.error {
        let desc = body.error_description.unwrap_or_default();
        return Err(format!("Token exchange error: {err} {desc}"));
    }
    if !status.is_success() {
        return Err(format!("Token exchange HTTP {status}"));
    }

    let refresh = body.refresh_token.filter(|t| !t.is_empty());
    if refresh.is_none() {
        return Err(
            "Google did not return a refresh_token. Re-connect should use access_type=offline&prompt=consent."
                .into(),
        );
    }

    Ok(TokenSet {
        access_token: body.access_token,
        refresh_token: refresh,
        expires_in: body.expires_in,
        scopes: body
            .scope
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fallback_scopes.to_string()),
    })
}

/// Refresh an access token using the stored refresh token.
pub async fn refresh_access_token(
    creds: &GoogleOAuthCredentials,
    refresh_token: &str,
) -> Result<TokenSet, String> {
    let form = [
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let response = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    let status = response.status();
    let body: GoogleTokenJson = response
        .json()
        .await
        .map_err(|e| format!("Token refresh parse failed: {e}"))?;

    if let Some(err) = body.error {
        let desc = body.error_description.unwrap_or_default();
        return Err(format!("Token refresh error: {err} {desc}"));
    }
    if !status.is_success() {
        return Err(format!("Token refresh HTTP {status}"));
    }

    // Google often omits refresh_token on refresh — keep the old one at the caller.
    Ok(TokenSet {
        access_token: body.access_token,
        refresh_token: body.refresh_token.filter(|t| !t.is_empty()),
        expires_in: body.expires_in,
        scopes: body.scope.unwrap_or_default(),
    })
}

#[derive(Debug, Deserialize)]
struct UserInfoJson {
    email: Option<String>,
}

/// Fetch the connected account email via Google userinfo.
pub async fn fetch_account_email(access_token: &str) -> Result<Option<String>, String> {
    let response = reqwest::Client::new()
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("userinfo request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("userinfo HTTP {}", response.status()));
    }

    let info: UserInfoJson = response
        .json()
        .await
        .map_err(|e| format!("userinfo parse failed: {e}"))?;

    Ok(info.email.filter(|e| !e.is_empty()))
}

/// Best-effort revoke (ignore failures on disconnect).
pub async fn revoke_token(token: &str) {
    let _ = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", token)])
        .send()
        .await;
}
