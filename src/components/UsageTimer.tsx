import { useEffect, useRef, useState } from "react";
import { loadUsageStats } from "@/lib/storage/usage-stats";
import { Headphones, Sparkles } from "lucide-react";

export function UsageTimer() {
  const [listeningSeconds, setListeningSeconds] = useState(0);
  const [aiResponses, setAiResponses] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => {
      const stats = loadUsageStats();
      setListeningSeconds(stats.listeningSeconds);
      setAiResponses(stats.aiResponses);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const h = Math.floor(listeningSeconds / 3600);
  const m = Math.floor((listeningSeconds % 3600) / 60);
  const s = listeningSeconds % 60;

  return (
    <div
      title="Listening time / AI responses this period"
      className="
        flex items-center gap-2
        px-2 py-1
        rounded-full
        text-[11px] font-medium
        text-white/80
        backdrop-blur-md
        bg-white/5
        border border-white/10
        shadow-sm
        select-none
        font-mono
        tracking-wider
      "
    >
      {/* Listening time */}
      <span className="flex items-center gap-1">
        <Headphones className="h-3 w-3 text-emerald-400/70" />
        <span>
          {h > 0 ? `${pad(h)}:` : ""}
          {pad(m)}:{pad(s)}
        </span>
      </span>

      <span className="text-white/20">|</span>

      {/* AI responses */}
      <span className="flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-indigo-400/70" />
        <span>{aiResponses}</span>
      </span>
    </div>
  );
}
