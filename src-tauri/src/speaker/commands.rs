/// Speaker capture commands — VAD engine, continuous capture, encoding pipeline,
/// and all Tauri IPC command handlers.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use super::SpeakerInput;

// ─── VAD Configuration ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub hop_size: usize,
    pub sensitivity_rms: f32,
    pub peak_threshold: f32,
    pub silence_chunks: usize,
    pub min_speech_chunks: usize,
    pub pre_speech_chunks: usize,
    pub noise_gate_threshold: f32,
    pub max_recording_duration_secs: u64,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            hop_size: 1024,
            sensitivity_rms: 0.012,
            peak_threshold: 0.035,
            silence_chunks: 45,
            min_speech_chunks: 7,
            pre_speech_chunks: 12,
            noise_gate_threshold: 0.003,
            max_recording_duration_secs: 180,
        }
    }
}

// ─── Audio Device Info ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub index: usize,
    pub name: String,
    pub is_default: bool,
}

// ─── Managed State ───────────────────────────────────────────────────────────

pub struct SpeakerState {
    /// Whether a VAD/continuous capture is currently running.
    pub is_capturing: AtomicBool,
    /// Signal to stop the capture loop.
    pub stop_signal: AtomicBool,
    /// Current VAD config (live-updatable).
    pub vad_config: Mutex<VadConfig>,
}

impl Default for SpeakerState {
    fn default() -> Self {
        Self {
            is_capturing: AtomicBool::new(false),
            stop_signal: AtomicBool::new(false),
            vad_config: Mutex::new(VadConfig::default()),
        }
    }
}

// ─── Audio Processing Helpers ────────────────────────────────────────────────

/// Soft-knee noise gate. Below threshold → silence, above knee → pass-through,
/// in between → smooth attenuation to avoid click artifacts.
fn apply_noise_gate(samples: &mut [f32], threshold: f32) {
    const KNEE_RATIO: f32 = 3.0;
    let knee_end = threshold * KNEE_RATIO;

    for sample in samples.iter_mut() {
        let abs_val = sample.abs();
        if abs_val < threshold {
            *sample = 0.0;
        } else if abs_val < knee_end {
            let t = (abs_val - threshold) / (knee_end - threshold);
            *sample *= t;
        }
    }
}

fn calc_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

fn calc_peak(samples: &[f32]) -> f32 {
    samples
        .iter()
        .map(|s| s.abs())
        .fold(0.0f32, f32::max)
}

/// Normalize audio to a target RMS level with soft saturation above 1.0.
fn normalize_audio_level(samples: &mut [f32]) {
    let target_rms = 0.1;
    let current_rms = calc_rms(samples);

    if current_rms < 1e-6 {
        return; // Silence — skip
    }

    let gain = (target_rms / current_rms).min(10.0); // Cap at 10× amplification

    for sample in samples.iter_mut() {
        *sample *= gain;
        // Soft saturation above 1.0 (prevents clipping)
        if sample.abs() > 1.0 {
            *sample = sample.signum() * (1.0 - (-sample.abs() + 1.0).exp().ln());
        }
    }
}

/// Trim trailing silence from audio buffer, keeping ~0.15s natural tail.
fn trim_trailing_silence(samples: &mut Vec<f32>, sample_rate: u32) {
    let tail_samples = (0.15 * sample_rate as f64) as usize;
    let threshold = 0.005f32;

    // Find last sample above threshold
    let mut last_non_silent = samples.len();
    for (i, &s) in samples.iter().enumerate().rev() {
        if s.abs() > threshold {
            last_non_silent = i;
            break;
        }
    }

    let keep_until = (last_non_silent + tail_samples).min(samples.len());
    samples.truncate(keep_until);
}

