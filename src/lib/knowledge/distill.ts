import { streamAIFromConfig } from "@/lib/functions/ai-response.function";
import { getRecentContext } from "@/lib/database/context-store";
import { filterExcludedCaptures } from "@/lib/context-memory/exclusions";
import {
  saveKnowledgeEntity,
  saveSkill,
} from "@/lib/knowledge";
import type { KnowledgeEntity, Skill } from "@/types/knowledge";

const DISTILL_SYSTEM = `You are Torvi's Company Brain distillation engine for SaaS support / CX ops teams.
Extract reusable operational knowledge from the provided workplace context (screen captures + email).
Focus ONLY on: refunds, pricing exceptions, escalation paths, SLAs, support macros, and similar support policies/processes.
Ignore personal chatter, code unrelated to support, and one-off opinions.

Respond with ONLY valid JSON (no markdown fences) in this shape:
{
  "entities": [
    {
      "kind": "policy" | "process" | "decision",
      "title": "short title",
      "body": "clear statement of the policy/process/decision",
      "sourceChunkIds": ["id1"]
    }
  ],
  "skills": [
    {
      "slug": "snake_case_id",
      "title": "short title",
      "yamlBody": "id: slug\\nversion: 1\\ntitle: ...\\ntrigger:\\n  - ...\\nsteps:\\n  - ...\\n",
      "sourceChunkIds": ["id1"]
    }
  ]
}
Return at most 5 entities and 3 skills. If nothing support-related is found, return empty arrays.`;

interface DistillEntityDraft {
  kind: string;
  title: string;
  body: string;
  sourceChunkIds?: string[];
}

interface DistillSkillDraft {
  slug: string;
  title: string;
  yamlBody: string;
  sourceChunkIds?: string[];
}

interface DistillPayload {
  entities?: DistillEntityDraft[];
  skills?: DistillSkillDraft[];
}

export interface DistillResult {
  entities: KnowledgeEntity[];
  skills: Skill[];
  rawPreview: string;
}

function extractJson(text: string): DistillPayload {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Distillation did not return JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as DistillPayload;
}

/** Propose draft policies/processes/skills from recent screen + Gmail context. */
export async function proposeKnowledgeFromRecent(): Promise<DistillResult> {
  const chunks = filterExcludedCaptures(await getRecentContext(40, 24 * 60));
  if (chunks.length === 0) {
    throw new Error("No recent context to distill. Sync Gmail or capture screen activity first.");
  }

  const corpus = chunks
    .slice(0, 25)
    .map((c) => {
      const text =
        c.text_content.length > 1200
          ? `${c.text_content.slice(0, 1200)}…`
          : c.text_content;
      return `### chunk_id=${c.id} app=${c.app_name} title=${c.window_title}\n${text}`;
    })
    .join("\n\n");

  let raw = "";
  for await (const piece of streamAIFromConfig({
    systemPrompt: DISTILL_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Distill support-ops knowledge from this context:\n\n${corpus}`,
      },
    ],
  })) {
    raw += piece;
  }

  const payload = extractJson(raw);
  const chunkById = new Map(chunks.map((c) => [c.id, c]));

  const entities: KnowledgeEntity[] = [];
  for (const draft of payload.entities ?? []) {
    const kind = (draft.kind || "policy").toLowerCase();
    if (!["policy", "process", "decision"].includes(kind)) continue;
    if (!draft.title?.trim() || !draft.body?.trim()) continue;
    const sources = (draft.sourceChunkIds ?? [])
      .filter((id) => chunkById.has(id))
      .slice(0, 5)
      .map((id) => {
        const c = chunkById.get(id)!;
        const sourceType = c.app_name === "gmail" ? "gmail" : "screen";
        return {
          sourceType,
          refId: id,
          snippet: c.text_content.slice(0, 160),
        };
      });

    entities.push(
      await saveKnowledgeEntity({
        kind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        status: "draft",
        sources,
      })
    );
  }

  const skills: Skill[] = [];
  for (const draft of payload.skills ?? []) {
    if (!draft.slug?.trim() || !draft.title?.trim() || !draft.yamlBody?.trim()) {
      continue;
    }
    const sources = (draft.sourceChunkIds ?? [])
      .filter((id) => chunkById.has(id))
      .slice(0, 5)
      .map((id) => {
        const c = chunkById.get(id)!;
        const sourceType = c.app_name === "gmail" ? "gmail" : "screen";
        return {
          sourceType,
          refId: id,
          snippet: c.text_content.slice(0, 160),
        };
      });

    skills.push(
      await saveSkill({
        slug: draft.slug.trim(),
        title: draft.title.trim(),
        yamlBody: draft.yamlBody.trim(),
        status: "draft",
        sources,
      })
    );
  }

  return { entities, skills, rawPreview: raw.slice(0, 500) };
}
