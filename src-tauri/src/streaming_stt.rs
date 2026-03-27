//! Real-time STT via AssemblyAI WebSocket streaming.
//!
//! Architecture:
//!   VAD thread (spawn_blocking)
//!     → send_raw_samples() → decimation to PCM16-16kHz → blocking_send
//!     → async WS writer task → AssemblyAI WebSocket (persistent)
//!     → async WS reader task → emits stt-partial / stt-final Tauri events
//!     → auto-reconnect on unexpected WS drop (2s backoff)
//!
//! Note: windows.rs already downmixes multichannel to mono before buffering,
//! so read_samples() always returns mono f32 at the device's native rate.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::client::generate_key;
use tokio_tungstenite::tungstenite::http::Request;
use tokio_tungstenite::tungstenite::Message;

const WS_URL: &str = "wss://streaming.assemblyai.com/v3/ws";
const DST_RATE: u32 = 16_000;

// ─── Channel message type ─────────────────────────────────────────────────────

pub(crate) enum SttMsg {
    /// Raw PCM16 little-endian bytes to send to AssemblyAI.
    Audio(Vec<u8>),
    /// Gracefully terminate the session.
    Terminate,
}

// ─── Managed state ────────────────────────────────────────────────────────────

/// Holds session state. Uses std::sync::Mutex so the VAD blocking thread can lock it.
pub struct StreamingSttState {
    pub sender: Mutex<Option<mpsc::Sender<SttMsg>>>,
    /// True when user explicitly calls close_realtime_stt — suppresses auto-reconnect.
    pub is_terminated: AtomicBool,
    /// Cached API key for reconnect without re-reading env.
    pub api_key: Mutex<Option<String>>,
}

impl Default for StreamingSttState {
    fn default() -> Self {
        Self {
            sender: Mutex::new(None),
            is_terminated: AtomicBool::new(false),
            api_key: Mutex::new(None),
        }
    }
}

// ─── Tauri event payload ──────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct SttTranscript {
    pub text: String,
    pub is_final: bool,
}

// ─── Audio conversion ─────────────────────────────────────────────────────────

