import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/contexts/theme.context";
import { AppProvider } from "@/contexts/app.context";
import { ToastProvider } from "@/contexts/toast.context";
import { router } from "@/routes";
import { initDatabase, initSystemPromptsTable } from "@/lib/database";
import { initContextStore, saveContextChunk, pruneOldContext, type AppContextSnapshot } from "@/lib/database/context-store";
import { initSessionTracking } from "@/lib/storage/usage";
import { isTauri } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./global.css";

// Initialize database tables on startup (Tauri only — not available in plain browser)
if (isTauri()) {
  initDatabase().catch(console.error);
  initSystemPromptsTable().catch(console.error);

  // Initialise the context-chunks table, then start the UIAutomation watcher.
  initContextStore()
    .then(() => {
      // Prune stale context from previous sessions (keep last 24 h).
      pruneOldContext().catch(console.error);

      // Prune again every hour — avoids unbounded DB growth during long sessions.
      setInterval(() => {
        pruneOldContext().catch(console.error);
      }, 60 * 60 * 1000);

      // Start the background context watcher (Windows UIAutomation, 5 s poll).
      invoke("start_context_watcher").catch((e: unknown) =>
        console.warn("[ContextWatcher] Could not start:", e)
      );

      // Persist every captured snapshot to SQLite for RAG injection.
      listen<AppContextSnapshot>("context-captured", ({ payload }) => {
        saveContextChunk(payload).catch(console.error);
      }).catch(console.error);
    })
    .catch(console.error);
}
// Track session count for usage stats
initSessionTracking();

// Force dark class so dark:prose-invert and any dark: variants work throughout
document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AppProvider>
          <RouterProvider router={router} />
        </AppProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
