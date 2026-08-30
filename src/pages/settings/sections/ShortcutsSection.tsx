import { SettingsLinkCard } from "@/components/settings/SettingsLinkCard";

export function ShortcutsSection() {
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Global shortcuts work even when the overlay is hidden. Some system shortcuts are fixed in the Rust layer.
      </p>
      <SettingsLinkCard
        title="Keyboard shortcuts"
        description="View and customize overlay, dashboard, and capture hotkeys."
        to="/shortcuts"
      />
    </div>
  );
}
