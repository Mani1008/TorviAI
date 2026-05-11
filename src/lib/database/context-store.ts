/**
 * Local SQLite store for screen context chunks captured by the Rust UIAutomation watcher.
 * These chunks form the RAG (Retrieval-Augmented Generation) knowledge base that is
 * injected into AI prompts automatically.
 *
 * Schema: context_chunks
 *   id            TEXT PRIMARY KEY
 *   app_name      TEXT NOT NULL
 *   window_title  TEXT NOT NULL
 *   content_type  TEXT NOT NULL
 *   text_content  TEXT NOT NULL
 *   content_hash  TEXT NOT NULL   -- SHA-256 for dedup
 *   captured_at   INTEGER NOT NULL  -- Unix seconds
 *   url           TEXT
 */

import Database from "@tauri-apps/plugin-sql";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single captured screen context chunk. */
export interface ContextChunk {
  id: string;
  app_name: string;
  window_title: string;
  content_type: string;
  text_content: string;
  content_hash: string;
  captured_at: number;
  url: string | null;
}

/** Shape emitted by the Rust `context-captured` event. */
export interface AppContextSnapshot {
  app_name: string;
  window_title: string;
  text_content: string;
  content_type: string;
  content_hash: string;
  url: string | null;
  captured_at: number;
}

// ─── Database connection ──────────────────────────────────────────────────────

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:ai_assistant.db");
  }
  return db;
}

// ─── Table initialisation ─────────────────────────────────────────────────────

export async function initContextStore(): Promise<void> {
  const conn = await getDb();

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS context_chunks (
      id           TEXT    PRIMARY KEY,
      app_name     TEXT    NOT NULL,
      window_title TEXT    NOT NULL,
      content_type TEXT    NOT NULL,
      text_content TEXT    NOT NULL,
      content_hash TEXT    NOT NULL,
      captured_at  INTEGER NOT NULL,
      url          TEXT
    )
  `);

  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_captured_at ON context_chunks(captured_at DESC)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_hash ON context_chunks(content_hash)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_app ON context_chunks(app_name)`
  );
  // Composite index for the common RAG query: filter by app_name, order by time.
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_app_time ON context_chunks(app_name, captured_at DESC)`
  );
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Persist a captured context snapshot.
 * Silently skips duplicates: if the same content_hash was stored within the
 * last 5 minutes the write is dropped.
 */
export async function saveContextChunk(snapshot: AppContextSnapshot): Promise<void> {
  const conn = await getDb();
  const cutoffSecs = snapshot.captured_at - 5 * 60;

  // Dedup check: same hash within last 5 minutes → skip.
  const existing = await conn.select<{ id: string }[]>(
    `SELECT id FROM context_chunks WHERE content_hash = ? AND captured_at > ? LIMIT 1`,
    [snapshot.content_hash, cutoffSecs]
  );
  if (existing.length > 0) return;

  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO context_chunks
       (id, app_name, window_title, content_type, text_content, content_hash, captured_at, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      snapshot.app_name,
      snapshot.window_title,
      snapshot.content_type,
      snapshot.text_content,
      snapshot.content_hash,
      snapshot.captured_at,
      snapshot.url ?? null,
    ]
  );
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the most recent context chunks captured within the last `withinMinutes`.
 * Returns at most `limit` rows ordered newest-first.
 */
export async function getRecentContext(
  limit: number,
  withinMinutes: number
): Promise<ContextChunk[]> {
  const conn = await getDb();
  const cutoff = Math.floor(Date.now() / 1000) - withinMinutes * 60;

  return conn.select<ContextChunk[]>(
    `SELECT * FROM context_chunks WHERE captured_at > ? ORDER BY captured_at DESC LIMIT ?`,
    [cutoff, limit]
  );
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

/** Delete context chunks older than 24 hours to keep the database lean. */
export async function pruneOldContext(): Promise<void> {
  const conn = await getDb();
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  await conn.execute(`DELETE FROM context_chunks WHERE captured_at < ?`, [cutoff]);
}
