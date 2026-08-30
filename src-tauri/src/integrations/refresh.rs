//! Background + on-demand OAuth token refresh for connected integrations.

use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::integrations::oauth_client::{refresh_access_token, GoogleOAuthCredentials};
use crate::integrations::token_store::{
    self, plaintext_access_token, plaintext_refresh_token,
};
use crate::integrations::{STATUS_CONNECTED, STATUS_EXPIRED};

/// Refresh when access token expires within this window.
const REFRESH_SKEW_SECS: i64 = 5 * 60;
const LOOP_INTERVAL: Duration = Duration::from_secs(60);

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn needs_refresh(expires_at: Option<i64>) -> bool {
    match expires_at {
        None => true, // unknown expiry — refresh proactively when we have a refresh_token
        Some(exp) => exp <= now_secs() + REFRESH_SKEW_SECS,
    }
}

async fn mark_expired(app: &AppHandle, provider: &str, reason: &str) {
    log::warn!("[Integrations] Marking {provider} expired: {reason}");
    if let Err(e) = token_store::set_integration_status(app, provider, STATUS_EXPIRED).await {
        log::warn!("[Integrations] Failed to set expired status: {e}");
        return;
    }
    if let Ok(Some(record)) = token_store::get_integration(app, provider).await {
        let mut dto = record.to_dto();
        dto.status = STATUS_EXPIRED.to_string();
        let _ = app.emit("integration-expired", &dto);
    }
}

/// Refresh one provider's tokens. Returns the new access token on success.
pub async fn refresh_provider(app: &AppHandle, provider: &str) -> Result<String, String> {
    let record = token_store::get_integration(app, provider)
        .await?
        .ok_or_else(|| format!("No integration for provider: {provider}"))?;

    if record.status == STATUS_EXPIRED || record.status == "revoked" {
        return Err(format!("Integration {provider} is {}", record.status));
    }

    let refresh = match plaintext_refresh_token(&record)? {
        Some(t) => t,
        None => {
            mark_expired(app, provider, "missing refresh_token").await;
            return Err(format!(
                "No refresh_token for {provider} — reconnect with prompt=consent"
            ));
        }
    };

    let creds = GoogleOAuthCredentials::from_env()?;
    let tokens = match refresh_access_token(&creds, &refresh).await {
        Ok(t) => t,
        Err(e) => {
            mark_expired(app, provider, &e).await;
            return Err(e);
        }
    };

    let expires_at = tokens.expires_in.map(|secs| now_secs() + secs as i64);
    // Keep old refresh_token when Google omits a new one
    let new_refresh = tokens.refresh_token.as_deref();

    token_store::update_tokens(
        app,
        provider,
        &tokens.access_token,
        new_refresh,
        expires_at,
    )
    .await?;

    Ok(tokens.access_token)
}

/// Return a usable access token, refreshing first if near expiry.
pub async fn get_valid_access_token(app: &AppHandle, provider: &str) -> Result<String, String> {
    let record = token_store::get_integration(app, provider)
        .await?
        .ok_or_else(|| format!("No integration for provider: {provider}"))?;

    if record.status != STATUS_CONNECTED {
        return Err(format!(
            "Integration {provider} status is {} — reconnect in Settings",
            record.status
        ));
    }

    if needs_refresh(record.token_expires_at) {
        return refresh_provider(app, provider).await;
    }

    plaintext_access_token(&record)
}

async fn refresh_due_tokens(app: &AppHandle) {
    let Ok(creds) = GoogleOAuthCredentials::from_env() else {
        // No credentials configured — skip quietly (dev machines without Google setup)
        return;
    };
    let _ = creds; // validated env exists; refresh_provider loads again

    let records = match token_store::list_integration_records(app).await {
        Ok(r) => r,
        Err(e) => {
            log::debug!("[Integrations] refresh tick skipped: {e}");
            return;
        }
    };

    for record in records {
        if record.status != STATUS_CONNECTED {
            continue;
        }
        if !needs_refresh(record.token_expires_at) {
            continue;
        }
        match refresh_provider(app, &record.provider).await {
            Ok(_) => log::info!(
                "[Integrations] Background refresh OK for {}",
                record.provider
            ),
            Err(e) => log::warn!(
                "[Integrations] Background refresh failed for {}: {e}",
                record.provider
            ),
        }
    }
}

/// Spawn the periodic refresh loop (call once from app setup).
pub fn start_token_refresh_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial delay so DB / env settle after launch
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            refresh_due_tokens(&app).await;
            tokio::time::sleep(LOOP_INTERVAL).await;
        }
    });
    log::info!("[Integrations] Token refresh loop started (every {}s)", LOOP_INTERVAL.as_secs());
}
