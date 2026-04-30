import { useState, useEffect } from "react";
import { PageLayout } from "@/layouts";
import { loadUserProfile } from "@/lib/storage/auth";
import type { UserProfile } from "@/types/settings";
import { Check, Minus, Plus, Crown } from "lucide-react";

// ─── Pricing constants ──────────────────────────────────────────────────────
const BASE_PLUS_PRICE = 800;
const LISTENING_HOUR_STEP = 200; // ₹200 per extra hour
const RESPONSE_BLOCK_STEP = 200; // ₹200 per extra 60 responses
const GST_RATE = 0.18;

// Base Plus includes: 2hr listening + 120 AI responses
const BASE_LISTENING_HOURS = 2;
const BASE_RESPONSE_BLOCKS = 2; // 2 × 60 = 120

interface PlanFeature {
  text: string;
  included: boolean;
}

const STARTER_FEATURES: PlanFeature[] = [
  { text: "30 min listening / period", included: true },
  { text: "30 AI responses / period", included: true },
  { text: "Manual screenshot only", included: true },
  { text: "Community support", included: true },
  { text: "Auto screenshot", included: false },
  { text: "Priority support", included: false },
];

const PLUS_FEATURES: PlanFeature[] = [
  { text: "2hr+ listening / period", included: true },
  { text: "120+ AI responses / period", included: true },
  { text: "Auto screenshot capture", included: true },
  { text: "Email support", included: true },
  { text: "Custom adjustments", included: true },
  { text: "Priority queue", included: false },
];

const PRO_FEATURES: PlanFeature[] = [
  { text: "Unlimited listening", included: true },
  { text: "Unlimited AI responses", included: true },
  { text: "Auto screenshot capture", included: true },
  { text: "Priority support", included: true },
  { text: "Priority queue", included: true },
  { text: "Early access to features", included: true },
];

