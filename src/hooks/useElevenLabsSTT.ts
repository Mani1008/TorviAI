import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const ELEVENLABS_STT_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const ELEVENLABS_MODEL = "scribe_v2_realtime";

interface ElevenLabsSTTOptions {
  apiKey: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  languageCode?: string;
}

/**
 * Hook for real-time speech-to-text using ElevenLabs Scribe v2 via WebSocket.
 * Captures system audio (WASAPI loopback) from Rust and streams to ElevenLabs.
 * VAD auto-detects when speech ends and commits the transcript.
 */
export function useElevenLabsSTT() {
  const [isListening, setIsListening] = useState(false);
  const [partialText, setPartialText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const optionsRef = useRef<ElevenLabsSTTOptions | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = useCallback(async (options: ElevenLabsSTTOptions) => {
    if (wsRef.current) return;
    optionsRef.current = options;

    try {
      // 1. Connect WebSocket to ElevenLabs
      const params = new URLSearchParams({
        model_id: ELEVENLABS_MODEL,
        commit_strategy: "vad",
        vad_silence_threshold_secs: "1.5",
        vad_threshold: "0.4",
        audio_format: "pcm_16000",
        include_timestamps: "false",
      });
      if (options.languageCode) {
        params.set("language_code", options.languageCode);
      }

      const wsUrl = `${ELEVENLABS_STT_URL}?${params.toString()}&xi-api-key=${encodeURIComponent(options.apiKey)}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = async () => {
        console.log("[ElevenLabs STT] WebSocket connected");
        setIsListening(true);

        // 2. Start Rust WASAPI loopback capture
        try {
          await invoke("start_audio_capture");
          console.log("[ElevenLabs STT] Audio capture started");
        } catch (e) {
          console.error("[ElevenLabs STT] Failed to start audio capture:", e);
          options.onError?.(`Audio capture failed: ${e}`);
          ws.close();
          return;
        }

        // Listen for audio capture errors from Rust
        const unlistenError = await listen<string>("audio-capture-error", (event) => {
          console.error("[ElevenLabs STT] Rust audio error:", event.payload);
          options.onError?.(`Audio error: ${event.payload}`);
        });

        // 3. Listen for audio chunks from Rust and forward to WebSocket
        let chunkCount = 0;
        const unlisten = await listen<string>("audio-chunk", (event) => {
          chunkCount++;
          if (chunkCount <= 5 || chunkCount % 100 === 0) {
            console.log(`[ElevenLabs STT] Audio chunk #${chunkCount}, size: ${event.payload.length} chars`);
          }
          if (ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
              message_type: "input_audio_chunk",
              audio_base_64: event.payload,
            });
            ws.send(message);
          }
        });
        // Store both unlisteners
        const origUnlisten = unlisten;
        unlistenRef.current = () => {
          origUnlisten();
          unlistenError();
        };
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[ElevenLabs STT] Message:", data.message_type, data.text || "");
          switch (data.message_type) {
            case "session_started":
              console.log("[ElevenLabs STT] Session started:", data.session_id);
              break;

            case "partial_transcript":
              if (data.text) {
                setPartialText(data.text);
              }
              break;

            case "committed_transcript":
              if (data.text) {
                setPartialText("");
                optionsRef.current?.onTranscript(data.text, true);
              }
              break;

            case "committed_transcript_with_timestamps":
              if (data.text) {
                setPartialText("");
                optionsRef.current?.onTranscript(data.text, true);
              }
              break;

            default:
              // Handle error types
              if (data.message_type?.includes("error")) {
                console.error("[ElevenLabs STT] Error:", data);
                optionsRef.current?.onError?.(data.message || data.message_type);
              }
              break;
          }
        } catch {
          // Non-JSON message, ignore
        }
      };

      ws.onerror = (event) => {
        console.error("[ElevenLabs STT] WebSocket error:", event);
        options.onError?.("WebSocket connection failed");
      };

      ws.onclose = (event) => {
        console.log("[ElevenLabs STT] WebSocket closed:", event.code, event.reason);
        cleanup();
      };

      wsRef.current = ws;
    } catch (e) {
      console.error("[ElevenLabs STT] Setup error:", e);
      options.onError?.(`Setup failed: ${e}`);
    }
  }, []);

  const cleanup = useCallback(() => {
    // Stop Rust audio capture
    invoke("stop_audio_capture").catch(console.error);

    // Remove audio chunk listener
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    setIsListening(false);
    setPartialText("");
  }, []);

  const stopListening = useCallback(() => {
    if (wsRef.current) {
      // Send EOS to ElevenLabs
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ message_type: "eos" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();
  }, [cleanup]);

  return {
    isListening,
    partialText,
    startListening,
    stopListening,
  };
}
