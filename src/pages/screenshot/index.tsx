import { useState } from "react";
import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";
import { Camera, Monitor, Clock, Power } from "lucide-react";

const INTERVAL_OPTIONS = [5, 10, 15, 30, 60];

export default function Screenshot() {
  const { screenshotConfiguration, updateScreenshotConfiguration } = useAppContext();
  const [prompt, setPrompt] = useState(screenshotConfiguration.autoPrompt);

  const handlePromptSave = () => {
    updateScreenshotConfiguration({ autoPrompt: prompt });
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

        {/* ── Mode Toggle ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Capture Mode
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => updateScreenshotConfiguration({ mode: "manual" })}
              className={`rounded-lg border px-4 py-3 text-left transition-all ${
                screenshotConfiguration.mode === "manual"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Camera className="h-4 w-4" />
                <span className="text-sm font-medium">Manual</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+Shift+S</kbd> or click the camera button
              </p>
            </button>
            <button
              onClick={() => updateScreenshotConfiguration({ mode: "auto" })}
              className={`rounded-lg border px-4 py-3 text-left transition-all ${
                screenshotConfiguration.mode === "auto"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Monitor className="h-4 w-4" />
                <span className="text-sm font-medium">Automatic</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Captures screen at a set interval while listening
              </p>
            </button>
          </div>
        </section>

        {/* ── Auto Interval (shown only in auto mode) ── */}
        {screenshotConfiguration.mode === "auto" && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Capture Interval
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {INTERVAL_OPTIONS.map((sec) => (
                <button
                  key={sec}
                  onClick={() => updateScreenshotConfiguration({ autoIntervalSeconds: sec })}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    screenshotConfiguration.autoIntervalSeconds === sec
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Screen will be captured every {screenshotConfiguration.autoIntervalSeconds} seconds while system audio or mic is active.
            </p>
          </section>
        )}

        {/* ── Analysis Prompt ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Analysis Prompt
          </h3>
          <p className="text-xs text-muted-foreground">
            The instruction sent to the AI when analyzing a screenshot.
          </p>
          <textarea
            className="w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={handlePromptSave}
          />
        </section>
      </div>
    </PageLayout>
  );
}
