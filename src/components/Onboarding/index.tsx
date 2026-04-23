import { useState } from "react";
import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config/constants";
import { DEFAULT_SHORTCUTS } from "@/config/shortcuts";
import {
  Sparkles,
  Keyboard,
  Globe,
  ChevronRight,
  Check,
  X,
} from "lucide-react";

const ONBOARDING_SHORTCUTS = DEFAULT_SHORTCUTS.slice(0, 6);

type Step = "welcome" | "shortcuts" | "provider" | "done";
const STEPS: Step[] = ["welcome", "shortcuts", "provider", "done"];

function ProgressDots({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-1.5">
      {STEPS.map((_, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i <= idx ? "bg-primary" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Step Components ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Welcome to Torvi</h2>
        <p className="text-muted-foreground text-sm max-w-sm">
          Your AI overlay assistant. Lives in a floating pill — always accessible,
          never in the way. Let's get you set up in under a minute.
        </p>
      </div>
      <ul className="w-full text-left space-y-2 text-sm text-muted-foreground">
        {[
          "AI chat with any OpenRouter model",
          "Screen analysis & vision",
          "Microphone & system audio transcription",
          "Keyboard-first, always on top",
        ].map((f) => (
          <li key={f} className="flex items-center gap-2">
            <Check className="h-4 w-4 text-primary shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <button
        onClick={onNext}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
      >
        Get Started <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function ShortcutsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
          <Keyboard className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          <p className="text-xs text-muted-foreground">Work without lifting your hands</p>
        </div>
      </div>
      <div className="space-y-2">
        {ONBOARDING_SHORTCUTS.map((s) => (
          <div key={s.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <span className="text-sm text-muted-foreground">{s.description}</span>
            <kbd className="ml-4 shrink-0 px-2 py-0.5 rounded bg-muted text-xs font-mono border border-border">
              {s.key}
            </kbd>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        The first two shortcuts work system-wide — even when Torvi is hidden.
      </p>
      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors">
          Back
        </button>
        <button onClick={onNext} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          Next <ChevronRight className="h-4 w-4" />
        </button>   
      </div>
    </div>
  );
}

function ProviderStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
          <Globe className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">AI Models — Ready to Go</h2>
          <p className="text-xs text-muted-foreground">Powered by OpenRouter, managed by Torvi</p>
        </div>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Torvi handles API access for you — no keys to copy, no accounts to create.
          You get access to 20+ curated models across 5 categories:
        </p>
        <ul className="space-y-1.5 text-sm">
          {[
            "General purpose (GPT-4o, Claude, Nemotron)",
            "Coding (DeepSeek Coder, Qwen)",
            "Deep reasoning (o4-mini, DeepSeek R1)",
            "Fast & lightweight (Gemini Flash, Llama)",
            "Vision & images (Llama 4, GPT-4o Vision)",
          ].map((f) => (
            <li key={f} className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Switch models any time in <strong>Settings → AI Model</strong>.
        </p>
      </div>
      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors">
          Back
        </button>
        <button onClick={onNext} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <Check className="h-8 w-8 text-emerald-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">You're all set!</h2>
        <p className="text-muted-foreground text-sm max-w-sm">
          Press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-xs font-mono">Ctrl+Shift+H</kbd> any time
          to show or hide Torvi. Explore Settings to fine-tune your experience.
        </p>
      </div>
      <button
        onClick={onFinish}
        className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
      >
        Open Dashboard
      </button>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("welcome");

  const finish = () => {
    safeLocalStorage.setItem(STORAGE_KEYS.ONBOARDED, "1");
    onComplete();
  };

  const next = () => setStep((s) => STEPS[STEPS.indexOf(s) + 1] as Step);
  const back = () => setStep((s) => STEPS[STEPS.indexOf(s) - 1] as Step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl p-7 mx-4">
        {/* Skip button (only on non-last steps) */}
        {step !== "done" && (
          <button
            onClick={finish}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            title="Skip setup"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="space-y-6">
          {step === "welcome" && <WelcomeStep onNext={next} />}
          {step === "shortcuts" && <ShortcutsStep onNext={next} onBack={back} />}
          {step === "provider" && <ProviderStep onNext={next} onBack={back} />}
          {step === "done" && <DoneStep onFinish={finish} />}
          <ProgressDots current={step} />
        </div>
      </div>
    </div>
  );
}

export function isOnboarded(): boolean {
  return safeLocalStorage.getItem(STORAGE_KEYS.ONBOARDED) === "1";
}
