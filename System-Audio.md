# System Audio Capture — Complete Architecture & Implementation Guide

> **Scope**: End-to-end documentation of Pluely's system audio capture pipeline — from OS-level loopback capture through Voice Activity Detection, encoding, Speech-to-Text, and AI response streaming.

---

## Table of Contents

1. [High-Level Pipeline](#1-high-level-pipeline)
2. [Platform Abstraction Layer (Rust)](#2-platform-abstraction-layer-rust)
3. [Ring Buffer Architecture](#3-ring-buffer-architecture)
4. [Voice Activity Detection (VAD)](#4-voice-activity-detection-vad)
5. [Continuous Capture Mode](#5-continuous-capture-mode)
6. [Audio Encoding Pipeline](#6-audio-encoding-pipeline)
7. [Tauri IPC Bridge](#7-tauri-ipc-bridge)
8. [Frontend Hook — useSystemAudio](#8-frontend-hook--usesystemaudio)
9. [UI Components](#9-ui-components)
10. [Complete Audio Flow Diagram](#10-complete-audio-flow-diagram)
11. [VAD State Machine (Detailed)](#11-vad-state-machine-detailed)
12. [Key Technical Insights](#12-key-technical-insights)
13. [Performance Metrics](#13-performance-metrics)
14. [Implementation Guide — How to Build This](#14-implementation-guide--how-to-build-this)

---

## 1. High-Level Pipeline

The system audio capture follows a **5-stage pipeline**:

```
Hardware Capture → VAD / Continuous → Encoding → STT → AI Response
```

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐    ┌────────────┐
│  OS Loopback │───▸│  Ring Buffer │───▸│  VAD Engine  │───▸│ WAV+B64  │───▸│  STT → AI  │
│  (per-plat)  │    │  (128 KB)    │    │  (3-state)   │    │ Encoding │    │  Pipeline   │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────┘    └────────────┘
     WASAPI             VecDeque/         Noise Gate           hound          Tauri events
     CoreAudio          HeapRb            RMS + Peak           base64         → JS → fetch
     PulseAudio                           State Machine
```

### Stage Summary

| Stage | Location | Technology | Purpose |
|-------|----------|------------|---------|
| 1. Capture | `src-tauri/src/speaker/{windows,macos,linux}.rs` | WASAPI / CoreAudio / PulseAudio | Loopback audio from system output |
| 2. Detection | `src-tauri/src/speaker/commands.rs` | Custom VAD (RMS + Peak state machine) | Detect speech boundaries or manual control |
| 3. Encoding | `src-tauri/src/speaker/commands.rs` | hound (WAV) + base64 | Convert f32 samples → WAV → base64 string |
| 4. Transport | Tauri event system | `speech-detected` event | Push base64 WAV from Rust → JavaScript |
| 5. Processing | `src/hooks/useSystemAudio.ts` | fetch (STT) + streaming AI | Transcribe audio, stream AI response |

---

## 2. Platform Abstraction Layer (Rust)

### File: `src-tauri/src/speaker/mod.rs`

All platform-specific audio capture is abstracted behind a single Rust trait:

```rust
pub trait SpeakerInput: Send + 'static {
    fn read_samples(&mut self) -> Vec<f32>;
    fn sample_rate(&self) -> u32;
    fn stop(&mut self);
}
```

A factory function selects the correct implementation at **compile time** (zero runtime overhead):

```rust
pub fn create_speaker_stream(device_index: Option<usize>) -> Result<SpeakerStream, String>
```

- `SpeakerStream` is a type alias wrapping the platform-specific struct
- `device_index` is optional — `None` uses the default audio output device
- Each platform implementation lives in its own file behind `#[cfg(target_os = "...")]`

### Platform Implementations

#### Windows — `src-tauri/src/speaker/windows.rs`

| Aspect | Detail |
|--------|--------|
| **API** | WASAPI (Windows Audio Session API) |
| **Crate** | `wasapi = "0.19"` |
| **Capture Mode** | Loopback ("Stereo Mix") — captures what speakers output |
| **Audio Format** | 32-bit float, device-native sample rate |
| **Buffer** | `VecDeque<f32>` with max capacity 131,072 samples |
| **Threading** | Dedicated native thread for audio capture |
| **Device Selection** | By index (0, 1, 2...) from enumerated output devices |
| **Overflow** | Drop oldest samples when buffer exceeds 131,072 |
| **Locking** | `Arc<Mutex<VecDeque<f32>>>` with double-checked locking poll |

**Key implementation details:**
- WASAPI loopback captures the audio mix being sent to speakers
- The capture thread writes into the `VecDeque` ring buffer
- `read_samples()` drains the VecDeque into a `Vec<f32>` and returns it
- Buffer overflow handling: when `VecDeque.len() > 131_072`, oldest samples are dropped

#### macOS — `src-tauri/src/speaker/macos.rs`

| Aspect | Detail |
|--------|--------|
| **API** | CoreAudio Process Tap |
| **Crate** | `cidre` |
| **Capture Mode** | System Audio Tap (captures all system audio) |
| **Audio Format** | 32-bit float, device-native sample rate |
| **Buffer** | `HeapRb<f32>` from `ringbuf` crate (lock-free SPSC) |
| **Buffer Size** | 1024 × 128 = 131,072 samples |
| **Threading** | Audio thread callback (IO proc) |
| **Device Selection** | Default output device only |
| **Overflow** | Detected at 50 consecutive ring buffer drops → logged warning |

**Key implementation details:**
- Uses `cidre`'s CoreAudio bindings for process tap API
- Lock-free Single-Producer Single-Consumer (SPSC) ring buffer
- Audio callback writes into the producer side
- `read_samples()` reads from the consumer side
- No mutex needed — lock-free design prevents audio thread blocking

#### Linux — `src-tauri/src/speaker/linux.rs`

| Aspect | Detail |
|--------|--------|
| **API** | PulseAudio |
| **Crate** | `libpulse-binding = "2.x"` |
| **Capture Mode** | Monitor source (`@DEFAULT_MONITOR@`) |
| **Audio Format** | 32-bit little-endian float, mono |
| **Sample Rate** | Fixed 44,100 Hz |
| **Buffer** | `VecDeque<f32>` with max capacity 131,072 |
| **Read Chunk** | 4,096 bytes per read operation |
| **Threading** | Dedicated native thread |
| **Device Selection** | Source name (`@DEFAULT_MONITOR@`, or specific device) |

**Key implementation details:**
- PulseAudio's monitor source captures the audio going to the default sink
- Fixed 44.1 kHz sample rate (unlike Windows/macOS which use device-native rates)
- Raw bytes read from PulseAudio are reinterpreted as f32 slices
- Same VecDeque overflow strategy as Windows

### Platform Comparison Table

| Aspect | Windows | macOS | Linux |
|--------|---------|-------|-------|
| API | WASAPI | Core Audio | PulseAudio |
| Audio Format | 32-bit float | 32-bit float | 32-bit LE float |
| Sample Rate | Variable (device) | Variable (device) | Fixed 44.1 kHz |
| Threading | Native thread | Audio thread callback | Native thread |
| Device Selection | By index (0+) | Default only | Source name |
| Loopback Method | "Stereo Mix" | System Audio Tap | PulseAudio monitor |
| Ring Buffer | `VecDeque` (mutex) | `HeapRb` (lock-free) | `VecDeque` (mutex) |

---

## 3. Ring Buffer Architecture

### Purpose

The ring buffer decouples the **audio capture thread** (real-time, must never block) from the **VAD processing loop** (async, runs on Tokio):

```
Audio Thread (real-time)          VAD Loop (async, ~10ms poll)
        │                                   │
        ▼                                   ▼
   ┌─────────┐   write    ┌──────────┐   read    ┌──────────┐
   │ OS Audio │──────────▸ │  Ring    │──────────▸│  VAD     │
   │ Callback │           │  Buffer  │           │  Engine  │
   └─────────┘           │ (128 KB) │           └──────────┘
                          └──────────┘
```

### Buffer Specifications

| Property | Value | Notes |
|----------|-------|-------|
| Capacity | 131,072 samples | 128 KB (f32 = 4 bytes each) |
| Duration | ~3 seconds | At 44.1 kHz |
| Overflow | Drop oldest | Prefers low latency over data completeness |
| Windows/Linux type | `VecDeque<f32>` | Protected by `Arc<Mutex<>>` |
| macOS type | `HeapRb<f32>` | Lock-free SPSC (no mutex needed) |

### Why Lock-Free on macOS?

macOS CoreAudio runs the audio callback on a **real-time audio thread**. Blocking this thread (e.g., with a mutex) causes audio glitches. The `HeapRb` SPSC ring buffer is lock-free — the producer (audio callback) and consumer (VAD loop) never block each other.

### Waker Pattern

The ring buffer integrates with Tokio's async runtime:
- The VAD loop calls `read_samples()` every ~10ms via `tokio::time::sleep`
- If no new samples are available, the loop simply continues (non-blocking)
- This poll-based approach avoids the complexity of waker-based async reads

---

## 4. Voice Activity Detection (VAD)

### File: `src-tauri/src/speaker/commands.rs`

Pluely uses a **custom VAD algorithm** — NOT a neural network. It's a lightweight state machine based on audio energy metrics (RMS and peak amplitude).

### VAD Configuration

```rust
pub struct VadConfig {
    pub hop_size: usize,                      // 1024 — samples per VAD decision (~23ms)
    pub sensitivity_rms: f32,                 // 0.012 — RMS threshold for speech
    pub peak_threshold: f32,                  // 0.035 — Peak threshold for transients
    pub silence_chunks: usize,                // 45 — silence chunks to end utterance (~1.0s)
    pub min_speech_chunks: usize,             // 7 — minimum chunks for valid speech (~0.16s)
    pub pre_speech_chunks: usize,             // 12 — lookback buffer size (~0.28s)
    pub noise_gate_threshold: f32,            // 0.003 — below this → zeroed
    pub max_recording_duration_secs: u64,     // 180 — 3-minute safety cap
}
```

### What Each Parameter Means

| Parameter | Default | Duration | Purpose |
|-----------|---------|----------|---------|
| `hop_size` | 1024 | ~23ms | How often VAD makes a speech/silence decision |
| `sensitivity_rms` | 0.012 | — | RMS energy threshold. Lower = more sensitive |
| `peak_threshold` | 0.035 | — | Peak amplitude threshold. Catches sudden sounds |
| `silence_chunks` | 45 | ~1.0s | How long silence must last to end an utterance |
| `min_speech_chunks` | 7 | ~0.16s | Minimum speech length to be valid (rejects clicks) |
| `pre_speech_chunks` | 12 | ~0.28s | Lookback buffer to capture word onsets |
| `noise_gate_threshold` | 0.003 | — | Below this amplitude → zeroed out |
| `max_recording_duration_secs` | 180 | 3 min | Safety cap for maximum utterance length |

### Noise Gate (Soft Knee)

Before computing metrics, each hop goes through a noise gate:

```rust
fn apply_noise_gate(samples: &mut [f32], threshold: f32) {
    const KNEE_RATIO: f32 = 3.0;
    let knee_end = threshold * KNEE_RATIO;

    for sample in samples.iter_mut() {
        let abs_val = sample.abs();
        if abs_val < threshold {
            *sample = 0.0;                          // Below threshold: silence
        } else if abs_val < knee_end {
            let t = (abs_val - threshold) / (knee_end - threshold);
            *sample *= t;                           // Knee region: smooth attenuation
        }
        // Above knee_end: pass through unchanged
    }
}
```

**Why soft knee?** A hard cutoff (below threshold → zero, above → pass) creates audible clicks at the transition point. The soft knee smoothly transitions between silence and pass-through, eliminating artifacts.

### Speech Detection (Dual Metric)

```rust
let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
let peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;
```

**Two independent thresholds:**
- **RMS** (Root Mean Square) — catches sustained speech (energy over time)
- **Peak** — catches sudden transients (plosives like "p", "t", "k") that might have low RMS but high peak

Using OR logic means either metric can trigger detection — preventing missed speech.

### Pre-Speech Buffer

```
Time:  ─────────────────────────────────▶
Audio: [silence...][pre-buffer][SPEECH ONSET][speech continues...]
                    ◄──0.28s──▶
                    (12 × 1024 samples)
```

A circular buffer of the last 12 hops (~0.28 seconds) is always maintained during silence. When speech is first detected, this buffer is prepended to the speech buffer — **capturing the beginning of words that would otherwise be clipped**.

Without pre-speech buffering, the first syllable of words is often cut off because the VAD needs a few milliseconds to detect speech.

### VAD Core Loop (Pseudocode)

```rust
async fn vad_capture_loop(speaker: SpeakerStream, config: VadConfig, app: AppHandle) {
    let mut speech_buffer: Vec<f32> = Vec::new();
    let mut pre_speech: VecDeque<f32> = VecDeque::new();
    let mut in_speech = false;
    let mut speech_chunks: usize = 0;
    let mut silence_chunks: usize = 0;

    loop {
        let samples = speaker.read_samples();
        if samples.is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
            continue;
        }

        for chunk in samples.chunks(config.hop_size) {
            let mut chunk = chunk.to_vec();

            // Step 1: Noise gate
            apply_noise_gate(&mut chunk, config.noise_gate_threshold);

            // Step 2: Compute metrics
            let rms = calc_rms(&chunk);
            let peak = calc_peak(&chunk);
            let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

            if is_speech {
                if !in_speech {
                    // TRANSITION: Silence → Speech
                    in_speech = true;
                    speech_chunks = 1;
                    silence_chunks = 0;
                    speech_buffer.extend(pre_speech.iter()); // Prepend lookback
                    app.emit("speech-start", ()).ok();
                } else {
                    speech_chunks += 1;
                    silence_chunks = 0;  // Reset silence counter
                }
                speech_buffer.extend_from_slice(&chunk);

                // Safety cap: 30-second max utterance
                if speech_buffer.len() > 30 * speaker.sample_rate() as usize {
                    emit_speech(&speech_buffer, speaker.sample_rate(), &app);
                    reset_state(&mut speech_buffer, &mut in_speech, ...);
                }
            } else if in_speech {
                // Silence while in speech — might be a pause
                silence_chunks += 1;
                speech_buffer.extend_from_slice(&chunk); // Keep natural tail

                if silence_chunks >= config.silence_chunks {
                    // Enough silence — utterance is complete
                    if speech_chunks >= config.min_speech_chunks {
                        // Valid speech: trim, normalize, encode, emit
                        emit_speech(&speech_buffer, speaker.sample_rate(), &app);
                    } else {
                        // Too short: discard (was a click/noise)
                        app.emit("speech-discarded", ()).ok();
                    }
                    reset_state(&mut speech_buffer, &mut in_speech, ...);
                }
            } else {
                // Pure silence: maintain pre-speech circular buffer
                pre_speech.extend(chunk.iter());
                let max_pre = config.pre_speech_chunks * config.hop_size;
                while pre_speech.len() > max_pre {
                    pre_speech.pop_front();
                }
            }
        }

        // Check for external stop signal
        // Check max recording duration
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
```

---

## 5. Continuous Capture Mode

### File: `src-tauri/src/speaker/commands.rs`

Unlike VAD mode, continuous capture simply records everything until manually stopped:

```rust
async fn continuous_capture_loop(speaker: SpeakerStream, app: AppHandle) {
    let mut buffer: Vec<f32> = Vec::new();
    let start = Instant::now();

    loop {
        let samples = speaker.read_samples();
        buffer.extend_from_slice(&samples);

        // Emit progress every second
        let elapsed = start.elapsed().as_secs();
        app.emit("recording-progress", elapsed).ok();

        // Check max duration (180 seconds)
        if elapsed > config.max_recording_duration_secs {
            break;
        }

        // Check manual stop signal
        if manual_stop_received() {
            break;
        }

        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    // Process everything
    apply_noise_gate(&mut buffer, config.noise_gate_threshold);
    normalize_audio_level(&mut buffer);
    let wav_b64 = samples_to_wav_b64(&buffer, speaker.sample_rate());
    app.emit("speech-detected", wav_b64).ok();
}
```

### VAD vs Continuous Comparison

| Aspect | VAD Mode | Continuous Mode |
|--------|----------|-----------------|
| **Trigger** | Automatic speech detection | Manual start/stop |
| **Best For** | Hands-free, natural conversation | Noisy environments, specific recordings |
| **Pros** | Energy-efficient, captures natural pauses | Reliable, captures everything |
| **Cons** | May miss quiet speakers, requires tuning | Manual control needed, more data to transcribe |
| **Max Duration** | 30s per utterance (auto-segmented) | 180s total (configurable) |
| **Output** | Multiple short segments | One large segment |

---

## 6. Audio Encoding Pipeline

### Processing Chain

When speech is ready to send (VAD detected end-of-utterance, or continuous capture stopped):

```
Raw f32 samples → Trim Silence → Normalize → i16 PCM → WAV → Base64
```

### Step 1: Trim Trailing Silence

```rust
// Remove trailing silence but keep ~0.15s natural tail
let tail_samples = (0.15 * sample_rate as f64) as usize;
// Find last non-silent sample, keep tail_samples after it
```

This preserves natural word endings while removing dead air.

### Step 2: Normalize Audio Level

```rust
fn normalize_audio_level(samples: &mut [f32]) {
    let target_rms = 0.1;
    let current_rms = calc_rms(samples);

    if current_rms < 1e-6 { return; } // Silence, skip

    let gain = (target_rms / current_rms).min(10.0); // Cap at 10× amplification

    for sample in samples.iter_mut() {
        *sample *= gain;
        // Soft saturation above 1.0 (prevents clipping)
        if sample.abs() > 1.0 {
            *sample = sample.signum() * (1.0 - (-sample.abs() + 1.0).exp().ln());
        }
    }
}
```

**Key properties:**
- Target RMS: 0.1 (consistent volume for STT)
- Max gain: 10× (prevents amplifying noise to speech levels)
- Soft saturation: Above 1.0, uses exponential curve instead of hard clipping

### Step 3: WAV Encoding + Base64

```rust
fn samples_to_wav_b64(samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let spec = hound::WavSpec {
        channels: 1,                         // Mono (speech is mono; stereo unnecessary)
        sample_rate,                         // Device-native (usually 44100 or 48000)
        bits_per_sample: 16,                 // 16-bit signed integer PCM
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut cursor, spec)?;

    for &sample in samples {
        let clamped = sample.max(-1.0).min(1.0);              // Clamp to [-1, 1]
        writer.write_sample((clamped * 32767.0) as i16)?;     // Scale to i16 range
    }

    writer.finalize()?;
    Ok(base64::engine::general_purpose::STANDARD.encode(cursor.into_inner()))
}
```

**Why these choices:**
- **Mono**: Speech is inherently mono; stereo doubles size for zero benefit
- **16-bit PCM**: Universal STT provider compatibility (Bluetooth-era codec)
- **WAV**: No compression artifacts, all STT providers accept it
- **Base64**: Safe for Tauri event transport (JSON-safe string)

---

## 7. Tauri IPC Bridge

### 9 Tauri Commands (Frontend → Rust)

Commands are invoked from JavaScript and execute Rust code:

| Command | Parameters | Return | Purpose |
|---------|-----------|--------|---------|
| `start_vad_capture` | `VadConfig`, `device_index?` | `Result<(), String>` | Start VAD-based system audio capture |
| `stop_vad_capture` | — | `Result<(), String>` | Stop VAD capture loop |
| `start_continuous_capture` | `device_index?` | `Result<(), String>` | Start manual recording mode |
| `stop_continuous_capture` | — | `Result<(), String>` | Stop continuous recording + process buffer |
| `update_vad_config` | `VadConfig` | `Result<(), String>` | Live-update VAD parameters (no restart needed) |
| `get_vad_config` | — | `Result<VadConfig, String>` | Retrieve current VAD configuration |
| `get_audio_devices` | — | `Result<Vec<AudioDevice>, String>` | List available audio output devices |
| `check_audio_permissions` | — | `Result<bool, String>` | Check if app has audio capture permission |
| `request_audio_permissions` | — | `Result<bool, String>` | Request OS-level audio permissions |

### 10 Tauri Events (Rust → Frontend)

Events are emitted from Rust and received by JavaScript listeners:

| Event | Payload | Direction | Purpose |
|-------|---------|-----------|---------|
| `speech-detected` | `String` (base64 WAV) | Rust → JS | Completed speech segment ready for STT |
| `speech-start` | — | Rust → JS | Speech onset detected (VAD mode) |
| `speech-discarded` | — | Rust → JS | Too-short speech rejected by VAD |
| `capture-started` | — | Rust → JS | Capture session is now active |
| `capture-stopped` | — | Rust → JS | Capture session has ended |
| `recording-progress` | `u64` (seconds) | Rust → JS | Elapsed time in continuous mode |
| `audio-encoding-error` | `String` (error msg) | Rust → JS | WAV encoding or base64 failure |
| `continuous-speech-detected` | `String` (base64 WAV) | Rust → JS | Continuous mode result |
| `manual-stop-capture` | — | JS → Rust | Internal signal to stop capture |
| `vad-config-updated` | `VadConfig` (JSON) | Rust → JS | Config change notification |

### Event Flow Diagram

```
Frontend (React)                          Backend (Rust)
     │                                         │
     │ invoke("start_vad_capture", config)     │
     │────────────────────────────────────────▸│
     │                                         │ ← spawns async task
     │         emit("capture-started")         │
     │◂────────────────────────────────────────│
     │                                         │
     │         emit("speech-start")            │
     │◂────────────────────────────────────────│ ← VAD detected speech
     │                                         │
     │    emit("speech-detected", base64_wav)  │
     │◂────────────────────────────────────────│ ← utterance complete
     │                                         │
     │ invoke("stop_vad_capture")              │
     │────────────────────────────────────────▸│
     │                                         │ ← task cancelled
     │         emit("capture-stopped")         │
     │◂────────────────────────────────────────│
```

---

## 8. Frontend Hook — useSystemAudio

### File: `src/hooks/useSystemAudio.ts`

The `useSystemAudio` hook (~700+ lines) is the main frontend orchestrator. It manages state, event listeners, STT routing, and AI processing.

### Exported State

```typescript
// Capture state
capturing: boolean              // Whether audio capture is currently active
isProcessing: boolean           // Whether STT transcription is in progress
isAIProcessing: boolean         // Whether AI response is being streamed
lastTranscription: string       // Most recent STT transcription result
lastAIResponse: string          // Most recent AI response text
error: string                   // Current error message (empty if none)

// Configuration
vadConfig: VadConfig            // Current VAD configuration
selectedSttProvider: string     // Active STT provider ID
useSystemPrompt: boolean        // Whether to use system prompt for AI context

// Conversation
conversation: {
    messages: Message[]         // Full conversation history
}
```

### Exported Functions

```typescript
startCapture()                  // Begin VAD or continuous capture
stopCapture()                   // Stop any active capture
startContinuousRecording()      // Begin manual recording mode
manualStopAndSend()             // Stop continuous + immediately process
updateVadConfig(config)         // Update VAD parameters (sends to Rust)
clearConversation()             // Reset conversation history
clearError()                    // Clear current error
```

### Complete Audio Flow (7 Steps)

```
Step 1: User Trigger
  └─ Click capture button OR press global shortcut (Alt+Space)
       └─ Calls startCapture()

Step 2: Invoke Rust Capture
  └─ await invoke("start_vad_capture", { config: vadConfig })
       └─ Rust spawns async capture task

Step 3: Audio Capture (Rust side)
  └─ Platform speaker reads system audio
       └─ Ring buffer → VAD state machine → speech detection
            └─ On complete utterance: encode → base64

Step 4: Event Transport
  └─ Rust emits "speech-detected" with base64 WAV payload
       └─ JavaScript listener receives the event

Step 5: Speech-to-Text
  └─ Decode: atob(base64) → Uint8Array → Blob("audio/wav")
       └─ Send to STT provider:
            ├─ Pluely API: POST with audio blob
            └─ Custom cURL: User-configured endpoint
       └─ Receive transcription text (30-second timeout)

Step 6: AI Processing
  └─ Build context:
       ├─ System prompt (or custom context)
       └─ Conversation history (previous messages)
  └─ Stream AI response (chunk by chunk):
       └─ for await (chunk of fetchAIResponse(...))
            └─ Append to lastAIResponse (real-time UI update)

Step 7: Persist & Reset
  └─ Save to conversation:
       ├─ User message: { role: "user", content: transcription }
       └─ Assistant message: { role: "assistant", content: response }
  └─ Persist to localStorage (debounced 500ms)
  └─ Ready for next capture cycle
```

### Event Listeners Setup

```typescript
// Inside useSystemAudio hook initialization:

// Core speech event
const unlistenSpeech = await listen<string>("speech-detected", async (event) => {
    const base64Audio = event.payload;

    // Decode base64 to audio blob
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: "audio/wav" });

    // Get STT provider configuration
    if (!selectedSttProvider) {
        setError("No STT provider selected");
        return;
    }
    const providerConfig = allSttProviders.find(p => p.id === selectedSttProvider);

    // Transcribe
    setIsProcessing(true);
    const transcription = await fetchSTT({
        provider: providerConfig,
        selectedProvider: selectedSttProvider,
        audio: audioBlob,
    }); // 30-second timeout

    if (transcription.trim()) {
        setLastTranscription(transcription);

        // Build AI context
        const effectivePrompt = useSystemPrompt ? systemPrompt : contextContent;
        const previousMessages = conversation.messages;

        // Process with AI
        await processWithAI(transcription, effectivePrompt, previousMessages);
    }
    setIsProcessing(false);
});

// Status events
const unlistenStart = await listen("capture-started", () => setCapturing(true));
const unlistenStop = await listen("capture-stopped", () => setCapturing(false));
const unlistenSpeechStart = await listen("speech-start", () => { /* UI feedback */ });
const unlistenDiscard = await listen("speech-discarded", () => { /* brief notification */ });
const unlistenError = await listen<string>("audio-encoding-error", (e) => setError(e.payload));
const unlistenProgress = await listen<number>("recording-progress", (e) => { /* update timer */ });
```

### VAD Config Interface (TypeScript)

```typescript
interface VadConfig {
    hop_size: number;                      // 1024
    sensitivity_rms: number;               // 0.012
    peak_threshold: number;                // 0.035
    silence_chunks: number;                // 45
    min_speech_chunks: number;             // 7
    pre_speech_chunks: number;             // 12
    noise_gate_threshold: number;          // 0.003
    max_recording_duration_secs: number;   // 180
}
```

### Storage Keys

| Key | Value | Purpose |
|-----|-------|---------|
| `pluely-vad-config` | JSON (VadConfig) | Persist VAD settings across restarts |
| `pluely-stt-provider` | String (provider ID) | Selected STT provider |
| `pluely-use-system-prompt` | Boolean | Whether to use system prompt |
| `pluely-quick-actions` | JSON (array) | Saved quick action presets |
| `pluely-conversation` | IndexedDB | Full conversation history |

---

## 9. UI Components

### Speech Button — `src/pages/app/components/speech/index.tsx`

The main capture trigger button with 5 visual states:

| State | Appearance | Trigger |
|-------|-----------|---------|
| **Setup Required** | Warning icon, muted | No STT provider configured |
| **Error** | Red icon | Audio error occurred |
| **Processing** | Spinner animation | STT or AI processing in progress |
| **Capturing** | Pulsing ring, active color | Currently capturing system audio |
| **Idle** | Microphone icon, neutral | Ready to capture |

**Popover behavior:** Clicking the button opens a popover containing the VAD config panel, audio visualizer, operation section, and conversation history. The button itself toggles capture on/off.

### Audio Visualizer — `src/pages/app/components/speech/audio-visualizer.tsx`

Real-time frequency visualization of the microphone input:

| Property | Value | Notes |
|----------|-------|-------|
| **Rendering** | HTML5 Canvas | DPI-aware (uses `devicePixelRatio`) |
| **FFT Size** | 512 | Produces 256 frequency bins |
| **Smoothing** | 0.8 | Temporal smoothing constant |
| **Style** | Greyscale bars | Mirrored above/below center line |
| **Frame Rate** | 60 FPS | Synced via `requestAnimationFrame` |
| **Audio Source** | Microphone stream | Uses `navigator.mediaDevices.getUserMedia` |
| **Performance** | Optimized | Canvas cleared + redrawn each frame, DPI scaling |

**Note:** The visualizer uses the **microphone** input (not system audio) because the system audio stream lives in Rust and isn't directly accessible to the WebView's Web Audio API. This provides visual feedback that audio hardware is working.

### VAD Config Panel — `src/pages/app/components/speech/VadConfigPanel.tsx`

UI for adjusting VAD parameters with slider controls:

| Slider | Range | Mapping |
|--------|-------|---------|
| **Sensitivity** | 1–100 | `sensitivity_rms = value / 1000` (1→0.001, 100→0.1) |
| **Peak Threshold** | 1–100 | `peak_threshold = value / 1000` |
| **Silence Duration** | 10–100 chunks | `duration_seconds = chunks × hop_size / sample_rate` |
| **Pre-Speech Buffer** | 1–30 chunks | `duration_ms = chunks × hop_size / sample_rate × 1000` |
| **Noise Gate** | 0–50 | `noise_gate_threshold = value / 10000` |

Changes are sent to Rust immediately via `invoke("update_vad_config", config)` for live-update without restarting capture.

### Operation Section — `src/pages/app/components/speech/OperationSection.tsx`

Displays the active processing state and results:

| Section | Content |
|---------|---------|
| **Transcription** | Latest STT result text |
| **AI Response** | Streamed markdown response (real-time rendering) |
| **Quick Actions** | Configurable action buttons (copy, retry, custom) |
| **Conversation History** | Scrollable list of past user/assistant message pairs |
| **Error Display** | Error messages with dismiss button |

---

## 10. Complete Audio Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                  FRONTEND (React/TypeScript)                    │
│                                                                 │
│  User clicks Capture Button (or presses Alt+Space)             │
│  ├─ startCapture()                                             │
│  └─ invoke("start_vad_capture", vadConfig)                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼ Tauri Command (IPC)
┌─────────────────────────────────────────────────────────────────┐
│                    RUST BACKEND (Tauri)                         │
│                                                                 │
│  start_vad_capture(config, device_index)                       │
│  ├─ create_speaker_stream(device_index)                        │
│  │   ├─ Windows: WASAPI loopback                               │
│  │   ├─ macOS: CoreAudio process tap                           │
│  │   └─ Linux: PulseAudio monitor                              │
│  ├─ emit("capture-started")                                    │
│  └─ tokio::spawn(vad_capture_loop(...))                        │
│                                                                 │
│  ┌─ VAD Capture Loop ─────────────────────────────────────┐    │
│  │                                                         │    │
│  │  loop {                                                 │    │
│  │    samples = speaker.read_samples()  // drain buffer    │    │
│  │                                                         │    │
│  │    for chunk in samples.chunks(hop_size) {              │    │
│  │      apply_noise_gate(chunk, 0.003)                     │    │
│  │      rms = calc_rms(chunk)                              │    │
│  │      peak = calc_peak(chunk)                            │    │
│  │      is_speech = rms > 0.012 || peak > 0.035            │    │
│  │                                                         │    │
│  │      match state {                                      │    │
│  │        Silence + Speech → start accumulating            │    │
│  │        Speech + Speech → continue accumulating          │    │
│  │        Speech + Silence → count silence chunks          │    │
│  │        Silence (45+ chunks) → emit or discard           │    │
│  │      }                                                  │    │
│  │    }                                                    │    │
│  │                                                         │    │
│  │    // On valid utterance:                               │    │
│  │    trim_silence(buffer)                                 │    │
│  │    normalize_audio_level(buffer)  // target RMS 0.1     │    │
│  │    wav_b64 = samples_to_wav_b64(buffer, sample_rate)    │    │
│  │    emit("speech-detected", wav_b64)                     │    │
│  │                                                         │    │
│  │    sleep(10ms)                                          │    │
│  │  }                                                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼ Tauri Event ("speech-detected")
┌─────────────────────────────────────────────────────────────────┐
│                  FRONTEND (React/TypeScript)                    │
│                                                                 │
│  listen("speech-detected", async (event) => {                  │
│                                                                 │
│    // 1. Decode base64 → AudioBlob                             │
│    base64Audio = event.payload                                 │
│    audioBlob = atob(base64) → Uint8Array → Blob("audio/wav")  │
│                                                                 │
│    // 2. Send to STT provider                                  │
│    setIsProcessing(true)                                       │
│    transcription = await fetchSTT({                            │
│      provider: providerConfig,                                 │
│      audio: audioBlob                                          │
│    })  // 30-second timeout                                    │
│                                                                 │
│    // 3. Validate transcription                                │
│    if (transcription.trim()) {                                 │
│      setLastTranscription(transcription)                       │
│                                                                 │
│      // 4. Build AI context                                    │
│      effectivePrompt = useSystemPrompt                         │
│        ? systemPrompt                                          │
│        : contextContent                                        │
│      previousMessages = conversation.messages                  │
│                                                                 │
│      // 5. Stream AI response                                  │
│      setIsAIProcessing(true)                                   │
│      for await (chunk of fetchAIResponse({                     │
│        provider, systemPrompt, history, userMessage            │
│      })) {                                                     │
│        fullResponse += chunk                                   │
│        setLastAIResponse(fullResponse)  // real-time update    │
│      }                                                         │
│                                                                 │
│      // 6. Save to conversation                                │
│      conversation.messages.push(                               │
│        { role: "user", content: transcription },               │
│        { role: "assistant", content: fullResponse }            │
│      )                                                         │
│      saveConversation()  // debounced 500ms                    │
│                                                                 │
│      // 7. Reset state                                         │
│      setIsAIProcessing(false)                                  │
│      setLastTranscription("")                                  │
│    }                                                           │
│    setIsProcessing(false)                                      │
│  })                                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. VAD State Machine (Detailed)

```
                        Initial State
                             │
                    (buffer empty, pre_speech empty)
                    (in_speech = false)
                             │
                             ▼
    ┌────────────────────────────────────────────────┐
    │                                                │
    │  [SILENCE]                                     │
    │                                                │
    │  Condition: RMS < 0.012 AND peak < 0.035       │
    │                                                │
    │  Actions:                                      │
    │  ├─ pre_speech.extend(chunk)                  │
    │  ├─ Maintain circular buffer (12 × 1024)      │
    │  └─ Periodically trim to capacity             │
    │                                                │
    │         (repeat until speech detected)         │
    │                                                │
    └────────────────────┬───────────────────────────┘
                         │
                         │ Speech Onset Detected
                         │ (RMS > 0.012 OR peak > 0.035)
                         ▼
    ┌────────────────────────────────────────────────┐
    │                                                │
    │  [SPEECH START]                                │
    │                                                │
    │  First transition from silence to speech       │
    │                                                │
    │  Actions:                                      │
    │  ├─ in_speech = true                          │
    │  ├─ speech_chunks = 1                         │
    │  ├─ silence_chunks = 0                        │
    │  ├─ speech_buffer.extend(pre_speech)          │
    │  ├─ speech_buffer.extend(chunk)               │
    │  └─ emit("speech-start")                      │
    │                                                │
    └────────────────────┬───────────────────────────┘
                         │
                         ▼
    ┌────────────────────────────────────────────────┐
    │                                                │
    │  [ACTIVE SPEECH]                               │
    │                                                │
    │  Continuous speech being detected              │
    │                                                │
    │  While RMS > 0.012 OR peak > 0.035:            │
    │  ├─ speech_chunks++                           │
    │  ├─ silence_chunks = 0  (reset)               │
    │  ├─ speech_buffer.extend(chunk)               │
    │  └─ Safety check: buffer > 30 × sample_rate?  │
    │     ├─ YES: force emit, reset (30s cap)       │
    │     └─ NO: continue                           │
    │                                                │
    └────────────────────┬───────────────────────────┘
                         │
                         │ Silence detected (RMS < 0.012 AND peak < 0.035)
                         ▼
    ┌────────────────────────────────────────────────┐
    │                                                │
    │  [SILENCE COUNTING]                            │
    │                                                │
    │  Speech may have ended, or it's just a pause   │
    │                                                │
    │  Actions:                                      │
    │  ├─ silence_chunks++                          │
    │  ├─ speech_buffer.extend(chunk)  (keep tail)  │
    │  └─ Check: silence_chunks >= 45? (~1.0s)      │
    │     ├─ NO: return to ACTIVE SPEECH (loop)     │
    │     └─ YES: → SPEECH COMPLETE                 │
    │                                                │
    └────────────────────┬───────────────────────────┘
                         │
                         │ silence_chunks >= 45
                         ▼
    ┌────────────────────────────────────────────────┐
    │                                                │
    │  [SPEECH COMPLETE] — Decision Point            │
    │                                                │
    │  Validate: speech_chunks >= 7? (~0.16s min)    │
    │                                                │
    │  ├─ YES (valid speech):                       │
    │  │  ├─ Trim trailing silence (keep ~0.15s)    │
    │  │  ├─ normalize_audio_level()                │
    │  │  ├─ samples_to_wav_b64()                   │
    │  │  ├─ emit("speech-detected", base64_wav)    │
    │  │  └─ Reset all state → back to [SILENCE]    │
    │  │                                             │
    │  └─ NO (too short — noise/click):             │
    │     ├─ emit("speech-discarded")               │
    │     └─ Reset all state → back to [SILENCE]    │
    │                                                │
    │  Safety Cap:                                   │
    │  ├─ If speech_buffer > 30 × sample_rate:      │
    │  │  ├─ Force emit immediately                 │
    │  │  ├─ Reset state                            │
    │  │  └─ Resume listening (prevents DoS)        │
    │  └─ Max total duration: 180s                  │
    │                                                │
    └────────────────────────────────────────────────┘
```

---

## 12. Key Technical Insights

### 1. VAD Optimization

- **Dual-threshold detection**: RMS OR peak (independent logic)
  - RMS catches sustained speech
  - Peak catches sudden sounds (plosives, prevents mis-gating)
- **Pre-speech buffer**: 12 chunks (~0.28s) captures word onsets naturally
- **Silence tolerance**: 45 chunks (~1.0s) allows natural pauses within sentences
- **Noise gate**: Soft knee (not hard cutoff) prevents artifact clicks

### 2. Audio Quality

- **16-bit signed integer WAV** — universal STT provider compatibility
- **Mono channel** — speech is inherently mono; stereo is unnecessary overhead
- **Normalization** — Target RMS 0.1, soft saturation above 1.0 (no clipping)
- **Sample rate range** — 8–96 kHz (platform-dependent, usually 44.1 or 48 kHz)

### 3. Buffer Management

- **Ring buffer size**: 131,072 samples (128 KB)
  - At 44.1 kHz: ~3 seconds of audio headroom
  - Windows/Linux: `VecDeque` (mutex-protected)
  - macOS: `HeapRb` (lock-free SPSC)
- **Overflow strategy**: Drop oldest samples (latency > data completeness)
- **Poll-based async reads**: Integrates with Tokio without complex waker patterns

### 4. Event-Driven Architecture

- **Tauri events** (one-way, backend → frontend):
  - Speech detection: `speech-detected` (payload = base64 WAV)
  - Progress: `recording-progress`, `speech-start`, `speech-discarded`
  - Errors: `audio-encoding-error`
- **Tauri commands** (request/response, frontend → backend):
  - Block until complete (async handlers supported)
  - Return `Result<T, String>` for error handling

### 5. Storage & Persistence

| Data | Storage | Durability |
|------|---------|------------|
| VAD Config | localStorage JSON | Survives app restart |
| STT Provider | localStorage string | Survives app restart |
| Conversation | IndexedDB | Survives app restart (debounced 500ms save) |
| Quick Actions | localStorage JSON array | Survives app restart |
| Context Settings | localStorage | Survives app restart |

### 6. Error Handling

The system handles errors at multiple layers:
- **Platform layer**: Device not found, permission denied, format mismatch
- **VAD layer**: Buffer overflow, encoding failure, timeout
- **Transport layer**: Tauri event delivery failure
- **STT layer**: Network timeout (30s), provider error, empty transcription
- **AI layer**: Streaming failure, provider error

Each error is propagated to the frontend via either `Result<T, String>` (commands) or the `audio-encoding-error` event and displayed in the Operation Section.

---

## 13. Performance Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Hop size | 1,024 samples | ~23ms per VAD decision |
| VAD latency | ~100–150ms | Detection + encoding overhead |
| Ring buffer | 128 KB | ~3 seconds audio headroom |
| Memory per stream | ~2 MB | Buffer + state + working memory |
| CPU (VAD mode) | <5% | Single thread, optimized math |
| CPU (continuous) | <2% | Mostly I/O bound |
| FFT bins (visualizer) | 256 | From FFT_SIZE=512 |
| Visualizer FPS | 60 | `requestAnimationFrame` sync |
| Max utterance | 30 seconds | Safety cap (auto-segmented) |
| Max continuous | 180 seconds | Configurable, default 3 minutes |
| STT timeout | 30 seconds | Per-transcription limit |
| Conversation save | 500ms debounce | Prevents excessive writes |

---

## 14. Implementation Guide — How to Build This

### Prerequisites

- **Rust**: 1.70+ with Cargo
- **Tauri 2.x**: Desktop framework
- **Node.js 18+**: Frontend tooling
- **React 18+**: UI framework
- **Platform SDKs**: Windows SDK, Xcode (macOS), PulseAudio dev headers (Linux)

### Step 1: Add Rust Dependencies

```toml
# Cargo.toml

[dependencies]
tauri = { version = "2", features = ["..."] }
tokio = { version = "1", features = ["full"] }
hound = "3.5"          # WAV encoding
base64 = "0.22"        # Transport encoding
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[target.'cfg(windows)'.dependencies]
wasapi = "0.19"        # WASAPI loopback capture

[target.'cfg(target_os = "macos")'.dependencies]
cidre = "0.x"          # CoreAudio process tap
ringbuf = "0.4"        # Lock-free SPSC ring buffer

[target.'cfg(target_os = "linux")'.dependencies]
libpulse-binding = "2" # PulseAudio monitor source
```

### Step 2: Define the Platform Abstraction

```rust
// src-tauri/src/speaker/mod.rs

pub trait SpeakerInput: Send + 'static {
    fn read_samples(&mut self) -> Vec<f32>;
    fn sample_rate(&self) -> u32;
    fn stop(&mut self);
}

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

pub mod commands;

// Type alias for the platform-specific implementation
#[cfg(target_os = "windows")]
pub type SpeakerStream = windows::WindowsSpeaker;
#[cfg(target_os = "macos")]
pub type SpeakerStream = macos::MacOSSpeaker;
#[cfg(target_os = "linux")]
pub type SpeakerStream = linux::LinuxSpeaker;

pub fn create_speaker_stream(device_index: Option<usize>) -> Result<SpeakerStream, String> {
    #[cfg(target_os = "windows")]
    { windows::WindowsSpeaker::new(device_index) }
    #[cfg(target_os = "macos")]
    { macos::MacOSSpeaker::new() }
    #[cfg(target_os = "linux")]
    { linux::LinuxSpeaker::new(device_index) }
}
```

### Step 3: Implement Platform Capture (Windows Example)

```rust
// src-tauri/src/speaker/windows.rs

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use wasapi::*;

const MAX_BUFFER_SIZE: usize = 131_072; // 128 KB ring buffer

pub struct WindowsSpeaker {
    buffer: Arc<Mutex<VecDeque<f32>>>,
    sample_rate: u32,
    running: Arc<Mutex<bool>>,
    _capture_thread: thread::JoinHandle<()>,
}

impl WindowsSpeaker {
    pub fn new(device_index: Option<usize>) -> Result<Self, String> {
        let buffer = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_BUFFER_SIZE)));
        let running = Arc::new(Mutex::new(true));

        // Initialize WASAPI, select device, get sample rate
        // Spawn capture thread that writes into buffer
        // ...

        Ok(Self { buffer, sample_rate, running, _capture_thread })
    }
}

impl super::SpeakerInput for WindowsSpeaker {
    fn read_samples(&mut self) -> Vec<f32> {
        let mut buf = self.buffer.lock().unwrap();
        buf.drain(..).collect() // Drain all available samples
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn stop(&mut self) {
        *self.running.lock().unwrap() = false;
    }
}
```

### Step 4: Implement the VAD Engine

```rust
// src-tauri/src/speaker/commands.rs

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub hop_size: usize,                      // 1024
    pub sensitivity_rms: f32,                 // 0.012
    pub peak_threshold: f32,                  // 0.035
    pub silence_chunks: usize,                // 45
    pub min_speech_chunks: usize,             // 7
    pub pre_speech_chunks: usize,             // 12
    pub noise_gate_threshold: f32,            // 0.003
    pub max_recording_duration_secs: u64,     // 180
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
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

fn calc_peak(samples: &[f32]) -> f32 {
    samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max)
}

fn normalize_audio_level(samples: &mut [f32]) {
    let target_rms = 0.1;
    let current_rms = calc_rms(samples);
    if current_rms < 1e-6 { return; }

    let gain = (target_rms / current_rms).min(10.0);
    for sample in samples.iter_mut() {
        *sample *= gain;
        if sample.abs() > 1.0 {
            *sample = sample.signum() * (1.0 - (-sample.abs() + 1.0).exp().ln());
        }
    }
}

fn samples_to_wav_b64(samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut cursor, spec)
        .map_err(|e| e.to_string())?;
    for &s in samples {
        let clamped = s.max(-1.0).min(1.0);
        writer.write_sample((clamped * 32767.0) as i16)
            .map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(cursor.into_inner()))
}

// The main VAD capture command
#[tauri::command]
pub async fn start_vad_capture(
    app: AppHandle,
    config: VadConfig,
    device_index: Option<usize>,
) -> Result<(), String> {
    let mut speaker = super::create_speaker_stream(device_index)?;
    let sample_rate = speaker.sample_rate();

    app.emit("capture-started", ()).ok();

    tokio::spawn(async move {
        let mut speech_buffer: Vec<f32> = Vec::new();
        let mut pre_speech: VecDeque<f32> = VecDeque::new();
        let mut in_speech = false;
        let mut speech_chunks: usize = 0;
        let mut silence_chunks: usize = 0;
        let start = Instant::now();
        let max_pre = config.pre_speech_chunks * config.hop_size;

        loop {
            // Check max duration
            if start.elapsed().as_secs() > config.max_recording_duration_secs {
                break;
            }

            let samples = speaker.read_samples();
            if samples.is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
                continue;
            }

            for chunk in samples.chunks(config.hop_size) {
                let mut chunk = chunk.to_vec();
                apply_noise_gate(&mut chunk, config.noise_gate_threshold);

                let rms = calc_rms(&chunk);
                let peak = calc_peak(&chunk);
                let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

                if is_speech {
                    if !in_speech {
                        in_speech = true;
                        speech_chunks = 1;
                        silence_chunks = 0;
                        speech_buffer.extend(pre_speech.iter());
                        app.emit("speech-start", ()).ok();
                    } else {
                        speech_chunks += 1;
                        silence_chunks = 0;
                    }
                    speech_buffer.extend_from_slice(&chunk);

                    // 30-second utterance safety cap
                    if speech_buffer.len() > 30 * sample_rate as usize {
                        normalize_audio_level(&mut speech_buffer);
                        match samples_to_wav_b64(&speech_buffer, sample_rate) {
                            Ok(wav) => { app.emit("speech-detected", wav).ok(); }
                            Err(e) => { app.emit("audio-encoding-error", e).ok(); }
                        }
                        speech_buffer.clear();
                        pre_speech.clear();
                        in_speech = false;
                        speech_chunks = 0;
                        silence_chunks = 0;
                    }
                } else if in_speech {
                    silence_chunks += 1;
                    speech_buffer.extend_from_slice(&chunk);

                    if silence_chunks >= config.silence_chunks {
                        if speech_chunks >= config.min_speech_chunks {
                            // Valid speech — encode and emit
                            normalize_audio_level(&mut speech_buffer);
                            match samples_to_wav_b64(&speech_buffer, sample_rate) {
                                Ok(wav) => { app.emit("speech-detected", wav).ok(); }
                                Err(e) => { app.emit("audio-encoding-error", e).ok(); }
                            }
                        } else {
                            // Too short — discard
                            app.emit("speech-discarded", ()).ok();
                        }
                        speech_buffer.clear();
                        pre_speech.clear();
                        in_speech = false;
                        speech_chunks = 0;
                        silence_chunks = 0;
                    }
                } else {
                    // Maintain pre-speech circular buffer
                    pre_speech.extend(chunk.iter());
                    while pre_speech.len() > max_pre {
                        pre_speech.pop_front();
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        speaker.stop();
        app.emit("capture-stopped", ()).ok();
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_vad_capture(app: AppHandle) -> Result<(), String> {
    app.emit("manual-stop-capture", ()).ok();
    Ok(())
}
```

### Step 5: Register Tauri Commands

```rust
// src-tauri/src/lib.rs

mod speaker;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            speaker::commands::start_vad_capture,
            speaker::commands::stop_vad_capture,
            speaker::commands::start_continuous_capture,
            speaker::commands::stop_continuous_capture,
            speaker::commands::update_vad_config,
            speaker::commands::get_vad_config,
            speaker::commands::get_audio_devices,
            speaker::commands::check_audio_permissions,
            speaker::commands::request_audio_permissions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Step 6: Frontend Hook (TypeScript)

```typescript
// src/hooks/useSystemAudio.ts

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, useCallback } from "react";

interface VadConfig {
    hop_size: number;
    sensitivity_rms: number;
    peak_threshold: number;
    silence_chunks: number;
    min_speech_chunks: number;
    pre_speech_chunks: number;
    noise_gate_threshold: number;
    max_recording_duration_secs: number;
}

const DEFAULT_VAD_CONFIG: VadConfig = {
    hop_size: 1024,
    sensitivity_rms: 0.012,
    peak_threshold: 0.035,
    silence_chunks: 45,
    min_speech_chunks: 7,
    pre_speech_chunks: 12,
    noise_gate_threshold: 0.003,
    max_recording_duration_secs: 180,
};

export function useSystemAudio() {
    const [capturing, setCapturing] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);
    const [lastTranscription, setLastTranscription] = useState("");
    const [lastAIResponse, setLastAIResponse] = useState("");
    const [error, setError] = useState("");
    const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);

    const unlistenRefs = useRef<UnlistenFn[]>([]);

    // Setup event listeners
    useEffect(() => {
        const setupListeners = async () => {
            const unlistens: UnlistenFn[] = [];

            // Core: speech detected
            unlistens.push(
                await listen<string>("speech-detected", async (event) => {
                    const base64Audio = event.payload;

                    // Decode base64 → WAV Blob
                    const binaryString = atob(base64Audio);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const audioBlob = new Blob([bytes], { type: "audio/wav" });

                    // Send to your STT provider
                    setIsProcessing(true);
                    try {
                        const transcription = await sendToSTT(audioBlob);
                        if (transcription.trim()) {
                            setLastTranscription(transcription);
                            // Process with AI...
                            await processWithAI(transcription);
                        }
                    } catch (err) {
                        setError(String(err));
                    } finally {
                        setIsProcessing(false);
                    }
                })
            );

            // Status events
            unlistens.push(await listen("capture-started", () => setCapturing(true)));
            unlistens.push(await listen("capture-stopped", () => setCapturing(false)));
            unlistens.push(
                await listen<string>("audio-encoding-error", (e) => setError(e.payload))
            );

            unlistenRefs.current = unlistens;
        };

        setupListeners();

        return () => {
            unlistenRefs.current.forEach((unlisten) => unlisten());
        };
    }, []);

    // Start capture
    const startCapture = useCallback(async () => {
        try {
            await invoke("start_vad_capture", {
                config: vadConfig,
                deviceIndex: null,
            });
        } catch (err) {
            setError(String(err));
        }
    }, [vadConfig]);

    // Stop capture
    const stopCapture = useCallback(async () => {
        try {
            await invoke("stop_vad_capture");
        } catch (err) {
            setError(String(err));
        }
    }, []);

    return {
        capturing,
        isProcessing,
        isAIProcessing,
        lastTranscription,
        lastAIResponse,
        error,
        vadConfig,
        startCapture,
        stopCapture,
    };
}
```

### Step 7: Audio Visualizer Component (React)

```tsx
// src/components/AudioVisualizer.tsx

import { useEffect, useRef } from "react";

const FFT_SIZE = 512;
const SMOOTHING = 0.8;

export function AudioVisualizer({ stream }: { stream: MediaStream | null }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);

    useEffect(() => {
        if (!stream || !canvasRef.current) return;

        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount; // 256
        const dataArray = new Uint8Array(bufferLength);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d")!;

        const draw = () => {
            animFrameRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            // DPI-aware canvas sizing
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            ctx.clearRect(0, 0, rect.width, rect.height);

            const barWidth = rect.width / bufferLength;
            const centerY = rect.height / 2;

            for (let i = 0; i < bufferLength; i++) {
                const value = dataArray[i] / 255;
                const barHeight = value * centerY;
                const x = i * barWidth;
                const grey = Math.floor(100 + value * 155);

                ctx.fillStyle = `rgb(${grey}, ${grey}, ${grey})`;
                // Mirror above and below center
                ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight);
                ctx.fillRect(x, centerY, barWidth - 1, barHeight);
            }
        };

        draw();

        return () => {
            cancelAnimationFrame(animFrameRef.current);
            audioCtx.close();
        };
    }, [stream]);

    return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />;
}
```

### Architecture Checklist

- [ ] Define `SpeakerInput` trait with `read_samples()`, `sample_rate()`, `stop()`
- [ ] Implement WASAPI loopback (Windows)
- [ ] Implement CoreAudio process tap (macOS)
- [ ] Implement PulseAudio monitor (Linux)
- [ ] Ring buffer with overflow handling (128 KB)
- [ ] Noise gate with soft knee
- [ ] VAD state machine (SILENCE → SPEECH → EMIT/DISCARD)
- [ ] Pre-speech circular buffer (12 hops)
- [ ] Audio normalization (target RMS 0.1)
- [ ] WAV encoding (hound, 16-bit mono PCM)
- [ ] Base64 encoding for Tauri event transport
- [ ] Register 9 Tauri commands
- [ ] Emit 10 Tauri events
- [ ] Frontend hook with event listeners
- [ ] STT integration (provider-agnostic)
- [ ] AI response streaming
- [ ] Conversation persistence (IndexedDB)
- [ ] Audio visualizer (Canvas FFT)
- [ ] VAD config panel with live-update sliders
- [ ] Keyboard shortcuts (Alt+Space for toggle capture)

---

## File Reference

| File | Purpose | Lines |
|------|---------|-------|
| `src-tauri/src/speaker/mod.rs` | Platform abstraction trait, factory function | ~100 |
| `src-tauri/src/speaker/commands.rs` | VAD engine, continuous capture, encoding, 9 Tauri commands | ~600 |
| `src-tauri/src/speaker/windows.rs` | WASAPI loopback implementation | ~200 |
| `src-tauri/src/speaker/macos.rs` | CoreAudio process tap implementation | ~250 |
| `src-tauri/src/speaker/linux.rs` | PulseAudio monitor implementation | ~150 |
| `src/hooks/useSystemAudio.ts` | Frontend orchestration hook | ~700 |
| `src/pages/app/components/speech/index.tsx` | Speech button + popover UI | ~200 |
| `src/pages/app/components/speech/audio-visualizer.tsx` | Canvas FFT frequency bars | ~150 |
| `src/pages/app/components/speech/VadConfigPanel.tsx` | VAD parameter sliders | ~200 |
| `src/pages/app/components/speech/OperationSection.tsx` | Transcription + AI response display | ~200 |

---

*Generated from analysis of the Pluely codebase. This document covers the complete system audio capture pipeline — from hardware loopback through Voice Activity Detection, encoding, Speech-to-Text, and AI response streaming.*
