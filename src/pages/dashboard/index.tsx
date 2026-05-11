import { useEffect, useState, useCallback } from "react";
import { PageLayout } from "@/layouts";
import {
  getAllConversations,
  getRecentContext,
} from "@/lib/database";

import { loadUserProfile, clearAuthToken, clearUserProfile } from "@/lib/storage/auth";
import { loadUsageStats } from "@/lib/storage/usage-stats";
import type { UserProfile, UsageStats } from "@/types/settings";
import type { ChatConversation } from "@/types/completion";
import type { ContextChunk } from "@/lib/database/context-store";
import { logout } from "@/lib/appwrite";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";
import { GreetingHeader } from "./components/GreetingHeader";
import { QuickChatInput } from "./components/QuickChatInput";
import { RecentActivityFeed } from "./components/RecentActivityFeed";
import { ContextSnapshot } from "./components/ContextSnapshot";
import { UsageRow } from "./components/UsageRow";

export default function Dashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [recentChunks, setRecentChunks] = useState<ContextChunk[]>([]);
  const [watcherStatus, setWatcherStatus] = useState<"running" | "stopped">("stopped");

  const handleSignOut = async () => {
    setUser(null);
    setUsage(null);
    setConversations([]);
    setRecentChunks([]);
    try { await logout(); } catch { /* session may be expired */ }
    clearAuthToken();
    clearUserProfile();
    await invoke("lock_app").catch(() => {});
  };

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
    } catch {
      // SQLite not yet ready — silently ignore
    }
  }, []);

  useEffect(() => {
    loadData();

    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onFocusChanged(({ payload: focused }) => {
            if (focused) loadData();
          })
          .then((fn) => { unlisten = fn; })
          .catch(() => {})
      );
    }

    // Poll usage stats + watcher status every second
    const poll = setInterval(() => {
      setUsage(loadUsageStats());
      if (isTauri()) {
        invoke<string>("get_watcher_status")
          .then((s) => setWatcherStatus((s as "running" | "stopped") || "stopped"))
          .catch(() => {});
      }
    }, 1000);

    return () => {
      unlisten?.();
      clearInterval(poll);
    };
  }, [loadData]);

  // Count context chunks captured today
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const contextChunksToday = recentChunks.filter(
    (c) => c.captured_at >= todayStart
  ).length;

  return (
    <PageLayout title="Dashboard" description="Overview of your AI assistant usage">
      <div className="flex flex-col gap-5">

        {/* ── Greeting header (full width) ── */}
        <GreetingHeader
          user={user}
          watcherStatus={watcherStatus}
          contextChunksToday={contextChunksToday}
          onSignOut={handleSignOut}
        />

        {/* ── Quick chat input (full width) ── */}
        <QuickChatInput recentChunks={recentChunks} />

        {/* ── Two-column main content ── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">

          {/* Left column: recent activity */}
          <div className="flex flex-col gap-3 lg:col-span-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Activity
            </h2>
            <RecentActivityFeed
              conversations={conversations}
              contextChunks={recentChunks}
            />
          </div>

          {/* Right column: live context snapshot */}
          <div className="lg:col-span-2">
            <ContextSnapshot
              initialChunks={recentChunks}
              initialStatus={watcherStatus}
            />
          </div>
        </div>

        {/* ── Usage row (full width) ── */}
        <UsageRow
          user={user}
          usedListeningSeconds={usage?.listeningSeconds ?? 0}
          usedAiResponses={usage?.aiResponses ?? 0}
        />
      </div>
    </PageLayout>
  );
}

