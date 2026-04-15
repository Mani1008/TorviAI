import { useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "@/components/Sidebar";
import { Onboarding, isOnboarded } from "@/components/Onboarding";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X, Minus, Square } from "lucide-react";

function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-9 bg-background border-b border-border px-3 select-none shrink-0"
    >
      {/* Left — app brand */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <div className="h-3.5 w-3.5 rounded-sm bg-indigo-500/80" />
        <span className="text-xs font-semibold tracking-wide text-foreground/60">
          Pluely
        </span>
      </div>

      {/* Right — window controls */}
      <div className="flex items-center -mr-1">
        <button
          onClick={() => appWindow.minimize()}
          className="flex items-center justify-center h-7 w-8 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={async () => {
            const maximized = await appWindow.isMaximized();
            maximized ? appWindow.unmaximize() : appWindow.maximize();
          }}
          className="flex items-center justify-center h-7 w-8 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          onClick={() => appWindow.hide()}
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
