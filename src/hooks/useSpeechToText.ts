import { useState, useRef, useCallback } from "react";
import { useToast } from "@/hooks/useToast";

// Web Speech API types (not included in all TS configs)
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

/**
 * Hook for browser-native speech-to-text using the Web Speech API.
 * Works in Chromium-based WebViews (Tauri uses WebView2 on Windows).
 */
export function useSpeechToText() {
  const toast = useToast();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Tracks user intent: true = user wants mic on, false = user stopped it.
  // Web Speech API fires onend during silence gaps even in continuous mode — we
  // use this ref to auto-restart rather than treating those as intentional stops.
  const shouldBeListeningRef = useRef(false);

  const start = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("[STT] SpeechRecognition not supported");
      toast.error("Microphone input is not supported in this environment");
      return;
    }

    // Stop any existing session
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(final || interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("[STT] Error:", event.error);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error(`Microphone error: ${event.error}`);
        // Non-recoverable error — stop trying to restart
        shouldBeListeningRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Chrome/WebView2 fires onend during silence gaps even in continuous mode.
      // If the user hasn't explicitly stopped, auto-restart so the button stays active.
      if (shouldBeListeningRef.current && recognitionRef.current === recognition) {
        setTimeout(() => {
          if (shouldBeListeningRef.current && recognitionRef.current === recognition) {
            try {
              recognition.start();
            } catch {
              // start() throws if already running — safe to ignore
            }
          }
        }, 100);
        return;
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    shouldBeListeningRef.current = true;
    recognition.start();
    setIsListening(true);
    setTranscript("");
  }, []);

  const stop = useCallback((): string => {
    shouldBeListeningRef.current = false; // signal onend NOT to auto-restart
    const currentTranscript = transcript;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    return currentTranscript;
  }, [transcript]);

  const toggle = useCallback(() => {
    if (isListening) {
      return stop();
    } else {
      start();
      return "";
    }
  }, [isListening, start, stop]);

  return { isListening, transcript, start, stop, toggle };
}
