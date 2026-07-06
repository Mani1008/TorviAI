import { useState, useCallback } from "react";
import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";
import {
  INTERVIEW_ROLES,
  DEFAULT_ROLE_ID,
  type InterviewRoleId,
  type SpecialisationId,
} from "@/config/interview-roles.constants";
import {
  applyInterviewRole,
  loadInterviewRole,
  loadInterviewSpec,
} from "@/lib/storage/ai-providers";
import { loadResponseSettings, saveResponseSettings } from "@/lib/storage/response-settings.storage";
import { logout } from "@/lib/backend";
import { clearAuthToken, clearUserProfile, loadUserProfile } from "@/lib/storage/auth";
import { invoke } from "@tauri-apps/api/core";
import {
  Code2,
  Users,
  LineChart,
  BarChart2,
  Building2,
  ShoppingBag,
  Sparkles,
  Info,
  Check,
} from "lucide-react";

// ─── Icon resolver ────────────────────────────────────────────────────────────
const ROLE_ICONS: Record<string, React.ReactNode> = {
  Code2: <Code2 className="h-5 w-5" />,
  Users: <Users className="h-5 w-5" />,
  LineChart: <LineChart className="h-5 w-5" />,
  BarChart2: <BarChart2 className="h-5 w-5" />,
  Building2: <Building2 className="h-5 w-5" />,
  Handshake: <ShoppingBag className="h-5 w-5" />,
  Sparkles: <Sparkles className="h-5 w-5" />,
};

const RESPONSE_LENGTHS = [
  { id: "short" as const, label: "Short", sub: "2–4 sentences" },
  { id: "medium" as const, label: "Medium", sub: "1–2 paragraphs" },
  { id: "auto" as const, label: "Auto", sub: "AI decides the appropriate length" },
];

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese",
  "Dutch", "Russian", "Chinese", "Japanese", "Korean", "Arabic",
  "Hindi", "Turkish", "Polish",
];

const MAX_PROMPT_LENGTH = 3000;

export default function Settings() {
  const { systemPrompt, updateSystemPrompt } = useAppContext();

  // Interview role + specialisation
  const [selectedRole, setSelectedRole] = useState<InterviewRoleId>(() => loadInterviewRole());
  const [selectedSpec, setSelectedSpec] = useState<SpecialisationId | null>(() => {
    const stored = loadInterviewSpec();
    return stored === "none" ? null : stored;
  });

  // Response settings
  const [respSettings, setRespSettings] = useState(() => loadResponseSettings());

  // System prompt
  const [promptValue, setPromptValue] = useState(systemPrompt);

  // Save flash
  const [saved, setSaved] = useState(false);

  const currentRole =
    INTERVIEW_ROLES.find((r) => r.id === selectedRole) ??
    INTERVIEW_ROLES.find((r) => r.id === DEFAULT_ROLE_ID)!;

  const handleRoleSelect = (roleId: InterviewRoleId) => {
    setSelectedRole(roleId);
    // Reset spec to first available for new role, or null
    const role = INTERVIEW_ROLES.find((r) => r.id === roleId)!;
    const firstSpec = role.specialisations[0]?.id ?? null;
    setSelectedSpec(firstSpec);
  };

  const handleSave = useCallback(() => {
    applyInterviewRole(selectedRole, selectedSpec);
    saveResponseSettings(respSettings);
    updateSystemPrompt(promptValue);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [selectedRole, selectedSpec, respSettings, promptValue, updateSystemPrompt]);

  const handleSignOutAll = async () => {
    try { await logout(); } catch { /* expired */ }
    clearAuthToken();
    clearUserProfile();
    await invoke("lock_app").catch(() => {});
  };

  const user = loadUserProfile();

  return (
    <PageLayout title="Settings" description="Configure AI model, response preferences, and system prompt">
      {/* Save button */}
      <div className="flex justify-end mb-6">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {saved && <Check className="h-4 w-4" />}
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>

      <div className="space-y-10 max-w-3xl">

        {/* ── Interview / Meeting Type ── */}
        <section className="space-y-4">
          <div>
            <h3 className="text-base font-semibold">Interview / Meeting Type</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Select your role and specialisation — we automatically choose the best AI model for you.
            </p>
          </div>

          {/* Role grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {INTERVIEW_ROLES.map((role) => {
              const isSelected = role.id === selectedRole;
              return (
                <button
                  key={role.id}
                  onClick={() => handleRoleSelect(role.id)}
                  className={`relative text-left rounded-xl border p-4 transition-all ${
                    isSelected
                      ? "border-primary bg-primary/8"
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/40"
                  }`}
                >
                  {isSelected && (
                    <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                  )}
                  <div className={`mb-2 ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                    {ROLE_ICONS[role.icon]}
                  </div>
                  <p className="text-sm font-medium leading-tight">{role.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{role.description}</p>
                </button>
              );
            })}
          </div>

          {/* Specialisation pills — only shown when the selected role has specialisations */}
          {currentRole.specialisations.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Specialisation
              </p>
              <div className="flex flex-wrap gap-2">
                {currentRole.specialisations.map((spec) => {
                  const isActive = selectedSpec === spec.id;
                  return (
                    <button
                      key={spec.id}
                      onClick={() => setSelectedSpec(spec.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {spec.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              AI model selected automatically based on your specialisation. You can focus on your interview — we handle the rest.
            </p>
          </div>
        </section>

        {/* ── Response Length ── */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold">Response Length</h3>
          <div className="grid grid-cols-3 gap-3">
            {RESPONSE_LENGTHS.map((opt) => {
              const isSelected = respSettings.length === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setRespSettings((s) => ({ ...s, length: opt.id }))}
                  className={`relative text-left rounded-xl border p-4 transition-all ${
                    isSelected
                      ? "border-primary bg-primary/8"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  {isSelected && (
                    <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                  )}
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.sub}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Response Language ── */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold">Response Language</h3>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => {
              const isSelected = respSettings.language === lang;
              return (
                <button
                  key={lang}
                  onClick={() => setRespSettings((s) => ({ ...s, language: lang }))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {lang}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── System Prompt ── */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold">System Prompt</h3>
          <div className="relative">
            <textarea
              className="w-full min-h-40 rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              placeholder="Enter a system prompt…"
              maxLength={MAX_PROMPT_LENGTH}
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
            />
            <span className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/60 select-none">
              {promptValue.length} / {MAX_PROMPT_LENGTH}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            This prompt is used as the default instruction for all AI interactions.
          </p>
        </section>

        {/* ── Security ── */}
        {user && (
          <section className="space-y-4">
            <h3 className="text-base font-semibold">Security</h3>
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Sign out of all devices</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Revokes every active session, including other browsers and devices.
                </p>
              </div>
              <button
                onClick={handleSignOutAll}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/15 transition-colors shrink-0 ml-4"
              >
                Sign out all
              </button>
            </div>
          </section>
        )}

      </div>
    </PageLayout>
  );
}
