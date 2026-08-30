import { useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";
import {
  getSettingsSection,
  type SettingsSectionId,
} from "@/config/settings-sections.constants";
import { SettingsSectionNav } from "./SettingsSectionNav";

interface SettingsShellProps {
  activeSection: SettingsSectionId;
  onSectionChange: (sectionId: SettingsSectionId) => void;
  children: ReactNode;
  headerRight?: ReactNode;
}

export function SettingsShell({
  activeSection,
  onSectionChange,
  children,
  headerRight,
}: SettingsShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const section = getSettingsSection(activeSection);

  const close = useCallback(() => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? "/dashboard", { replace: true });
  }, [location.state, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3">
      {/* Blurred backdrop — covers sidebar + dashboard */}
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 bg-black/20 backdrop-blur-md animate-in fade-in-0 duration-200"
        onClick={close}
      />

      {/* Settings card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="relative z-10 flex w-full max-w-[1240px] h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl shadow-black/20 animate-in fade-in-0 zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsSectionNav
          activeSection={activeSection}
          onSelect={onSectionChange}
        />

        <div className="flex min-w-0 flex-1 flex-col bg-card">
          <header className="flex items-start justify-between gap-4 border-b border-neutral-200/80 px-7 py-6 shrink-0">
            <div className="min-w-0">
              <h1
                id="settings-dialog-title"
                className="text-[26px] font-semibold tracking-tight text-neutral-900"
              >
                {section.label}
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500 max-w-xl">
                {section.description}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {headerRight}
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
