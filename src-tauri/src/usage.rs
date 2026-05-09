/// usage.rs — Server-side usage tracking via Appwrite REST API.
///
/// WHY THIS EXISTS (SECURITY-01):
/// Storing rate-limit counters in a collection that users have write access to
/// lets any authenticated user call the Appwrite REST API directly and reset
/// their own counters to any value.
/// By routing all writes through this Rust module — which uses the server-side
/// APPWRITE_API_KEY (never exposed to JS) — users have no write path to their
/// own usage counters.
///
/// STORAGE MODEL: we store *used* counts (0 → N), not *remaining*.
/// This is more readable in the Appwrite Console ("used 3133 s") and avoids
/// clamping confusion when a user exceeds their limit.
/// Appwrite column config: aiResponsesUsed (max 600), listeningSecondsUsed (max 40000).
///
/// The `user_usage` Appwrite collection MUST be configured with:
///   - Document Security ON (Settings tab in Appwrite Console)
///   - Collection-level permissions: NONE
///   - Individual documents have Permission.read(Role.user(userId)) only.
///
/// Commands exposed to the frontend:
///   - initialize_user_usage(user_id, plan) — call after sign-in; idempotent
///   - record_usage(user_id, usage_type, amount) — increment per AI / audio use
///   - push_local_usage(user_id, ai_used, listening_used)
///       — startup reconciliation: pushes local counters ONLY if local shows
///         MORE usage than remote (higher used = more consumed).
///         Prevents reset-on-restart without giving the client free increments.

use reqwest::Client;
use serde_json::json;
use std::env;

// ─── Helpers ──────────────────────────────────────────────────────────────────

struct AppwriteConfig {
    endpoint: String,
    project_id: String,
    database_id: String,
    api_key: String,
    collection_id: String,
}

fn load_appwrite_config() -> Result<AppwriteConfig, String> {
    let endpoint = env::var("VITE_APPWRITE_ENDPOINT")
        .unwrap_or_else(|_| "https://cloud.appwrite.io/v1".to_string());
    let project_id = env::var("VITE_APPWRITE_PROJECT_ID")
        .unwrap_or_default();
    let database_id = env::var("VITE_APPWRITE_DATABASE_ID")
        .unwrap_or_default();
    let api_key = env::var("APPWRITE_API_SECRET")
        .unwrap_or_default();
    let collection_id = env::var("VITE_APPWRITE_COLLECTION_USER_USAGE")
        .unwrap_or_default();

    if api_key.is_empty() || collection_id.is_empty() {
        return Err("Appwrite usage collection not configured (APPWRITE_API_SECRET / VITE_APPWRITE_COLLECTION_USER_USAGE missing)".to_string());
    }

    Ok(AppwriteConfig {
        endpoint: endpoint.trim_end_matches('/').to_string(),
        project_id,
        database_id,
        api_key,
        collection_id,
    })
}

fn doc_url(cfg: &AppwriteConfig, user_id: &str) -> String {
    format!(
        "{}/databases/{}/collections/{}/documents/{}",
        cfg.endpoint, cfg.database_id, cfg.collection_id, user_id
    )
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Create the user_usage document on first sign-in using the server API key.
///
/// Values are initialised to the plan's maximum. If the document already exists
/// (idempotent re-sign-in) the call is a no-op — it does NOT reset counters.
#[tauri::command]
pub async fn initialize_user_usage(user_id: String, plan: String) -> Result<(), String> {
    let cfg = match load_appwrite_config() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[Usage] Skipping initialize_user_usage: {}", e);
            return Ok(()); // graceful degradation — counters unavailable but app works
        }
    };

    // All plans start at 0 — we track how much has been used, not how much remains.
    // Limit enforcement is done client-side via PLAN_LIMITS in constants.ts.
    let read_perm = format!("read(\"user:{}\")", user_id);
    let _ = plan; // plan reserved for future server-side enforcement

    let body = json!({
        "documentId": user_id,
        "data": {
            "aiResponsesUsed": 0,
            "listeningSecondsUsed": 0,
        },
        "permissions": [read_perm]
    });

    let url = format!(
        "{}/databases/{}/collections/{}/documents",
        cfg.endpoint, cfg.database_id, cfg.collection_id
    );

    let resp = Client::new()
        .post(&url)
        .header("X-Appwrite-Project", &cfg.project_id)
        .header("X-Appwrite-Key", &cfg.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    let status = resp.status();
    if status.as_u16() == 409 {
        // Document already exists — not an error, usage is preserved
        return Ok(());
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Appwrite create failed {}: {}", status, body));
    }

    log::info!("[Usage] Initialized user_usage for {}", user_id);
    Ok(())
}

