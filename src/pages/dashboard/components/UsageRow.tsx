/**
 * UsageRow — ultra-compact footer bar.
 * Two inline bars: listening time + AI responses.
 */
import { Mic, Zap } from "lucide-react";
import type { UserProfile } from "@/types/settings";
import { PLAN_LIMITS } from "@/config/constants";

interface Props {
  user: UserProfile | null;
  usedListeningSeconds: number;
  usedAiResponses: number;
}

function fmtTime(secs: number): string {
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

  const barCls = (pct: number) =>
    pct >= 90
      ? "bg-red-500"
      : pct >= 70
      ? "bg-amber-500"
      : "bg-primary/60";

  return (
    <div className="flex items-center gap-6">
      {/* Listening */}
      <div className="flex items-center gap-2 min-w-0">
        <Mic className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground/50">
            {fmtTime(usedListeningSeconds)}
            <span className="text-muted-foreground/30"> / {fmtTime(limits.listeningSeconds)}</span>
          </span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted/60">
            <div
              className={`h-full rounded-full transition-all ${barCls(listenPct)}`}
              style={{ width: `${listenPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* AI responses */}
      <div className="flex items-center gap-2 min-w-0">
        <Zap className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground/50">
            {usedAiResponses}
            <span className="text-muted-foreground/30"> / {limits.aiResponses} responses</span>
          </span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted/60">
            <div
              className={`h-full rounded-full transition-all ${barCls(aiPct)}`}
              style={{ width: `${aiPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

