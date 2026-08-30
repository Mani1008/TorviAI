//! Integrations layer — OAuth-connected external providers (Gmail, Calendar, …).
//!
//! Tokens stay on-device: DPAPI-encrypted BLOBs in the local `integrations` SQLite
//! table (same `ai_assistant.db` as context chunks). See `docs/Integration-plan.md`.
//!
//! Module build order:
//! 1. Stub + schema (done)
//! 2. `token_store` — DPAPI + CRUD (done)
//! 3. `loopback_server` — PKCE callback (done)
//! 4. `oauth_client` + `providers` (done)
//! 5. `commands` — Tauri IPC (done)
//! 6. `refresh` — background + on-demand token refresh (done)

pub mod commands;
pub mod ingest;
pub mod loopback_server;
pub mod oauth_client;
pub mod providers;
pub mod refresh;
pub mod token_store;

use serde::{Deserialize, Serialize};

/// Provider ids stored in `integrations.provider`.
pub const PROVIDER_GMAIL: &str = "gmail";
pub const PROVIDER_GOOGLE_CALENDAR: &str = "google_calendar";

/// Row status values.
pub const STATUS_CONNECTED: &str = "connected";
pub const STATUS_EXPIRED: &str = "expired";
pub const STATUS_REVOKED: &str = "revoked";

/// Safe DTO for the frontend — never includes tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationDto {
    pub id: String,
    pub provider: String,
    pub account_email: Option<String>,
    pub status: String,
    pub connected_at: i64,
    pub updated_at: i64,
}

/// Internal row used by the token store (tokens stay in Rust only).
#[derive(Debug, Clone)]
pub struct IntegrationRecord {
    pub id: String,
    pub provider: String,
    pub account_email: Option<String>,
    pub scopes: String,
    pub access_token: Vec<u8>,
    pub refresh_token: Option<Vec<u8>>,
    pub token_expires_at: Option<i64>,
    pub status: String,
    pub connected_at: i64,
    pub updated_at: i64,
}

impl IntegrationRecord {
    pub fn to_dto(&self) -> IntegrationDto {
        IntegrationDto {
            id: self.id.clone(),
            provider: self.provider.clone(),
            account_email: self.account_email.clone(),
            status: self.status.clone(),
            connected_at: self.connected_at,
            updated_at: self.updated_at,
        }
    }
}
