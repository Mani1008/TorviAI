import type { UserProfile } from "@/types/settings";
import type {
  RemoteUsage,
  RemoteSettings,
  MemoryItem,
  MemorySource,
  CreateMemoryItemInput,
  UpdateMemoryItemInput,
  CreateMemorySourceInput,
} from "../../types";
import { getSupabaseClient, isSupabaseConfigured } from "./client";
import { loadResponseSettings } from "@/lib/storage/response-settings.storage";
import { loadSelectedModel } from "@/lib/storage/ai-providers";
import { STORAGE_KEYS, DEFAULT_SYSTEM_PROMPT } from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage/helper";

// ─── Row types (Postgres snake_case) ─────────────────────────────────────────

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  plan: string;
  is_active: boolean;
  legacy_appwrite_id: string | null;
  created_at: string;
  updated_at: string;
}

interface UsageRow {
  user_id: string;
  ai_responses_used: number;
  listening_seconds_used: number;
  period_start: string;
  updated_at: string;
}

interface SettingsRow {
  user_id: string;
  selected_model: string;
  response_length: string;
  language: string;
  system_prompt: string;
  updated_at: string;
}

interface MemoryItemRow {
  id: string;
  user_id: string;
  title: string;
  tags: string[];
  content: string;
  summary: string | null;
  knowledge_type: string;
  domain: string;
  importance: number;
  created_by: string;
  content_hash: string | null;
  confirmed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MemorySourceRow {
  id: string;
  memory_id: string;
  user_id: string;
  source_kind: string;
  source_ref: string | null;
  connector: string | null;
  connector_ref: string | null;
  app_name: string | null;
  window_title: string | null;
  content_type: string | null;
  url: string | null;
  captured_at: string | null;
  excerpt: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    tags: row.tags ?? [],
    content: row.content,
    summary: row.summary,
    knowledgeType: row.knowledge_type,
    domain: row.domain,
    importance: row.importance,
    createdBy: row.created_by as MemoryItem["createdBy"],
    contentHash: row.content_hash,
    confirmedAt: row.confirmed_at,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapMemorySource(row: MemorySourceRow): MemorySource {
  return {
    id: row.id,
    memoryId: row.memory_id,
    userId: row.user_id,
    sourceKind: row.source_kind as MemorySource["sourceKind"],
    sourceRef: row.source_ref,
    connector: row.connector,
    connectorRef: row.connector_ref,
    appName: row.app_name,
    windowTitle: row.window_title,
    contentType: row.content_type,
    url: row.url,
    capturedAt: row.captured_at,
    excerpt: row.excerpt,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// ─── profiles ────────────────────────────────────────────────────────────────

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as ProfileRow;
  const plan = row.plan === "free" ? "starter" : row.plan;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
    plan: plan as UserProfile["plan"],
  };
}

/** Upsert profile fields users may edit — plan is DB-protected (column REVOKE). */
export async function upsertProfile(profile: UserProfile): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabaseClient()
    .from("profiles")
    .upsert(
      {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        avatar_url: profile.avatarUrl ?? null,
      },
      { onConflict: "id" }
    );

  if (error) throw error;
}

export async function fetchPlan(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.plan ?? null;
}

// ─── usage ───────────────────────────────────────────────────────────────────

export async function fetchUsage(userId: string): Promise<RemoteUsage | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient()
    .from("usage")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as UsageRow;
  return {
    aiResponsesUsed: row.ai_responses_used,
    listeningSecondsUsed: row.listening_seconds_used,
  };
}

// ─── settings ────────────────────────────────────────────────────────────────

export async function fetchSettings(userId: string): Promise<RemoteSettings | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient()
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as SettingsRow;
  return {
    selectedModel: row.selected_model,
    responseLength: row.response_length,
    language: row.language,
    systemPrompt: row.system_prompt,
  };
}

