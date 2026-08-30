import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/contexts/theme.context";
import { AppProvider } from "@/contexts/app.context";
import { ToastProvider } from "@/contexts/toast.context";
import { router } from "@/routes";
import { initDatabase, initSystemPromptsTable } from "@/lib/database";
import { initContextStore, pruneOldContext } from "@/lib/database/context-store";
import { initMemorySyncState, scheduleMemoryChunkSync } from "@/lib/memory-sync";
import { applyCaptureExclusionsToBackend } from "@/lib/storage/capture-exclusions.storage";
import { listen } from "@tauri-apps/api/event";
import { initSessionTracking } from "@/lib/storage/usage";
import { isTauri } from "@/lib/platform";
import { pingBackend } from "@/lib/backend";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./global.css";

// Initialize database tables on startup (Tauri only — not available in plain browser)
if (isTauri()) {
  initDatabase().catch(console.error);
  initSystemPromptsTable().catch(console.error);

  // Initialise the context-chunks table (schema + migrations).
  // This is fire-and-forget — failures are logged but must NOT block the listener
  // or watcher startup below.  A DB error during init (e.g. locked file, schema
  // mismatch) previously caused the entire .then() chain to be skipped, leaving
  // no listener registered and no chunks ever saved.
  initContextStore()
    .then(() => {
      initMemorySyncState().catch(console.error);
      pruneOldContext().catch(console.error);
      setInterval(() => pruneOldContext().catch(console.error), 60 * 60 * 1000);
    })
    .catch((e: unknown) =>
      console.error("[ContextStore] initContextStore failed — saves may fail:", e)
    );

  // Start the background context watcher UNCONDITIONALLY — do not wait for
  // initContextStore so a DB hiccup cannot prevent the watcher from starting.
  // IMPORTANT: Only start the watcher in the 'main' pill-bar window.  The
  // 'dashboard' window loads the same main.tsx and would otherwise attempt to
  // start a second watcher instance.
  // Push saved exclusions to Rust before the watcher starts (any window).
  applyCaptureExclusionsToBackend().catch((e: unknown) =>
    console.warn("[CaptureExclusions] Could not apply:", e)
  );

  const currentWindowLabel = getCurrentWindow().label;
  if (currentWindowLabel === "main") {
    invoke("start_context_watcher").catch((e: unknown) =>
      console.warn("[ContextWatcher] Could not start:", e)
    );

    // NOTE: context chunk SAVES now happen entirely in Rust (context_db.rs).
    // The Rust watcher saves directly via sqlx after each capture, then emits
    // "context-chunks-saved" for the dashboard/context-memory UI to refresh.
    // We no longer register a JS listen("context-captured") for saving here —
    // the previous JS-side tauri-plugin-sql execute() was silently dropping all
    // INSERT OR REPLACE statements (rows_affected=0, no exception thrown).

    // Debounced cloud memory upload when new chunks land in SQLite.
    listen<void>("context-chunks-saved", () => {
      scheduleMemoryChunkSync();
    }).catch(console.warn);

    // Watchdog: restart the watcher if it stops unexpectedly (HMR, crash, etc.)
    // unless the user deliberately paused it via the UI.
    setInterval(() => {
      if (localStorage.getItem("ctx_watcher_paused") === "1") return;
      invoke<string>("get_watcher_status")
        .then((s) => {
          if (s !== "running") {
            console.warn("[ContextWatcher] Watchdog: watcher was stopped — restarting.");
            invoke("start_context_watcher").catch(() => {});
          }
        })
        .catch(() => {});
    }, 10_000);
  }
}
// Verify cloud backend connectivity on every app launch (see pingBackend in lib/backend)
pingBackend();

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
