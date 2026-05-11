import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Brain, Pause, Play, ExternalLink, Circle } from "lucide-react";
import type { ContextChunk } from "@/lib/database/context-store";

interface Props {
  initialChunks: ContextChunk[];
  initialStatus: "running" | "stopped";
}

const CONTENT_TYPE_COLORS: Record<string, string> = {
  code:               "bg-blue-500/15 text-blue-400",
  document:           "bg-green-500/15 text-green-400",
  email:              "bg-orange-500/15 text-orange-400",
  chat:               "bg-purple-500/15 text-purple-400",
  meeting:            "bg-pink-500/15 text-pink-400",
  project_management: "bg-yellow-500/15 text-yellow-400",
  browser:            "bg-sky-500/15 text-sky-400",
  generic:            "bg-zinc-500/15 text-zinc-400",
};

export function ContextSnapshot({ initialChunks, initialStatus }: Props) {
  const navigate = useNavigate();
  const [chunks, setChunks] = useState<ContextChunk[]>(initialChunks.slice(0, 3));
  const [status, setStatus] = useState<"running" | "stopped">(initialStatus);
  const [toggling, setToggling] = useState(false);

  // Update if parent refreshes initialChunks
  useEffect(() => {
    setChunks(initialChunks.slice(0, 3));
  }, [initialChunks]);

  // Live updates from background watcher
  useEffect(() => {
    const unlisten = listen<ContextChunk>("context-captured", (e) => {
      setChunks((prev) => [e.payload, ...prev].slice(0, 3));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const toggleWatcher = async () => {
    setToggling(true);
    try {
      if (status === "running") {
        await invoke("stop_context_watcher");
        setStatus("stopped");
      } else {
        await invoke("start_context_watcher");
        setStatus("running");
      }
    } finally {
      setToggling(false);
    }
  };

  const isRunning = status === "running";

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Context Snapshot</span>
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isRunning
                ? "bg-green-500/10 text-green-400"
                : "bg-yellow-500/10 text-yellow-400"
            }`}
          >
            <Circle
              className={`h-1.5 w-1.5 fill-current ${isRunning ? "animate-pulse" : ""}`}
            />
            {isRunning ? "Live" : "Paused"}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleWatcher}
            disabled={toggling}
            title={isRunning ? "Pause capture" : "Resume capture"}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
          >
            {isRunning ? (
              <><Pause className="h-3 w-3" /> Pause</>
            ) : (
              <><Play className="h-3 w-3" /> Resume</>
            )}
          </button>
          <button
            onClick={() => navigate("/context-memory")}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            View all
          </button>
        </div>
      </div>

      {/* Chunks */}
      {chunks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground py-6">
          <Brain className="mb-2 h-8 w-8 opacity-20" />
          <p className="text-xs">
            {isRunning
              ? "Waiting for first capture…"
              : "Context capture is paused"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {chunks.map((chunk) => (
            <div
              key={chunk.id}
              className="rounded-lg bg-muted/40 px-3 py-2.5 space-y-1"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    CONTENT_TYPE_COLORS[chunk.content_type] ?? CONTENT_TYPE_COLORS.generic
                  }`}
                >
                  {chunk.content_type.replace("_", " ")}
                </span>
                <span className="truncate text-xs font-medium">
                  {chunk.window_title.split(" - ")[0].trim()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                {chunk.text_content.slice(0, 120)}
                {chunk.text_content.length > 120 ? "…" : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
