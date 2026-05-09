import { useState } from "react";
import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";
import { Camera, Power, Check } from "lucide-react";

export default function Screenshot() {
  const { screenshotConfiguration, updateScreenshotConfiguration } = useAppContext();
  const [prompt, setPrompt] = useState(screenshotConfiguration.autoPrompt);
  const [saved, setSaved] = useState(false);

  const handlePromptSave = () => {
    updateScreenshotConfiguration({ autoPrompt: prompt });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <PageLayout
      title="Screenshot"
      description="Configure screenshot capture behavior"
    >
      <div className="space-y-6 max-w-2xl">

        {/* ── Enable / Disable ── */}
        <section className="rounded-lg border border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Power className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Screenshot Analysis</p>
              <p className="text-xs text-muted-foreground">
                Capture and analyze screen content with AI
              </p>
            </div>
          </div>
          <button
            onClick={() => updateScreenshotConfiguration({ enabled: !screenshotConfiguration.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              screenshotConfiguration.enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                screenshotConfiguration.enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </section>

        {/* ── Capture Mode (manual only) ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Capture Mode
          </h3>
          <div className="rounded-lg border border-primary bg-primary/10 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Camera className="h-4 w-4" />
              <span className="text-sm font-medium">Manual</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+Shift+S</kbd> or click the camera button
            </p>
          </div>
        </section>

        {/* ── Analysis Prompt ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Analysis Prompt
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                The instruction sent to the AI when analyzing a screenshot.
              </p>
            </div>
            <button
              onClick={handlePromptSave}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 ml-4"
            >
              {saved && <Check className="h-3.5 w-3.5" />}
              {saved ? "Saved!" : "Save"}
            </button>
          </div>
          <textarea
            className="w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </section>
      </div>
    </PageLayout>
  );
}
