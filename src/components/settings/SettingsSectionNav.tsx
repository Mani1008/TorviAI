import { cn } from "@/lib/utils";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/config/settings-sections.constants";
import { loadCaptureExclusions } from "@/lib/storage/capture-exclusions.storage";

function sectionBadge(sectionId: SettingsSectionId): number | null {
  if (sectionId !== "privacy") return null;
  const exclusions = loadCaptureExclusions();
  return exclusions.blockedApps.length + exclusions.blockedDomains.length || null;
}

interface SettingsSectionNavProps {
  activeSection: SettingsSectionId;
  onSelect: (sectionId: SettingsSectionId) => void;
}

export function SettingsSectionNav({
  activeSection,
  onSelect,
}: SettingsSectionNavProps) {
  return (
    <nav className="flex w-[200px] shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Settings
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === activeSection;
          const badge = sectionBadge(section.id);

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-foreground/60 hover:bg-background/60 hover:text-foreground/85"
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive ? "text-primary" : "text-foreground/35"
                )}
              />
              <span className="flex-1 truncate font-medium leading-tight">{section.label}</span>
              {badge !== null && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="border-t border-border px-4 py-3">
        <p className="text-[10px] text-muted-foreground">Torvi v0.1.0</p>
      </div>
    </nav>
  );
}
