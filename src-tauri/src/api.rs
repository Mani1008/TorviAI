use serde::{Deserialize, Serialize};
use std::env;

/// Load an environment variable, returning a friendly error if missing.
fn env_var(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("Missing env var: {} — check .env file", key))
}

// ─── AI Configuration ────────────────────────────────────────────────────────
// Returns the config the frontend needs for streaming AI calls.
// The frontend still makes the HTTP call (for SSE streaming) but gets
// URL + headers + body template from Rust so keys stay server-side.

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfig {
    pub url: String,
    pub method: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body_template: String,
    pub streaming: bool,
    pub response_content_path: String,
}

/// Return the AI provider configuration (URL, auth headers, body template).
/// The frontend uses this to make the streaming HTTP call.
#[tauri::command]
pub async fn get_ai_config() -> Result<AiConfig, String> {
    let api_key = env_var("OPENROUTER_API_KEY")?;
    let model = env::var("OPENROUTER_MODEL")
        .unwrap_or_else(|_| "nvidia/nemotron-3-super-120b-a12b:free".to_string());

    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Authorization".to_string(), format!("Bearer {}", api_key));
    headers.insert("HTTP-Referer".to_string(), "https://pluely.com".to_string());
    headers.insert("X-Title".to_string(), "Pluely".to_string());

    // Body template — OpenAI-compatible format.
    // System prompt goes inside the messages array (first element).
    // {{MESSAGES_JSON}} is replaced by the frontend with the full messages array
    // (already including the system message).
    let body_template = serde_json::json!({
        "model": model,
        "stream": true,
        "max_tokens": 4096,
        "messages": "{{MESSAGES_JSON}}"
    })
    .to_string();

    Ok(AiConfig {
        url: "https://openrouter.ai/api/v1/chat/completions".to_string(),
        method: "POST".to_string(),
        headers,
        body_template,
        streaming: true,
        response_content_path: "choices[0].delta.content".to_string(),
    })
}

/// Check if the user has an active license.
///
/// TODO: Implement license validation against backend.
#[tauri::command]
pub async fn check_license_status() -> Result<bool, String> {
    println!("[API] check_license_status");
    Ok(false)
}
