import { cn } from "@/lib/utils";

export type RagPhase = "idle" | "searching" | "streaming";

export interface RagStatusIndicatorProps {
  phase: RagPhase;
  variant?: "overlay" | "dashboard";
  showDots?: boolean;
  className?: string;
}

function ThinkingDots({ variant }: { variant: "overlay" | "dashboard" }) {
  if (variant === "overlay") {
    return (
      <div className="flex items-center gap-1 py-0.5">
        <span className="dot dot-1" />
        <span className="dot dot-2" />
        <span className="dot dot-3" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/30 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

/**
 * Shows RAG progress: searching local screen context, then how many chunks were injected.
 */
export function RagStatusIndicator({
  phase,
  variant = "overlay",
  showDots = true,
  className,
}: RagStatusIndicatorProps) {
  if (phase === "idle") return null;

  const textClass =
    variant === "overlay"
      ? "text-[11px] text-white/45"
      : "text-xs text-muted-foreground";

  let label: string | null = null;
  if (phase === "searching") {
    label = "Reading your screen…";
  } else if (phase === "streaming") {
    label = "Generating…";
  }

  if (!label && !showDots) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className={textClass}>{label}</span>}
      {showDots && <ThinkingDots variant={variant} />}
    </div>
  );
}

/** Compact chip label for overlay panel header. */
export function ragStatusChipLabel(phase: RagPhase): string {
  if (phase === "searching") return "Reading screen";
  return "Generating";
}
