import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { Sidebar } from "@/components/Sidebar";
import { Onboarding, isOnboarded } from "@/components/Onboarding";
import { Updater } from "@/components/Updater";
import Dashboard from "@/pages/dashboard";
import { isTauri } from "@/lib/platform";
import { loadUserProfile } from "@/lib/storage/auth";
import { X, Minus, Maximize2, Minimize2 } from "lucide-react";

function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only drag on left mouse button, not on button elements
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (!isTauri()) return;
    e.preventDefault();
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().startDragging().catch(() => {})
    );
  };

  const toggleMaximize = async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    const isMax = await w.isMaximized();
    isMax ? w.unmaximize() : w.maximize();
    setMaximized(!isMax);
  };

  return (
    <div
      className="flex h-8 w-full shrink-0 select-none items-center bg-transparent"
      onMouseDown={handleDragStart}
    >
      {/* Drag region fills left side */}
      <div className="flex-1 h-full cursor-move" />

      {/* Windows-style controls — flat rectangular, no circles */}
      <div className="flex h-full items-stretch">
        {/* Minimize */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() =>
            isTauri() &&
            import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
              getCurrentWindow().minimize()
            )
          }
          title="Minimize"
          className="flex w-11 items-center justify-center text-foreground/40 hover:bg-neutral-200 hover:text-foreground/70 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        {/* Maximize / Restore */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleMaximize}
          title={maximized ? "Restore" : "Maximize"}
          className="flex w-11 items-center justify-center text-foreground/40 hover:bg-neutral-200 hover:text-foreground/70 transition-colors"
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        {/* Close */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() =>
            isTauri() &&
            import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
              getCurrentWindow().hide()
            )
          }
          title="Close"
          className="flex w-11 items-center justify-center text-foreground/40 hover:bg-red-500 hover:text-white transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function DashboardLayout() {
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboarded());
  const location = useLocation();
  const isSettingsOpen = location.pathname.startsWith("/settings");

  useEffect(() => {
    if (!loadUserProfile() && isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().hide().catch(() => {})
      );
    }
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-dashboard-bg">
      {/* Windows titlebar — full width, drag region left, controls right */}
      <TitleBar />

      {/* Silent update check — shows a banner if a new version is available */}
      <Updater />

      {/* Sidebar + main content below the titlebar */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-hidden">
          {isSettingsOpen && (
            <div
              aria-hidden
              className="absolute inset-0 overflow-hidden pointer-events-none select-none"
            >
              <Dashboard />
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}

