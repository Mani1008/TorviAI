import { useState, useEffect, useCallback } from "react";
import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";
import {
  getAllSystemPrompts,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
} from "@/lib/database/system-prompts";
import { syncSystemPromptRemote, deleteSystemPrompt as deleteRemoteSystemPrompt } from "@/lib/backend";
import { loadUserProfile } from "@/lib/storage/auth";
import type { SystemPrompt } from "@/types/system-prompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Check, Wand2 } from "lucide-react";

// ─── Default starter templates ────────────────────────────────────────────────
const DEFAULT_TEMPLATES: { name: string; prompt: string }[] = [
  {
    name: "Concise Assistant",
    prompt:
      "You are a concise, direct assistant. Answer in the fewest words possible without sacrificing accuracy. Avoid preamble, filler phrases, and unnecessary explanations.",
  },
  {
    name: "Technical Expert",
    prompt:
      "You are a senior software engineer with deep expertise in system design, algorithms, and modern web technologies. Provide precise, production-ready code and explain trade-offs clearly.",
  },
  {
    name: "Interview Coach",
    prompt:
      "You are an expert interview coach. Help the user prepare strong, structured answers to interview questions using the STAR method. Be encouraging, specific, and highlight what makes an answer compelling.",
  },
  {
    name: "Writing Editor",
    prompt:
      "You are a professional editor. Improve clarity, flow, and tone while preserving the author's voice. Point out any logical inconsistencies or areas that need more detail.",
  },
];

const MAX_NAME_LENGTH = 80;
const MAX_PROMPT_LENGTH = 4000;

// ─── Form state ───────────────────────────────────────────────────────────────
interface FormState {
  name: string;
  prompt: string;
}

const EMPTY_FORM: FormState = { name: "", prompt: "" };

export default function SystemPrompts() {
  const { systemPrompt: activePrompt, updateSystemPrompt: setActivePrompt } =
    useAppContext();

  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state: null = closed, "new" = creating, number = editing id
  const [dialog, setDialog] = useState<null | "new" | number>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // "Applied" flash per prompt id
  const [appliedId, setAppliedId] = useState<number | null>(null);

  // ─── Load ────────────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAllSystemPrompts();
      setPrompts(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const openNew = () => {
    setForm(EMPTY_FORM);
    setFormError("");
    setDialog("new");
  };

  const openEdit = (p: SystemPrompt) => {
    setForm({ name: p.name, prompt: p.prompt });
    setFormError("");
    setDialog(p.id);
  };

  const closeDialog = () => {
    setDialog(null);
    setForm(EMPTY_FORM);
    setFormError("");
  };

  const validate = (): boolean => {
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return false;
    }
    if (!form.prompt.trim()) {
      setFormError("Prompt content is required.");
      return false;
    }
    return true;
  };

  // ─── Save (create or update) ──────────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const userId = loadUserProfile()?.id ?? null;
      if (dialog === "new") {
        await createSystemPrompt(form.name.trim(), form.prompt.trim());
      } else if (typeof dialog === "number") {
        await updateSystemPrompt(dialog, form.name.trim(), form.prompt.trim());
      }
      // Sync to Appwrite (best-effort)
      if (userId) {
        const updated = await getAllSystemPrompts();
        const saved = updated.find(
          (p) =>
            p.name === form.name.trim() && p.prompt === form.prompt.trim()
        );
        if (saved) syncSystemPromptRemote(userId, saved).catch(() => {});
      }
      await reload();
      closeDialog();
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    await deleteSystemPrompt(id);
    const userId = loadUserProfile()?.id ?? null;
    if (userId) deleteRemoteSystemPrompt(userId, id).catch(() => {});
    setConfirmDelete(null);
    await reload();
  };

  // ─── Apply as active system prompt ────────────────────────────────────────
  const handleApply = (p: SystemPrompt) => {
    setActivePrompt(p.prompt);
    setAppliedId(p.id);
    setTimeout(() => setAppliedId(null), 2000);
  };

  // ─── Seed default templates ───────────────────────────────────────────────
  const handleSeedDefaults = async () => {
    setSaving(true);
    try {
      const existing = prompts.map((p) => p.name);
      for (const t of DEFAULT_TEMPLATES) {
        if (!existing.includes(t.name)) {
          await createSystemPrompt(t.name, t.prompt);
        }
      }
      await reload();
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <PageLayout
      title="System Prompts"
      description="Saved AI instruction templates. Click Use to make one active."
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {prompts.length === 0 && !loading && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDefaults}
              disabled={saving}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Add starter templates
            </Button>
          )}
        </div>
        <Button size="sm" onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          New Prompt
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      ) : prompts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <p className="text-sm">No prompts yet.</p>
          <p className="text-xs">
            Click <strong>New Prompt</strong> to create one, or use the starter
            templates.
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-w-3xl">
          {prompts.map((p) => {
            const isActive = p.prompt === activePrompt;
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-4 transition-colors ${
                  isActive
                    ? "border-primary/60 bg-primary/5"
                    : "border-border bg-card hover:border-border/80"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {p.name}
                      </span>
                      {isActive && (
                        <span className="shrink-0 text-xs rounded-full bg-primary/15 text-primary px-2 py-0.5 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {p.prompt}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant={appliedId === p.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleApply(p)}
                      className="gap-1.5 text-xs h-8"
                    >
                      {appliedId === p.id ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Applied
                        </>
                      ) : (
                        "Use"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog === "new" ? "New System Prompt" : "Edit Prompt"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-name">Name</Label>
              <Input
                id="prompt-name"
                placeholder="e.g. Concise Assistant"
                value={form.name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="prompt-content">Prompt</Label>
                <span className="text-xs text-muted-foreground">
                  {form.prompt.length}/{MAX_PROMPT_LENGTH}
                </span>
              </div>
              <Textarea
                id="prompt-content"
                placeholder="You are a helpful assistant that..."
                value={form.prompt}
                maxLength={MAX_PROMPT_LENGTH}
                rows={8}
                className="resize-none font-mono text-xs leading-relaxed"
                onChange={(e) =>
                  setForm((f) => ({ ...f, prompt: e.target.value }))
                }
              />
            </div>

            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete prompt?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will permanently delete the prompt and remove it from Appwrite
            sync. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                confirmDelete !== null && handleDelete(confirmDelete)
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
