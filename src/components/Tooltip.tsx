import { useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: "top" | "bottom";
}

export function Tooltip({ label, shortcut, children, side = "bottom" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [adjustedX, setAdjustedX] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2,
      y: side === "bottom" ? rect.bottom + 8 : rect.top - 8,
    });
    setAdjustedX(null); // Reset so layoutEffect recalculates
  }, [side]);

  const show = () => {
    timeoutRef.current = setTimeout(() => {
      updatePos();
      setVisible(true);
    }, 400);
  };
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
    setAdjustedX(null);
  };

  // Clamp tooltip within viewport after it renders
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const tt = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const padding = 8;

    if (tt.right > vw - padding) {
      // Overflowing right — shift left
      setAdjustedX(pos.x - (tt.right - vw + padding));
    } else if (tt.left < padding) {
      // Overflowing left — shift right
      setAdjustedX(pos.x + (padding - tt.left));
    }
  }, [visible, pos]);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  const finalX = adjustedX ?? pos.x;

  return (
    <div ref={triggerRef} className="inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-9999 pointer-events-none"
          style={{
            left: finalX,
            top: pos.y,
            transform: side === "bottom"
              ? "translateX(-50%)"
              : "translateX(-50%) translateY(-100%)",
          }}
        >
          <div
            className="
              flex items-center gap-2 whitespace-nowrap
              rounded-lg px-2.5 py-1.5
              bg-zinc-900/95 border border-white/10
              shadow-lg shadow-black/40
              backdrop-blur-xl
            "
          >
            <span className="text-[11px] font-medium text-white/80">{label}</span>
            {shortcut && (
              <kbd
                className="
                  text-[10px] font-mono font-semibold
                  text-white/50 bg-white/8
                  border border-white/10
                  rounded px-1.5 py-0.5
                  leading-none
                "
              >
                {shortcut}
              </kbd>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
