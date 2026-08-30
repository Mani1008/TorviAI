//! Sync recent Gmail threads into local `context_chunks`.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tauri::AppHandle;

use crate::context_db::ContextDb;
use crate::integrations::ingest::{GmailSyncResult, IngestSyncStatus};
use crate::integrations::refresh::get_valid_access_token;
use crate::integrations::PROVIDER_GMAIL;

const MAX_MESSAGES: usize = 25;
const NEWER_THAN_DAYS: u32 = 7;

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn hash_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

async fn write_sync_state(
    app: &AppHandle,
    status: &str,
    error: Option<&str>,
    items: i64,
) -> Result<IngestSyncStatus, String> {
    let db = ContextDb::open(app).await?;
    let now = now_secs();
    sqlx::query(
        "INSERT INTO ingest_sync_state (provider, last_sync_at, last_status, last_error, items_synced)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
            last_sync_at = excluded.last_sync_at,
            last_status = excluded.last_status,
            last_error = excluded.last_error,
            items_synced = excluded.items_synced",
    )
    .bind(PROVIDER_GMAIL)
    .bind(now)
    .bind(status)
    .bind(error)
    .bind(items)
    .execute(db.pool())
    .await
    .map_err(|e| format!("ingest_sync_state upsert: {e}"))?;

    Ok(IngestSyncStatus {
        provider: PROVIDER_GMAIL.to_string(),
        last_sync_at: Some(now),
        last_status: status.to_string(),
        last_error: error.map(|s| s.to_string()),
        items_synced: items,
    })
}

pub async fn get_sync_status(app: &AppHandle) -> Result<IngestSyncStatus, String> {
    let db = ContextDb::open(app).await?;
    let row = sqlx::query(
        "SELECT provider, last_sync_at, last_status, last_error, items_synced
         FROM ingest_sync_state WHERE provider = ? LIMIT 1",
    )
    .bind(PROVIDER_GMAIL)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("ingest_sync_state get: {e}"))?;

    if let Some(row) = row {
        Ok(IngestSyncStatus {
            provider: row.try_get("provider").map_err(|e| e.to_string())?,
            last_sync_at: row.try_get("last_sync_at").ok(),
            last_status: row.try_get("last_status").map_err(|e| e.to_string())?,
            last_error: row.try_get("last_error").ok(),
            items_synced: row.try_get("items_synced").unwrap_or(0),
        })
    } else {
        Ok(IngestSyncStatus {
            provider: PROVIDER_GMAIL.to_string(),
            last_sync_at: None,
            last_status: "idle".into(),
            last_error: None,
            items_synced: 0,
        })
    }
}

#[derive(Debug, serde::Deserialize)]
struct ListMessagesResponse {
    messages: Option<Vec<MessageRef>>,
}

#[derive(Debug, serde::Deserialize)]
struct MessageRef {
    id: String,
}

#[derive(Debug, serde::Deserialize)]
struct GmailMessage {
    id: String,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    snippet: Option<String>,
    payload: Option<MessagePayload>,
}

