import { useRef, useEffect, useState, useCallback } from "react";
import { TextInput } from "@/components/TextInput";
import { Markdown } from "@/components/Markdown";
import { ContextIndicator } from "@/components/ContextIndicator";
import { RagStatusIndicator, ragStatusChipLabel } from "@/components/RagStatusIndicator";
import { getRecentContext, type AppContextSnapshot } from "@/lib/database/context-store";
import { useCompletion } from "@/hooks/useCompletion";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useSystemAudio } from "@/hooks/useSystemAudio";
import { useTheme } from "@/contexts/theme.context";
import { UsageTimer } from "@/components/UsageTimer";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/lib/platform";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/Toast";
import { addListeningSeconds, checkListeningLimit } from "@/lib/storage/usage-stats";
import { loadUserProfile } from "@/lib/storage/auth";
import { STORAGE_KEYS, DEFAULT_SCREENSHOT_CONFIG } from "@/config/constants";
import type { ScreenshotConfig } from "@/types/settings";
import { saveScreenshot } from "@/lib/database/screenshots";
import { syncScreenshot } from "@/lib/backend";
import { DEFAULT_SHORTCUTS } from "@/config/shortcuts";
import { loadShortcuts } from "@/lib/storage";

/** Read the latest screenshot config directly from localStorage (not React state).
 * The pill bar and dashboard are separate Tauri windows — React context state is
 * not shared between them, only localStorage is. */
function loadScreenshotConfigNow(): ScreenshotConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SCREENSHOT_CONFIG);
    return raw ? (JSON.parse(raw) as ScreenshotConfig) : DEFAULT_SCREENSHOT_CONFIG;
  } catch {
    return DEFAULT_SCREENSHOT_CONFIG;
  }
}

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
  Minimize2,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

// ─── Key matching utility ─────────────────────────────────────────────────────
// Parses a key string like "Ctrl+Shift+S" and checks it against a KeyboardEvent.
function matchKey(e: KeyboardEvent, keyStr: string): boolean {
  const parts = keyStr.split("+");
  const mainKey = parts[parts.length - 1];
  const hasCtrl = parts.some((p) => p === "Ctrl" || p === "Cmd");
  const hasShift = parts.some((p) => p === "Shift");
  const hasAlt = parts.some((p) => p === "Alt");
  return (
    (e.ctrlKey || e.metaKey) === hasCtrl &&
    e.shiftKey === hasShift &&
    e.altKey === hasAlt &&
    e.key === mainKey
  );
}

