use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

/// State for tracking the audio capture thread.
pub struct AudioCaptureState {
    pub is_capturing: AtomicBool,
    pub stop_signal: AtomicBool,
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self {
            is_capturing: AtomicBool::new(false),
            stop_signal: AtomicBool::new(false),
        }
    }
}

/// Start capturing system audio (WASAPI loopback) and emit PCM chunks via Tauri events.
/// Audio is resampled to 16kHz mono PCM16 for ElevenLabs STT.
#[tauri::command]
pub async fn start_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AudioCaptureState>();

    if state.is_capturing.load(Ordering::SeqCst) {
        return Err("Audio capture already running".to_string());
    }

    state.stop_signal.store(false, Ordering::SeqCst);
    state.is_capturing.store(true, Ordering::SeqCst);

    let app_handle = app.clone();

    // Spawn audio capture on a separate thread (cpal requires it)
    std::thread::spawn(move || {
        if let Err(e) = run_audio_capture(&app_handle) {
            log::error!("[AudioCapture] Error: {}", e);
            let _ = app_handle.emit("audio-capture-error", e.to_string());
        }
        let state = app_handle.state::<AudioCaptureState>();
        state.is_capturing.store(false, Ordering::SeqCst);
        let _ = app_handle.emit("audio-capture-stopped", ());
    });

    Ok(())
}

/// Stop the audio capture.
#[tauri::command]
pub async fn stop_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AudioCaptureState>();
    state.stop_signal.store(true, Ordering::SeqCst);
    Ok(())
}

/// Check if audio capture is currently active.
#[tauri::command]
pub async fn is_audio_capturing(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<AudioCaptureState>();
    Ok(state.is_capturing.load(Ordering::SeqCst))
}

fn run_audio_capture(app: &AppHandle) -> Result<(), String> {
    let host = cpal::host_from_id(cpal::HostId::Wasapi)
        .map_err(|e| format!("Failed to get WASAPI host: {}", e))?;

    // Get default output device for loopback capture
    let device = host
        .default_output_device()
        .ok_or_else(|| "No output audio device found".to_string())?;

    log::debug!(
        "[AudioCapture] Using device: {}",
        device.name().unwrap_or_default()
    );

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get output config: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;

    log::debug!(
        "[AudioCapture] Source: {}Hz, {} channels, {:?}",
        sample_rate,
        channels,
        config.sample_format()
    );

    let state = app.state::<AudioCaptureState>();
    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_signal_clone = stop_signal.clone();
    let app_handle = app.clone();

    // Buffer to accumulate ~100ms chunks of 16kHz mono PCM
    let chunk_samples = 1600; // 100ms at 16kHz
    let mut resample_buffer: Vec<i16> = Vec::with_capacity(chunk_samples * 2);
    let mut sample_accumulator: Vec<f32> = Vec::new();
    let chunk_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));

    // Resample ratio: source_rate -> 16000
    let target_rate = 16000u32;

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let config: cpal::StreamConfig = config.into();
            let counter = chunk_counter.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if stop_signal_clone.load(Ordering::Relaxed) {
                            return;
                        }
                        // Mix to mono
                        let mono_samples: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| {
                                frame.iter().sum::<f32>() / channels as f32
                            })
                            .collect();

                        sample_accumulator.extend_from_slice(&mono_samples);

                        // Resample when we have enough source samples
                        let source_chunk_size =
                            (chunk_samples as f64 * sample_rate as f64 / target_rate as f64) as usize;

                        while sample_accumulator.len() >= source_chunk_size {
                            let chunk: Vec<f32> =
                                sample_accumulator.drain(..source_chunk_size).collect();

                            // Linear resample to 16kHz
                            resample_buffer.clear();
                            for i in 0..chunk_samples {
                                let src_idx =
                                    i as f64 * chunk.len() as f64 / chunk_samples as f64;
                                let idx = src_idx as usize;
                                let frac = src_idx - idx as f64;

                                let s = if idx + 1 < chunk.len() {
                                    chunk[idx] * (1.0 - frac as f32)
                                        + chunk[idx + 1] * frac as f32
                                } else {
                                    chunk[idx.min(chunk.len() - 1)]
                                };

                                // Convert f32 [-1.0, 1.0] to i16
                                let sample =
                                    (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                                resample_buffer.push(sample);
                            }

                            // Convert i16 samples to bytes (little-endian) then base64
                            let bytes: Vec<u8> = resample_buffer
                                .iter()
                                .flat_map(|s| s.to_le_bytes())
                                .collect();

                            let b64 = BASE64.encode(&bytes);
                            let count = counter.fetch_add(1, Ordering::Relaxed) + 1;
                            if count <= 5 || count % 100 == 0 {
                                log::debug!("[AudioCapture] Emitted chunk #{}, b64 size: {}", count, b64.len());
                            }
                            let _ = app_handle.emit("audio-chunk", b64);
                        }
                    },
                    |err| log::error!("[AudioCapture] Stream error: {}", err),
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?
        }
        cpal::SampleFormat::I16 => {
            let config: cpal::StreamConfig = config.into();
            let counter = chunk_counter.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if stop_signal_clone.load(Ordering::Relaxed) {
                            return;
                        }
                        // Convert i16 to f32, mix to mono
                        let mono_samples: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| {
                                frame.iter().map(|&s| s as f32 / i16::MAX as f32).sum::<f32>()
                                    / channels as f32
                            })
                            .collect();

                        sample_accumulator.extend_from_slice(&mono_samples);

                        let source_chunk_size =
                            (chunk_samples as f64 * sample_rate as f64 / target_rate as f64) as usize;

                        while sample_accumulator.len() >= source_chunk_size {
                            let chunk: Vec<f32> =
                                sample_accumulator.drain(..source_chunk_size).collect();

                            resample_buffer.clear();
                            for i in 0..chunk_samples {
                                let src_idx =
                                    i as f64 * chunk.len() as f64 / chunk_samples as f64;
                                let idx = src_idx as usize;
                                let frac = src_idx - idx as f64;

                                let s = if idx + 1 < chunk.len() {
                                    chunk[idx] * (1.0 - frac as f32)
                                        + chunk[idx + 1] * frac as f32
                                } else {
                                    chunk[idx.min(chunk.len() - 1)]
                                };

                                let sample =
                                    (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                                resample_buffer.push(sample);
                            }

                            let bytes: Vec<u8> = resample_buffer
                                .iter()
                                .flat_map(|s| s.to_le_bytes())
                                .collect();

                            let b64 = BASE64.encode(&bytes);
                            let count = counter.fetch_add(1, Ordering::Relaxed) + 1;
                            if count <= 5 || count % 100 == 0 {
                                log::debug!("[AudioCapture] Emitted chunk #{}, b64 size: {}", count, b64.len());
                            }
                            let _ = app_handle.emit("audio-chunk", b64);
                        }
                    },
                    |err| log::error!("[AudioCapture] Stream error: {}", err),
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?
        }
        fmt => return Err(format!("Unsupported sample format: {:?}", fmt)),
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start audio stream: {}", e))?;

    log::info!("[AudioCapture] Loopback capture started");

    // Keep thread alive until stop signal
    while !state.stop_signal.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    drop(stream);
    log::info!("[AudioCapture] Loopback capture stopped");
    Ok(())
}