#[derive(Debug, serde::Deserialize)]
struct MessagePayload {
    headers: Option<Vec<Header>>,
    body: Option<Body>,
    parts: Option<Vec<MessagePart>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Header {
    name: String,
    value: String,
}

#[derive(Debug, serde::Deserialize)]
struct Body {
    data: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct MessagePart {
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    body: Option<Body>,
    parts: Option<Vec<MessagePart>>,
}

fn header_value(headers: &[Header], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.clone())
}

fn decode_body_data(data: &str) -> String {
    URL_SAFE_NO_PAD
        .decode(data.trim_end_matches('='))
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(data))
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

fn extract_plain_text(payload: &MessagePayload) -> String {
    if let Some(body) = &payload.body {
        if let Some(data) = &body.data {
            let text = decode_body_data(data);
            if !text.trim().is_empty() {
                return text;
            }
        }
    }
    if let Some(parts) = &payload.parts {
        for part in parts {
            if part.mime_type.as_deref() == Some("text/plain") {
                if let Some(body) = &part.body {
                    if let Some(data) = &body.data {
                        let text = decode_body_data(data);
                        if !text.trim().is_empty() {
                            return text;
                        }
                    }
                }
            }
            if let Some(nested) = &part.parts {
                for n in nested {
                    if n.mime_type.as_deref() == Some("text/plain") {
                        if let Some(body) = &n.body {
                            if let Some(data) = &body.data {
                                let text = decode_body_data(data);
                                if !text.trim().is_empty() {
                                    return text;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    String::new()
}

fn format_email(msg: &GmailMessage) -> (String, String, i64) {
    let headers = msg
        .payload
        .as_ref()
        .and_then(|p| p.headers.as_ref())
        .cloned()
        .unwrap_or_default();
    let subject = header_value(&headers, "Subject").unwrap_or_else(|| "(no subject)".into());
    let from = header_value(&headers, "From").unwrap_or_else(|| "unknown".into());
    let date = header_value(&headers, "Date").unwrap_or_default();
    let mut body = msg
        .payload
        .as_ref()
        .map(extract_plain_text)
        .unwrap_or_default();
    if body.trim().is_empty() {
        body = msg.snippet.clone().unwrap_or_default();
    }
    if body.len() > 8_000 {
        body = format!("{}…", &body[..8_000]);
    }
    let text = format!("From: {from}\nDate: {date}\nSubject: {subject}\n\n{body}");
    let captured = msg
        .internal_date
        .as_ref()
        .and_then(|s| s.parse::<i64>().ok())
        .map(|ms| ms / 1000)
        .unwrap_or_else(now_secs);
    (subject, text, captured)
}

/// Fetch recent Gmail messages and insert new ones into context_chunks.
pub async fn sync_now(app: &AppHandle) -> Result<GmailSyncResult, String> {
    let token = match get_valid_access_token(app, PROVIDER_GMAIL).await {
        Ok(t) => t,
        Err(e) => {
            let _ = write_sync_state(app, "error", Some(&e), 0).await;
            return Err(e);
        }
    };

    let client = reqwest::Client::new();
    let list_url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults={MAX_MESSAGES}&q=newer_than:{NEWER_THAN_DAYS}d"
    );

    let list_resp = client
        .get(&list_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Gmail list request failed: {e}"))?;

    if !list_resp.status().is_success() {
        let status = list_resp.status();
        let body = list_resp.text().await.unwrap_or_default();
        let err = format!("Gmail list HTTP {status}: {body}");
        let _ = write_sync_state(app, "error", Some(&err), 0).await;
        return Err(err);
    }

    let listed: ListMessagesResponse = list_resp
        .json()
        .await
        .map_err(|e| format!("Gmail list parse: {e}"))?;

    let refs = listed.messages.unwrap_or_default();
    let db = ContextDb::open(app).await?;
    let mut synced: i64 = 0;
    let mut skipped: i64 = 0;

    for msg_ref in refs.iter().take(MAX_MESSAGES) {
        let url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=full",
            msg_ref.id
        );
        let msg_resp = match client.get(&url).bearer_auth(&token).send().await {
            Ok(r) => r,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        if !msg_resp.status().is_success() {
            skipped += 1;
            continue;
        }

        let msg: GmailMessage = match msg_resp.json().await {
            Ok(m) => m,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        let (subject, text, captured_at) = format_email(&msg);
        let content_hash = hash_hex(&format!("gmail:{}:{}", msg.id, &text));
        match db
            .insert_chunk(
                "gmail",
                &subject,
                "email",
                &text,
                &content_hash,
                captured_at,
                Some(&format!("gmail://message/{}", msg.id)),
            )
            .await
        {
            Ok(true) => synced += 1,
            Ok(false) => skipped += 1,
            Err(e) => {
                log::warn!("[GmailIngest] insert failed: {e}");
                skipped += 1;
            }
        }
    }

    let status = write_sync_state(app, "ok", None, synced).await?;
    log::info!("[GmailIngest] synced={synced} skipped={skipped}");
    Ok(GmailSyncResult {
        synced,
        skipped,
        status,
    })
}
