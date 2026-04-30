//! Real-time STT via AssemblyAI WebSocket streaming.
//!
//! Architecture:
//!   VAD thread (spawn_blocking)
//!     → send_raw_samples() → decimation to PCM16-16kHz → blocking_send
//!     → async WS writer task → AssemblyAI WebSocket (persistent)
//!     → async WS reader task → emits stt-partial / stt-final Tauri events
//!     → session-end oneshot → open_realtime_stt reconnect loop (backoff)
//!
//! Note: windows.rs already downmixes multichannel to mono before buffering,
//! so read_samples() always returns mono f32 at the device's native rate.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::handshake::client::generate_key;
use tokio_tungstenite::tungstenite::http::Request;
use tokio_tungstenite::tungstenite::Message;

const WS_URL: &str = "wss://streaming.assemblyai.com/v3/ws";
const DST_RATE: u32 = 16_000;

/// Maximum duration for a single STT session before it is force-stopped.
/// Prevents runaway AssemblyAI billing from a held-open WebSocket.
const MAX_STT_SESSION_SECS: u64 = 600; // 10 minutes

/// Maximum number of automatic reconnect attempts after an unexpected WS drop.
const MAX_RECONNECT_ATTEMPTS: u32 = 3;

/// Base delay for reconnect exponential backoff (doubles each attempt: 1s, 2s, 4s).
const RECONNECT_BASE_MS: u64 = 1_000;

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
    /// Number of consecutive auto-reconnect attempts (reset on explicit open/close).
    pub reconnect_count: std::sync::atomic::AtomicU32,
}

impl Default for StreamingSttState {
    fn default() -> Self {
        Self {
            sender: Mutex::new(None),
            is_terminated: AtomicBool::new(false),
            api_key: Mutex::new(None),
            reconnect_count: std::sync::atomic::AtomicU32::new(0),
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

/// Connect to AssemblyAI, spawn writer + reader tasks, return the audio sender
/// and a oneshot receiver that fires when the WS reader task ends.
/// Reconnect logic lives in open_realtime_stt (not here) to avoid circular Send.
async fn establish_session(
    app: AppHandle,
    api_key: String,
) -> Result<(mpsc::Sender<SttMsg>, oneshot::Receiver<()>), String> {
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

    // Oneshot: reader task fires this when the WS closes (expected or not).
    // open_realtime_stt awaits it to know when to attempt a reconnect.
    let (done_tx, done_rx) = oneshot::channel::<()>();

    // Watchdog: force-close session after MAX_STT_SESSION_SECS to cap billing.
    // Sends Terminate through the audio channel so writer closes WS gracefully.
    let app_wd = app.clone();
    let tx_wd = tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(MAX_STT_SESSION_SECS)).await;
        log::warn!("[StreamingSTT] Session exceeded max duration ({} min) — force-stopping", MAX_STT_SESSION_SECS / 60);
        let state = app_wd.state::<StreamingSttState>();
        state.is_terminated.store(true, Ordering::SeqCst);
        let _ = tx_wd.send(SttMsg::Terminate).await;
        let _ = app_wd.emit("stt-force-stopped", ());
    });

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

    // Reader task: WebSocket → Tauri events.
    // No reconnect logic here — avoids circular Send issue with establish_session.
    // Fires done_tx when the WS closes so the reconnect loop in open_realtime_stt
    // can decide whether to reconnect.
    let app_reader = app.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_source.next().await {
            if let Message::Text(text) = msg {
                // Debug-only: log raw WS message (trimmed to avoid filling logs)
                log::debug!("[StreamingSTT] Raw: {}", &text[..text.len().min(200)]);

                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    match val.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                        // Session established
                        "Begin" => {
                            log::debug!("[StreamingSTT] Session ready");
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
                                        // Transcript is PII — debug level only (silenced in release builds)
                                        log::debug!("[StreamingSTT] Final transcript received");
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
                            log::error!("[StreamingSTT] Server error: {}", text);
                        }
                        other => {
                            log::debug!("[StreamingSTT] Unhandled type '{}'", other);
                        }
                    }
                }
            }
        }

        log::debug!("[StreamingSTT] WS reader ended");
        // Signal the reconnect loop in open_realtime_stt that this session is over.
        let _ = done_tx.send(());
    });

    Ok((tx, done_rx))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Open an AssemblyAI real-time streaming session.
/// Runs a reconnect loop (with exponential backoff) for the lifetime of the session.
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

    // Mark active and reset reconnect counter
    state.is_terminated.store(false, Ordering::SeqCst);
    state.reconnect_count.store(0, Ordering::SeqCst);
    state.api_key.lock().unwrap().replace(api_key.clone());

    // Reconnect loop with exponential backoff (runs for the session lifetime).
    loop {
        let (tx, done_rx) = match establish_session(app.clone(), api_key.clone()).await {
            Ok(pair) => pair,
            Err(e) => {
                log::error!("[StreamingSTT] Failed to establish session: {}", e);
                return Err(e);
            }
        };

        state.sender.lock().unwrap().replace(tx);
        log::info!("[StreamingSTT] Session opened");

        // Block until the WS reader task signals session ended.
        done_rx.await.ok();
        state.sender.lock().unwrap().take();

        // Terminated deliberately (close command or watchdog) — don't reconnect
        if state.is_terminated.load(Ordering::SeqCst) {
            log::info!("[StreamingSTT] Session ended (terminated)");
            break;
        }

        let attempts = state.reconnect_count.fetch_add(1, Ordering::SeqCst);
        if attempts >= MAX_RECONNECT_ATTEMPTS {
            log::warn!("[StreamingSTT] Max reconnect attempts ({}) reached — giving up", MAX_RECONNECT_ATTEMPTS);
            state.reconnect_count.store(0, Ordering::SeqCst);
            let _ = app.emit("stt-disconnected", ());
            break;
        }

        // Exponential backoff: 1s, 2s, 4s
        let delay_ms = RECONNECT_BASE_MS * (1u64 << attempts);
        log::info!("[StreamingSTT] Unexpected WS drop — reconnect attempt {}/{} in {}ms",
            attempts + 1, MAX_RECONNECT_ATTEMPTS, delay_ms);
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
    }

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
    log::info!("[StreamingSTT] Session closed");
    Ok(())
}
