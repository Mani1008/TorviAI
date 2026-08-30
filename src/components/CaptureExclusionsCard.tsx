import { useState } from "react";
import { ShieldBan, X } from "lucide-react";
import type { CaptureExclusions } from "@/types/settings";
import {
  addBlockedApp,
  addBlockedDomain,
  loadCaptureExclusions,
  removeBlockedApp,
  removeBlockedDomain,
} from "@/lib/storage/capture-exclusions.storage";

function ExclusionList({
  label,
  placeholder,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">None added yet.</p>
      )}
    </div>
  );
}

export function CaptureExclusionsCard({ embedded = false }: { embedded?: boolean }) {
  const [exclusions, setExclusions] = useState<CaptureExclusions>(() =>
    loadCaptureExclusions()
  );
  const [activeTab, setActiveTab] = useState<"apps" | "domains">("apps");

  const form = (
    <div className="rounded-xl border border-border p-4 space-y-6">
      {embedded && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("apps")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "apps"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            Blocked apps ({exclusions.blockedApps.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("domains")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "domains"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            Blocked websites ({exclusions.blockedDomains.length})
          </button>
        </div>
      )}

      {(!embedded || activeTab === "apps") && (
        <ExclusionList
          label="Blocked apps"
          placeholder="e.g. chrome, slack, outlook"
          items={exclusions.blockedApps}
          onAdd={(value) => setExclusions((prev) => addBlockedApp(prev, value))}
          onRemove={(value) =>
            setExclusions((prev) => removeBlockedApp(prev, value))
          }
        />
      )}

      {(!embedded || activeTab === "domains") && (
        <ExclusionList
          label="Blocked domains"
          placeholder="e.g. gmail.com, linkedin.com"
          items={exclusions.blockedDomains}
          onAdd={(value) => setExclusions((prev) => addBlockedDomain(prev, value))}
          onRemove={(value) =>
            setExclusions((prev) => removeBlockedDomain(prev, value))
          }
        />
      )}
    </div>
  );

  if (embedded) {
    return <div className="space-y-4">{form}</div>;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3">
        <ShieldBan className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h3 className="text-base font-semibold">Capture exclusions</h3>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-xl">
            Block specific apps or websites from screen capture. Excluded content
            will not appear in Context Memory, AI answers, or cloud sync.
          </p>
        </div>
      </div>
      {form}
    </section>
  );
}