/// Encode f32 samples as 16-bit mono WAV → base64 string.
fn samples_to_wav_b64(samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer =
        hound::WavWriter::new(&mut cursor, spec).map_err(|e| format!("WAV init: {}", e))?;

    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        writer
            .write_sample((clamped * 32767.0) as i16)
            .map_err(|e| format!("WAV write: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("WAV finalize: {}", e))?;
    Ok(BASE64.encode(cursor.into_inner()))
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

/// Start VAD-based system audio capture.
/// Spawns an async task that reads from the platform speaker, runs VAD,
/// and emits `speech-detected` events with base64-encoded WAV payloads.
#[tauri::command]
pub async fn start_vad_capture(
    app: AppHandle,
    config: VadConfig,
    device_index: Option<usize>,
) -> Result<(), String> {
    let state = app.state::<SpeakerState>();

    if state.is_capturing.load(Ordering::SeqCst) {
        return Err("Audio capture already running".to_string());
    }

    // Update stored VAD config
    {
        let mut cfg = state.vad_config.lock().unwrap();
        *cfg = config.clone();
    }

    state.stop_signal.store(false, Ordering::SeqCst);
    state.is_capturing.store(true, Ordering::SeqCst);

    // Create the platform speaker stream
    let speaker = super::create_speaker_stream(device_index)?;

    let app_handle = app.clone();
    app.emit("capture-started", ()).ok();

    // Spawn the VAD capture loop on a blocking thread (speaker I/O is blocking)
    tokio::task::spawn_blocking(move || {
        if let Err(e) = vad_capture_loop(speaker, config, &app_handle) {
            eprintln!("[Speaker/VAD] Error: {}", e);
            app_handle
                .emit("audio-encoding-error", e.to_string())
                .ok();
        }
        let state = app_handle.state::<SpeakerState>();
        state.is_capturing.store(false, Ordering::SeqCst);
        app_handle.emit("capture-stopped", ()).ok();
    });

    Ok(())
}

/// Stop any active VAD capture.
#[tauri::command]
pub async fn stop_vad_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SpeakerState>();
    state.stop_signal.store(true, Ordering::SeqCst);
    Ok(())
}

/// Start continuous recording mode (manual start/stop, no VAD).
#[tauri::command]
pub async fn start_continuous_capture(
    app: AppHandle,
    device_index: Option<usize>,
) -> Result<(), String> {
    let state = app.state::<SpeakerState>();

    if state.is_capturing.load(Ordering::SeqCst) {
        return Err("Audio capture already running".to_string());
    }

    state.stop_signal.store(false, Ordering::SeqCst);
    state.is_capturing.store(true, Ordering::SeqCst);

    let speaker = super::create_speaker_stream(device_index)?;
    let config = state.vad_config.lock().unwrap().clone();

    let app_handle = app.clone();
    app.emit("capture-started", ()).ok();

    tokio::task::spawn_blocking(move || {
        if let Err(e) = continuous_capture_loop(speaker, &config, &app_handle) {
            eprintln!("[Speaker/Continuous] Error: {}", e);
            app_handle
                .emit("audio-encoding-error", e.to_string())
                .ok();
        }
        let state = app_handle.state::<SpeakerState>();
        state.is_capturing.store(false, Ordering::SeqCst);
        app_handle.emit("capture-stopped", ()).ok();
    });

    Ok(())
}

/// Stop continuous recording and process the buffer.
#[tauri::command]
pub async fn stop_continuous_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SpeakerState>();
    state.stop_signal.store(true, Ordering::SeqCst);
    Ok(())
}

/// Live-update VAD configuration without restarting capture.
#[tauri::command]
pub async fn update_vad_config(app: AppHandle, config: VadConfig) -> Result<(), String> {
    let state = app.state::<SpeakerState>();
    {
        let mut cfg = state.vad_config.lock().unwrap();
        *cfg = config.clone();
    }
    app.emit("vad-config-updated", &config).ok();
    Ok(())
}

/// Retrieve the current VAD configuration.
#[tauri::command]
pub async fn get_vad_config(app: AppHandle) -> Result<VadConfig, String> {
    let state = app.state::<SpeakerState>();
    let cfg = state.vad_config.lock().unwrap().clone();
    Ok(cfg)
}

/// List available audio output devices.
#[tauri::command]
pub async fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    #[cfg(target_os = "windows")]
    {
        let hr = wasapi::initialize_mta();
        if hr.is_err() {
            return Err(format!("COM init failed: {:?}", hr));
        }

        let collection = wasapi::DeviceCollection::new(&wasapi::Direction::Render)
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

        let default_device = wasapi::get_default_device(&wasapi::Direction::Render)
            .ok()
            .and_then(|d| d.get_id().ok());

        let count = collection
            .get_nbr_devices()
            .map_err(|e| format!("Device count: {}", e))?;

        let mut devices = Vec::new();
        for i in 0..count {
            if let Ok(dev) = collection.get_device_at_index(i) {
                let name = dev
                    .get_friendlyname()
                    .unwrap_or_else(|_| format!("Device {}", i));
                let dev_id = dev.get_id().ok();
                let is_default = match (&dev_id, &default_device) {
                    (Some(a), Some(b)) => a == b,
                    _ => false,
                };
                devices.push(AudioDevice {
                    index: i as usize,
                    name,
                    is_default,
                });
            }
        }

        Ok(devices)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

/// Check if the app has audio capture permission.
#[tauri::command]
pub async fn check_audio_permissions() -> Result<bool, String> {
    // On Windows, WASAPI loopback doesn't require special permissions
    Ok(true)
}

/// Request OS-level audio permissions.
#[tauri::command]
pub async fn request_audio_permissions() -> Result<bool, String> {
    // On Windows, no permission prompt needed
    Ok(true)
}

// ─── VAD Capture Loop ────────────────────────────────────────────────────────

fn vad_capture_loop(
    mut speaker: super::SpeakerStream,
    config: VadConfig,
    app: &AppHandle,
) -> Result<(), String> {
    let state = app.state::<SpeakerState>();
    let sample_rate = speaker.sample_rate();

    let mut speech_buffer: Vec<f32> = Vec::new();
    let mut pre_speech: VecDeque<f32> = VecDeque::new();
    let mut in_speech = false;
    let mut speech_chunks: usize = 0;
    let mut silence_chunks: usize = 0;
    let start = Instant::now();
    let max_pre = config.pre_speech_chunks * config.hop_size;
    let max_utterance_samples = 30 * sample_rate as usize; // 30s safety cap

    println!(
        "[Speaker/VAD] Started — {}Hz, hop={}, silence_chunks={}, min_speech={}",
        sample_rate, config.hop_size, config.silence_chunks, config.min_speech_chunks
    );

    // Stream 200ms audio chunks to AssemblyAI real-time STT (if session is active)
    let streaming_chunk_size = (sample_rate as f32 * 0.2) as usize;
    let mut streaming_acc: Vec<f32> = Vec::new();

    loop {
        // Check stop signal
        if state.stop_signal.load(Ordering::SeqCst) {
            // If there's accumulated speech, emit it before stopping
            if in_speech && speech_chunks >= config.min_speech_chunks {
                emit_speech(&mut speech_buffer, sample_rate, app);
            }
            break;
        }

        // Check max duration
        if start.elapsed().as_secs() > config.max_recording_duration_secs {
            if in_speech && speech_chunks >= config.min_speech_chunks {
                emit_speech(&mut speech_buffer, sample_rate, app);
            }
            break;
        }

        let samples = speaker.read_samples();
        if samples.is_empty() {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }

        // Feed AssemblyAI with 200ms chunks + 50% overlap for better word-boundary continuity.
        // Overlap means [0–200ms] → [100–300ms] → [200–400ms] rather than hard cuts.
        streaming_acc.extend_from_slice(&samples);
        if streaming_acc.len() >= streaming_chunk_size {
            crate::streaming_stt::send_raw_samples(&streaming_acc, sample_rate, app);
            // Retain last 50% (100ms) — reduces transcript flicker at word boundaries
            let keep = streaming_chunk_size / 2;
            if streaming_acc.len() > keep {
                streaming_acc.drain(..streaming_acc.len() - keep);
            }
        }

        for chunk in samples.chunks(config.hop_size) {
            let mut chunk = chunk.to_vec();

            // Step 1: Noise gate
            apply_noise_gate(&mut chunk, config.noise_gate_threshold);

            // Step 2: Compute speech metrics
            let rms = calc_rms(&chunk);
            let peak = calc_peak(&chunk);
            let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

            if is_speech {
                if !in_speech {
                    // TRANSITION: Silence → Speech
                    in_speech = true;
                    speech_chunks = 1;
                    silence_chunks = 0;
                    // Prepend pre-speech lookback buffer
                    speech_buffer.extend(pre_speech.iter());
                    app.emit("speech-start", ()).ok();
                    println!("[Speaker/VAD] Speech onset detected (RMS={:.4}, Peak={:.4})", rms, peak);
                } else {
                    speech_chunks += 1;
                    silence_chunks = 0;
                }
                speech_buffer.extend_from_slice(&chunk);

                // Safety cap: 30-second max utterance
                if speech_buffer.len() > max_utterance_samples {
                    println!("[Speaker/VAD] 30s safety cap — force emit");
                    emit_speech(&mut speech_buffer, sample_rate, app);
                    pre_speech.clear();
                    in_speech = false;
                    speech_chunks = 0;
                    silence_chunks = 0;
                }
            } else if in_speech {
                // Silence while in speech — might be a natural pause
                silence_chunks += 1;
                speech_buffer.extend_from_slice(&chunk); // Keep natural tail

                if silence_chunks >= config.silence_chunks {
                    // Enough silence — utterance is complete
                    if speech_chunks >= config.min_speech_chunks {
                        println!(
                            "[Speaker/VAD] Utterance complete — {} speech chunks, {} silence chunks",
                            speech_chunks, silence_chunks
                        );
                        emit_speech(&mut speech_buffer, sample_rate, app);
                    } else {
                        // Too short — noise/click, discard
                        app.emit("speech-discarded", ()).ok();
                    }
                    speech_buffer.clear();
                    pre_speech.clear();
                    in_speech = false;
                    speech_chunks = 0;
                    silence_chunks = 0;
                }
            } else {
                // Pure silence: maintain pre-speech circular buffer
                pre_speech.extend(chunk.iter());
                while pre_speech.len() > max_pre {
                    pre_speech.pop_front();
                }
            }
        }

        std::thread::sleep(Duration::from_millis(10));
    }

    speaker.stop();
    println!("[Speaker/VAD] Capture loop ended");
    Ok(())
}

/// Process and emit a completed speech buffer.
fn emit_speech(buffer: &mut Vec<f32>, sample_rate: u32, app: &AppHandle) {
    trim_trailing_silence(buffer, sample_rate);
    normalize_audio_level(buffer);

    match samples_to_wav_b64(buffer, sample_rate) {
        Ok(wav_b64) => {
            println!(
                "[Speaker/VAD] Emitting speech — {:.1}s, {} b64 chars",
                buffer.len() as f64 / sample_rate as f64,
                wav_b64.len()
            );
            app.emit("speech-detected", wav_b64).ok();
        }
        Err(e) => {
            eprintln!("[Speaker/VAD] Encoding error: {}", e);
            app.emit("audio-encoding-error", e).ok();
        }
    }
    buffer.clear();
}

// ─── Continuous Capture Loop ─────────────────────────────────────────────────

fn continuous_capture_loop(
    mut speaker: super::SpeakerStream,
    config: &VadConfig,
    app: &AppHandle,
) -> Result<(), String> {
    let state = app.state::<SpeakerState>();
    let sample_rate = speaker.sample_rate();
    let mut buffer: Vec<f32> = Vec::new();
    let start = Instant::now();
    let mut last_progress: u64 = 0;

    println!("[Speaker/Continuous] Started — {}Hz", sample_rate);

    loop {
        if state.stop_signal.load(Ordering::SeqCst) {
            break;
        }

        let elapsed = start.elapsed().as_secs();
        if elapsed > config.max_recording_duration_secs {
            break;
        }

        // Emit progress every second
        if elapsed > last_progress {
            last_progress = elapsed;
            app.emit("recording-progress", elapsed).ok();
        }

        let samples = speaker.read_samples();
        buffer.extend_from_slice(&samples);

        std::thread::sleep(Duration::from_millis(10));
    }

    speaker.stop();

    // Process everything
    if !buffer.is_empty() {
        apply_noise_gate(&mut buffer, config.noise_gate_threshold);
        normalize_audio_level(&mut buffer);

        match samples_to_wav_b64(&buffer, sample_rate) {
            Ok(wav_b64) => {
                println!(
                    "[Speaker/Continuous] Emitting — {:.1}s, {} b64 chars",
                    buffer.len() as f64 / sample_rate as f64,
                    wav_b64.len()
                );
                app.emit("continuous-speech-detected", wav_b64).ok();
            }
            Err(e) => {
                eprintln!("[Speaker/Continuous] Encoding error: {}", e);
                app.emit("audio-encoding-error", e).ok();
            }
        }
    }

    println!("[Speaker/Continuous] Capture loop ended");
    Ok(())
}
