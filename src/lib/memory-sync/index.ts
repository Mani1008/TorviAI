import type { ContextChunk } from "@/lib/database/context-store";
import { isSupabaseProvider } from "@/lib/backend/config";
import { isSupabaseConfigured } from "@/lib/backend/providers/supabase/client";
import { getCurrentUser } from "@/lib/backend/providers/supabase/auth";
import {
  createMemoryItem,
  createMemorySource,
  findMemoryByContentHash,
} from "@/lib/backend/providers/supabase/database";
import { formatSupabaseError, isPostgresDuplicateError } from "@/lib/backend/providers/supabase/errors";
import { buildMemoryPayloadFromChunk } from "./chunk-mapper";
import { encryptForCloud } from "./encryption";
import {
  countPendingUnsyncedChunks,
  getMemorySyncStats,
  getUnsyncedChunks,
  markChunkFailed,
  markChunkSynced,
} from "./sync-state";
import { isExcludedCapture } from "@/lib/context-memory/exclusions";
import { loadMemorySyncSettings, saveMemorySyncSettings } from "./settings.storage";

export type MemorySyncSkipReason =
  | "disabled"
  | "not_configured"
  | "not_supabase_provider"
  | "not_authenticated";

export interface MemorySyncResult {
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
  reason?: MemorySyncSkipReason;
}

const DEFAULT_BATCH_SIZE = 25;

async function promoteChunk(
  userId: string,
  chunk: ContextChunk,
  encryptCloud: boolean
): Promise<string> {
  const cloudContent = encryptCloud
    ? await encryptForCloud(chunk.text_content)
    : chunk.text_content;

  const { item, source } = buildMemoryPayloadFromChunk(
    chunk,
    cloudContent,
    encryptCloud
  );

  let memoryId: string;
  try {
    const memory = await createMemoryItem(userId, item);
    memoryId = memory.id;
  } catch (err) {
    if (!isPostgresDuplicateError(err)) throw err;
    const existing = await findMemoryByContentHash(userId, chunk.content_hash);
    if (!existing) throw err;
    memoryId = existing.id;
  }

  try {
    await createMemorySource(userId, { ...source, memoryId });
  } catch (err) {
    // Item may already exist from a prior partial sync; source duplicate is OK.
    if (!isPostgresDuplicateError(err)) throw err;
  }

  return memoryId;
}

/**
 * Upload pending local context chunks to Supabase memory_items (batch).
 * No-ops gracefully when sync is disabled, Supabase is not configured, or user is offline.
 */
export async function syncContextChunksToCloud(options?: {
  limit?: number;
  force?: boolean;
}): Promise<MemorySyncResult> {
  const settings = loadMemorySyncSettings();
  const result: MemorySyncResult = { synced: 0, skipped: 0, failed: 0, errors: [] };

  if (!options?.force && !settings.enabled) {
    return { ...result, reason: "disabled" };
  }
  if (!isSupabaseProvider()) {
    return { ...result, reason: "not_supabase_provider" };
  }
  if (!isSupabaseConfigured()) {
    return { ...result, reason: "not_configured" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ...result, reason: "not_authenticated" };
  }

  const batchSize = options?.limit ?? DEFAULT_BATCH_SIZE;
  const chunks = await getUnsyncedChunks(batchSize);

  for (const chunk of chunks) {
    if (isExcludedCapture(chunk)) {
      await markChunkSynced(chunk.id, "excluded-arch-doc").catch(console.warn);
      result.skipped++;
      continue;
    }
    try {
      const memoryId = await promoteChunk(user.id, chunk, settings.encryptCloud);
      await markChunkSynced(chunk.id, memoryId);
      result.synced++;
    } catch (err) {
      const msg = formatSupabaseError(err);
      result.failed++;
      result.errors.push(`${chunk.id}: ${msg}`);
      await markChunkFailed(chunk.id, msg).catch(console.warn);
    }
  }

  if (result.synced > 0 || result.failed > 0) {
    saveMemorySyncSettings({
      lastSyncAt: Date.now(),
      lastSyncedCount: result.synced,
      lastSyncError: result.errors[0] ?? null,
    });
  }

  return result;
}

export async function getMemorySyncQueueStatus(): Promise<{
  pending: number;
  synced: number;
  failed: number;
  settings: ReturnType<typeof loadMemorySyncSettings>;
  canSync: boolean;
}> {
  const settings = loadMemorySyncSettings();
  const tableStats = await getMemorySyncStats();
  const pending = await countPendingUnsyncedChunks();

  return {
    pending,
    synced: tableStats.synced,
    failed: tableStats.failed,
    settings,
    canSync:
      settings.enabled &&
      isSupabaseProvider() &&
      isSupabaseConfigured(),
  };
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced background upload after new local captures. */
export function scheduleMemoryChunkSync(delayMs = 45_000): void {
  const settings = loadMemorySyncSettings();
  if (!settings.enabled) return;
  if (!isSupabaseProvider() || !isSupabaseConfigured()) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncContextChunksToCloud().catch((e) =>
      console.warn("[MemorySync] Background sync failed:", e)
    );
  }, delayMs);
}

export {
  loadMemorySyncSettings,
  saveMemorySyncSettings,
} from "./settings.storage";

export { initMemorySyncState } from "./sync-state";

export { decryptFromCloud, isEncryptedCloudContent } from "./encryption";
