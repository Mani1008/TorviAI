import { useRef, useEffect, useState, useCallback } from "react";
import { TextInput } from "@/components/TextInput";
import { Markdown } from "@/components/Markdown";
import { useCompletion } from "@/hooks/useCompletion";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useSystemAudio } from "@/hooks/useSystemAudio";
import { useTheme } from "@/contexts/theme.context";
import { UsageTimer } from "@/components/UsageTimer";
import {
  Settings,
  Square,
  Trash2,
  X,
  AlertCircle,
  MessageSquare,
  GripVertical,
  Headphones,
  HeadphoneOff,
  Sparkles,
  Contrast,
  Camera,
} from "lucide-react";
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [sttText, setSttText] = useState("");
  const [showIntensity, setShowIntensity] = useState(false);
  const { transparency, setTransparency } = useTheme();
  const glassAlpha = transparency / 100;

  const handleListenToggle = useCallback(() => {
    if (capturing) stopCapture(); else startCapture();
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

  // Only auto-scroll to bottom when a new message is added and not streaming
  const prevIsLoading = useRef(false);
  useEffect(() => {
    // If AI just finished streaming (was loading, now not), scroll to bottom
    if (prevIsLoading.current && !isLoading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevIsLoading.current = isLoading;
    // Do NOT scroll during streaming
  }, [isLoading, messages]);

  // Resize window to match content: 44px (toolbar only) or 600px (with panel)
  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("set_window_height", { height: isExpanded ? 600 : 44 }).catch(() => {});
    });
  }, [isExpanded]);

  const openDashboard = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_dashboard");
    } catch (e) { console.error("Failed to open dashboard:", e); }
  };

  const handleClear = () => {
    clearMessages(); clearError();
    clearSystemConversation(); clearSystemError();
    setScreenImage(null);
  };

  const responseCount = messages.filter((m) => m.role === "assistant").length;

  const [screenImage, setScreenImage] = useState<string | null>(null);
  const handleScreenAnalysis = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const imgData: string = await invoke("start_screen_capture");
      setScreenImage(imgData);
      setIsExpanded(true);
      // Send screenshot to AI for analysis
      await sendMessage("Analyze this screenshot and describe what you see.", [imgData]);
    } catch (e) {
      console.error("Screen analysis failed:", e);
    }
  };

  return (
    <div
      className="flex flex-col h-full w-full select-none relative"
      style={{ "--glass-alpha": String(glassAlpha) } as React.CSSProperties}
    >

      {/* Intensity slider popover — outside toolbar so it's not clipped */}
      {showIntensity && (
        <div
          className="absolute top-11 right-2 z-50 glass rounded-xl px-3.5 py-2.5 no-drag
            shadow-[0_4px_20px_rgba(0,0,0,0.55)] flex items-center gap-2.5"
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
          toolbar-bar drag-region glass
          flex items-center gap-1 px-2 h-10 min-h-10
          rounded-full mx-0.5 mt-0.5 overflow-hidden
          shadow-[0_8px_32px_rgba(0,0,0,0.5)]
          transition-all duration-300
          ${capturing ? "listening-glow" : ""}
          ${isLoading ? "generating-glow" : ""}
        `}
      >
        {/* Left — grip + clear */}
        <div className="no-drag flex items-center gap-0.5 pl-0.5">
          <button className="toolbar-icon-btn" title="Move window">
            <GripVertical className="h-4 w-4" />
          </button>
          {(messages.length > 0 || error) && (
            <button onClick={handleClear} className="toolbar-icon-btn" title="New conversation">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Center — text input */}
        <div className="no-drag flex-1 mx-1.5">
          <TextInput
            onSend={sendMessage}
            isLoading={isLoading}
            isListening={isMicListening}
            onMicToggle={handleMicToggle}
            externalText={sttText}
            onExternalTextConsumed={() => setSttText("")}
          />
        </div>

        {/* Right — action icons */}
        <div className="no-drag flex items-center gap-0.5 pr-0.5">
          <button
            onClick={handleScreenAnalysis}
            className="toolbar-icon-btn"
            title="Screen Analysis"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleListenToggle}
            className={`toolbar-icon-btn ${
              capturing
                ? "text-emerald-400! hover:text-emerald-300!"
                : ""
            }`}
            title={capturing ? "Stop listening" : "Listen to system audio"}
          >
            {capturing
              ? <HeadphoneOff className="h-4 w-4" />
              : <Headphones className="h-4 w-4" />}
          </button>

          {isLoading && (
            <button
              onClick={abort}
              className="toolbar-icon-btn text-rose-400! hover:text-rose-300!"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}

          <button onClick={openDashboard} className="toolbar-icon-btn" title="History">
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowIntensity((v) => !v)}
            className={`toolbar-icon-btn ${showIntensity ? "text-indigo-400!" : ""}`}
            title="Glass intensity"
          >
            <Contrast className="h-3.5 w-3.5" />
          </button>
          <UsageTimer/>
          <button onClick={openDashboard} className="toolbar-icon-btn" title="Settings">
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ══════════════ RESPONSE PANEL ══════════════ */}
      {isExpanded && (
        <div
          className="
            flex-1 flex flex-col mx-0.5 mt-1 mb-0.5
            rounded-2xl glass
            shadow-[0_16px_48px_rgba(0,0,0,0.6)]
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
            <button
              onClick={handleClear}
              className="rounded-lg p-1 text-white/25 hover:text-white/60 transition-colors"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Messages area */}
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

            {/* Conversation messages */}
            {messages.map((msg) => (
              <div key={msg.id} className="msg-in">
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div
                      className="max-w-[82%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs leading-relaxed text-white/90 whitespace-pre-wrap"
                      style={{
                        background: "linear-gradient(135deg, rgba(99,102,241,0.75) 0%, rgba(139,92,246,0.65) 100%)",
                        border: "1px solid rgba(139,92,246,0.3)",
                        boxShadow: "0 4px 16px rgba(99,102,241,0.2)",
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start">
                    <div
                      className="max-w-[95%] rounded-2xl rounded-tl-sm px-3.5 py-2.5"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      {msg.content ? (
                        <div className="glass-prose">
                          <Markdown content={msg.content} />
                        </div>
                      ) : (
                        <ThinkingDots />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

