import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@/layouts";
import {
  Check,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  exportConfirmedKnowledge,
  listKnowledgeEntities,
  listSkills,
  setKnowledgeEntityStatus,
  setSkillStatus,
} from "@/lib/knowledge";
import { proposeKnowledgeFromRecent } from "@/lib/knowledge/distill";
import type { KnowledgeEntity, Skill } from "@/types/knowledge";
import { isTauri } from "@/lib/platform";

type Tab = "drafts" | "confirmed";

export default function SkillsPage() {
  const [tab, setTab] = useState<Tab>("drafts");
  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === "drafts" ? "draft" : "confirmed";
      const [e, s] = await Promise.all([
        listKnowledgeEntities(status),
        listSkills(status),
      ]);
      setEntities(e);
      setSkills(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDistill = async () => {
    if (!isTauri()) {
      setError("Distillation requires the desktop app.");
      return;
    }
    setDistilling(true);
    setError(null);
    setInfo(null);
    try {
      const result = await proposeKnowledgeFromRecent();
      setTab("drafts");
      setInfo(
        `Proposed ${result.entities.length} policies/processes and ${result.skills.length} skills. Review drafts below.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDistilling(false);
    }
  };

  const confirmEntity = async (id: string) => {
    setBusyId(id);
    try {
      await setKnowledgeEntityStatus(id, "confirmed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const rejectEntity = async (id: string) => {
    setBusyId(id);
    try {
      await setKnowledgeEntityStatus(id, "rejected");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const confirmSkill = async (id: string) => {
    setBusyId(id);
    try {
      await setSkillStatus(id, "confirmed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const rejectSkill = async (id: string) => {
    setBusyId(id);
    try {
      await setSkillStatus(id, "rejected");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportConfirmedKnowledge();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `torvi-skills-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setInfo("Exported confirmed skills JSON for design partners.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <PageLayout
      title="Skills & Policies"
      description="Company brain for support ops — distill live work into confirmed skills AI can cite."
    >
      <div className="mx-auto max-w-3xl space-y-5 px-1 pb-10">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleDistill()}
            disabled={distilling}
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {distilling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {distilling ? "Distilling…" : "Propose from recent context"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export confirmed
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            {info}
          </div>
        )}

        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1 w-fit">
          {(["drafts", "confirmed"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium capitalize ${
                tab === t
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-[13px] text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : entities.length === 0 && skills.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-14 text-center shadow-sm">
            <p className="text-[15px] font-semibold text-neutral-900">
              No {tab} yet
            </p>
            <p className="mt-1.5 text-[13px] text-neutral-500">
              Sync Gmail, capture support work on screen, then propose policies
              and skills from recent context.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {entities.map((entity) => (
              <article
                key={entity.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                      {entity.kind}
                    </p>
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      {entity.title}
                    </h3>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] text-neutral-700">
                      {entity.body}
                    </p>
                    {entity.sources.length > 0 && (
                      <p className="mt-2 text-[11px] text-neutral-400">
                        Sources:{" "}
                        {entity.sources
                          .map((s) => `${s.sourceType}:${s.refId.slice(0, 8)}`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  {tab === "drafts" && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={busyId === entity.id}
                        onClick={() => void confirmEntity(entity.id)}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        title="Confirm"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === entity.id}
                        onClick={() => void rejectEntity(entity.id)}
                        className="rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
                        title="Reject"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}

            {skills.map((skill) => (
              <article
                key={skill.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                      skill · {skill.slug}
                    </p>
                    <h3 className="text-[14px] font-semibold text-neutral-900">
                      {skill.title}
                    </h3>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-neutral-50 p-3 text-[11px] text-neutral-700">
                      {skill.yamlBody}
                    </pre>
                    {skill.sources.length > 0 && (
                      <p className="mt-2 text-[11px] text-neutral-400">
                        Sources:{" "}
                        {skill.sources
                          .map((s) => `${s.sourceType}:${s.refId.slice(0, 8)}`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  {tab === "drafts" && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={busyId === skill.id}
                        onClick={() => void confirmSkill(skill.id)}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        title="Confirm"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === skill.id}
                        onClick={() => void rejectSkill(skill.id)}
                        className="rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
                        title="Reject"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
