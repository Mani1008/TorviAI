//! DPAPI-encrypted integration token storage (local SQLite only).
//!
//! Never log plaintext tokens. Blobs are opaque ciphertext tied to the
//! Windows user account via `CryptProtectData` / `CryptUnprotectData`.

use sqlx::Row;
use tauri::AppHandle;
use uuid::Uuid;

use crate::context_db::ContextDb;
use crate::integrations::{
    IntegrationDto, IntegrationRecord, STATUS_CONNECTED,
};

// ─── DPAPI ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn encrypt_token(plain: &str) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    let mut input_bytes = plain.as_bytes().to_vec();
    let data_in = CRYPT_INTEGER_BLOB {
        cbData: input_bytes.len() as u32,
        pbData: input_bytes.as_mut_ptr(),
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let desc: Vec<u16> = "TorviIntegrations\0".encode_utf16().collect();

    unsafe {
        CryptProtectData(
            &data_in,
            PCWSTR(desc.as_ptr()),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut data_out,
        )
        .map_err(|e| format!("CryptProtectData failed: {e}"))?;

        if data_out.pbData.is_null() || data_out.cbData == 0 {
            return Err("CryptProtectData returned empty blob".into());
        }

        let cipher =
            std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(data_out.pbData as *mut _));
        for b in &mut input_bytes {
            *b = 0;
        }
        Ok(cipher)
    }
}

#[cfg(target_os = "windows")]
pub fn decrypt_token(cipher: &[u8]) -> Result<String, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    if cipher.is_empty() {
        return Err("Empty ciphertext".into());
    }

    let mut input_bytes = cipher.to_vec();
    let data_in = CRYPT_INTEGER_BLOB {
        cbData: input_bytes.len() as u32,
        pbData: input_bytes.as_mut_ptr(),
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(
            &data_in,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut data_out,
        )
        .map_err(|e| format!("CryptUnprotectData failed: {e}"))?;

        if data_out.pbData.is_null() || data_out.cbData == 0 {
            return Err("CryptUnprotectData returned empty blob".into());
        }

        let plain_bytes =
            std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(data_out.pbData as *mut _));

        String::from_utf8(plain_bytes).map_err(|e| format!("Token UTF-8 decode failed: {e}"))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn encrypt_token(plain: &str) -> Result<Vec<u8>, String> {
    // Non-Windows builds store opaque base64 — not for production desktop.
    Ok(plain.as_bytes().to_vec())
}

