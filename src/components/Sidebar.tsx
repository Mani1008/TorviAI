import { NavLink, useNavigate, useLocation } from "react-router";
import {
  MessageSquare,
  Settings,
  Keyboard,
  Camera,
  SlidersHorizontal,
  CreditCard,
  Brain,
  Sparkles,
  Plus,
  LayoutDashboard,
  Crown,
  User,
  LogOut,
  LogIn,
  ChevronRight,
  ChevronDown,
  X,
  Wrench,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";
import { logout } from "@/lib/backend";
import { clearAuthToken, clearUserProfile, loadUserProfile } from "@/lib/storage/auth";
import type { UserProfile } from "@/types/settings";
import { useHistory } from "@/hooks/useHistory";

interface SidebarProps {
  titleBar?: never;
}

const primaryNav = [
  { to: "/dashboard",      icon: LayoutDashboard, label: "Dashboard" },
  { to: "/context-memory", icon: Brain,           label: "Context Memory" },
  { to: "/skills",         icon: Sparkles,        label: "Skills & Policies" },
];

const toolsNav = [
  { to: "/shortcuts",  icon: Keyboard,          label: "Shortcuts" },
  { to: "/screenshot", icon: Camera,            label: "Screenshot" },
  { to: "/responses",  icon: SlidersHorizontal, label: "Responses" },
];

const bottomNav = [
  { to: "/billing",  icon: CreditCard, label: "Billing" },
  { to: "/settings", icon: Settings,   label: "Settings" },
];

/** Max recent chats shown collapsed */
const RECENT_COLLAPSED_COUNT = 4;

function PlanBadge({ plan }: { plan: UserProfile["plan"] }) {
  if (plan === "pro" || plan === "plus") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          plan === "pro"
            ? "bg-amber-100 text-amber-600"
            : "bg-indigo-100 text-indigo-600"
        )}
      >
        <Crown className="h-2 w-2" />
        {plan}
      </span>
    );
  }
  return null;
}

function NavItem({
  to,
  icon: Icon,
  label,
  compact = false,
}: {
  to: string;
  icon: typeof MessageSquare;
  label: string;
  compact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-2 rounded-md px-2.5 text-[13px] transition-all duration-150",
          compact ? "py-1" : "py-1.5",
          isActive
            ? "bg-neutral-200/70 text-foreground font-medium"
            : "text-foreground/55 hover:bg-neutral-200/50 hover:text-foreground/80"
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "h-[14px] w-[14px] shrink-0",
              isActive
                ? "text-primary"
                : "text-foreground/35 group-hover:text-foreground/55"
            )}
          />
          <span className="leading-none truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

// ── Context Awareness Panel ──────────────────────────────────────────────────
interface ContextPanelProps {
  status: "running" | "stopped";
  onResume: () => void;
  onPause: () => void;
  onClose: () => void;
  onManage: () => void;
  onDataDeleted: () => void;
}

