import { useEffect, useRef, useState } from "react";

export function UsageTimer() {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
