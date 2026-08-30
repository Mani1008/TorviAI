import { Cloud } from "lucide-react";
import { SettingsLinkCard } from "@/components/settings/SettingsLinkCard";

interface DataSectionProps {
  cloudMemorySync: boolean;
  onCloudMemorySyncChange: (enabled: boolean) => void;
}

export function DataSection({
  cloudMemorySync,
  onCloudMemorySyncChange,
}: DataSectionProps) {
  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Cloud second brain</h3>
        <div className="flex items-center justify-between rounded-xl border border-border p-4">
          <div className="flex items-start gap-3">
            <Cloud className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Sync context to cloud memory</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                Upload local screen context chunks to Supabase when configured.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cloudMemorySync}
            onClick={() => onCloudMemorySyncChange(!cloudMemorySync)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ml-4 ${
              cloudMemorySync ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                cloudMemorySync ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </section>

      <SettingsLinkCard
        title="Context Memory"
        description="Review captured screen context, sync queue, and encryption."
        to="/context-memory"
      />
    </div>
  );
}
