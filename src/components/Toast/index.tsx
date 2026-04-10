import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useToastContext, type ToastItem, type ToastType } from "@/contexts/toast.context";

const ICON: Record<ToastType, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLOR: Record<ToastType, string> = {
  error: "border-rose-500/40 text-rose-300",
  warning: "border-amber-500/40 text-amber-300",
  info: "border-indigo-500/40 text-indigo-300",
};

function Toast({ toast, onRemove }: { toast: ToastItem; onRemove: () => void }) {
  const Icon = ICON[toast.type];
  return (
    <div
      className={`
        flex items-start gap-2 px-3 py-2 rounded-xl border
        bg-black/75 backdrop-blur-md shadow-lg
        text-[11px] leading-snug
        min-w-45 max-w-70
        ${COLOR[toast.type]}
      `}
    >
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span className="flex-1 text-white/80">{toast.message}</span>
      <button
        onClick={onRemove}
        className="text-white/25 hover:text-white/60 transition-colors ml-0.5 shrink-0"
        aria-label="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastContext();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-2 right-2 z-100 flex flex-col gap-1.5 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onRemove={() => removeToast(t.id)} />
        </div>
      ))}
    </div>
  );
}
