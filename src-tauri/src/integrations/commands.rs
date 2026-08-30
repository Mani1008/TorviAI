//! Tauri IPC for Integrations (list / connect / disconnect).

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

use crate::integrations::oauth_client::{
    build_auth_request, exchange_code, fetch_account_email, revoke_token, GoogleOAuthCredentials,
};
use crate::integrations::providers::{self, ProviderMeta};
use crate::integrations::token_store::{
    self, plaintext_access_token, plaintext_refresh_token, SaveIntegrationInput,
};
use crate::integrations::{loopback_server, IntegrationDto, STATUS_CONNECTED};

/// Tracks the cancel handle for an in-flight `start_oauth_connect`.
/// A second connect cancels the first loopback listener.
#[derive(Default)]
pub struct OAuthInFlight {
    cancel: Mutex<Option<oneshot::Sender<()>>>,
}

impl OAuthInFlight {
    fn cancel_previous(&self) {
        if let Ok(mut guard) = self.cancel.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
                log::info!("[Integrations] Cancelled previous in-flight OAuth connect");
            }
        }
    }

    fn set_current(&self, tx: oneshot::Sender<()>) {
        if let Ok(mut guard) = self.cancel.lock() {
            *guard = Some(tx);
        }
    }

    fn clear(&self) {
        if let Ok(mut guard) = self.cancel.lock() {
            *guard = None;
        }
    }
}

#[tauri::command]
pub async fn list_integrations(app: AppHandle) -> Result<Vec<IntegrationDto>, String> {
    token_store::list_integrations(&app).await
}

#[tauri::command]
pub fn list_available_providers() -> Vec<ProviderMeta> {
    providers::list_available_providers()
}

#[tauri::command]
pub async fn start_oauth_connect(
    app: AppHandle,
    in_flight: State<'_, OAuthInFlight>,
    provider: String,
) -> Result<IntegrationDto, String> {
    let provider_id = provider.trim().to_lowercase();
    let meta = providers::get_provider(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider}"))?;

    let creds = GoogleOAuthCredentials::from_env()?;

    in_flight.cancel_previous();

    let prepared = loopback_server::prepare_loopback().await?;
    let redirect_uri = prepared.redirect_uri.clone();
    let port = prepared.port;

    let pending = build_auth_request(&creds, &meta, &redirect_uri)?;

    let mut session = prepared.listen(pending.csrf_state.clone())?;
    if let Some(cancel_tx) = session.take_cancel_tx() {
        in_flight.set_current(cancel_tx);
    }

    app.opener()
        .open_url(&pending.auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))?;

    log::info!(
        "[Integrations] Waiting for OAuth callback (provider={provider_id}, port={port})"
    );

    let code = match session.wait_for_code().await {
        Ok(c) => {
            in_flight.clear();
            c
        }
        Err(e) => {
            in_flight.clear();
            return Err(e);
        }
    };

    let tokens = exchange_code(
        &creds,
        &pending.redirect_uri,
        code,
        pending.pkce_verifier,
        &pending.scopes,
    )
    .await?;

    let email = fetch_account_email(&tokens.access_token)
        .await
        .unwrap_or(None);

    let expires_at = tokens.expires_in.map(|secs| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        now + secs as i64
    });

    let dto = token_store::save_integration(
        &app,
        SaveIntegrationInput {
            provider: provider_id,
            account_email: email,
            scopes: tokens.scopes,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: expires_at,
            status: STATUS_CONNECTED.to_string(),
        },
    )
    .await?;

    let _ = app.emit("integration-connected", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn disconnect_integration(app: AppHandle, provider: String) -> Result<(), String> {
    let provider_id = provider.trim().to_lowercase();

    if let Ok(Some(record)) = token_store::get_integration(&app, &provider_id).await {
        if let Ok(access) = plaintext_access_token(&record) {
            revoke_token(&access).await;
        } else if let Ok(Some(refresh)) = plaintext_refresh_token(&record) {
            revoke_token(&refresh).await;
        }
    }

    let deleted = token_store::delete_integration(&app, &provider_id).await?;
    if !deleted {
        return Err(format!("No integration found for provider: {provider_id}"));
    }

    let _ = app.emit("integration-disconnected", provider_id);
    Ok(())
}

#[tauri::command]
pub async fn sync_gmail_now(
    app: AppHandle,
) -> Result<crate::integrations::ingest::GmailSyncResult, String> {
    crate::integrations::ingest::gmail::sync_now(&app).await
}

#[tauri::command]
pub async fn get_gmail_sync_status(
    app: AppHandle,
) -> Result<crate::integrations::ingest::IngestSyncStatus, String> {
    crate::integrations::ingest::gmail::get_sync_status(&app).await
}
