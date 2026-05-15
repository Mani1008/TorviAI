/**
 * Local SQLite store for screen context chunks captured by the Rust UIAutomation watcher.
 * These chunks form the RAG (Retrieval-Augmented Generation) knowledge base that is
 * injected into AI prompts automatically.
 *
 * Schema: context_chunks
 *   id                 TEXT    PRIMARY KEY
 *   app_name           TEXT    NOT NULL
 *   window_title       TEXT    NOT NULL
 *   content_type       TEXT    NOT NULL
 *   text_content       TEXT    NOT NULL
 *   content_hash       TEXT    NOT NULL   -- SHA-256 of original full text for dedup
 *   captured_at        INTEGER NOT NULL   -- Unix seconds
 *   url                TEXT
 *   parent_capture_id  TEXT               -- NULL for first/atomic chunk; sibling ID for splits
 *   chunk_index        INTEGER NOT NULL DEFAULT 0  -- 0-based position within a split capture
 *
 * Chunking strategy (per content_type):
 *   chat              → split on speaker-turn boundaries ("Name: …" patterns)
 *   email             → split on "From:", reply markers, or separator lines
 *   code              → split on top-level declaration boundaries (fn/class/interface/…)
 *   document          → split on markdown headings (# / ## / ###) or 3+ blank lines
 *   generic/default   → sliding window: 600-char windows with 100-char overlap
 *
 * Sub-chunks smaller than MIN_CHUNK_CHARS are silently dropped.
 * Sub-chunks larger than MAX_CHUNK_CHARS are recursively split with a sliding window.
 */

import Database from "@tauri-apps/plugin-sql";
import { emit } from "@tauri-apps/api/event";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single stored context chunk (potentially a sub-chunk of a larger capture). */
export interface ContextChunk {
  id: string;
  app_name: string;
  window_title: string;
  content_type: string;
  text_content: string;
  content_hash: string;
  captured_at: number;
  url: string | null;
  /** NULL when this is an unsplit (atomic) capture or the first sub-chunk. */
  parent_capture_id: string | null;
  /** 0-based position within the original capture's split sequence. */
  chunk_index: number;
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
      id                TEXT    PRIMARY KEY,
      app_name          TEXT    NOT NULL,
      window_title      TEXT    NOT NULL,
      content_type      TEXT    NOT NULL,
      text_content      TEXT    NOT NULL,
      content_hash      TEXT    NOT NULL,
      captured_at       INTEGER NOT NULL,
      url               TEXT,
      parent_capture_id TEXT,
      chunk_index       INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Core indexes.
  // IMPORTANT: Always DROP the content_hash index first, then recreate as non-unique.
  // Older versions of this codebase may have created it as a UNIQUE index
  // (e.g. "CREATE UNIQUE INDEX idx_ctx_hash ..."), which causes every INSERT of
  // a previously-seen hash to be silently ignored (rows_affected=0, no throw) when
  // tauri-plugin-sql uses SQLite's default OR ABORT replaced by OR IGNORE internally.
  // Dropping + recreating guarantees it is always non-unique.
  // ── Schema migrations (MUST run before any index that references new columns) ─
  // SQLite does not support "ALTER TABLE … ADD COLUMN IF NOT EXISTS", so we
  // attempt each ALTER and swallow the "duplicate column name" error gracefully.
  for (const migration of [
    `ALTER TABLE context_chunks ADD COLUMN parent_capture_id TEXT`,
    `ALTER TABLE context_chunks ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try {
      await conn.execute(migration);
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  // ── Indexes (after migrations so idx_ctx_parent can reference parent_capture_id) ─
  try { await conn.execute(`DROP INDEX IF EXISTS idx_ctx_hash`); } catch { /* ignore */ }
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_captured_at ON context_chunks(captured_at DESC)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_hash ON context_chunks(content_hash)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_app ON context_chunks(app_name)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_app_time ON context_chunks(app_name, captured_at DESC)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_ctx_parent ON context_chunks(parent_capture_id)`
  );
}

// ─── Chunking engine ──────────────────────────────────────────────────────────

/** Minimum chars a sub-chunk must contain to be worth storing. */
const MIN_CHUNK_CHARS = 80;

/** Hard ceiling for a single stored chunk — keeps each row within the RAG budget. */
const MAX_CHUNK_CHARS = 1_400;

/** Intermediate representation before index assignment. */
interface RawChunk {
  text: string;
}

/**
 * Dispatch text to the appropriate splitter based on content_type, then
 * assign final 0-based indexes.
 */
function splitByContentType(text: string, contentType: string): RawChunk[] {
  if (text.length <= MIN_CHUNK_CHARS) return [{ text }];

  let parts: RawChunk[];
  switch (contentType) {
    case "chat":
      parts = splitChatTurns(text);
      break;
    case "email":
      parts = splitEmailThread(text);
      break;
    case "code":
      parts = splitCodeBlocks(text);
      break;
    case "document":
    case "project_management":
      parts = splitDocumentSections(text);
      break;
    default:
      parts = slidingWindow(text);
  }

  // Any individual part that exceeds the max is recursively split via sliding window.
  return parts.flatMap((p) =>
    p.text.length > MAX_CHUNK_CHARS ? slidingWindow(p.text) : [p]
  );
}

/**
 * Chat: split on speaker-turn boundaries.
 * Recognises patterns like:
 *   "Alice: hello"
 *   "Bob [10:42]: sure"
 *   "Carol [10:42:05]: agreed"
 */
function splitChatTurns(text: string): RawChunk[] {
  // Matches lines that open a new speaker turn.
  const SPEAKER_RE = /^[A-Za-z][^\n:]{0,40}(?:\s\[\d{1,2}:\d{2}(?::\d{2})?\])?\s*:/;
  const lines = text.split("\n");
  const groups: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (SPEAKER_RE.test(line.trim()) && current.length > 0) {
      const joined = current.join("\n").trim();
      if (joined.length >= MIN_CHUNK_CHARS) groups.push(joined);
      current = [line];
    } else {
      current.push(line);
    }
  }
  const last = current.join("\n").trim();
  if (last.length >= MIN_CHUNK_CHARS) groups.push(last);

