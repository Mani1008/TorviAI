import { useRef, useEffect, useState, useCallback } from "react";
import { TextInput } from "@/components/TextInput";
import { Markdown } from "@/components/Markdown";
import { useCompletion } from "@/hooks/useCompletion";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useSystemAudio } from "@/hooks/useSystemAudio";
import { useTheme } from "@/contexts/theme.context";
import { UsageTimer } from "@/components/UsageTimer";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/Toast";
import { getModelById } from "@/config/models.constants";
import { loadSelectedModel } from "@/lib/storage/ai-providers";
import { addListeningSeconds } from "@/lib/storage/usage-stats";

// The pill bar is the only transparent window — override the global dark background
function useTransparentWindow() {
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
  }, []);
}
import {
  Settings,
  Square,
  Trash2,
  X,
  AlertCircle,
  GripVertical,
  Headphones,
  HeadphoneOff,
  Sparkles,
  Contrast,
  Camera,
  Mic,
  MicOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
// ─── Thinking indicator ───────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      <span className="dot dot-1" />
      <span className="dot dot-2" />
      <span className="dot dot-3" />
    </div>
  );
}

// ─── Status chip ──────────────────────────────────────────────────────────────
function StatusChip({ label, pulse = false }: { label: string; pulse?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${pulse ? "animate-pulse" : ""}` }>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
      <span className="text-[11px] font-medium tracking-wide text-white/50">{label}</span>
    </div>
  );
}

export default function App() {
  useTransparentWindow();
  const { messages, isLoading, error, sendMessage, abort, clearMessages, clearError } =
    useCompletion();
  const { isListening: isMicListening, transcript, stop: stopListening, toggle: toggleMic } = useSpeechToText();
  const {
    capturing,
    isProcessing: isSttProcessing,
    lastTranscription,
    error: systemAudioError,
    startCapture,
    stopCapture,
    clearConversation: clearSystemConversation,
    clearError: clearSystemError,
  } = useSystemAudio(sendMessage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [sttText, setSttText] = useState("");
  const [showIntensity, setShowIntensity] = useState(false);
  const [screenImage, setScreenImage] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const { transparency, setTransparency } = useTheme();
  const toast = useToast();
  const glassAlpha = transparency / 100;

  // Build slides: each AI response paired with its preceding user message
  const slides = messages.reduce<{ user?: typeof messages[0]; assistant: typeof messages[0] }[]>(
    (acc, msg) => {
      if (msg.role === "user") {
        acc.push({ user: msg, assistant: undefined as any });
      } else if (msg.role === "assistant") {
        if (acc.length > 0 && !acc[acc.length - 1].assistant) {
          acc[acc.length - 1].assistant = msg;
        } else {
          acc.push({ assistant: msg });
        }
      }
      return acc;
    },
    []
  ).filter((s) => s.assistant);

  const handleListenToggle = useCallback(() => {
    if (capturing) {
      stopCapture();
    } else {
      startCapture();
    }
  }, [capturing, stopCapture, startCapture]);

  const handleMicToggle = useCallback(() => {
    if (isMicListening) {
      const finalText = stopListening();
      if (finalText) setSttText(finalText);
    } else {
      toggleMic();
    }
  }, [isMicListening, stopListening, toggleMic]);

  useEffect(() => {
    if (!isMicListening && transcript) setSttText(transcript);
  }, [isMicListening, transcript]);

  useEffect(() => {
    const shouldExpand =
      messages.length > 0 || !!error || !!systemAudioError ||
      !!lastTranscription || isSttProcessing || isLoading;
    setIsExpanded(shouldExpand);
  }, [messages.length, error, systemAudioError, lastTranscription, isSttProcessing, isLoading]);

  // Auto-advance to the latest slide when a new AI response arrives
  useEffect(() => {
    if (slides.length > 0) {
      setCurrentSlide(slides.length - 1);
    }
  }, [slides.length]);

  // Resize window to match content: 44px (toolbar only), 110px (intensity popover), or 600px (panel)
  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      let height = 44;
      if (isExpanded) height = 600;
      else if (showIntensity) height = 110;
      invoke("set_window_height", { height }).catch(() => {});
    });
  }, [isExpanded, showIntensity]);

  const openDashboard = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_dashboard");
    } catch (e) {
      console.error("Failed to open dashboard:", e);
      toast.error("Could not open dashboard");
    }
  };

  const handleClear = () => {
    abort(); // Stop any in-progress streaming first
    clearMessages(); clearError();
    clearSystemConversation(); clearSystemError();
    setScreenImage(null);
    setCurrentSlide(0);
  };

  const goPrevSlide = useCallback(() => {
    setCurrentSlide((i) => Math.max(0, i - 1));
  }, []);

  const goNextSlide = useCallback(() => {
    setCurrentSlide((i) => Math.min(slides.length - 1, i + 1));
  }, [slides.length]);

  const responseCount = messages.filter((m) => m.role === "assistant").length;

  const handleScreenAnalysis = useCallback(async () => {
    const currentModel = getModelById(loadSelectedModel());
    if (!currentModel?.supportsVision) {
      toast.error(
        currentModel
          ? `${currentModel.name} doesn't support images. Switch to a vision model in Settings.`
          : "Selected model doesn't support images. Switch to a vision model in Settings."
      );
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const imgData: string = await invoke("start_screen_capture");
      setScreenImage(imgData);
      setIsExpanded(true);
      await sendMessage(
        "Look at this screenshot carefully. Identify what is being shown — if it's a coding problem, provide a complete working solution with explanation; if it's an error or bug, diagnose and fix it; if it's a UI or design, critique and suggest improvements; if it's a document or article, summarize the key points. Be specific and actionable.",
        [imgData]
      );
    } catch (e) {
      console.error("Screen analysis failed:", e);
      toast.error("Screen analysis failed");
    }
  }, [sendMessage, toast]);

  // Listen for global shortcut "focus-input" event from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("focus-input", () => {
        inputRef.current?.focus();
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape — no modifier needed
      if (e.key === "Escape") {
        if (isExpanded) handleClear();
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // Ctrl+Shift+Arrow — navigate response slides
      if (e.shiftKey && e.key === "ArrowLeft") { e.preventDefault(); goPrevSlide(); return; }
      if (e.shiftKey && e.key === "ArrowRight") { e.preventDefault(); goNextSlide(); return; }

      switch (true) {
        case e.shiftKey && e.key === "I":
          e.preventDefault();
          inputRef.current?.focus();
          break;
        case e.shiftKey && e.key === "S":
          e.preventDefault();
          handleScreenAnalysis();
          break;
        case e.shiftKey && e.key === "A":
          e.preventDefault();
          handleListenToggle();
          break;
        case e.shiftKey && e.key === "M":
          e.preventDefault();
          handleMicToggle();
          break;
        case e.shiftKey && e.key === "D":
          e.preventDefault();
          openDashboard();
          break;
        case e.shiftKey && e.key === "X":
          e.preventDefault();
          handleClear();
          break;
        case e.key === "[":
          e.preventDefault();
          setTransparency(Math.max(25, transparency - 5));
          break;
        case e.key === "]":
          e.preventDefault();
          setTransparency(Math.min(100, transparency + 5));
          break;
        // Ctrl+Arrow — move window
        case e.key === "ArrowUp":
          e.preventDefault();
          import("@tauri-apps/api/core").then(({ invoke }) => invoke("move_window", { direction: "up", step: 20 }));
          break;
        case e.key === "ArrowDown":
          e.preventDefault();
          import("@tauri-apps/api/core").then(({ invoke }) => invoke("move_window", { direction: "down", step: 20 }));
          break;
        case e.key === "ArrowLeft":
          e.preventDefault();
          import("@tauri-apps/api/core").then(({ invoke }) => invoke("move_window", { direction: "left", step: 20 }));
          break;
        case e.key === "ArrowRight":
          e.preventDefault();
          import("@tauri-apps/api/core").then(({ invoke }) => invoke("move_window", { direction: "right", step: 20 }));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleListenToggle, handleMicToggle, isExpanded, transparency, goPrevSlide, goNextSlide]);

  // ─── Track listening seconds ───────────────────────────────────────────────
  useEffect(() => {
    if (!capturing && !isMicListening) return;
    const interval = setInterval(() => {
      addListeningSeconds(1);
    }, 1000);
    return () => clearInterval(interval);
  }, [capturing, isMicListening]);

  return (
    <div
      className="flex flex-col h-full w-full select-none relative"
      style={{ "--glass-alpha": String(glassAlpha) } as React.CSSProperties}
    >

      {/* Toast notifications */}
      <ToastContainer />

      {/* Intensity slider popover — outside toolbar so it's not clipped */}
      {showIntensity && (
        <div
          className="absolute top-11 right-2 z-50 glass rounded-xl px-3.5 py-2.5 no-drag
            flex items-center gap-2.5"
        >
          <Contrast className="h-3 w-3 text-white/35 shrink-0" />
          <input
            type="range"
            min="15"
            max="97"
            step="1"
            value={transparency}
            onChange={(e) => setTransparency(Number(e.target.value))}
            className="intensity-slider w-28"
          />
          <span className="text-[10px] tabular-nums text-white/40 w-7 text-right">
            {transparency}%
          </span>
        </div>
      )}

      {/* ══════════════ TOOLBAR PILL ══════════════ */}
      <div
        className={`
          toolbar-bar glass
          flex items-center gap-1 px-2 h-10 min-h-10
          rounded-full mx-0.5 mt-0.5 overflow-hidden
          transition-all duration-300
          ${capturing ? "listening-glow" : ""}
          ${isLoading ? "generating-glow" : ""}
        `}
      >
        {/* Left — grip (drag) + audio toggles + clear */}
        <div className="flex items-center gap-0.5 pl-0.5">
          <Tooltip label="Drag to move">
            <button
              className="toolbar-icon-btn cursor-move drag-region"
              onMouseDown={() => getCurrentWindow().startDragging().catch(() => {})}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </Tooltip>

          {/* Mic toggle — neon green when active */}
          <Tooltip label={isMicListening ? "Stop mic" : "Microphone"} shortcut="Ctrl+Shift+M">
            <button
              onClick={handleMicToggle}
              className="toolbar-icon-btn no-drag"
              style={isMicListening ? { color: "#4ade80", filter: "drop-shadow(0 0 6px #4ade80)" } : {}}
            >
              {isMicListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>

          {/* System audio toggle — neon emerald when active */}
          <Tooltip label={capturing ? "Stop system audio" : "System audio"} shortcut="Ctrl+Shift+A">
            <button
              onClick={handleListenToggle}
              className="toolbar-icon-btn no-drag"
              style={capturing ? { color: "#34d399", filter: "drop-shadow(0 0 6px #34d399)" } : {}}
            >
              {capturing ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
            </button>
          </Tooltip>

          {(messages.length > 0 || error) && (
            <Tooltip label="Clear conversation" shortcut="Ctrl+Shift+X">
              <button onClick={handleClear} className="toolbar-icon-btn no-drag">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Center — text input */}
        <div className="no-drag flex-1 mx-1.5">
          <TextInput
            onSend={sendMessage}
            isLoading={isLoading}
            isListening={isMicListening}
            externalText={sttText}
            onExternalTextConsumed={() => setSttText("")}
            inputRef={inputRef}
          />
        </div>

        {/* Right — action icons */}
        <div className="no-drag flex items-center gap-0.5 pr-0.5">
          <Tooltip label="Screen analysis" shortcut="Ctrl+Shift+S">
            <button
              onClick={handleScreenAnalysis}
              className="toolbar-icon-btn"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          {isLoading && (
            <Tooltip label="Stop generating" shortcut="Esc">
              <button
                onClick={abort}
                className="toolbar-icon-btn text-rose-400! hover:text-rose-300!"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}

          <Tooltip label="Glass intensity" shortcut="Ctrl+[ / ]">
            <button
              onClick={() => setShowIntensity((v) => !v)}
              className={`toolbar-icon-btn ${showIntensity ? "text-indigo-400!" : ""}`}
            >
              <Contrast className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <UsageTimer/>
          <Tooltip label="Dashboard" shortcut="Ctrl+Shift+D">
            <button onClick={openDashboard} className="toolbar-icon-btn">
              <Settings className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ══════════════ RESPONSE PANEL ══════════════ */}
      {isExpanded && (
        <div
          className="
            flex-1 flex flex-col mx-0.5 mt-1 mb-0.5
            rounded-2xl glass
            overflow-hidden min-h-0
          "
        >
          {/* Panel header */}
          <div
            className="
              flex items-center justify-between px-3.5 py-2
              border-b border-white/6
            "
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <div className="flex items-center gap-2">
              {isLoading ? (
                <StatusChip label="Generating" pulse />
              ) : isSttProcessing ? (
                <StatusChip label="Transcribing" pulse />
              ) : capturing ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-medium tracking-wide text-emerald-400/80">Listening</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-indigo-400/60" />
                  <span className="text-[11px] font-medium tracking-wide text-white/35">
                    {responseCount} response{responseCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {/* Slide navigation */}
              {slides.length > 1 && (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={goPrevSlide}
                    disabled={currentSlide === 0}
                    className="rounded-md p-0.5 text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    title="Previous response (Ctrl+Shift+←)"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[10px] tabular-nums text-white/40 min-w-8 text-center">
                    {currentSlide + 1}/{slides.length}
                  </span>
                  <button
                    onClick={goNextSlide}
                    disabled={currentSlide >= slides.length - 1}
                    className="rounded-md p-0.5 text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    title="Next response (Ctrl+Shift+→)"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleClear}
              className="rounded-lg p-1 text-white/25 hover:text-white/60 transition-colors"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Response slide area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">

            {/* Errors */}
            {(error || systemAudioError) && (
              <div className="msg-in flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}
              >
                <AlertCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
                <p className="text-xs text-rose-300/90">{error || systemAudioError}</p>
              </div>
            )}

            {/* Live transcription banner */}
            {capturing && lastTranscription && (
              <div
                className="msg-in flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.16)" }}
              >
                <Headphones className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-xs text-emerald-300/85 italic leading-relaxed">{lastTranscription}</p>
              </div>
            )}

            {/* Screen capture preview */}
            {screenImage && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-white/30 px-1">Screen captured</span>
                <img
                  src={screenImage}
                  alt="Screen capture"
                  className="rounded-lg max-w-full border border-white/10 shadow cursor-pointer"
                  onClick={() => setScreenImage(null)}
                  title="Click to dismiss"
                />
              </div>
            )}

            {/* Current slide: user question + AI response */}
            {slides.length > 0 && slides[currentSlide] && (
              <>
                {/* User message */}
                {slides[currentSlide].user && (
                  <div className="msg-in">
                    <div className="flex justify-end">
                      <div
                        className="max-w-[82%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs leading-relaxed text-white/90 whitespace-pre-wrap"
                        style={{
                          background: "linear-gradient(135deg, rgba(99,102,241,0.75) 0%, rgba(139,92,246,0.65) 100%)",
                          border: "1px solid rgba(139,92,246,0.3)",
                          boxShadow: "0 4px 16px rgba(99,102,241,0.2)",
                        }}
                      >
                        {slides[currentSlide].user!.content}
                      </div>
                    </div>
                  </div>
                )}
                {/* AI response */}
                <div className="msg-in">
                  <div className="flex justify-start">
                    <div
                      className="max-w-[95%] rounded-2xl rounded-tl-sm px-3.5 py-2.5"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      {slides[currentSlide].assistant.content ? (
                        <div className="glass-prose">
                          <Markdown content={slides[currentSlide].assistant.content} />
                        </div>
                      ) : (
                        <ThinkingDots />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* If loading and no slides yet (first message streaming) */}
            {slides.length === 0 && isLoading && (
              <div className="msg-in">
                <div className="flex justify-start">
                  <div
                    className="rounded-2xl rounded-tl-sm px-3.5 py-2.5"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >
                    <ThinkingDots />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

