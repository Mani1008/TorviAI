import { cn } from "@/lib/utils";

function formatAppName(raw: string): string {
  const name = raw.trim();
  if (!name) return "Unknown";
  const lower = name.toLowerCase();
  if (lower === "code") return "VS Code";
  if (lower === "cursor") return "Cursor";
  if (lower === "msedge") return "Edge";
  if (lower === "chrome") return "Chrome";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export interface ContextIndicatorProps {
  isWatching: boolean;
  appName?: string | null;
  windowTitle?: string | null;
  onClick?: () => void;
  className?: string;
}

/**
 * Compact strip showing what screen context Torvi is observing.
 * Used on the overlay pill bar and optionally elsewhere.
 */
export function ContextIndicator({
  isWatching,
  appName,
  windowTitle,
  onClick,
  className,
}: ContextIndicatorProps) {
  const hasFocus = !!(appName?.trim() || windowTitle?.trim());
  const label = isWatching ? "Watching" : "Paused";
  const app = appName ? formatAppName(appName) : null;
  const title = windowTitle ? truncate(windowTitle, 42) : null;

  const content = (
    <>
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          isWatching ? "bg-emerald-400 animate-pulse" : "bg-amber-400/80"
        )}
      />
      <span className="shrink-0 font-medium text-white/45">{label}</span>
      {hasFocus ? (
        <>
          <span className="text-white/20">·</span>
          <span className="truncate text-white/55">
            {app}
            {title && (
              <>
                <span className="text-white/25"> · </span>
                {title}
              </>
            )}
          </span>
        </>
      ) : isWatching ? (
        <>
          <span className="text-white/20">·</span>
          <span className="text-white/35">waiting for activity</span>
        </>
      ) : (
        <>
          <span className="text-white/20">·</span>
          <span className="text-white/35">resume in Context Memory</span>
        </>
      )}
    </>
  );

  const surfaceClass = cn(
    "glass mx-0.5 rounded-b-2xl border-t border-white/[0.06]",
    "no-drag flex items-center gap-1.5 px-3 py-1 min-h-[20px] text-[10px] leading-tight",
    className
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          surfaceClass,
          "w-[calc(100%-0.25rem)] text-left hover:brightness-125 transition-all duration-150"
        )}
        title="Open Context Memory"
      >
        {content}
      </button>
    );
  }

  return <div className={surfaceClass}>{content}</div>;
}
