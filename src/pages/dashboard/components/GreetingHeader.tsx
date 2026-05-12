import type { UserProfile } from "@/types/settings";

interface Props {
  user: UserProfile | null;
  watcherStatus: "running" | "stopped";
  contextChunksToday: number;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function GreetingHeader({ user, watcherStatus, contextChunksToday }: Props) {
  const firstName = user?.name?.split(" ")[0];
  const isRunning = watcherStatus === "running";

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {/* Main greeting */}
      <h1 className="text-3xl font-bold tracking-tight">
        {greeting()}{firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="text-lg text-muted-foreground/70 font-normal">
        What's on your mind today?
      </p>

      {/* Subtle context pill */}
      <div
        className={`mt-1 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
          isRunning
            ? "bg-green-500/8 text-green-500/70"
            : "bg-yellow-500/8 text-yellow-500/60"
        }`}
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            isRunning ? "bg-green-500 animate-pulse" : "bg-yellow-500/60"
          }`}
        />
        {isRunning
          ? `Context active · ${contextChunksToday} captured today`
          : "Context capture is paused"}
      </div>
    </div>
  );
}

