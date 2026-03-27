import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/contexts/theme.context";
import { AppProvider } from "@/contexts/app.context";
import { router } from "@/routes";
import { initDatabase, initSystemPromptsTable } from "@/lib/database";
import "./global.css";

// Initialize database tables on startup
initDatabase().catch(console.error);
initSystemPromptsTable().catch(console.error);

// Force dark class so dark:prose-invert and any dark: variants work throughout
document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ThemeProvider>
  </React.StrictMode>
);
