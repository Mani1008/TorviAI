import { useState, useEffect } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "@/components/Sidebar";
import { Onboarding, isOnboarded } from "@/components/Onboarding";
import { isTauri } from "@/lib/platform";
import { loadUserProfile } from "@/lib/storage/auth";
import { X, Minus, Square } from "lucide-react";

function TitleBar() {
  const startDrag = (e: React.MouseEvent) => {
    if (!isTauri()) return;
    if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
      e.preventDefault();
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().startDragging().catch(() => {})
      );
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-9 bg-background border-b border-border px-3 select-none shrink-0 cursor-move"
      onMouseDown={startDrag}
    >
      {/* Left — app brand (drag region) */}
      <div data-tauri-drag-region className="flex items-center gap-2 flex-1 h-full">
        <div className="h-3.5 w-3.5 rounded-sm bg-indigo-500/80 pointer-events-none" />
        <span className="text-xs font-semibold tracking-wide text-foreground/60 pointer-events-none">
          Torvi
        </span>
      </div>

      {/* Right — window controls */}
      <div className="flex items-center -mr-1">
        <button
          onClick={() => isTauri() && import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize())}
          className="flex items-center justify-center h-7 w-8 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={async () => {
            if (!isTauri()) return;
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const w = getCurrentWindow();
            const maximized = await w.isMaximized();
            maximized ? w.unmaximize() : w.maximize();
          }}
          className="flex items-center justify-center h-7 w-8 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          onClick={() => isTauri() && import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().hide())}
          className="flex items-center justify-center h-7 w-8 rounded-md text-muted-foreground/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function DashboardLayout() {
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboarded());

  // Auth gate — if there's no valid session when the dashboard mounts, hide this
  // window immediately. The gate is managed by Rust (shown on startup and by lock_app).
  // Do NOT call open_gate here — it can interfere with the unlock_app reload cycle.
  useEffect(() => {
    if (!loadUserProfile() && isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().hide().catch(() => {})
      );
    }
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}