/// Record a unit of usage in Appwrite — increments the used counter.
///
/// `usage_type`: `"ai_response"` | `"listening_seconds"`
/// `amount`: how many units to add (default 1)
///
/// Returns the new used count, or -1 if the service is unavailable.
#[tauri::command]
pub async fn record_usage(
    user_id: String,
    usage_type: String,
    amount: Option<i64>,
) -> Result<i64, String> {
    let cfg = match load_appwrite_config() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[Usage] Skipping record_usage: {}", e);
            return Ok(-1);
        }
    };

    let field_name = match usage_type.as_str() {
        "ai_response"       => "aiResponsesUsed",
        "listening_seconds" => "listeningSecondsUsed",
        other => return Err(format!("Unknown usage_type: {}", other)),
    };

    let url = doc_url(&cfg, &user_id);
    let client = Client::new();

    // Read current value
    let get_resp = client
        .get(&url)
        .header("X-Appwrite-Project", &cfg.project_id)
        .header("X-Appwrite-Key", &cfg.api_key)
        .send()
        .await
        .map_err(|e| format!("GET failed: {}", e))?;

    if !get_resp.status().is_success() {
        return Err(format!("Appwrite GET failed: {}", get_resp.status()));
    }

    let doc: serde_json::Value = get_resp.json().await.map_err(|e| e.to_string())?;
    let current = doc.get(field_name).and_then(|v| v.as_i64()).unwrap_or(0);
    let delta = amount.unwrap_or(1);
    let next = current + delta;

    // Write new value (API key bypasses document-level read-only for user)
    let patch_resp = client
        .patch(&url)
        .header("X-Appwrite-Project", &cfg.project_id)
        .header("X-Appwrite-Key", &cfg.api_key)
        .json(&json!({ "data": { field_name: next } }))
        .send()
        .await
        .map_err(|e| format!("PATCH failed: {}", e))?;

    if !patch_resp.status().is_success() {
        let status = patch_resp.status();
        let body = patch_resp.text().await.unwrap_or_default();
        return Err(format!("Appwrite PATCH failed {}: {}", status, body));
    }

    log::debug!("[Usage] Recorded {} for {}: {} → {}", field_name, user_id, current, next);
    Ok(next)
}

/// Push locally-accumulated usage counters to Appwrite at startup.
///
/// ONE-WAY ratchet: Appwrite values are only updated if the supplied
/// used count is HIGHER than what Appwrite currently has (i.e. the user has
/// consumed more locally than Appwrite knows about). This prevents a malicious
/// client from calling this endpoint to inflate their usage quota.
#[tauri::command]
pub async fn push_local_usage(
    user_id: String,
    ai_used: i64,
    listening_used: i64,
) -> Result<(), String> {
    let cfg = match load_appwrite_config() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[Usage] Skipping push_local_usage: {}", e);
            return Ok(());
        }
    };

    let url = doc_url(&cfg, &user_id);
    let client = Client::new();

    // Read current remote values
    let get_resp = client
        .get(&url)
        .header("X-Appwrite-Project", &cfg.project_id)
        .header("X-Appwrite-Key", &cfg.api_key)
        .send()
        .await
        .map_err(|e| format!("GET failed: {}", e))?;

    if !get_resp.status().is_success() {
        return Err(format!("Appwrite GET failed: {}", get_resp.status()));
    }

    let doc: serde_json::Value = get_resp.json().await.map_err(|e| e.to_string())?;
    let remote_ai   = doc.get("aiResponsesUsed").and_then(|v| v.as_i64()).unwrap_or(0);
    let remote_lstn = doc.get("listeningSecondsUsed").and_then(|v| v.as_i64()).unwrap_or(0);

    // Only update fields where local shows MORE usage (higher used count)
    let mut update: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    if ai_used > remote_ai {
        update.insert("aiResponsesUsed".to_string(), json!(ai_used));
    }
    if listening_used > remote_lstn {
        update.insert("listeningSecondsUsed".to_string(), json!(listening_used));
    }

    if update.is_empty() {
        log::debug!("[Usage] push_local_usage: remote already ahead for {}", user_id);
        return Ok(());
    }

    let patch_resp = client
        .patch(&url)
        .header("X-Appwrite-Project", &cfg.project_id)
        .header("X-Appwrite-Key", &cfg.api_key)
        .json(&json!({ "data": update }))
        .send()
        .await
        .map_err(|e| format!("PATCH failed: {}", e))?;

    if !patch_resp.status().is_success() {
        let status = patch_resp.status();
        let body = patch_resp.text().await.unwrap_or_default();
        return Err(format!("Appwrite PATCH failed {}: {}", status, body));
    }

    log::info!("[Usage] Pushed local usage for {} → AI used: {}, listening used: {}", user_id, ai_used, listening_used);
    Ok(())
}
