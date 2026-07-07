import Database from "@tauri-apps/plugin-sql";
import type { ContextChunk } from "@/lib/database/context-store";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) db = await Database.load("sqlite:ai_assistant.db");
  return db;
}

export type MemorySyncStatus = "pending" | "synced" | "failed";

export interface MemorySyncStateRow {
  chunk_id: string;
  memory_id: string | null;
  sync_status: MemorySyncStatus;
  synced_at: number | null;
  last_error: string | null;
  retry_count: number;
}

export async function initMemorySyncState(): Promise<void> {
  const conn = await getDb();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS memory_sync_state (
      chunk_id      TEXT PRIMARY KEY,
      memory_id     TEXT,
      sync_status   TEXT NOT NULL DEFAULT 'pending',
      synced_at     INTEGER,
      last_error    TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0
    )
  `);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_sync_status ON memory_sync_state(sync_status)`
  );
}

export async function getMemorySyncStats(): Promise<{
  pending: number;
  synced: number;
  failed: number;
}> {
  const conn = await getDb();
  const rows = await conn.select<{ sync_status: MemorySyncStatus; n: number }[]>(`
    SELECT sync_status, COUNT(*) as n
    FROM memory_sync_state
    GROUP BY sync_status
  `);

  const stats = { pending: 0, synced: 0, failed: 0 };
  for (const row of rows) {
    if (row.sync_status === "synced") stats.synced = row.n;
    else if (row.sync_status === "failed") stats.failed = row.n;
    else stats.pending = row.n;
  }
  return stats;
}

/** Chunks not yet successfully uploaded (includes never-queued rows). */
export async function getUnsyncedChunks(limit: number): Promise<ContextChunk[]> {
  const conn = await getDb();
  return conn.select<ContextChunk[]>(
    `SELECT c.*
     FROM context_chunks c
     LEFT JOIN memory_sync_state s ON s.chunk_id = c.id
     WHERE s.chunk_id IS NULL
        OR (s.sync_status = 'failed' AND s.retry_count < 8)
        OR s.sync_status = 'pending'
     ORDER BY c.captured_at ASC
     LIMIT ?`,
    [limit]
  );
}

export async function countPendingUnsyncedChunks(): Promise<number> {
  const conn = await getDb();
  const rows = await conn.select<{ n: number }[]>(
    `SELECT COUNT(*) as n
     FROM context_chunks c
     LEFT JOIN memory_sync_state s ON s.chunk_id = c.id
     WHERE s.chunk_id IS NULL
        OR (s.sync_status = 'failed' AND s.retry_count < 8)
        OR s.sync_status = 'pending'`
  );
  return rows[0]?.n ?? 0;
}

export async function markChunkSynced(
  chunkId: string,
  memoryId: string
): Promise<void> {
  const conn = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await conn.execute(
    `INSERT OR REPLACE INTO memory_sync_state
       (chunk_id, memory_id, sync_status, synced_at, last_error, retry_count)
     VALUES (?, ?, 'synced', ?, NULL, 0)`,
    [chunkId, memoryId, now]
  );
}

export async function markChunkFailed(
  chunkId: string,
  error: string
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO memory_sync_state (chunk_id, sync_status, last_error, retry_count)
     VALUES (?, 'failed', ?, 1)
     ON CONFLICT(chunk_id) DO UPDATE SET
       sync_status = 'failed',
       last_error = excluded.last_error,
       retry_count = memory_sync_state.retry_count + 1`,
    [chunkId, error.slice(0, 500)]
  );
}
