import { PageLayout } from "@/layouts";

/**
 * Audio input device selection page.
 *
 * TODO: List available audio input devices from Tauri.
 * TODO: Audio level visualization.
 * TODO: VAD sensitivity configuration.
 */
export default function Audio() {
  return (
    <PageLayout
      title="Audio"
      description="Configure audio input devices and voice detection"
    >
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">
          Audio device selection and VAD configuration will be implemented here.
        </p>
      </div>
    </PageLayout>
  );
}