export async function pushSettings(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const resp = loadResponseSettings();
  const model = loadSelectedModel();
  const rawPrompt = safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) ?? DEFAULT_SYSTEM_PROMPT;
  const sysPrompt = typeof rawPrompt === "string" ? rawPrompt : JSON.stringify(rawPrompt);

  if (sysPrompt.length > 10_000) {
    console.warn("[Supabase] System prompt exceeds 10 000 chars — skipping cloud sync.");
    return;
  }

  const { error } = await getSupabaseClient()
    .from("settings")
    .upsert(
      {
        user_id: userId,
        selected_model: model,
        response_length: resp.length,
        language: resp.language,
        system_prompt: sysPrompt,
      },
      { onConflict: "user_id" }
    );

  if (error) throw error;
}

// ─── memory_items ────────────────────────────────────────────────────────────

export async function listMemoryItems(
  userId: string,
  options?: { limit?: number; includeDeleted?: boolean }
): Promise<MemoryItem[]> {
  if (!isSupabaseConfigured()) return [];

  let query = getSupabaseClient()
    .from("memory_items")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!options?.includeDeleted) {
    query = query.is("deleted_at", null);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as MemoryItemRow[]).map(mapMemoryItem);
}

export async function getMemoryItem(id: string): Promise<MemoryItem | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient()
    .from("memory_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapMemoryItem(data as MemoryItemRow);
}

export async function createMemoryItem(
  userId: string,
  input: CreateMemoryItemInput
): Promise<MemoryItem> {
  const { data, error } = await getSupabaseClient()
    .from("memory_items")
    .insert({
      user_id: userId,
      title: input.title ?? "",
      tags: input.tags ?? [],
      content: input.content,
      summary: input.summary ?? null,
      knowledge_type: input.knowledgeType ?? "reference",
      domain: input.domain ?? "generic",
      importance: input.importance ?? 5,
      created_by: input.createdBy ?? "user",
      content_hash: input.contentHash ?? null,
      confirmed_at: input.confirmedAt ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapMemoryItem(data as MemoryItemRow);
}

export async function updateMemoryItem(
  id: string,
  input: UpdateMemoryItemInput
): Promise<MemoryItem> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.content !== undefined) patch.content = input.content;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.knowledgeType !== undefined) patch.knowledge_type = input.knowledgeType;
  if (input.domain !== undefined) patch.domain = input.domain;
  if (input.importance !== undefined) patch.importance = input.importance;
  if (input.createdBy !== undefined) patch.created_by = input.createdBy;
  if (input.contentHash !== undefined) patch.content_hash = input.contentHash;
  if (input.confirmedAt !== undefined) patch.confirmed_at = input.confirmedAt;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await getSupabaseClient()
    .from("memory_items")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return mapMemoryItem(data as MemoryItemRow);
}

export async function softDeleteMemoryItem(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("memory_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function hardDeleteMemoryItem(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from("memory_items").delete().eq("id", id);
  if (error) throw error;
}

// ─── memory_sources ────────────────────────────────────────────────────────────

export async function listMemorySources(memoryId: string): Promise<MemorySource[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient()
    .from("memory_sources")
    .select("*")
    .eq("memory_id", memoryId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as MemorySourceRow[]).map(mapMemorySource);
}

export async function createMemorySource(
  userId: string,
  input: CreateMemorySourceInput
): Promise<MemorySource> {
  const { data, error } = await getSupabaseClient()
    .from("memory_sources")
    .insert({
      memory_id: input.memoryId,
      user_id: userId,
      source_kind: input.sourceKind,
      source_ref: input.sourceRef ?? null,
      connector: input.connector ?? null,
      connector_ref: input.connectorRef ?? null,
      app_name: input.appName ?? null,
      window_title: input.windowTitle ?? null,
      content_type: input.contentType ?? null,
      url: input.url ?? null,
      captured_at: input.capturedAt ?? null,
      excerpt: input.excerpt ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapMemorySource(data as MemorySourceRow);
}

export async function deleteMemorySource(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from("memory_sources").delete().eq("id", id);
  if (error) throw error;
}