function ContextPanel({ status, onResume, onPause, onClose, onManage, onDataDeleted }: ContextPanelProps) {
  const [resuming, setResuming] = useState(false);
  const [infoVisible, setInfoVisible] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleResume = async () => {
    setResuming(true);
    try {
      await invoke("start_context_watcher");
      localStorage.removeItem("ctx_watcher_paused"); // clear user pause intent
      onResume();
    } finally {
      setResuming(false);
    }
  };

  const handlePause = async () => {
    try {
      await invoke("stop_context_watcher");
      localStorage.setItem("ctx_watcher_paused", "1"); // remember user pause intent
      onPause();
    } catch { /* ignore */ }
  };

  const handleDeleteData = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await invoke("clear_context_data");
      localStorage.removeItem("ctx_watcher_paused");
      onDataDeleted();
      onClose();
    } catch (err) {
      console.error("[Sidebar] clear_context_data failed:", err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-50 rounded-t-xl border-t border-border bg-card shadow-2xl shadow-black/8">
        <div className="flex items-start justify-between border-b border-border/60 px-4 pt-3 pb-2.5">
          <p className="text-[11px] font-medium text-foreground/70 leading-snug pr-2">
            Context Awareness is{" "}
            {status === "stopped" ? "paused — resume?" : "active"}
          </p>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-0.5 text-foreground/25 hover:text-foreground/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {infoVisible && (
          <div className="mx-3 mt-2.5 mb-0.5 rounded-lg border border-border bg-secondary/50 p-3">
            <div className="flex items-start justify-between mb-1">
              <span className="text-xs font-semibold text-foreground/80">Context Awareness</span>
              <button
                onClick={() => setInfoVisible(false)}
                className="text-foreground/25 hover:text-foreground/50 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Torvi remembers your work across apps, no integrations needed.
            </p>
            <span className="mt-1.5 inline-block text-[11px] text-primary">Learn more ↗</span>
          </div>
        )}
        <div className="px-3 pb-3 pt-0.5">
          {status === "stopped" ? (
            <button
              onClick={handleResume}
              disabled={resuming}
              className="flex w-full items-center px-1 py-2.5 text-sm font-medium text-foreground/85 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {resuming ? "Resuming…" : "Resume Context Awareness"}
            </button>
          ) : (
            <button
              onClick={handlePause}
              className="flex w-full items-center px-1 py-2.5 text-sm text-foreground/80 hover:text-foreground transition-colors"
            >
              Pause Context Awareness
            </button>
          )}
          <div className="border-t border-border/60" />
          <button
            onClick={handleDeleteData}
            disabled={deleting}
            className={`flex w-full items-center justify-between px-1 py-2.5 text-sm transition-colors disabled:opacity-50 ${
              confirmDelete
                ? "text-red-500 hover:text-red-600"
                : "text-foreground/70 hover:text-foreground"
            }`}
          >
            <span>
              {deleting
                ? "Deleting…"
                : confirmDelete
                ? "Confirm — this cannot be undone"
                : "Delete Data"}
            </span>
            {!deleting && (
              confirmDelete
                ? <span className="text-[11px] font-medium text-red-500 shrink-0 ml-2">Tap to confirm</span>
                : <ChevronRight className="h-3.5 w-3.5 text-foreground/30" />
            )}
          </button>
          {confirmDelete && !deleting && (
            <button
              onClick={() => setConfirmDelete(false)}
              className="w-full px-1 pb-1.5 text-left text-[11px] text-foreground/35 hover:text-foreground/60 transition-colors"
            >
              Cancel
            </button>
          )}
          <div className="border-t border-border/60" />
          <div className="flex items-center justify-between px-1 py-2">
            <span className="text-[11px] text-muted-foreground leading-snug max-w-[130px]">
              Exclude apps Torvi can access context from
            </span>
            <button
              onClick={onManage}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground/65 hover:bg-secondary transition-colors"
            >
              Manage
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar(_props?: SidebarProps) {
  const [user] = useState<UserProfile | null>(() => loadUserProfile());
  const [watcherStatus, setWatcherStatus] = useState<"running" | "stopped">("stopped");
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { conversations, hasMorePages, isLoadingMore, loadMore, setSearch } = useHistory();
  const navigate = useNavigate();
  const location = useLocation();

  // Poll context watcher status every 3 s
  useEffect(() => {
    if (!isTauri()) return;
    const fetch = () =>
      invoke<string>("get_watcher_status")
        .then((s) => setWatcherStatus(s as "running" | "stopped"))
        .catch(() => {});
    fetch();
    const id = setInterval(fetch, 3000);
    return () => clearInterval(id);
  }, []);

  const handleSignOut = async () => {
    try { await logout(); } catch { /* expired */ }
    clearAuthToken();
    clearUserProfile();
    await invoke("lock_app").catch(() => {});
  };

  const visibleConversations = recentsExpanded
    ? conversations
    : conversations.slice(0, RECENT_COLLAPSED_COUNT);

  const hasMoreLocal = conversations.length > RECENT_COLLAPSED_COUNT;

  // Sync local search state into the hook (debounced via state change)
  useEffect(() => {
    setSearch(searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  return (
    <aside className="relative flex h-full w-[200px] shrink-0 flex-col overflow-hidden border-r border-border/70 bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-2 px-3.5 py-3">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/20">
          <span className="text-[9px] font-black text-white">T</span>
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-foreground/80">Torvi</span>
      </div>

      {/* New Chat quick action */}
      <div className="px-3 pb-2">
        <button
          onClick={() => navigate("/chats")}
          className="flex w-full items-center gap-1.5 rounded-md border border-border/70 bg-neutral-200/40 px-2.5 py-1.5 text-[13px] text-foreground/60 hover:bg-neutral-200/70 hover:text-foreground/80 transition-colors"
        >
          <Plus className="h-3 w-3 shrink-0" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Scrollable nav */}
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-2">
        {/* Primary nav */}
        <div className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        {/* Recents */}
        <div className="mt-4">
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-foreground/30">
            Recents
          </p>

          {/* Search box */}
          <div className="px-2.5 pb-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-md border border-border/50 bg-neutral-100/60 px-2 py-1 text-[11px] text-foreground/70 placeholder:text-foreground/30 outline-none focus:border-indigo-400/50 focus:bg-neutral-100/80 transition-colors"
            />
          </div>

          {conversations.length === 0 ? (
            searchQuery ? (
              <p className="px-2.5 py-1 text-[11px] text-foreground/30">No results</p>
            ) : null
          ) : (
            <div className="space-y-0.5">
              {visibleConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => navigate("/chats", { state: { conversationId: conv.id } })}
                  className="w-full rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-neutral-200/50 group"
                >
                  <p className="truncate text-[12px] text-foreground/55 group-hover:text-foreground/75 leading-snug">
                    {conv.title}
                  </p>
                </button>
              ))}

              {/* Expand to show all loaded conversations */}
              {hasMoreLocal && (
                <button
                  onClick={() => setRecentsExpanded((v) => !v)}
                  className="flex w-full items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-foreground/35 hover:text-foreground/55 transition-colors"
                >
                  {recentsExpanded ? (
                    <>
                      <ChevronDown className="h-3 w-3 shrink-0" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      {conversations.length - RECENT_COLLAPSED_COUNT} more
                    </>
                  )}
                </button>
              )}

              {/* Load next page from DB */}
              {recentsExpanded && hasMorePages && (
                <button
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="flex w-full items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-foreground/35 hover:text-foreground/55 transition-colors disabled:opacity-50"
                >
                  <ChevronDown className="h-3 w-3 shrink-0" />
                  {isLoadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tools — collapsible */}
        <div className="mt-4">
          <button
            onClick={() => setToolsOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-foreground/40 hover:bg-neutral-200/50 hover:text-foreground/65 transition-colors"
          >
            <Wrench className="h-[13px] w-[13px] shrink-0" />
            <span className="flex-1 text-left leading-none">Tools</span>
            {toolsOpen ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-foreground/25" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-foreground/25" />
            )}
          </button>

          {toolsOpen && (
            <div className="mt-0.5 space-y-0.5 pl-2">
              {toolsNav.map((item) => (
                <NavItem key={item.to} {...item} compact />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: settings + context status + user card */}
      <div className="shrink-0 border-t border-border/60 px-3 py-2 space-y-0.5">
        {bottomNav.map((item) => {
          if (item.to === "/settings") {
            const from =
              location.pathname.startsWith("/settings") ? "/dashboard" : location.pathname;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                state={{ from }}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-2 rounded-md px-2.5 text-[13px] transition-all duration-150 py-1.5",
                    isActive
                      ? "bg-neutral-200/70 text-foreground font-medium"
                      : "text-foreground/55 hover:bg-neutral-200/50 hover:text-foreground/80"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={cn(
                        "h-[14px] w-[14px] shrink-0",
                        isActive
                          ? "text-primary"
                          : "text-foreground/35 group-hover:text-foreground/55"
                      )}
                    />
                    <span className="leading-none truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          }
          return <NavItem key={item.to} {...item} />;
        })}

        {/* Context status toggle */}
        <button
          onClick={() => setContextPanelOpen((o) => !o)}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            contextPanelOpen
              ? "bg-neutral-200/70 text-foreground/80"
              : "text-foreground/50 hover:bg-neutral-200/50 hover:text-foreground/70"
          )}
        >
          <span>
            {watcherStatus === "running" ? "Context active" : "Context paused"}
          </span>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              watcherStatus === "running"
                ? "bg-emerald-500 animate-pulse"
                : "bg-foreground/20"
            )}
          />
        </button>

        {/* User card */}
        {user ? (
          <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="h-5 w-5 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-gradient-to-br from-indigo-100 to-violet-100">
                <User className="h-3 w-3 text-indigo-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-[12px] font-medium text-foreground/70">
                  {user.name.split(" ")[0]}
                </span>
                <PlanBadge plan={user.plan} />
              </div>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="shrink-0 rounded-md p-0.5 text-foreground/25 hover:text-red-500/70 transition-colors"
            >
              <LogOut className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => invoke("open_gate").catch(() => {})}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-primary transition-colors"
          >
            <LogIn className="h-[14px] w-[14px] shrink-0" />
            <span>Sign in</span>
          </button>
        )}
      </div>

      {/* Context Awareness Panel — rises from the bottom of the sidebar */}
      {contextPanelOpen && (
        <ContextPanel
          status={watcherStatus}
          onResume={() => setWatcherStatus("running")}
          onPause={() => setWatcherStatus("stopped")}
          onClose={() => setContextPanelOpen(false)}
          onManage={() => {
            setContextPanelOpen(false);
            navigate("/settings?section=privacy", {
              state: { from: location.pathname },
            });
          }}
          onDataDeleted={() => setWatcherStatus("stopped")}
        />
      )}
    </aside>
  );
}


