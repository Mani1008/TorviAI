import { useEffect, useState, useCallback } from "react";
import {
  getAllConversations,
  getRecentContext,
} from "@/lib/database";
import { loadUserProfile, clearAuthToken, clearUserProfile } from "@/lib/storage/auth";
import { loadUsageStats } from "@/lib/storage/usage-stats";
import type { UserProfile, UsageStats } from "@/types/settings";
import type { ChatConversation } from "@/types/completion";
import type { ContextChunk } from "@/lib/database/context-store";
import { logout } from "@/lib/backend";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/platform";
import { QuickChatInput } from "./components/QuickChatInput";
import { RecentActivityFeed } from "./components/RecentActivityFeed";
import { UsageRow } from "./components/UsageRow";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [recentChunks, setRecentChunks] = useState<ContextChunk[]>([]);
  const [watcherStatus, setWatcherStatus] = useState<"running" | "stopped">("stopped");

  const loadData = useCallback(async () => {
    setUser(loadUserProfile());
    setUsage(loadUsageStats());
    try {
      const [convs, chunks, status] = await Promise.all([
        getAllConversations(),
        getRecentContext(8, 24 * 60),
        isTauri()
          ? invoke<string>("get_watcher_status").catch(() => "stopped")
          : Promise.resolve("stopped"),
      ]);
      setConversations(convs);
      setRecentChunks(chunks);
      setWatcherStatus((status as "running" | "stopped") || "stopped");
    } catch { /* SQLite not ready */ }
  }, []);

  useEffect(() => {
    loadData();

    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onFocusChanged(({ payload: focused }) => { if (focused) loadData(); })
          .then((fn) => { unlisten = fn; })
          .catch(() => {})
      );
    }

    const poll = setInterval(() => {
      setUsage(loadUsageStats());
      if (isTauri()) {
        invoke<string>("get_watcher_status")
          .then((s) => setWatcherStatus((s as "running" | "stopped") || "stopped"))
          .catch(() => {});
      }
    }, 1000);

    // Refresh context chunks whenever new chunks are committed to the DB.
    // Use Tauri listen() — saveContextChunk runs in the 'main' window and
    // emits via Tauri IPC.  DOM CustomEvents don't cross WebView boundaries.
    let unlistenSaved: (() => void) | undefined;
    listen<void>("context-chunks-saved", () => {
      getRecentContext(8, 24 * 60)
        .then((chunks) => setRecentChunks(chunks))
        .catch(() => {});
    }).then((fn) => { unlistenSaved = fn; }).catch(() => {});

    return () => { unlisten?.(); unlistenSaved?.(); clearInterval(poll); };
  }, [loadData]);

  const handleSignOut = async () => {
    setUser(null); setUsage(null); setConversations([]); setRecentChunks([]);
    try { await logout(); } catch { /* expired */ }
    clearAuthToken(); clearUserProfile();
    await invoke("lock_app").catch(() => {});
  };

  // captured_at is Unix seconds — convert todayStart to seconds too.
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const contextChunksToday = recentChunks.filter((c) => c.captured_at >= todayStart).length;
  const firstName = user?.name?.split(" ")[0];
  const hasActivity = conversations.length > 0 || recentChunks.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Scrollable canvas ── */}
      <div className="flex flex-1 flex-col overflow-y-auto">

        {/* ─────────────────────────────────────────────── */}
        {/*  HERO — vertically centered, max-width capped  */}
        {/* ─────────────────────────────────────────────── */}
        <div
          className="flex flex-1 flex-col items-center justify-center px-10 py-12"
          style={{ minHeight: "380px" }}
        >
          <div
            className="w-full max-w-[620px] space-y-7"
            style={{ animation: "scaleIn 0.25s ease-out" }}
          >
            {/* ── Greeting ── */}
            <div className="space-y-1 text-center">
              <h1 className="text-[28px] font-bold tracking-tight leading-tight">
                {/* Gradient text — indigo → violet */}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, oklch(0.32 0.18 264) 0%, oklch(0.42 0.22 274) 55%, oklch(0.38 0.20 295) 100%)",
                  }}
                >
                  {greeting()}
                  {firstName ? `, ${firstName}` : ""}
                </span>
              </h1>
              <p className="text-base text-foreground/40 font-normal">
                What's on your mind today?
              </p>
              {/* Context awareness dot */}
              <div className="flex items-center justify-center gap-1.5 pt-0.5">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    watcherStatus === "running"
                      ? "bg-emerald-500 animate-pulse"
                      : "bg-foreground/20"
                  }`}
                />
                <span className="text-[11px] text-foreground/30">
                  {watcherStatus === "running"
                    ? `Context active · ${contextChunksToday} captured today`
                    : "Context capture paused"}
                </span>
              </div>
            </div>

            {/* ── Chat Input ── */}
            <QuickChatInput recentChunks={recentChunks} />
          </div>
        </div>

        {/* ─────────────────────────────────────── */}
        {/*  RECENTS — only shown when there's data */}
        {/* ─────────────────────────────────────── */}
        {hasActivity && (
          <div
            className="mx-auto w-full max-w-[620px] px-10 pb-8"
            style={{ animation: "fadeInUp 0.3s ease-out 0.1s both" }}
          >
            {/* Section divider */}
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border/40" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/25">
                Recents
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border/40" />
            </div>

            <RecentActivityFeed
              conversations={conversations}
              contextChunks={recentChunks}
            />
          </div>
        )}
      </div>

      {/* ───────────────────────── */}
      {/*  FOOTER — usage + signout */}
      {/* ───────────────────────── */}
      <div className="shrink-0 border-t border-border/60 bg-dashboard-bg/90 backdrop-blur-sm px-6 py-2.5 flex items-center justify-between">
        <UsageRow
          user={user}
          usedListeningSeconds={usage?.listeningSeconds ?? 0}
          usedAiResponses={usage?.aiResponses ?? 0}
        />
        {user && (
          <button
            onClick={handleSignOut}
            className="text-[11px] text-foreground/25 hover:text-red-400/60 transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}



