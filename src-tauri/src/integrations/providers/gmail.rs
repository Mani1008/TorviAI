//! Gmail provider — read-only mail scope.

use super::ProviderMeta;
use crate::integrations::PROVIDER_GMAIL;

pub fn meta() -> ProviderMeta {
    ProviderMeta {
        id: PROVIDER_GMAIL.to_string(),
        label: "Gmail".to_string(),
        description: "Ingest support email into your company brain (read-only).".to_string(),
        scopes: vec![
            "https://www.googleapis.com/auth/gmail.readonly".to_string(),
            "openid".to_string(),
            "email".to_string(),
            "profile".to_string(),
        ],
    }
}
