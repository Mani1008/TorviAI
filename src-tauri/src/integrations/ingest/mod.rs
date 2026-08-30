//! Connector ingest workers (Gmail → context_chunks).

pub mod gmail;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestSyncStatus {
    pub provider: String,
    pub last_sync_at: Option<i64>,
    pub last_status: String,
    pub last_error: Option<String>,
    pub items_synced: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSyncResult {
    pub synced: i64,
    pub skipped: i64,
    pub status: IngestSyncStatus,
}
