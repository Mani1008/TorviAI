import { NavLink } from "react-router";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Keyboard,
  Camera,
  SlidersHorizontal,
  CreditCard,
  LogOut,
  LogIn,
  Brain,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { logout } from "@/lib/appwrite";
import { clearAuthToken, clearUserProfile, loadUserProfile } from "@/lib/storage/auth";

const navItems = [
  { to: "/dashboard",      icon: LayoutDashboard,   label: "Dashboard" },
  { to: "/chats",          icon: MessageSquare,      label: "Chats" },
  { to: "/shortcuts",      icon: Keyboard,           label: "Shortcuts" },
  { to: "/screenshot",     icon: Camera,             label: "Screenshot" },
  { to: "/context-memory", icon: Brain,              label: "Context Memory" },
  { to: "/responses",      icon: SlidersHorizontal,  label: "Responses" },
  { to: "/billing",        icon: CreditCard,         label: "Billing" },
  { to: "/settings",       icon: Settings,           label: "Settings" },
];

export function Sidebar() {
  const [isSignedIn, setIsSignedIn] = useState(() => loadUserProfile() !== null);

  const handleSignOut = async () => {
    setIsSignedIn(false);
    try {
      await logout();
    } catch {
      // Session may already be expired — continue with local cleanup
    }
    clearAuthToken();
    clearUserProfile();
    // Hide all app windows and show the gate
    await invoke("lock_app").catch(() => {});
  };

  const handleSignIn = async () => {
    // Show the gate window for sign-in
    await invoke("open_gate").catch(() => {});
  };

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-sidebar-background p-3">
      <div className="mb-6 px-2 pt-2">
        <h1 className="text-lg font-bold text-sidebar-foreground">
          AI Assistant
        </h1>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      {/* Auth action — pinned to sidebar footer */}
      <div className="mt-2 border-t border-border pt-2">
        {isSignedIn ? (
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        ) : (
          <button
            onClick={handleSignIn}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-indigo-500/10 hover:text-indigo-400 transition-colors"
          >
            <LogIn className="h-4 w-4 shrink-0" />
            Sign in
          </button>
        )}
      </div>
    </aside>
  );
}