function FeatureList({ features }: { features: PlanFeature[] }) {
  return (
    <ul className="space-y-2">
      {features.map((f) => (
        <li key={f.text} className="flex items-center gap-2 text-sm">
          {f.included ? (
            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <span className="h-4 w-4 text-muted-foreground/40 shrink-0 flex items-center justify-center">
              —
            </span>
          )}
          <span className={f.included ? "" : "text-muted-foreground/50"}>
            {f.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Billing() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [extraListeningHours, setExtraListeningHours] = useState(0);
  const [extraResponseBlocks, setExtraResponseBlocks] = useState(0);

  useEffect(() => {
    setUser(loadUserProfile());
  }, []);

  const plusPrice =
    BASE_PLUS_PRICE +
    extraListeningHours * LISTENING_HOUR_STEP +
    extraResponseBlocks * RESPONSE_BLOCK_STEP;
  const plusGst = Math.round(plusPrice * GST_RATE);
  const plusTotal = plusPrice + plusGst;

  const totalListeningHrs = BASE_LISTENING_HOURS + extraListeningHours;
  const totalResponses = (BASE_RESPONSE_BLOCKS + extraResponseBlocks) * 60;

  const currentPlan = user?.plan ?? "starter";

  return (
    <PageLayout title="Billing" description="Choose a plan that fits your needs">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-4xl">

        {/* ── Starter ── */}
        <div
          className={`rounded-xl border p-6 flex flex-col gap-5 transition-all ${
            currentPlan === "starter"
              ? "border-primary ring-2 ring-primary/20"
              : "border-border"
          }`}
        >
          <div>
            <h3 className="text-lg font-semibold">Starter</h3>
            <p className="text-sm text-muted-foreground">Get started for free</p>
          </div>
          <div>
            <span className="text-4xl font-bold">₹0</span>
            <span className="text-sm text-muted-foreground"> / period</span>
          </div>
          <FeatureList features={STARTER_FEATURES} />
          <div className="mt-auto pt-3">
            {currentPlan === "starter" ? (
              <div className="text-center py-2 text-sm font-medium text-muted-foreground">
                Current Plan
              </div>
            ) : (
              <button className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted">
                Downgrade
              </button>
            )}
          </div>
        </div>

        {/* ── Plus (adjustable) ── */}
        <div
          className={`rounded-xl border p-6 flex flex-col gap-5 transition-all relative ${
            currentPlan === "plus"
              ? "border-indigo-500 ring-2 ring-indigo-500/20"
              : "border-border"
          }`}
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wider">
            Popular
          </div>
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Plus
              <Crown className="h-4 w-4 text-indigo-400" />
            </h3>
            <p className="text-sm text-muted-foreground">For regular users</p>
          </div>

          {/* Price */}
          <div>
            <span className="text-4xl font-bold">₹{plusPrice}</span>
            <span className="text-sm text-muted-foreground"> / period</span>
            {plusGst > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                + ₹{plusGst} GST = <strong>₹{plusTotal}</strong> total
              </p>
            )}
          </div>

          {/* Adjustable listening hours */}
          <div className="space-y-3 rounded-lg bg-muted/50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span>Listening time</span>
              <span className="font-semibold">{totalListeningHrs}hr</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExtraListeningHours(Math.max(0, extraListeningHours - 1))}
                disabled={extraListeningHours === 0}
                className="rounded-md border border-border p-1.5 hover:bg-indigo-500 transition"
              >
                <Minus className="h-3 w-3" />
              </button>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(100, (totalListeningHrs / 10) * 100)}%` }}
                />
              </div>
              <button
                onClick={() => setExtraListeningHours(extraListeningHours + 1)}
                className="rounded-md border border-border p-1.5 hover:bg-indigo-500 transition"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              +₹{LISTENING_HOUR_STEP}/hr beyond {BASE_LISTENING_HOURS}hr base
            </p>
          </div>

          {/* Adjustable AI responses */}
          <div className="space-y-3 rounded-lg bg-muted/50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span>AI responses</span>
              <span className="font-semibold">{totalResponses}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExtraResponseBlocks(Math.max(0, extraResponseBlocks - 1))}
                disabled={extraResponseBlocks === 0}
                className="rounded-md border border-border p-1.5 hover:bg-indigo-500 transition"
              >
                <Minus className="h-3 w-3" />
              </button>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(100, (totalResponses / 600) * 100)}%` }}
                />
              </div>
              <button
                onClick={() => setExtraResponseBlocks(extraResponseBlocks + 1)}
                className="rounded-md border border-border p-1.5 hover:bg-indigo-500 transition"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              +₹{RESPONSE_BLOCK_STEP}/60 responses beyond {BASE_RESPONSE_BLOCKS * 60} base
            </p>
          </div>

          <FeatureList features={PLUS_FEATURES} />
          <div className="mt-auto pt-3">
            {currentPlan === "plus" ? (
              <div className="text-center py-2 text-sm font-medium text-muted-foreground">
                Current Plan
              </div>
            ) : (
              <button className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500">
                Upgrade to Plus
              </button>
            )}
          </div>
        </div>

        {/* ── Pro ── */}
        <div
          className={`rounded-xl border p-6 flex flex-col gap-5 transition-all ${
            currentPlan === "pro"
              ? "border-amber-500 ring-2 ring-amber-500/20"
              : "border-border"
          }`}
        >
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Pro
              <Crown className="h-4 w-4 text-amber-400" />
            </h3>
            <p className="text-sm text-muted-foreground">Unlimited everything</p>
          </div>
          <div>
            <span className="text-4xl font-bold">₹2,999</span>
            <span className="text-sm text-muted-foreground"> / month</span>
            <p className="text-xs text-muted-foreground mt-1">
              + ₹{Math.round(2999 * GST_RATE)} GST = <strong>₹{2999 + Math.round(1999 * GST_RATE)}</strong> total
            </p>
          </div>
          <FeatureList features={PRO_FEATURES} />
          <div className="mt-auto pt-3">
            {currentPlan === "pro" ? (
              <div className="text-center py-2 text-sm font-medium text-muted-foreground">
                Current Plan
              </div>
            ) : (
              <button className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500">
                Upgrade to Pro
              </button>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
