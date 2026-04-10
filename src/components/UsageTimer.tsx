import { useEffect, useRef, useState } from "react";

const SESSION_START_KEY = "pluely_session_start";

function getSessionStart(): number {
  const stored = sessionStorage.getItem(SESSION_START_KEY);
  if (stored) return Number(stored);
  const now = Date.now();
  sessionStorage.setItem(SESSION_START_KEY, String(now));
  return now;
}

export function UsageTimer() {
  const [seconds, setSeconds] = useState(() =>
    Math.floor((Date.now() - getSessionStart()) / 1000)
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = getSessionStart();
    const tick = () => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    };
    intervalRef.current = setInterval(tick, 1000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return (
    <div
      title="Session duration"
      className="
        flex items-center gap-1
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
      {/* optional subtle dot */}
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />

      <span>
        {h > 0 ? `${pad(h)}:` : ""}
        {pad(m)}:{pad(s)}
      </span>
    </div>
  );
}
