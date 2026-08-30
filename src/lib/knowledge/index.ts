import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";
import type {
  GmailSyncResult,
  GmailSyncStatus,
  KnowledgeEntity,
  SaveEntityInput,
  SaveSkillInput,
  Skill,
} from "@/types/knowledge";

export async function listKnowledgeEntities(
  status?: string
): Promise<KnowledgeEntity[]> {
  if (!isTauri()) return [];
  return invoke<KnowledgeEntity[]>("list_knowledge_entities", {
    status: status ?? null,
  });
}

export async function listSkills(status?: string): Promise<Skill[]> {
  if (!isTauri()) return [];
  return invoke<Skill[]>("list_skills", { status: status ?? null });
}

export async function listConfirmedSkills(): Promise<Skill[]> {
  if (!isTauri()) return [];
  return invoke<Skill[]>("list_confirmed_skills");
}

export async function saveKnowledgeEntity(
  input: SaveEntityInput
): Promise<KnowledgeEntity> {
  return invoke<KnowledgeEntity>("save_knowledge_entity", { input });
}

export async function saveSkill(input: SaveSkillInput): Promise<Skill> {
  return invoke<Skill>("save_skill", { input });
}

export async function setKnowledgeEntityStatus(
  id: string,
  status: string
): Promise<KnowledgeEntity> {
  return invoke<KnowledgeEntity>("set_knowledge_entity_status", { id, status });
}

export async function setSkillStatus(
  id: string,
  status: string
): Promise<Skill> {
  return invoke<Skill>("set_skill_status", { id, status });
}

export async function exportConfirmedKnowledge(): Promise<string> {
  return invoke<string>("export_confirmed_knowledge");
}

export async function syncGmailNow(): Promise<GmailSyncResult> {
  return invoke<GmailSyncResult>("sync_gmail_now");
}

export async function getGmailSyncStatus(): Promise<GmailSyncStatus> {
  if (!isTauri()) {
    return {
      provider: "gmail",
      lastSyncAt: null,
      lastStatus: "idle",
      lastError: null,
      itemsSynced: 0,
    };
  }
  return invoke<GmailSyncStatus>("get_gmail_sync_status");
}