#[cfg(not(target_os = "windows"))]
pub fn decrypt_token(cipher: &[u8]) -> Result<String, String> {
    String::from_utf8(cipher.to_vec()).map_err(|e| e.to_string())
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/// Plaintext tokens for upsert — encrypted before write.
pub struct SaveIntegrationInput {
    pub provider: String,
    pub account_email: Option<String>,
    pub scopes: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub status: String,
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row_to_record(row: &sqlx::sqlite::SqliteRow) -> Result<IntegrationRecord, String> {
    Ok(IntegrationRecord {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        provider: row.try_get("provider").map_err(|e| e.to_string())?,
        account_email: row.try_get("account_email").map_err(|e| e.to_string())?,
        scopes: row.try_get("scopes").map_err(|e| e.to_string())?,
        access_token: row.try_get("access_token").map_err(|e| e.to_string())?,
        refresh_token: row.try_get("refresh_token").map_err(|e| e.to_string())?,
        token_expires_at: row.try_get("token_expires_at").map_err(|e| e.to_string())?,
        status: row.try_get("status").map_err(|e| e.to_string())?,
        connected_at: row.try_get("connected_at").map_err(|e| e.to_string())?,
        updated_at: row.try_get("updated_at").map_err(|e| e.to_string())?,
    })
}

/// Upsert by `provider` (one connection per provider). Re-connect overwrites tokens.
pub async fn save_integration(
    app: &AppHandle,
    input: SaveIntegrationInput,
) -> Result<IntegrationDto, String> {
    let provider = input.provider.trim().to_lowercase();
    if provider.is_empty() {
        return Err("provider is required".into());
    }

    let access_cipher = encrypt_token(&input.access_token)?;
    let refresh_cipher = match &input.refresh_token {
        Some(t) if !t.is_empty() => Some(encrypt_token(t)?),
        _ => None,
    };

    let status = if input.status.trim().is_empty() {
        STATUS_CONNECTED.to_string()
    } else {
        input.status
    };

    let db = ContextDb::open(app).await?;
    let pool = db.pool();
    let updated_at = now_secs();

    // Keep original connected_at / id when updating an existing row
    let existing = sqlx::query(
        "SELECT id, connected_at FROM integrations WHERE provider = ? LIMIT 1",
    )
    .bind(&provider)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("integrations lookup: {e}"))?;

    let (id, connected_at) = if let Some(row) = existing {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        let connected_at: i64 = row.try_get("connected_at").map_err(|e| e.to_string())?;
        (id, connected_at)
    } else {
        (Uuid::new_v4().to_string(), updated_at)
    };

    sqlx::query(
        "INSERT INTO integrations (
            id, provider, account_email, scopes,
            access_token, refresh_token, token_expires_at,
            status, connected_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
            account_email    = excluded.account_email,
            scopes           = excluded.scopes,
            access_token     = excluded.access_token,
            refresh_token    = excluded.refresh_token,
            token_expires_at = excluded.token_expires_at,
            status           = excluded.status,
            updated_at       = excluded.updated_at",
    )
    .bind(&id)
    .bind(&provider)
    .bind(&input.account_email)
    .bind(&input.scopes)
    .bind(&access_cipher)
    .bind(&refresh_cipher)
    .bind(input.token_expires_at)
    .bind(&status)
    .bind(connected_at)
    .bind(updated_at)
    .execute(pool)
    .await
    .map_err(|e| format!("integrations upsert: {e}"))?;

    log::info!(
        "[Integrations] Saved provider={provider} status={status} (tokens encrypted)"
    );

    Ok(IntegrationDto {
        id,
        provider,
        account_email: input.account_email,
        status,
        connected_at,
        updated_at,
    })
}

pub async fn get_integration(
    app: &AppHandle,
    provider: &str,
) -> Result<Option<IntegrationRecord>, String> {
    let provider = provider.trim().to_lowercase();
    let db = ContextDb::open(app).await?;
    let row = sqlx::query(
        "SELECT id, provider, account_email, scopes, access_token, refresh_token,
                token_expires_at, status, connected_at, updated_at
         FROM integrations WHERE provider = ? LIMIT 1",
    )
    .bind(&provider)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| format!("integrations get: {e}"))?;

    row.map(|r| row_to_record(&r)).transpose()
}