  return groups.length > 1 ? groups.map((t) => ({ text: t })) : slidingWindow(text);
}

/**
 * Email: split on message boundaries.
 * Boundary markers: "From:", "On … wrote:", separator lines (---/===).
 */
function splitEmailThread(text: string): RawChunk[] {
  const BOUNDARY_RE = /^(?:From:|On .{5,80} wrote:|[-=_]{3,})$/m;
  const parts = text
    .split(BOUNDARY_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CHUNK_CHARS);

  return parts.length > 1 ? parts.map((t) => ({ text: t })) : slidingWindow(text);
}

/**
 * Code: split on top-level declaration boundaries.
 * Handles JS/TS, Python, Rust, Go, Java/C# common patterns.
 */
function splitCodeBlocks(text: string): RawChunk[] {
  // Matches the start of a top-level declaration at column 0.
  const DECL_RE =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|impl|struct|trait|def|pub fn|fn|public|private|protected)\s+\w/;

  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    // Only split on declarations that appear at the start of a line (no indentation).
    const startsAtCol0 = line.length > 0 && line[0] !== " " && line[0] !== "\t";
    if (startsAtCol0 && DECL_RE.test(line) && current.join("\n").trim().length >= MIN_CHUNK_CHARS) {
      blocks.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  const last = current.join("\n").trim();
  if (last.length >= MIN_CHUNK_CHARS) blocks.push(last);

  return blocks.length > 1 ? blocks.map((t) => ({ text: t })) : slidingWindow(text);
}

/**
 * Document: split on markdown headings (# / ## / ###) or 3+ consecutive blank lines.
 */
function splitDocumentSections(text: string): RawChunk[] {
  const HEADING_RE = /^#{1,3} .+/;
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    if (HEADING_RE.test(line) && current.join("\n").trim().length >= MIN_CHUNK_CHARS) {
      sections.push(current.join("\n").trim());
      current = [line];
      blankRun = 0;
    } else if (line.trim() === "") {
      blankRun++;
      if (blankRun >= 3 && current.join("\n").trim().length >= MIN_CHUNK_CHARS) {
        sections.push(current.join("\n").trim());
        current = [];
        blankRun = 0;
      } else {
        current.push(line);
      }
    } else {
      blankRun = 0;
      current.push(line);
    }
  }
  const last = current.join("\n").trim();
  if (last.length >= MIN_CHUNK_CHARS) sections.push(last);

  return sections.length > 1 ? sections.map((t) => ({ text: t })) : slidingWindow(text);
}

/**
 * Generic sliding-window chunker: 600-char windows with 100-char overlap.
 * Window boundaries are snapped to the nearest newline when possible so chunks
 * never end mid-sentence or mid-identifier.
 */
function slidingWindow(text: string, windowSize = 600, overlap = 100): RawChunk[] {
  if (text.length <= windowSize) return [{ text }];

  const chunks: RawChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + windowSize, text.length);

    if (end < text.length) {
      const lastNL = text.lastIndexOf("\n", end);
      if (lastNL > start + windowSize * 0.6) end = lastNL + 1;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_CHARS) chunks.push({ text: chunk });

    const next = end - overlap;
    if (next <= start) break; // guard against infinite loop on pathological input
    start = next;
  }

  return chunks;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Persist a captured context snapshot, splitting it into semantically coherent
 * sub-chunks based on content_type before storing.
 *
 * Dedup contract: the Rust-generated content_hash covers the original full text.
 * If that hash exists in the last 5 minutes, the entire capture (and all its
 * sub-chunks) is skipped — no partial re-inserts.
 *
 * Sub-chunk IDs:
 *   index 0  → canonical firstId, parent_capture_id = NULL, carries original hash
 *   index N  → new UUID, parent_capture_id = firstId, hash = "${original}:N"
 */
