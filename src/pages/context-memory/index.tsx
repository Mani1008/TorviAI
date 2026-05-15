import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PageLayout } from "@/layouts";
import {
  getRecentContext,
  pruneOldContext,
  type ContextChunk,
  type AppContextSnapshot,
} from "@/lib/database/context-store";
import { Brain, Trash2, RefreshCw, Circle, Pause, Play } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterKey = "all" | "code" | "document" | "email" | "chat" | "meeting" | "project_management" | "generic";

const CONTENT_TYPE_COLORS: Record<string, string> = {
  code:               "bg-blue-500/15 text-blue-400 border-blue-500/30",
  document:           "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  email:              "bg-purple-500/15 text-purple-400 border-purple-500/30",
  chat:               "bg-green-500/15 text-green-400 border-green-500/30",
  meeting:            "bg-orange-500/15 text-orange-400 border-orange-500/30",
  project_management: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  generic:            "bg-muted/50 text-muted-foreground border-border",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(unixtimeSecs: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixtimeSecs;
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function formatTime(unixtimeSecs: number): string {
  return new Date(unixtimeSecs * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContextMemory() {
  const [chunks, setChunks]           = useState<ContextChunk[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<FilterKey>("all");
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [liveCount, setLiveCount]     = useState(0);
  const [isWatching, setIsWatching]   = useState(false);
  // Initialised from actual Rust watcher status — see mount effect below.
  const [isPaused, setIsPaused]       = useState(false);
  const unlistenRef                   = useRef<(() => void) | null>(null);
  // Shown when user is on Google Docs without screen reader mode enabled.
  const [showDocsNudge, setShowDocsNudge] = useState(false);

  // ── Key for user's explicit pause intent (survives HMR re-renders) ─────────
  const PAUSE_KEY = "ctx_watcher_paused";

  // ── Load from DB ───────────────────────────────────────────────────────────
  const loadChunks = async () => {
    setLoading(true);
    try {
      // Fetch up to 100 chunks from the last 24 hours
      const rows = await getRecentContext(100, 24 * 60);
      setChunks(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChunks();
  }, []);

  // ── Sync isPaused with actual Rust watcher state on mount ─────────────────
  // The component re-mounts on navigation (isPaused resets to false) but the
  // Rust watcher might still be stopped. We read the real status here so the
  // UI is truthful, and we auto-restart if the watcher stopped due to an HMR
  // re-render (not because the user deliberately paused it).
  useEffect(() => {
    invoke<string>("get_watcher_status")
      .then((s) => {
        if (s === "running") {
          setIsPaused(false);
          setIsWatching(true);
        } else {
          // If the user deliberately paused, respect that. Otherwise restart.
          const userPaused = sessionStorage.getItem(PAUSE_KEY) === "1";
          if (!userPaused) {
            // Watcher stopped for a non-deliberate reason (HMR, crash, etc.).
            // Restart it automatically.
            invoke("start_context_watcher").catch(console.error);
            setIsPaused(false);
            setIsWatching(true);
          } else {
            setIsPaused(true);
            setIsWatching(false);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ── Focus reload — re-fetch DB whenever the Tauri window regains focus ─────
  // This ensures chunks captured while the user was on another app appear
  // immediately when they switch back to Torvi, without needing to click Refresh.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => { if (focused) loadChunks(); })
        .then((fn) => { cleanup = fn; })
        .catch(() => {});
    });
    return () => cleanup?.();
  }, []);

  // ── Live listener ──────────────────────────────────────────────────────────
  // Two separate signals:
  //   "context-captured"     (Tauri event)  — fires immediately when Rust emits;
  //                                           used ONLY to increment the session
  //                                           counter and light the "Watching" dot.
  //   "context-chunks-saved" (CustomEvent)  — dispatched by saveContextChunk()
  //                                           AFTER all sub-chunks are committed
  //                                           to SQLite.  This is when we reload.
  // Splitting the two signals eliminates the debounce race entirely.
  useEffect(() => {
    let cancelled = false;

    // Counter + indicator (no DB read needed yet).
    listen<AppContextSnapshot>("context-captured", () => {
      if (cancelled) return;
      setLiveCount((n) => n + 1);
      setIsWatching(true);
    }).then((unlisten) => {
      if (cancelled) { unlisten(); }
      else { unlistenRef.current = unlisten; setIsWatching(true); }
    });

    // Safe reload — all INSERTs are done by the time this fires.
    // Use Tauri listen() (not window.addEventListener) because saveContextChunk
    // runs in the 'main' window and emits via Tauri IPC; DOM CustomEvents don't
    // cross WebView boundaries so window.addEventListener would never fire here.
    let unlistenSaved: (() => void) | null = null;
    listen<void>("context-chunks-saved", () => {
      if (!cancelled) loadChunks();
    }).then((fn) => {
      if (cancelled) { fn(); }
      else { unlistenSaved = fn; }
    }).catch(console.error);

    // Google Docs screen-reader nudge — fires when the user is on a Google Docs
    // URL and the document content is inaccessible (canvas-rendered).
    let unlistenDocsNudge: (() => void) | null = null;
    listen<string>("google-docs-needs-screen-reader", () => {
      if (!cancelled) setShowDocsNudge(true);
    }).then((fn) => {
      if (cancelled) { fn(); }
      else { unlistenDocsNudge = fn; }
    }).catch(console.error);

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
      unlistenSaved?.();
      unlistenDocsNudge?.();
    };
  }, []);

  // ── Periodic refresh ──────────────────────────────────────────────────────
  // Refresh every 30 s so "X ago" labels stay accurate and any capture that
  // slipped through the event listener (e.g. race condition, paused state) shows up.
  useEffect(() => {
    const interval = setInterval(() => loadChunks(), 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Prune + reload ─────────────────────────────────────────────────────────
  const handleClear = async () => {
    await pruneOldContext();
    setChunks([]);
    setLiveCount(0);
  };
  // ── Pause / Resume ────────────────────────────────────────────────────────────
  const handleTogglePause = async () => {
    if (isPaused) {
      await invoke("start_context_watcher").catch(console.error);
      sessionStorage.removeItem(PAUSE_KEY); // user chose to resume
      setIsPaused(false);
      setIsWatching(true);
    } else {
      await invoke("stop_context_watcher").catch(console.error);
      sessionStorage.setItem(PAUSE_KEY, "1"); // remember user's deliberate choice
      setIsPaused(true);
      setIsWatching(false);
    }
  };
  // ── Filtered list ─────────────────────────────────────────────────────────
  const visible = filter === "all"
    ? chunks
    : chunks.filter((c) => c.content_type === filter);

  // Count by type for filter badges
  const typeCounts = chunks.reduce<Record<string, number>>((acc, c) => {
    acc[c.content_type] = (acc[c.content_type] ?? 0) + 1;
    return acc;
  }, {});

  const filterTabs: { key: FilterKey; label: string }[] = [
    { key: "all",               label: `All (${chunks.length})` },
    { key: "code",              label: `Code (${typeCounts.code ?? 0})` },
    { key: "document",          label: `Docs (${typeCounts.document ?? 0})` },
    { key: "email",             label: `Email (${typeCounts.email ?? 0})` },
    { key: "chat",              label: `Chat (${typeCounts.chat ?? 0})` },
    { key: "meeting",           label: `Meeting (${typeCounts.meeting ?? 0})` },
    { key: "project_management",label: `PM (${typeCounts.project_management ?? 0})` },
    { key: "generic",           label: `Generic (${typeCounts.generic ?? 0})` },
  ];

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <PageLayout
      title="Context Memory"
      description="Live feed of what the AI is observing from your screen"
      rightSlot={
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Circle
              className={`h-2 w-2 fill-current ${
                isPaused
                  ? "text-yellow-500"
                  : isWatching
                  ? "text-green-500 animate-pulse"
                  : "text-muted-foreground"
              }`}
            />
            {isPaused
              ? "Paused"
              : isWatching
              ? `Watching · ${liveCount} captured this session`
              : "Not watching"}
          </span>

          {/* Pause / Resume */}
          <button
            onClick={handleTogglePause}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
              isPaused
                ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                : "border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
            }`}
          >
            {isPaused ? (
              <><Play className="h-3.5 w-3.5" />Resume</>
            ) : (
              <><Pause className="h-3.5 w-3.5" />Pause</>
            )}
          </button>

          <button
            onClick={loadChunks}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>

          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      }
    >
      <div className="space-y-4 max-w-4xl">

        {/* ── How it works banner ── */}
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Brain className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-blue-300">How context memory works</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Every <strong className="text-foreground">2 seconds</strong> and instantly on every window switch,
                the watcher reads visible text from your active window using Windows Accessibility APIs (no screenshots).
                Password managers, lock screen, Remote Desktop, and <strong className="text-foreground">Torvi AI itself</strong> are
                automatically excluded. Captured text is injected into the AI when you ask a question.
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed mt-1">
                <strong className="text-yellow-400">⚠️ Google Docs tip:</strong> Enable screen reader support in Docs for richer capture.
                Open any Google Doc → <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Tools</kbd> →{" "}
                <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Accessibility</kbd> → Turn on screen reader support.
                Or press <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Ctrl + Alt + Z</kbd> (Windows).
              </p>
            </div>
          </div>
        </div>

        {/* ── Google Docs screen-reader nudge (shown only when Docs is active and inaccessible) ── */}
        {showDocsNudge && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm">
            <div className="flex items-start gap-3">
              <span className="text-yellow-400 mt-0.5 shrink-0 text-base">⚠️</span>
              <div className="flex-1 space-y-1">
                <p className="font-medium text-yellow-300">Google Docs detected — content is inaccessible</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Google Docs renders document text on a canvas, which is invisible to accessibility APIs.
                  Enable screen reader mode so Torvi can read your document content.
                </p>
                <p className="text-xs mt-2">
                  Press{" "}
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] border border-border">Ctrl</kbd>
                  {" + "}
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] border border-border">Alt</kbd>
                  {" + "}
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] border border-border">Z</kbd>
                  {" in Google Docs, or go to "}
                  <strong className="text-foreground">Tools → Accessibility → Turn on screen reader support</strong>.
                </p>
              </div>
              <button
                onClick={() => setShowDocsNudge(false)}
                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* ── Filter tabs ── */}
        <div className="flex flex-wrap gap-1.5">
          {filterTabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Chunk list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading context history…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Brain className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No context captured yet</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">
              Switch between apps or wait a few seconds. The watcher fires on every window switch
              and every 5 seconds.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((chunk) => {
              const isOpen = expanded.has(chunk.id);
              const typeColor = CONTENT_TYPE_COLORS[chunk.content_type] ?? CONTENT_TYPE_COLORS.generic;
              const preview = chunk.text_content.slice(0, 200).replace(/\s+/g, " ").trim();

              return (
                <div
                  key={chunk.id}
                  className="rounded-lg border border-border bg-card overflow-hidden"
                >
                  {/* Header row */}
                  <button
                    onClick={() => toggleExpand(chunk.id)}
                    className="w-full flex items-start gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
                  >
                    {/* Content-type badge */}
                    <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${typeColor}`}>
                      {chunk.content_type.replace("_", " ")}
                    </span>

                    {/* App + title */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{chunk.app_name}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[280px]">{chunk.window_title}</span>
                        {chunk.url && (
                          <span className="text-[10px] text-blue-400 truncate max-w-[200px]">{chunk.url}</span>
                        )}
                      </div>
                      {!isOpen && (
                        <p className="mt-0.5 text-xs text-muted-foreground/80 line-clamp-1">{preview}</p>
                      )}
                    </div>

                    {/* Timestamp */}
                    <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                      {formatTime(chunk.captured_at)}&nbsp;·&nbsp;{timeAgo(chunk.captured_at)}
                    </span>
                  </button>

                  {/* Expanded text */}
                  {isOpen && (
                    <div className="px-3 pb-3">
                      <pre className="whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground font-mono max-h-96 overflow-y-auto border border-border/50">
                        {chunk.text_content || "(empty)"}
                      </pre>
                      <p className="mt-1.5 text-[10px] text-muted-foreground/50">
                        Hash: {chunk.content_hash.slice(0, 12)}… · {chunk.text_content.length} chars
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