// Returns the current key string for a shortcut id, respecting custom bindings.
function sk(id: string): string {
  const custom = loadShortcuts();
  return (
    custom?.find((s) => s.id === id)?.key ??
    DEFAULT_SHORTCUTS.find((s) => s.id === id)!.key
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

// ─── Proactive context suggestion chips ─────────────────────────────────────
// Maps context content_type → 2-3 quick-action suggestions shown in the pill
// bar whenever the context watcher detects a switch to a new app/file.
const CONTEXT_SUGGESTIONS: Record<string, string[]> = {
  code:               ["Explain this",       "Review this code",  "What does this do?"],
  document:           ["Summarize this",     "Key points?",       "Explain this"],
  meeting:            ["Summarize meeting",  "Action items?",     "Key decisions?"],
  email:              ["Summarize this",     "Draft a reply",     "Key points?"],
  chat:               ["Summarize conversation", "Key points?"],
  project_management: ["What's the status?", "Summarize this"],
  design:             ["Describe this",      "Feedback on this"],
  generic:            ["Help with this",     "Summarize this",    "Explain this"],
};

export default function App() {
  useTransparentWindow();
  const { messages, isLoading, ragPhase, error, sendMessage, abort, clearMessages, clearError } =
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
  // Tracks whether a pointer-drag started on the floating icon (suppresses click).
  const iconDragRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [sttText, setSttText] = useState("");
  const [showIntensity, setShowIntensity] = useState(false);
  // Tracks whether any toolbar tooltip is currently hovered.
  // The pill bar window is only 44px tall — tooltips rendered at rect.bottom+8 would be
  // clipped by the OS window boundary. We expand to 88px on hover so they're visible.
  const [tooltipHovered, setTooltipHovered] = useState(false);
  // Per-slide screenshot map: key = slide index at the moment the screenshot was taken
  const [slideScreenshots, setSlideScreenshots] = useState<Record<number, string>>({});
  const [currentSlide, setCurrentSlide] = useState(0);
  const { transparency, setTransparency } = useTheme();
  const toast = useToast();
  const glassAlpha = transparency / 100;

  // Proactive suggestion chips — shown below the toolbar when context switches.
  const [suggestionChips, setSuggestionChips] = useState<string[] | null>(null);
  const prevAppNameRef = useRef<string | null>(null);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live context focus — what app/file the watcher last saw (toolbar indicator).
  const [contextFocus, setContextFocus] = useState<{
    appName: string;
    windowTitle: string;
  } | null>(null);
  const [contextWatching, setContextWatching] = useState(true);

  // Collapsed = floating Torvi icon. Expanded = full pill bar visible.
  // Persisted so the user's last preference survives restarts.
  const [isPillCollapsed, setIsPillCollapsedRaw] = useState(
    () => localStorage.getItem("pill_collapsed") !== "false"
  );
  const setIsPillCollapsed = (v: boolean) => {
    localStorage.setItem("pill_collapsed", String(v));
    setIsPillCollapsedRaw(v);
  };

  // isCollapsing: true while the pill-exit animation is playing (toolbar still
  // rendered but folding closed before the window shrinks).
  const [isCollapsing, setIsCollapsing] = useState(false);

  // Physical-pixel x position of the window before the last collapse.
  // Needed to restore the window's position on expand.
  // -1 = never collapsed (expand command will infer position from current location).
  const pillOriginalXRef = useRef<number>(
    parseInt(localStorage.getItem("pill_original_x") ?? "-1") || -1
  );

  // Auth gate — hide the pill bar if no valid session exists.
  // This covers the case where the window was left visible from a previous session
  // or the user pressed Ctrl+Shift+H while the gate is open.
  useEffect(() => {
    if (!loadUserProfile()) {
      if (isTauri()) getCurrentWindow().hide().catch(() => {});
    }
  }, []);

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
      // Block start if listening limit is already exhausted
      const limitMsg = checkListeningLimit();
      if (limitMsg) { toast.error(limitMsg); return; }
      startCapture();
    }
  }, [capturing, stopCapture, startCapture, toast]);

  const handleMicToggle = useCallback(() => {
    if (isMicListening) {
      const finalText = stopListening();
      if (finalText) setSttText(finalText);
    } else {
      const limitMsg = checkListeningLimit();
      if (limitMsg) { toast.error(limitMsg); return; }
      toggleMic();
    }
  }, [isMicListening, stopListening, toggleMic, toast]);

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

  // Listen for tooltip hover events dispatched by the Tooltip component.
  // We expand the Tauri window from 44→88px so the tooltip isn't OS-clipped.
  useEffect(() => {
    const onShow = () => setTooltipHovered(true);
    const onHide = () => setTooltipHovered(false);
    window.addEventListener("pill-tooltip-show", onShow);
    window.addEventListener("pill-tooltip-hide", onHide);
    return () => {
      window.removeEventListener("pill-tooltip-show", onShow);
      window.removeEventListener("pill-tooltip-hide", onHide);
    };
  }, []);

  // Resize window height — only while the pill bar is visible (not collapsed or collapsing).
  // Width and x-position are handled by collapse_pill_to_icon / expand_pill_from_icon.
  const hasSuggestions = !isExpanded && !!suggestionChips?.length;
  const showContextStrip = !isExpanded && !isPillCollapsed && !isCollapsing;
  useEffect(() => {
    if (isPillCollapsed || isCollapsing) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      let height = 44;
      if (isExpanded) height = 600;
      else if (showIntensity) height = showContextStrip ? 132 : 110;
      else if (tooltipHovered) height = showContextStrip ? 110 : 88;
      else if (hasSuggestions && showContextStrip) height = 104;
      else if (hasSuggestions) height = 82;
      else if (showContextStrip) height = 66;
      invoke("set_window_height", { height }).catch(() => {});
    });
  }, [isExpanded, showIntensity, tooltipHovered, isPillCollapsed, isCollapsing, hasSuggestions, showContextStrip]);

  // Animate the pill bar closed, shrink the Tauri window, then show the icon.
  const startCollapse = useCallback(() => {
    setIsCollapsing(true);
    setTimeout(async () => {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const origX = await invoke<number>("collapse_pill_to_icon").catch(() => -1);
        pillOriginalXRef.current = origX;
        localStorage.setItem("pill_original_x", String(origX));
      }
      setIsCollapsing(false);
      setIsPillCollapsed(true);
    }, 380); // matches pill-exit animation duration
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expand the Tauri window back to 600px, restore position, then show the toolbar.
  const startExpand = useCallback(async () => {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("expand_pill_from_icon", {
        originalX: pillOriginalXRef.current,
        height: 44,
      }).catch(() => {});
    }
    setIsPillCollapsed(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand from icon to pill when a response (or error) arrives.
  useEffect(() => {
    if (isExpanded && isPillCollapsed) startExpand();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

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
    setSlideScreenshots({});
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
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const imgData: string = await invoke("start_screen_capture");
      // Attach image to the slide that is about to be created.
      // slides are only counted once the assistant replies, so the new
      // slide index equals the current completed-slide count.
      const newSlideIndex = slides.length;
      setSlideScreenshots((prev) => ({ ...prev, [newSlideIndex]: imgData }));
      setIsExpanded(true);
      // Read config fresh from localStorage — the dashboard window may have updated
      // it after this window was opened (React context state is per-window, not shared).
      const screenshotPrompt = loadScreenshotConfigNow().autoPrompt;
      const prompt = screenshotPrompt || DEFAULT_SCREENSHOT_CONFIG.autoPrompt;

      // Persist screenshot locally (SQLite) and sync to Appwrite (best-effort)
      const id = `scr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const capturedAt = Date.now();
      saveScreenshot({ id, imageData: imgData, prompt, capturedAt, conversationId: null }).catch(() => {});
      syncScreenshot({ id, imageData: imgData, prompt, capturedAt }).catch(() => {});

      await sendMessage(prompt, [imgData]);
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

  // Listen for Ctrl+Shift+H events from Rust
  useEffect(() => {
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("expand-pill", () => setIsPillCollapsed(false)).then((fn) => { u1 = fn; });
      listen("toggle-pill-mode", () => setIsPillCollapsedRaw((v) => {
        const next = !v;
        localStorage.setItem("pill_collapsed", String(next));
        return next;
      })).then((fn) => { u2 = fn; });
    });
    return () => { u1?.(); u2?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for Ctrl+Shift+A global shortcut from Rust → toggle system audio capture
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("toggle-system-audio", () => handleListenToggle()).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [handleListenToggle]);

  // Listen for Ctrl+Shift+M global shortcut from Rust → toggle microphone
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("toggle-microphone", () => handleMicToggle()).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [handleMicToggle]);

  // Listen for Ctrl+Shift+S global shortcut from Rust → screenshot analysis
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("trigger-screenshot", () => handleScreenAnalysis()).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [handleScreenAnalysis]);

  // Bootstrap context indicator from SQLite + sync watcher pause state.
  useEffect(() => {
    if (!isTauri()) return;

    const syncWatcher = () => {
      const paused = localStorage.getItem("ctx_watcher_paused") === "1";
      if (paused) {
        setContextWatching(false);
        return;
      }
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<string>("get_watcher_status")
          .then((s) => setContextWatching(s === "running"))
          .catch(() => setContextWatching(true));
      });
    };

    getRecentContext(1, 24 * 60)
      .then((chunks) => {
        if (chunks[0]) {
          setContextFocus({
            appName: chunks[0].app_name,
            windowTitle: chunks[0].window_title,
          });
        }
      })
      .catch(() => {});

    syncWatcher();
    const interval = setInterval(syncWatcher, 3000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ctx_watcher_paused") syncWatcher();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Listen for context-captured events from the context watcher.
  // Updates the toolbar indicator and proactive suggestion chips.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<AppContextSnapshot>("context-captured", (e) => {
        const { app_name, window_title, content_type } = e.payload;

        if (app_name) {
          setContextFocus({
            appName: app_name,
            windowTitle: window_title ?? "",
          });
        }

        // Show suggestion chips when switching to a new app/file
        if (app_name && app_name !== prevAppNameRef.current) {
          const chips = (CONTEXT_SUGGESTIONS[content_type] ?? CONTEXT_SUGGESTIONS.generic).slice(0, 3);
          setSuggestionChips(chips);
          if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
          suggestionTimerRef.current = setTimeout(() => setSuggestionChips(null), 30_000);
        }
        prevAppNameRef.current = app_name;
      }).then((fn) => { unlisten = fn; });
    });
    return () => {
      unlisten?.();
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    };
  }, []);

  // Clear suggestion chips as soon as the AI starts generating
  // (no need to see chips while a response is already in flight).
  useEffect(() => {
    if (isLoading) setSuggestionChips(null);
  }, [isLoading]);

  // Keyboard shortcuts — in-app bindings respect custom shortcuts saved in localStorage
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape — hardcoded, always closes the response panel
      if (e.key === "Escape") {
        if (isExpanded) handleClear();
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // Ctrl+Shift+Arrow — navigate response slides (hardcoded, not configurable)
      if (e.shiftKey && e.key === "ArrowLeft") { e.preventDefault(); goPrevSlide(); return; }
      if (e.shiftKey && e.key === "ArrowRight") { e.preventDefault(); goNextSlide(); return; }

      // Configurable in-app shortcuts
      const actions: Array<[string, () => void]> = [
        ["focus_input",     () => inputRef.current?.focus()],
        ["screenshot",      handleScreenAnalysis],
        ["system_audio",    handleListenToggle],
        ["microphone",      handleMicToggle],
        ["toggle_dashboard",openDashboard],
        ["clear_chat",      handleClear],
        ["glass_decrease",  () => setTransparency(Math.max(25, transparency - 5))],
        ["glass_increase",  () => setTransparency(Math.min(100, transparency + 5))],
      ];
      for (const [id, action] of actions) {
        if (matchKey(e, sk(id))) { e.preventDefault(); action(); return; }
      }

      // Move window — Ctrl+Arrow (no Shift); hardcoded
      if (!e.shiftKey) {
        const dirMap: Record<string, string> = {
          ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
        };
        const dir = dirMap[e.key];
        if (dir) {
          e.preventDefault();
          import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("move_window", { direction: dir, step: 20 })
          );
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleListenToggle, handleMicToggle, isExpanded, transparency, goPrevSlide, goNextSlide]);

  // ─── Track listening seconds, enforce plan limit, sync to Appwrite every 1 s ─
  useEffect(() => {
    if (!capturing && !isMicListening) return;
    const interval = setInterval(() => {
      addListeningSeconds(1);

      // ── Enforce plan limit ─────────────────────────────────────────────────
      const limitMsg = checkListeningLimit();
      if (limitMsg) {
        // Stop both audio sources immediately
        if (capturing) stopCapture();
        if (isMicListening) stopListening();
        clearInterval(interval);
        toast.error(limitMsg);
        return;
      }

      // ── Sync consumed second to Appwrite ──────────────────────────────────
      const user = loadUserProfile();
      if (user?.id) {
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("record_usage", { userId: user.id, usageType: "listening_seconds", amount: 1 }).catch(() => {})
        );
      }
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, isMicListening]);

  return (
    <div
      className="flex flex-col h-full w-full select-none relative"
      style={{ "--glass-alpha": String(glassAlpha) } as React.CSSProperties}
    >

      {/* Toast notifications */}
      <ToastContainer />

      {isPillCollapsed ? (
        /* ── Floating icon mode ── */
        /* pointer-events-none on the centering wrapper so the transparent 600px-wide
           dead zone on either side of the icon passes clicks through to windows below. */
        <div className="flex h-full items-center justify-center pointer-events-none">
          <button
            className={`
              pointer-events-auto
              h-10 w-10 rounded-full glass flex items-center justify-center
              transition-all duration-200 hover:brightness-125 cursor-default
              ${capturing || isMicListening ? "listening-glow" : ""}
              ${isLoading ? "generating-glow" : ""}
            `}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              iconDragRef.current = false;
              const startX = e.clientX;
              const startY = e.clientY;
              const onMove = (ev: PointerEvent) => {
                if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
                  iconDragRef.current = true;
                  document.removeEventListener("pointermove", onMove);
                  if (isTauri()) getCurrentWindow().startDragging().catch(() => {});
                }
              };
              const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
              };
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            }}
            onClick={() => {
              if (!iconDragRef.current) startExpand();
            }}
            title="Click to expand Torvi"
          >
            <Sparkles className="h-4 w-4 text-indigo-300/80" />
          </button>
        </div>
      ) : (
      <>
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
      {/* pill-enter on mount = unfold; pill-exit when isCollapsing = fold back in */}
      <div
        className={`
          ${isCollapsing ? "pill-exit" : "pill-enter"}
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
              onMouseDown={() => { if (isTauri()) getCurrentWindow().startDragging().catch(() => {}); }}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </Tooltip>

          <Tooltip label="Collapse to icon">
            <button
              onClick={startCollapse}
              className="toolbar-icon-btn no-drag"
            >
              <Minimize2 className="h-3.5 w-3.5" />
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

      {/* Context focus strip — what Torvi is currently observing */}
      {showContextStrip && (
        <ContextIndicator
          isWatching={contextWatching}
          appName={contextFocus?.appName}
          windowTitle={contextFocus?.windowTitle}
          onClick={openDashboard}
        />
      )}

      {/* ══════════════ SUGGESTION CHIPS ══════════════ */}
      {/* Appear when context switches to a new app/file; auto-dismiss after 30 s */}
      {hasSuggestions && (
        <div
          className="no-drag flex items-center gap-1.5 px-2.5 pt-1 pb-0.5"
          style={{ animation: "fadeInUp 0.2s ease-out" }}
        >
          {suggestionChips!.map((chip) => (
            <button
              key={chip}
              onClick={() => { setSuggestionChips(null); setSttText(chip); }}
              className="
                rounded-full px-2.5 py-0.5
                text-[10px] text-white/55
                border border-white/10
                hover:border-indigo-400/40 hover:text-white/85 hover:bg-indigo-500/10
                transition-all duration-150 cursor-default glass
              "
            >
              {chip}
            </button>
          ))}
          <button
            onClick={() => setSuggestionChips(null)}
            className="ml-auto text-white/20 hover:text-white/55 transition-colors text-[10px] cursor-default leading-none"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

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
                <StatusChip label={ragStatusChipLabel(ragPhase)} pulse />
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

            {/* Per-slide screenshot preview */}
            {slideScreenshots[currentSlide] && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-white/30 px-1">Screen captured</span>
                <img
                  src={slideScreenshots[currentSlide]}
                  alt="Screen capture"
                  className="rounded-lg max-w-full border border-white/10 shadow cursor-pointer"
                  onClick={() => setSlideScreenshots((prev) => { const next = { ...prev }; delete next[currentSlide]; return next; })}
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
                        <RagStatusIndicator
                          phase={ragPhase}
                          variant="overlay"
                        />
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
                    <RagStatusIndicator
                      phase={ragPhase}
                      variant="overlay"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

