import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useAppContext } from "@/contexts/app.context";
import {
  loadResponseSettings,
  saveResponseSettings,
} from "@/lib/storage/response-settings.storage";
import {
  loadUserPreferences,
  saveUserPreferences,
} from "@/lib/storage/user-preferences.storage";
import {
  applyInterviewRole,
  loadInterviewRole,
  loadInterviewSpec,
} from "@/lib/storage/ai-providers";
import {
  INTERVIEW_ROLES,
  type InterviewRoleId,
  type SpecialisationId,
} from "@/config/interview-roles.constants";
import { InterviewRoleSection } from "./InterviewRoleSection";

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

/** Card footer with Save / Discard, mirroring Littlebird's Chat section. */
function EditorFooter({
  dirty,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {dirty ? "Unsaved changes" : "No unsaved changes"}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={!dirty}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function AiChatSection() {
  const { systemPrompt, updateSystemPrompt } = useAppContext();

  // Custom instructions (system prompt) — per-card draft + Save/Discard.
  const [instructions, setInstructions] = useState(systemPrompt);
  const instructionsDirty = instructions !== systemPrompt;

  // Assistant notes — user-editable memory guidance.
  const [savedNotes, setSavedNotes] = useState(() => loadUserPreferences().assistantNotes);
  const [notes, setNotes] = useState(savedNotes);
  const notesDirty = notes !== savedNotes;

  // Response settings (auto-save on change).
  const [respSettings, setRespSettings] = useState(() => loadResponseSettings());

  // Interview role (auto-save on change).
  const [selectedRole, setSelectedRole] = useState<InterviewRoleId>(() => loadInterviewRole());
  const [selectedSpec, setSelectedSpec] = useState<SpecialisationId | null>(() => {
    const stored = loadInterviewSpec();
    return stored === "none" ? null : stored;
  });

  const updateResp = (patch: Partial<typeof respSettings>) => {
    const next = { ...respSettings, ...patch };
    setRespSettings(next);
    saveResponseSettings(next);
  };

  const handleRoleSelect = (roleId: InterviewRoleId) => {
    const role = INTERVIEW_ROLES.find((r) => r.id === roleId)!;
    const firstSpec = role.specialisations[0]?.id ?? null;
    setSelectedRole(roleId);
    setSelectedSpec(firstSpec);
    applyInterviewRole(roleId, firstSpec);
  };

  const handleSpecSelect = (specId: SpecialisationId) => {
    setSelectedSpec(specId);
    applyInterviewRole(selectedRole, specId);
  };

  const saveNotes = () => {
    const prefs = loadUserPreferences();
    saveUserPreferences({ ...prefs, assistantNotes: notes });
    setSavedNotes(notes);
  };

  const instructionsCount = useMemo(() => instructions.length, [instructions]);

  return (
    <div className="space-y-8 max-w-2xl">
      {/* ── Custom Instructions ── */}
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Custom Instructions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Personalize your interactions with Torvi by providing your own instructions.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <textarea
            className="w-full min-h-40 resize-none bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            placeholder="Enter your custom instructions"
            maxLength={MAX_PROMPT_LENGTH}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {instructionsDirty
                ? `${instructionsCount} / ${MAX_PROMPT_LENGTH}`
                : "No unsaved changes"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInstructions(systemPrompt)}
                disabled={!instructionsDirty}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => updateSystemPrompt(instructions)}
                disabled={!instructionsDirty}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Assistant Notes ── */}
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Assistant Notes</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review and edit what Torvi has remembered from past chats to guide future conversations.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <textarea
            className="w-full min-h-36 resize-none bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            placeholder="Edit Torvi's memory"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <EditorFooter
            dirty={notesDirty}
            onSave={saveNotes}
            onDiscard={() => setNotes(savedNotes)}
          />
        </div>
      </section>

      {/* ── Response length ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Response length</h3>
        <div className="grid grid-cols-3 gap-3">
          {RESPONSE_LENGTHS.map((opt) => {
            const isSelected = respSettings.length === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateResp({ length: opt.id })}
                className={`relative text-left rounded-xl border p-4 transition-all ${
                  isSelected
                    ? "border-primary bg-primary/8"
                    : "border-border bg-background hover:border-primary/40"
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

      {/* ── Response language ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Response language</h3>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => {
            const isSelected = respSettings.language === lang;
            return (
              <button
                key={lang}
                type="button"
                onClick={() => updateResp({ language: lang })}
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

      {/* ── Interview / meeting type ── */}
      <InterviewRoleSection
        selectedRole={selectedRole}
        selectedSpec={selectedSpec}
        onRoleSelect={handleRoleSelect}
        onSpecSelect={handleSpecSelect}
      />
    </div>
  );
}
