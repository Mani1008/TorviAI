//! Provider catalog for Integrations (Gmail, Google Calendar, …).

mod gmail;
mod google_calendar;

use serde::{Deserialize, Serialize};

use crate::integrations::{PROVIDER_GMAIL, PROVIDER_GOOGLE_CALENDAR};

/// Static metadata for the Add Integration UI + OAuth config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMeta {
    pub id: String,
    pub label: String,
    pub description: String,
    /// Space-separated OAuth scopes (as granted / requested).
    pub scopes: Vec<String>,
}

pub fn list_available_providers() -> Vec<ProviderMeta> {
    vec![gmail::meta(), google_calendar::meta()]
}

pub fn get_provider(id: &str) -> Option<ProviderMeta> {
    match id.trim().to_lowercase().as_str() {
        PROVIDER_GMAIL => Some(gmail::meta()),
        PROVIDER_GOOGLE_CALENDAR => Some(google_calendar::meta()),
        _ => None,
    }
}

pub fn scopes_joined(meta: &ProviderMeta) -> String {
    meta.scopes.join(" ")
}