pub async fn list_integrations(app: &AppHandle) -> Result<Vec<IntegrationDto>, String> {
    let db = ContextDb::open(app).await?;
    let rows = sqlx::query(
        "SELECT id, provider, account_email, status, connected_at, updated_at
         FROM integrations
         ORDER BY connected_at ASC",
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("integrations list: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(IntegrationDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            provider: row.try_get("provider").map_err(|e| e.to_string())?,
            account_email: row.try_get("account_email").map_err(|e| e.to_string())?,
            status: row.try_get("status").map_err(|e| e.to_string())?,
            connected_at: row.try_get("connected_at").map_err(|e| e.to_string())?,
            updated_at: row.try_get("updated_at").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

pub async fn delete_integration(app: &AppHandle, provider: &str) -> Result<bool, String> {
    let provider = provider.trim().to_lowercase();
    let db = ContextDb::open(app).await?;
    let result = sqlx::query("DELETE FROM integrations WHERE provider = ?")
        .bind(&provider)
        .execute(db.pool())
        .await
        .map_err(|e| format!("integrations delete: {e}"))?;

    let deleted = result.rows_affected() > 0;
    if deleted {
        log::info!("[Integrations] Deleted provider={provider}");
    }
    Ok(deleted)
}

/// Decrypt access token for API use (never send to frontend).
pub fn plaintext_access_token(record: &IntegrationRecord) -> Result<String, String> {
    decrypt_token(&record.access_token)
}

/// Decrypt refresh token when present.
pub fn plaintext_refresh_token(record: &IntegrationRecord) -> Result<Option<String>, String> {
    match &record.refresh_token {
        Some(blob) if !blob.is_empty() => Ok(Some(decrypt_token(blob)?)),
        _ => Ok(None),
    }
}

/// Update status only (e.g. mark expired after failed refresh).
pub async fn set_integration_status(
    app: &AppHandle,
    provider: &str,
    status: &str,
) -> Result<(), String> {
    let provider = provider.trim().to_lowercase();
    let db = ContextDb::open(app).await?;
    let updated_at = now_secs();
    sqlx::query(
        "UPDATE integrations SET status = ?, updated_at = ? WHERE provider = ?",
    )
    .bind(status)
    .bind(updated_at)
    .bind(&provider)
    .execute(db.pool())
    .await
    .map_err(|e| format!("integrations status update: {e}"))?;
    log::info!("[Integrations] provider={provider} status → {status}");
    Ok(())
}

/// Update tokens after a successful refresh (keeps existing refresh_token if `None`).
pub async fn update_tokens(
    app: &AppHandle,
    provider: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    token_expires_at: Option<i64>,
) -> Result<(), String> {
    let provider = provider.trim().to_lowercase();
    let access_cipher = encrypt_token(access_token)?;
    let updated_at = now_secs();
    let db = ContextDb::open(app).await?;

    if let Some(refresh) = refresh_token.filter(|t| !t.is_empty()) {
        let refresh_cipher = encrypt_token(refresh)?;
        sqlx::query(
            "UPDATE integrations SET
                access_token = ?, refresh_token = ?, token_expires_at = ?,
                status = ?, updated_at = ?
             WHERE provider = ?",
        )
        .bind(&access_cipher)
        .bind(&refresh_cipher)
        .bind(token_expires_at)
        .bind(STATUS_CONNECTED)
        .bind(updated_at)
        .bind(&provider)
        .execute(db.pool())
        .await
        .map_err(|e| format!("integrations token update: {e}"))?;
    } else {
        sqlx::query(
            "UPDATE integrations SET
                access_token = ?, token_expires_at = ?,
                status = ?, updated_at = ?
             WHERE provider = ?",
        )
        .bind(&access_cipher)
        .bind(token_expires_at)
        .bind(STATUS_CONNECTED)
        .bind(updated_at)
        .bind(&provider)
        .execute(db.pool())
        .await
        .map_err(|e| format!("integrations token update: {e}"))?;
    }

    log::info!("[Integrations] Tokens refreshed for provider={provider}");
    Ok(())
}

/// Full rows for refresh / API use (tokens stay in Rust).
pub async fn list_integration_records(
    app: &AppHandle,
) -> Result<Vec<IntegrationRecord>, String> {
    let db = ContextDb::open(app).await?;
    let rows = sqlx::query(
        "SELECT id, provider, account_email, scopes, access_token, refresh_token,
                token_expires_at, status, connected_at, updated_at
         FROM integrations
         ORDER BY connected_at ASC",
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| format!("integrations list records: {e}"))?;

    rows.iter().map(row_to_record).collect()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip() {
        let plain = "ya29.test-access-token-not-real";
        let cipher = encrypt_token(plain).expect("encrypt");
        assert_ne!(cipher, plain.as_bytes());
        let back = decrypt_token(&cipher).expect("decrypt");
        assert_eq!(back, plain);
    }
}
