import { Mic, Zap } from "lucide-react";
import type { UserProfile } from "@/types/settings";
import { PLAN_LIMITS } from "@/config/constants";

interface Props {
  user: UserProfile | null;
  usedListeningSeconds: number;
  usedAiResponses: number;
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function UsageRow({ user, usedListeningSeconds, usedAiResponses }: Props) {
  const plan = user?.plan ?? "starter";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;

  const listenPct = Math.min(100, (usedListeningSeconds / limits.listeningSeconds) * 100);
  const aiPct = Math.min(100, (usedAiResponses / limits.aiResponses) * 100);

  const barColor = (pct: number) =>
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-primary";

  return (
    <div className="flex gap-4">
      {/* Listening usage */}
      <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Mic className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Listening</span>
            <span className="text-xs text-muted-foreground/70">
              {formatTime(usedListeningSeconds)} / {formatTime(limits.listeningSeconds)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${barColor(listenPct)}`}
              style={{ width: `${listenPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* AI responses usage */}
      <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">AI Responses</span>
            <span className="text-xs text-muted-foreground/70">
              {usedAiResponses} / {limits.aiResponses}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${barColor(aiPct)}`}
              style={{ width: `${aiPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
