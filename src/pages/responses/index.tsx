import { useState } from "react";
import { PageLayout } from "@/layouts";
import { RESPONSE_LENGTHS } from "@/lib/response-settings.constants";
import { loadResponseSettings, saveResponseSettings } from "@/lib/storage/response-settings.storage";
import { Check } from "lucide-react";

export default function Responses() {
  const [settings, setSettings] = useState(() => loadResponseSettings());

  function updateLength(length: typeof settings.length) {
    const updated = { ...settings, length };
    setSettings(updated);
    saveResponseSettings(updated);
  }

  return (
    <PageLayout title="Responses" description="Configure AI response length">
      <div className="space-y-8 max-w-xl">

        {/* ── Response Length ── */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Response Length
          </h3>
          <div className="space-y-2">
            {RESPONSE_LENGTHS.map((len) => {
              const active = settings.length === len.id;
              return (
                <button
                  key={len.id}
                  onClick={() => updateLength(len.id as typeof settings.length)}
                  className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{len.label}</p>
                    <p className="text-xs text-muted-foreground">{len.description}</p>
                  </div>
                  {active && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
