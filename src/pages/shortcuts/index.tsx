import { PageLayout } from "@/layouts";
import { DEFAULT_SHORTCUTS } from "@/config/shortcuts";

/**
 * Global keyboard shortcuts configuration page.
 *
 * TODO: Shortcut key binding editor with conflict detection.
 * TODO: Register/unregister via Tauri IPC.
 */
export default function Shortcuts() {
  return (
    <PageLayout
      title="Shortcuts"
      description="Configure global keyboard shortcuts"
    >
      <div className="space-y-2">
        {DEFAULT_SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.id}
            className="flex items-center justify-between rounded-lg border border-border p-4"
          >
            <div>
              <p className="text-sm font-medium">{shortcut.label}</p>
              <p className="text-xs text-muted-foreground">
                {shortcut.description}
              </p>
            </div>
            <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-mono">
              {shortcut.key}
            </kbd>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
