//! Google Calendar provider — read-only calendar scope.

use super::ProviderMeta;
use crate::integrations::PROVIDER_GOOGLE_CALENDAR;

pub fn meta() -> ProviderMeta {
    ProviderMeta {
        id: PROVIDER_GOOGLE_CALENDAR.to_string(),
        label: "Google Calendar".to_string(),
        description: "Let Torvi see your upcoming events (read-only).".to_string(),
        scopes: vec![
            "https://www.googleapis.com/auth/calendar.readonly".to_string(),
            "openid".to_string(),
            "email".to_string(),
            "profile".to_string(),
        ],
    }
}
