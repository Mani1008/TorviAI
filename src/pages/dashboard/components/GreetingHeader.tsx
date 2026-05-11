import { Crown, User, LogOut, Circle } from "lucide-react";
import type { UserProfile } from "@/types/settings";

interface Props {
  user: UserProfile | null;
  watcherStatus: "running" | "stopped";
  contextChunksToday: number;
  onSignOut: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dateStr(): string {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function GreetingHeader({ user, watcherStatus, contextChunksToday, onSignOut }: Props) {
  const planLabel =
    user?.plan === "pro" ? "Pro" : user?.plan === "plus" ? "Plus" : "Starter";
  const planColor =
    user?.plan === "pro"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : user?.plan === "plus"
      ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
      : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";

  const isRunning = watcherStatus === "running";

  return (
    <div className="flex items-start justify-between gap-4">
      {/* Left: greeting + date */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{dateStr()}</p>
      </div>

      {/* Right: context pill + user */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Context status pill */}
        <div
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
            isRunning
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
          }`}
        >
          <Circle
            className={`h-1.5 w-1.5 fill-current ${isRunning ? "animate-pulse" : ""}`}
          />
          {isRunning
            ? `Context active · ${contextChunksToday} captured today`
            : "Context paused"}
        </div>

        {/* User avatar */}
        {user && (
          <div className="flex items-center gap-2">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="h-8 w-8 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div className="hidden sm:block">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium leading-none">{user.name}</span>
                <span
                  className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${planColor}`}
                >
                  <Crown className="h-2.5 w-2.5" />
                  {planLabel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
            </div>
            <button
              onClick={onSignOut}
              title="Sign out"
              className="ml-1 rounded-md p-1.5 text-muted-foreground/60 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
