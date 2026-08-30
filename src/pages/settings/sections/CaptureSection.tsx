import { SettingsLinkCard } from "@/components/settings/SettingsLinkCard";

export function CaptureSection() {
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Screenshot capture supplements screen-text context for visual tasks like diagrams, errors, and UI reviews.
      </p>
      <SettingsLinkCard
        title="Screenshot settings"
        description="Enable capture, auto mode, and analysis prompt."
        to="/screenshot"
      />
    </div>
  );
}
