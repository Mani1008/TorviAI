import { NavLink } from "react-router";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Keyboard,
  Camera,
  Mic,
  FileText,
  SlidersHorizontal,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/chats", icon: MessageSquare, label: "Chats" },
  { to: "/system-prompts", icon: FileText, label: "System Prompts" },
  { to: "/shortcuts", icon: Keyboard, label: "Shortcuts" },
  { to: "/screenshot", icon: Camera, label: "Screenshot" },
  { to: "/audio", icon: Mic, label: "Audio" },
  { to: "/responses", icon: SlidersHorizontal, label: "Responses" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
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
    </aside>
  );
}
