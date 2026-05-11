import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/contexts/theme.context";
import { AppProvider } from "@/contexts/app.context";
import { ToastProvider } from "@/contexts/toast.context";
import { router } from "@/routes";
import { initDatabase, initSystemPromptsTable } from "@/lib/database";
import { initSessionTracking } from "@/lib/storage/usage";
import { isTauri } from "@/lib/platform";
import "./global.css";

// Initialize database tables on startup (Tauri only — not available in plain browser)
if (isTauri()) {
  initDatabase().catch(console.error);
  initSystemPromptsTable().catch(console.error);
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
