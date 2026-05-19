import { useState, useEffect } from "react";
import { PageLayout } from "@/layouts";
import { DEFAULT_SHORTCUTS } from "@/config/shortcuts";
import { loadShortcuts, saveShortcuts } from "@/lib/storage";
import type { Shortcut } from "@/types/shortcuts";
import { Button } from "@/components/ui/button";
import { Lock, Check, RotateCcw } from "lucide-react";

// Global shortcuts are registered in Rust — can't be rebound at runtime.
const GLOBAL_IDS = new Set(["toggle_window", "focus_input"]);
// Compound / special-case shortcuts — displayed but not rebindable.
const NON_EDITABLE_IDS = new Set(["move_window", "close_panel"]);

function formatKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(e.key);
  return parts.join("+");
}

export default function Shortcuts() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(
    () => loadShortcuts() ?? DEFAULT_SHORTCUTS
  );
  // id of the shortcut currently being recorded
  const [recording, setRecording] = useState<string | null>(null);
  // id of conflicting shortcut (during recording)
  const [conflict, setConflict] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Key recording listener
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Cancel on Escape
      if (e.key === "Escape") {
        setRecording(null);
        setConflict(null);
        return;
      }
      // Ignore bare modifier presses
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const newKey = formatKey(e);

      // Conflict check
      const conflicting = shortcuts.find(
        (s) => s.id !== recording && s.key === newKey
      );
      if (conflicting) {
        setConflict(conflicting.label);
        return;
      }

      setConflict(null);
      setShortcuts((prev) =>
        prev.map((s) => (s.id === recording ? { ...s, key: newKey } : s))
      );
      setRecording(null);
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [recording, shortcuts]);

  const handleSave = () => {
    saveShortcuts(shortcuts);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    setRecording(null);
    setConflict(null);
  };

  const isEditable = (id: string) =>
    !GLOBAL_IDS.has(id) && !NON_EDITABLE_IDS.has(id);

  return (
    <PageLayout
      title="Shortcuts"
      description="Configure keyboard shortcuts. Click a binding to rebind it."
    >
      {/* Action bar */}
      <div className="flex items-center justify-between mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="gap-2"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
        <Button size="sm" onClick={handleSave} className="gap-2">
          {saved && <Check className="h-4 w-4" />}
          {saved ? "Saved!" : "Save Changes"}
        </Button>
      </div>

      <div className="space-y-2 max-w-2xl">
        {shortcuts.map((shortcut) => {
          const editable = isEditable(shortcut.id);
          const isGlobal = GLOBAL_IDS.has(shortcut.id);
          const isRecording = recording === shortcut.id;

          return (
            <div
              key={shortcut.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{shortcut.label}</p>
                  {isGlobal && (
                    <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-2 py-0.5 font-medium">
                      global
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {shortcut.description}
                </p>
                {isRecording && conflict && (
                  <p className="text-xs text-destructive mt-1">
                    Conflicts with <strong>{conflict}</strong> — press a different combo
                  </p>
                )}
              </div>

              <div className="shrink-0">
                {!editable ? (
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3 text-muted-foreground/50" />
                    <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                      {shortcut.key}
                    </kbd>
                  </div>
                ) : isRecording ? (
                  <kbd className="rounded-md border border-primary bg-primary/10 px-3 py-1 text-xs font-mono text-primary animate-pulse min-w-36 inline-block text-center">
                    Press keys… (Esc to cancel)
                  </kbd>
                ) : (
                  <button
                    onClick={() => {
                      setRecording(shortcut.id);
                      setConflict(null);
                    }}
                    title="Click to rebind"
                    className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-mono hover:border-primary/60 hover:bg-primary/5 hover:text-primary transition-colors cursor-pointer"
                  >
                    {shortcut.key}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground max-w-2xl">
        <Lock className="h-3 w-3 inline mr-1 mb-0.5" />
        <strong>Global</strong> shortcuts are registered with the OS and cannot
        be rebound here. Restart the app after saving to apply changes to
        in-app shortcuts.
      </p>
    </PageLayout>
  );
}
