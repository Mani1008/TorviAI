import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PageLayout } from "@/layouts";
import { isTauri } from "@/lib/platform";
import { STORAGE_KEYS } from "@/config/constants";
import { type VadConfig, DEFAULT_VAD_CONFIG } from "@/hooks/useSystemAudio";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOP_SIZE = 1024;
const SAMPLE_RATE = 44100;

function chunksToSec(chunks: number) {
  return ((chunks * HOP_SIZE) / SAMPLE_RATE).toFixed(1);
}

function chunksToMs(chunks: number) {
  return Math.round((chunks * HOP_SIZE * 1000) / SAMPLE_RATE);
}

function loadVadConfig(): VadConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VAD_CONFIG);
    if (raw) return { ...DEFAULT_VAD_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_VAD_CONFIG };
}

// ─── Slider field definitions ─────────────────────────────────────────────────

type SliderField = {
  label: string;
  description: string;
  key: keyof VadConfig;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

const FIELDS: SliderField[] = [
  {
    label: "Voice sensitivity",
    description: "RMS energy threshold. Lower = picks up quieter speech; higher = ignores soft sounds.",
    key: "sensitivity_rms",
    min: 0.001,
    max: 0.08,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  {
    label: "Peak threshold",
    description: "Minimum peak amplitude needed to start a recording clip.",
    key: "peak_threshold",
    min: 0.005,
    max: 0.15,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  {
    label: "Noise gate",
    description: "Audio below this floor is treated as silence and filtered out.",
    key: "noise_gate_threshold",
    min: 0.001,
    max: 0.02,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  {
    label: "Silence before stop",
    description: "How long silence must persist before the recording clip ends.",
    key: "silence_chunks",
    min: 5,
    max: 150,
    step: 5,
    format: (v) => `${chunksToSec(v)} s`,
  },
  {
    label: "Min speech to trigger",
    description: "Minimum continuous speech duration required to send audio to AI.",
    key: "min_speech_chunks",
    min: 2,
    max: 30,
    step: 1,
    format: (v) => `${chunksToMs(v)} ms`,
  },
  {
    label: "Max clip length",
    description: "Hard cap on a single recording clip. Clips longer than this are cut off.",
    key: "max_recording_duration_secs",
    min: 30,
    max: 600,
    step: 30,
    format: (v) => `${v} s`,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Audio() {
  const [config, setConfig] = useState<VadConfig>(loadVadConfig);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleChange = (key: keyof VadConfig, value: number) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    localStorage.setItem(STORAGE_KEYS.VAD_CONFIG, JSON.stringify(config));
    if (isTauri()) {
      // Update the running Rust process — takes effect immediately if capture is active
      invoke("update_vad_config", { config }).catch(() => {});
    }
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [config]);

  const handleReset = () => {
    setConfig({ ...DEFAULT_VAD_CONFIG });
    setDirty(true);
    setSaved(false);
  };

  return (
    <PageLayout
      title="Audio"
      description="Configure voice activity detection and system audio capture"
    >
      <div className="space-y-6 max-w-xl">

        {/* VAD config card */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 bg-muted/30">
            <h3 className="text-sm font-semibold text-foreground">
              Voice Activity Detection
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Controls how the system detects when you start and stop speaking.
              Changes saved here take effect immediately if system audio capture is active.
            </p>
          </div>

          <div className="divide-y divide-border/50">
            {FIELDS.map(({ label, description, key, min, max, step, format }) => {
              const val = config[key] as number;
              const pct = ((val - min) / (max - min)) * 100;
              return (
                <div key={key} className="px-4 py-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">
                      {label}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                      {format(val)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => handleChange(key, Number(e.target.value))}
                    style={{
                      background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
                    }}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saved ? "Saved ✓" : "Save settings"}
          </button>
          <button
            onClick={handleReset}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-foreground/70 hover:bg-muted/50 transition-colors"
          >
            Reset to defaults
          </button>
          {saved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              Settings applied
            </span>
          )}
        </div>

        {/* Note about pre_speech_chunks / hop_size */}
        <p className="text-xs text-muted-foreground/60">
          Advanced parameters (pre-speech buffer, hop size) are fixed at optimised values and not exposed here.
        </p>
      </div>
    </PageLayout>
  );
}
