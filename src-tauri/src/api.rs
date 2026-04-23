use futures_util::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::env;
use tauri::{AppHandle, Emitter};

/// Load an environment variable, returning a friendly error if missing.
fn env_var(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("Missing env var: {} — check .env file", key))
}

// ─── Streaming AI Proxy ───────────────────────────────────────────────────────
// API keys NEVER leave the Rust process. The frontend sends message content;
// Rust authenticates, proxies the HTTP request, and emits SSE chunks back as
// Tauri events. This prevents key exposure in DevTools / memory dumps.

/// Event emitted for each streamed text chunk.
#[derive(Serialize, Clone)]
struct AiChunk {
    request_id: String,
    content: String,
}

/// Event emitted when the stream is complete.
#[derive(Serialize, Clone)]
struct AiStreamDone {
    request_id: String,
}

/// Event emitted on error.
#[derive(Serialize, Clone)]
struct AiStreamError {
    request_id: String,
    error: String,
}

/// Models routed to NVIDIA NIM instead of OpenRouter.
const NVIDIA_NIM_MODELS: &[&str] = &[
    "meta/llama-3.2-11b-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct",
    "google/gemma-4-31b-it",
    "meta/llama-4-scout-17b-16e-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "mistralai/mistral-small-3.1-24b-instruct",
];

/// Stream an AI response from the selected model provider.
///
/// The frontend sends `messages` + `system_prompt`; this command:
///   1. Reads the API key from environment variables (never sent to frontend).
///   2. Builds and sends the HTTP POST to the provider with auth headers.
///   3. Parses the SSE stream and emits chunks as Tauri events:
///      - `ai-chunk-{request_id}` — each text chunk as it arrives
///      - `ai-done-{request_id}`  — stream finished successfully
///      - `ai-error-{request_id}` — provider or network error (user-safe message)
#[tauri::command]
pub async fn stream_ai_request(
    app: AppHandle,
    model_id: Option<String>,
    messages: Vec<serde_json::Value>,
    system_prompt: String,
    images: Option<Vec<String>>,
    request_id: String,
) -> Result<(), String> {
    let default_model = env::var("OPENROUTER_MODEL")
        .unwrap_or_else(|_| "meta/llama-4-scout-17b-16e-instruct".to_string());
    let model = model_id.filter(|s| !s.is_empty()).unwrap_or(default_model);

    // Build the full messages array: system prompt first, then conversation
    let mut full_messages: Vec<serde_json::Value> = Vec::new();
    if !system_prompt.is_empty() {
        full_messages.push(serde_json::json!({
            "role": "system",
            "content": system_prompt
        }));
    }

    // Inject images into the last user message when present
    if let Some(ref imgs) = images {
        if !imgs.is_empty() {
            let n = messages.len();
            for (i, msg) in messages.iter().enumerate() {
                let is_last_user = i == n - 1
                    && msg.get("role").and_then(|r| r.as_str()) == Some("user");
                if is_last_user {
                    let text = msg
                        .get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();
                    let mut parts = vec![serde_json::json!({"type":"text","text":text})];
                    for img in imgs {
                        parts.push(serde_json::json!({
                            "type": "image_url",
                            "image_url": { "url": img }
                        }));
                    }
                    full_messages.push(serde_json::json!({"role":"user","content":parts}));
                } else {
                    full_messages.push(msg.clone());
                }
            }
        } else {
            full_messages.extend(messages.iter().cloned());
        }
    } else {
        full_messages.extend(messages.iter().cloned());
    }

    // Route to the correct provider and load API key from env (never from frontend)
    let is_nvidia = NVIDIA_NIM_MODELS.contains(&model.as_str());
    let (api_key, url, max_tokens, extra_headers): (String, &str, usize, Vec<(&str, &str)>) =
        if is_nvidia {
            let key = env_var("NVIDIA_API_KEY")?;
            (
                key,
                "https://integrate.api.nvidia.com/v1/chat/completions",
                16384,
                vec![("Accept", "text/event-stream")],
            )
        } else {
            let key = env_var("OPENROUTER_API_KEY")?;
            (
                key,
                "https://openrouter.ai/api/v1/chat/completions",
                4096,
                vec![("HTTP-Referer", "https://torvi.com"), ("X-Title", "Torvi")],
            )
        };

    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "max_tokens": max_tokens,
        "messages": full_messages,
    });

    let client = Client::new();
    let mut builder = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body);
    for (k, v) in extra_headers {
        builder = builder.header(k, v);
    }

    let response = match builder.send().await {
        Ok(r) => r,
        Err(_) => {
            let _ = app.emit(
                &format!("ai-error-{}", request_id),
                AiStreamError {
                    request_id: request_id.clone(),
                    error: "Network error. Check your connection.".to_string(),
                },
            );
            return Ok(());
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let user_msg = match status {
            401 | 403 => "Authentication error. Please contact support.",
            429 => "Rate limited. Please wait a moment and try again.",
            500..=599 => "AI provider server error. Try again later.",
            _ => "Request failed. Please try again.",
        };
        let _ = app.emit(
            &format!("ai-error-{}", request_id),
            AiStreamError {
                request_id: request_id.clone(),
                error: user_msg.to_string(),
            },
        );
        return Ok(());
    }

    // Parse SSE stream and emit each chunk as a Tauri event
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    'outer: while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(_) => {
                let _ = app.emit(
                    &format!("ai-error-{}", request_id),
                    AiStreamError {
                        request_id: request_id.clone(),
                        error: "Stream interrupted. Try again.".to_string(),
                    },
                );
                return Ok(());
            }
        };

        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
                continue;
            }
            if line == "data: [DONE]" || line == "data:[DONE]" {
                let _ = app.emit(
                    &format!("ai-done-{}", request_id),
                    AiStreamDone {
                        request_id: request_id.clone(),
                    },
                );
                break 'outer;
            }
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() {
                    continue;
                }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        if !content.is_empty() {
                            let _ = app.emit(
                                &format!("ai-chunk-{}", request_id),
                                AiChunk {
                                    request_id: request_id.clone(),
                                    content: content.to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    // Emit done even if the stream ended without an explicit [DONE] signal
    let _ = app.emit(
        &format!("ai-done-{}", request_id),
        AiStreamDone { request_id },
    );

    Ok(())
}
