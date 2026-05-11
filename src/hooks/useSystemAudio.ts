import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/platform";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VadConfig {
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  hop_size: 1024,
  sensitivity_rms: 0.012,
  peak_threshold: 0.035,
  silence_chunks: 45,
  min_speech_chunks: 7,
  pre_speech_chunks: 12,
  noise_gate_threshold: 0.003,
  max_recording_duration_secs: 180,
};

interface SttTranscript {
  text: string;
  is_final: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSystemAudio(onTranscript: (text: string) => void) {
  // --- Capture state ---
  const [capturing, setCapturing] = useState(false);
  const [isProcessing] = useState(false); // kept for API compat
  const [lastTranscription, setLastTranscription] = useState("");
  const [error, setError] = useState("");
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);

  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const assemblyAiActiveRef = useRef(false);
  const lastFinalSentRef = useRef<string>(""); // dedup identical consecutive finals
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // --- Partials: only update the live banner, never trigger AI ---
  const handlePartialTranscript = useCallback((text: string) => {
    setLastTranscription(text);
  }, []);

  // --- Final: send to AI once per unique turn result ---
  const handleFinalTranscript = useCallback((text: string) => {
    setLastTranscription(text);
    if (!text.trim()) return;
    if (lastFinalSentRef.current === text) {
      // Duplicate final from overlapping VAD windows — skip
      console.log("[SystemAudio] Duplicate final — skipping");
      return;
    }
    lastFinalSentRef.current = text;
    console.log("[SystemAudio] Sending final to AI:", text.slice(0, 80));
    onTranscriptRef.current(text);
  }, []);

  // --- Setup Tauri event listeners ---
  useEffect(() => {
    const setupListeners = async () => {
      const unlistens: UnlistenFn[] = [];

      // AssemblyAI real-time: partial transcript → stabilization layer
      unlistens.push(
        await listen<SttTranscript>("stt-partial", (event) => {
          handlePartialRef.current(event.payload.text);
        })
      );

      // AssemblyAI real-time: final turn → speculative-aware handler
      unlistens.push(
        await listen<SttTranscript>("stt-final", async (event) => {
          console.log("[SystemAudio] AssemblyAI turn:", event.payload.text);
          await handleFinalRef.current(event.payload.text);
        })
      );

      // AssemblyAI: unexpected WS drop — reconnect after 2s
      unlistens.push(
        await listen("stt-disconnected", async () => {
          console.warn("[SystemAudio] AssemblyAI WS dropped — reconnecting in 2s");
          await new Promise((r) => setTimeout(r, 2000));
          if (assemblyAiActiveRef.current) {
            try {
              await invoke("open_realtime_stt");
              console.log("[SystemAudio] AssemblyAI reconnected");
            } catch (e) {
              console.error("[SystemAudio] Reconnect failed:", e);
            }
          }
        })
      );

      // Status events — capture-stopped is the only one we trust for state sync.
      // We do NOT set capturing=true from capture-started because that event can
      // arrive AFTER the user has already clicked stop (late Tauri event delivery),
      // which would flip capturing back to true and trigger an unwanted auto-restart.
      // capturing=true is set optimistically in startCapture() instead.
      unlistens.push(
        await listen("capture-started", () => {
          console.log("[SystemAudio] Capture started (confirmed by Rust)");
          // Intentionally not calling setCapturing(true) here — handled optimistically.
        })
      );
      unlistens.push(
        await listen("capture-stopped", () => {
          console.log("[SystemAudio] Capture stopped (confirmed by Rust)");
          setCapturing(false);
        })
      );
      unlistens.push(
        await listen("speech-start", () => {
          console.log("[SystemAudio] Speech onset");
        })
      );
      unlistens.push(
        await listen("speech-discarded", () => {
          console.log("[SystemAudio] Speech discarded (too short)");
        })
      );
      unlistens.push(
        await listen<string>("audio-encoding-error", (event) => {
          console.error("[SystemAudio] Encoding error:", event.payload);
          setError(event.payload);
        })
      );
      unlistens.push(
        await listen<number>("recording-progress", (event) => {
          console.log("[SystemAudio] Recording progress:", event.payload, "s");
        })
      );

      unlistenRefs.current = unlistens;
    };

    if (isTauri()) {
      setupListeners();
    }

    return () => {
      unlistenRefs.current.forEach((unlisten) => unlisten());
      unlistenRefs.current = [];
      // Close AssemblyAI session on unmount (Tauri only)
      if (isTauri()) {
        invoke("close_realtime_stt").catch(() => {});
      }
    };
    // processSpeech is intentionally omitted to avoid re-registering listeners
    // on every conversation change — we use a ref-based approach in the listener
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep handlers up to date via refs so listeners always use the latest state
  const handlePartialRef = useRef(handlePartialTranscript);
  handlePartialRef.current = handlePartialTranscript;

  const handleFinalRef = useRef(handleFinalTranscript);
  handleFinalRef.current = handleFinalTranscript;

  // --- Actions ---

  const startCapture = useCallback(async () => {
    setCapturing(true); // optimistic: update UI immediately, don't wait for Rust event
    try {
      setError("");
      await invoke("open_realtime_stt");
      assemblyAiActiveRef.current = true;
      console.log("[SystemAudio] AssemblyAI streaming session opened");
      await invoke("start_vad_capture", {
        config: vadConfig,
        deviceIndex: null,
      });
    } catch (err) {
      setCapturing(false); // revert on failure
      setError(String(err));
    }
  }, [vadConfig]);

  const stopCapture = useCallback(async () => {
    setCapturing(false); // optimistic: update UI immediately, don't wait for Rust event
    try {
      await invoke("stop_vad_capture");
      await invoke("close_realtime_stt");
      assemblyAiActiveRef.current = false;
      lastFinalSentRef.current = "";
      setLastTranscription("");
    } catch (err) {
      setCapturing(true); // revert on failure — stop didn't work
      setError(String(err));
    }
  }, []);

  const startContinuousRecording = useCallback(async () => {
    try {
      setError("");
      await invoke("start_continuous_capture", { deviceIndex: null });
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const stopContinuousRecording = useCallback(async () => {
    try {
      await invoke("stop_continuous_capture");
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const updateVadConfig = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      await invoke("update_vad_config", { config });
    } catch (err) {
      console.error("[SystemAudio] Failed to update VAD config:", err);
    }
  }, []);

  const abortAI = useCallback(() => {
    // No-op: abort is handled by useCompletion in the parent
  }, []);

  const clearConversation = useCallback(() => {
    setLastTranscription("");
    setError("");
  }, []);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  return {
    // State
    capturing,
    isProcessing,
    lastTranscription,
    error,
    vadConfig,
    // Actions
    startCapture,
    stopCapture,
    startContinuousRecording,
    stopContinuousRecording,
    updateVadConfig,
    abortAI,
    clearConversation,
    clearError,
  };
}