/// Convert mono f32 @ src_rate Hz → PCM16 @ 16 kHz (little-endian bytes).
///
/// Uses decimation (take every Nth sample) rather than box-filter averaging.
/// Decimation preserves high-frequency phoneme energy ("t", "k", "s") better,
/// which matters for technical vocabulary in interview transcription.
fn to_pcm16_16k(samples: &[f32], src_rate: u32) -> Vec<u8> {
    if samples.is_empty() {
        return Vec::new();
    }
    if src_rate == DST_RATE {
        return samples
            .iter()
            .flat_map(|&s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
            .collect();
    }
    let ratio = ((src_rate as f32 / DST_RATE as f32).round() as usize).max(1);
    let mut bytes = Vec::with_capacity((samples.len() / ratio) * 2);
    let mut i = 0;
    while i < samples.len() {
        let pcm = (samples[i].clamp(-1.0, 1.0) * 32767.0) as i16;
        bytes.extend_from_slice(&pcm.to_le_bytes());
        i += ratio;
    }
    bytes
}

// ─── Called from VAD blocking thread ─────────────────────────────────────────

/// Forward audio samples to an active AssemblyAI session.
///
/// Must be called from `spawn_blocking` — uses `blocking_send` to apply
/// backpressure rather than silently dropping audio chunks.
pub fn send_raw_samples(samples: &[f32], src_rate: u32, app: &AppHandle) {
    let state = app.state::<StreamingSttState>();
    let maybe_tx = state.sender.lock().unwrap().clone();
    if let Some(tx) = maybe_tx {
        let pcm16 = to_pcm16_16k(samples, src_rate);
        if !pcm16.is_empty() {
            // blocking_send: we're inside spawn_blocking, safe to block.
            // Provides backpressure instead of dropping audio on channel full.
            let _ = tx.blocking_send(SttMsg::Audio(pcm16));
        }
    }
}

// ─── Core connection logic ────────────────────────────────────────────────────

/// Connect to AssemblyAI, spawn writer + reader tasks, return the audio sender.
/// Extracted so both open_realtime_stt and auto-reconnect can reuse it.
async fn establish_session(app: AppHandle, api_key: String) -> Result<mpsc::Sender<SttMsg>, String> {
    let url = format!("{}?sample_rate={}&speech_model=u3-rt-pro", WS_URL, DST_RATE);
    // Must include all WebSocket upgrade headers manually — when passing
    // an http::Request to connect_async, tungstenite does NOT generate them,
    // unlike the URL-string path which calls IntoClientRequest::into_client_request.
    let request = Request::builder()
        .uri(&url)
        .header("Host", "streaming.assemblyai.com")
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Authorization", &api_key)
        .body(())
        .map_err(|e| format!("WS request error: {}", e))?;

    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("AssemblyAI WS connect failed: {}", e))?;

    let (mut ws_sink, mut ws_source) = ws_stream.split();

    // Bounded at 16 slots (≈3.2s at 200ms chunks).
    // blocking_send provides backpressure; receiver drops signal reconnect.
    let (tx, mut rx) = mpsc::channel::<SttMsg>(16);

    // Writer task: channel → WebSocket
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match msg {
                SttMsg::Audio(bytes) => {
                    if ws_sink.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
                SttMsg::Terminate => {
                    let _ = ws_sink
                        .send(Message::Text(
                            r#"{"type":"terminate_session"}"#.to_string(),
                        ))
                        .await;
                    break;
                }
            }
        }
        let _ = ws_sink.close().await;
    });

    // Reader task: WebSocket → Tauri events + auto-reconnect
    let app_reader = app.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_source.next().await {
            if let Message::Text(text) = msg {
                // Log every message for debugging (trimmed to 200 chars)
                println!("[StreamingSTT] Raw: {}", &text[..text.len().min(200)]);

                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    match val.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                        // Session established
                        "Begin" => {
                            println!("[StreamingSTT] Session ready — id: {:?}", val.get("id"));
                        }
                        // Speech onset — no transcript yet, skip
                        "SpeechStarted" => {}
                        // Turn message: partial (end_of_turn=false) or final (end_of_turn=true)
                        // Contains "transcript" field with the text so far
                        "Turn" => {
                            if let Some(t) = val.get("transcript").and_then(|x| x.as_str()) {
                                if !t.is_empty() {
                                    let end_of_turn = val.get("end_of_turn")
                                        .and_then(|x| x.as_bool())
                                        .unwrap_or(false);
                                    if end_of_turn {
                                        println!("[StreamingSTT] Final: {}", &t[..t.len().min(80)]);
                                        let _ = app_reader.emit(
                                            "stt-final",
                                            SttTranscript { text: t.to_string(), is_final: true },
                                        );
                                    } else {
                                        let _ = app_reader.emit(
                                            "stt-partial",
                                            SttTranscript { text: t.to_string(), is_final: false },
                                        );
                                    }
                                }
                            }
                        }
                        "error" => {
                            eprintln!("[StreamingSTT] Server error: {}", text);
                        }
                        other => {
                            println!("[StreamingSTT] Unhandled type '{}': {}", other, &text[..text.len().min(120)]);
                        }
                    }
                }
            }
        }

        println!("[StreamingSTT] WS reader ended");

        // ── Auto-reconnect (unless deliberately terminated) ──────────────────
        let state = app_reader.state::<StreamingSttState>();
        if !state.is_terminated.load(Ordering::SeqCst) {
            // Clear stale sender so send_raw_samples stops sending to a dead channel
            state.sender.lock().unwrap().take();
            // Emit event — frontend will call open_realtime_stt after a 2s delay.
            // This avoids spawning a non-Send future (native-TLS) inside tokio::spawn.
            println!("[StreamingSTT] Unexpected drop — emitting stt-disconnected");
            let _ = app_reader.emit("stt-disconnected", ());
        }
    });

    Ok(tx)
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Open an AssemblyAI real-time streaming session (open once, stream forever).
#[tauri::command]
pub async fn open_realtime_stt(app: AppHandle) -> Result<(), String> {
    let api_key = std::env::var("ASSEMBLYAI_API_KEY")
        .map_err(|_| "Missing ASSEMBLYAI_API_KEY — add it to .env".to_string())?;

    let state = app.state::<StreamingSttState>();
    {
        if state.sender.lock().unwrap().is_some() {
            return Ok(()); // Already open
        }
    }

    // Mark active and cache key for reconnect
    state.is_terminated.store(false, Ordering::SeqCst);
    state.api_key.lock().unwrap().replace(api_key.clone());

    let tx = establish_session(app.clone(), api_key).await?;
    state.sender.lock().unwrap().replace(tx);
    println!("[StreamingSTT] Session opened");
    Ok(())
}

/// Close the active session gracefully (prevents auto-reconnect).
#[tauri::command]
pub async fn close_realtime_stt(app: AppHandle) -> Result<(), String> {
    let state = app.state::<StreamingSttState>();
    // Set terminated BEFORE taking sender so the reader task won't reconnect
    state.is_terminated.store(true, Ordering::SeqCst);
    let maybe_tx = state.sender.lock().unwrap().take();
    if let Some(tx) = maybe_tx {
        let _ = tx.send(SttMsg::Terminate).await;
    }
    println!("[StreamingSTT] Session closed");
    Ok(())
}
