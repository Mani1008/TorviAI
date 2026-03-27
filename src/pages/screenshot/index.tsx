import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";

/**
 * Screenshot settings page.
 *
 * TODO: Auto/manual mode toggle.
 * TODO: Screenshot prompt editor.
 * TODO: Enable/disable toggle.
 */
export default function Screenshot() {
  const { screenshotConfiguration } = useAppContext();

  return (
    <PageLayout
      title="Screenshot"
      description="Configure screenshot capture behavior"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            Mode: {screenshotConfiguration.mode}
          </p>
          <p className="text-xs text-muted-foreground">
            {screenshotConfiguration.mode === "auto"
              ? "Screenshots are captured automatically when you send a message."
              : "Manually trigger screenshots with the keyboard shortcut."}
          </p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            Enabled: {screenshotConfiguration.enabled ? "Yes" : "No"}
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