export async function saveContextChunk(snapshot: AppContextSnapshot): Promise<void> {
  let conn: Awaited<ReturnType<typeof getDb>>;
  try {
    conn = await getDb();
  } catch (dbErr) {
    console.error("[context-store] getDb() failed — cannot save chunk:", dbErr);
    return;
  }

  const cutoffSecs = snapshot.captured_at - 5 * 60;

  // Dedup on the original full-text hash — if ANY sub-chunk from this capture
  // was stored in the last 5 minutes, skip the whole capture.
  try {
    const existing = await conn.select<{ id: string }[]>(
      `SELECT id FROM context_chunks WHERE content_hash = ? AND captured_at > ? LIMIT 1`,
      [snapshot.content_hash, cutoffSecs]
    );
    if (existing.length > 0) return;
  } catch (dedupErr) {
    console.error("[context-store] dedup SELECT failed:", dedupErr);
    // Don't bail — still attempt the insert.
  }

  const subChunks = splitByContentType(snapshot.text_content, snapshot.content_type);
  if (subChunks.length === 0) return;

  const firstId = crypto.randomUUID();
  const rows: { id: string; parentId: string | null; hash: string }[] = subChunks.map((_, i) => ({
    id:       i === 0 ? firstId : crypto.randomUUID(),
    parentId: i === 0 ? null    : firstId,
    hash:     i === 0 ? snapshot.content_hash : `${snapshot.content_hash}:${i}`,
  }));

  // Use sequential single-row inserts — reliable across all SQLite/tauri-plugin-sql
  // versions, avoids multi-row VALUES syntax that can exceed parameter limits.
  let savedCount = 0;
  for (let i = 0; i < subChunks.length; i++) {
    try {
      const result = await conn.execute(
        `INSERT OR REPLACE INTO context_chunks
           (id, app_name, window_title, content_type, text_content, content_hash,
            captured_at, url, parent_capture_id, chunk_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rows[i].id,
          snapshot.app_name,
          snapshot.window_title,
          snapshot.content_type,
          subChunks[i].text,
          rows[i].hash,
          snapshot.captured_at,
          snapshot.url ?? null,
          rows[i].parentId,
          i,
        ],
      );
      // Log rowsAffected so we can confirm whether SQLite actually wrote the row.
      // In tauri-plugin-sql v2 the field is camelCase: result.rowsAffected.
      const affected = (result as unknown as { rowsAffected?: number }).rowsAffected ?? -1;
      if (affected === 0) {
        console.warn(`[context-store] INSERT chunk ${i} returned rowsAffected=0 — possible write failure.`);
      }
      savedCount++;
    } catch (insertErr) {
      console.error(`[context-store] INSERT failed for chunk ${i}:`, insertErr);
      // Continue trying remaining chunks — partial saves are better than none.
    }
  }

  console.debug(`[context-store] Saved ${savedCount}/${subChunks.length} chunks for: ${snapshot.app_name} — ${snapshot.window_title}`);

  // Verify the first chunk actually landed in the DB — confirms SQLite writes are
  // persisting and not being silently rolled back.  A failed SELECT here (or an
  // empty result) means the DB file is read-only or the connection is broken.
  if (savedCount > 0) {
    try {
      const verify = await conn.select<{ id: string }[]>(
        `SELECT id FROM context_chunks WHERE id = ? LIMIT 1`,
        [firstId]
      );
      if (verify.length === 0) {
        console.error(
          `[context-store] VERIFY FAILED — row ${firstId} not found after INSERT.`,
          "This means writes are not persisting. Possible causes: read-only DB file,",
          "connection pool routing to a different file, or SQLite WAL not checkpointing."
        );
      } else {
        console.debug(`[context-store] VERIFY OK — row ${firstId} confirmed in DB.`);
      }
    } catch (verifyErr) {
      console.error("[context-store] verify SELECT failed:", verifyErr);
    }
  }

  // Notify ALL webview windows that new chunks are committed to the DB.
  // CRITICAL: window.dispatchEvent() only fires within the SAME WebView window.
  // Since saveContextChunk() runs in the 'main' pill-bar window but the Context
  // Memory and Dashboard pages live in the 'dashboard' window, a DOM CustomEvent
  // is invisible across WebView boundaries.  Tauri's emit() routes through the
  // Rust event bus and is delivered to ALL windows, making it the correct IPC.
  try {
    await emit("context-chunks-saved");
  } catch (emitErr) {
    // Non-fatal — UI will catch up on its periodic 30 s refresh.
    console.warn("[context-store] emit context-chunks-saved failed:", emitErr);
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the most recent context chunks captured within the last `withinMinutes`.
 * Returns at most `limit` rows ordered newest-first.
 * Each row is a sub-chunk — callers can group by parent_capture_id if needed.
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
