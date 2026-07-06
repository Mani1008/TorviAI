/**
 * Silent auto-update checker.
 *
 * Runs once when the dashboard mounts (i.e. once per app session).
 * - On update found   → shows a non-intrusive banner at the top of the screen.
 * - On no update      → silent no-op.
 * - On error          → silent no-op (don't bother users with network issues).
 *
 * The install flow calls `update.downloadAndInstall()` and then exits the app
 * via the existing `exit_app` IPC command so the OS-level installer can relaunch
 * the new version. This avoids a dependency on `tauri-plugin-process`.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";

interface UpdateInfo {
  version: string;
  body: string | null;
}

export function Updater() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    // Dynamic import keeps the bundle small on non-Tauri (web) builds.
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((u) => {
        if (u) {
          setUpdate({ version: u.version, body: u.body ?? null });
        }
      })
      .catch(() => {
        // Network unavailable or endpoint not yet configured — stay silent.
      });
  }, []);

  if (!update) return null;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const u = await check();
      if (!u) return;
      await u.downloadAndInstall();
      // Exit the old process — the OS installer will relaunch the new version.
      await invoke("exit_app");
    } catch (err) {
      console.error("[Updater] Install failed:", err);
      setInstalling(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-primary/10 border-b border-primary/20 px-4 py-2 text-xs">
      <span className="text-foreground/80">
        <span className="font-semibold">Torvi {update.version}</span> is available.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setUpdate(null)}
          className="text-foreground/40 hover:text-foreground/70 transition-colors"
          aria-label="Dismiss update"
        >
          ✕
        </button>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {installing ? "Installing…" : "Install & Restart"}
        </button>
      </div>
    </div>
  );
}
