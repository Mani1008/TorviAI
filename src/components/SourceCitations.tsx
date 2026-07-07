import { useState } from "react";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ContextSourceCitation } from "@/types/completion";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/platform";

const TYPE_LABELS: Record<string, string> = {
  code: "Code",
  document: "Doc",
  email: "Email",
  chat: "Chat",
  meeting: "Meeting",
  project_management: "PM",
  generic: "Screen",
};

const TYPE_STYLES_OVERLAY: Record<string, string> = {
  code: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  document: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  email: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  chat: "bg-green-500/20 text-green-300 border-green-500/30",
  meeting: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  project_management: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  generic: "bg-white/10 text-white/60 border-white/15",
};

const TYPE_STYLES_DASHBOARD: Record<string, string> = {
  code: "bg-blue-100 text-blue-700 border-blue-200",
  document: "bg-amber-100 text-amber-800 border-amber-200",
  email: "bg-purple-100 text-purple-700 border-purple-200",
  chat: "bg-green-100 text-green-700 border-green-200",
  meeting: "bg-orange-100 text-orange-700 border-orange-200",
  project_management: "bg-pink-100 text-pink-700 border-pink-200",
  generic: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

function timeAgo(unixSecs: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixSecs;
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

interface SourceCitationsProps {
  sources: ContextSourceCitation[];
  /** Overlay pill uses dark glass; dashboard uses light cards. */
  variant?: "overlay" | "dashboard";
  className?: string;
}

export function SourceCitations({
  sources,
  variant = "dashboard",
  className,
}: SourceCitationsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!sources.length) return null;

  const typeStyles = variant === "overlay" ? TYPE_STYLES_OVERLAY : TYPE_STYLES_DASHBOARD;
  const isOverlay = variant === "overlay";

  return (
    <div className={cn("mt-2.5 space-y-1.5", className)}>
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide",
          isOverlay ? "text-white/35" : "text-muted-foreground"
        )}
      >
        <BookOpen className="h-3 w-3" />
        <span>
          {sources.length} source{sources.length !== 1 ? "s" : ""} from your screen
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {sources.map((source) => {
          const expanded = expandedId === source.chunkId;
          const typeKey = source.contentType in TYPE_LABELS ? source.contentType : "generic";
          const typeClass = typeStyles[typeKey] ?? typeStyles.generic;

          return (
            <div
              key={source.chunkId}
              className={cn(
                "rounded-lg border text-left transition-colors",
                isOverlay
                  ? "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]"
                  : "border-border/60 bg-muted/40 hover:bg-muted/70"
              )}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedId(expanded ? null : source.chunkId)
                }
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase border",
                    typeClass
                  )}
                >
                  {TYPE_LABELS[typeKey]}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[11px] font-medium",
                      isOverlay ? "text-white/75" : "text-foreground/85"
                    )}
                  >
                    {source.appName}
                    <span className={isOverlay ? "text-white/30" : "text-muted-foreground"}>
                      {" · "}
                    </span>
                    {source.windowTitle}
                  </span>
                  <span
                    className={cn(
                      "block text-[10px] mt-0.5",
                      isOverlay ? "text-white/30" : "text-muted-foreground"
                    )}
                  >
                    {timeAgo(source.capturedAt)}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 shrink-0 mt-0.5 transition-transform",
                    isOverlay ? "text-white/25" : "text-muted-foreground/50",
                    expanded && "rotate-180"
                  )}
                />
              </button>

              {expanded && (
                <div
                  className={cn(
                    "border-t px-2.5 py-2 text-[10px] leading-relaxed",
                    isOverlay
                      ? "border-white/6 text-white/50"
                      : "border-border/50 text-muted-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{source.snippet}</p>
                  {source.url && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isTauri()) {
                          openUrl(source.url!).catch(console.error);
                        } else {
                          window.open(source.url!, "_blank", "noopener,noreferrer");
                        }
                      }}
                      className={cn(
                        "mt-2 inline-flex items-center gap-1 text-[10px] font-medium",
                        isOverlay
                          ? "text-indigo-300/80 hover:text-indigo-200"
                          : "text-primary hover:underline"
                      )}
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      Open page
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
