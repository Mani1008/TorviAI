/**
 * ContextBanner — shown when context capture is paused.
 * Mimics LittleBird's "Context Awareness is paused" sidebar notification style
 * but rendered as an inline banner above the hero area.
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Brain } from "lucide-react";

interface Props {
  status: "running" | "stopped";
  onResume: () => void;
}

export function ContextBanner({ status, onResume }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [resuming, setResuming] = useState(false);

  if (status === "running" || dismissed) return null;

  const handleResume = async () => {
    setResuming(true);
    try {
      await invoke("start_context_watcher");
      onResume();
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="mx-auto mb-6 w-full max-w-lg rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <Brain className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500/60" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/80">
            Context Awareness is paused — resume?
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            Torvi remembers your work across apps, no integrations needed.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleResume}
              disabled={resuming}
              className="text-xs font-medium text-primary hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              {resuming ? "Resuming…" : "Resume Context Awareness"}
            </button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
