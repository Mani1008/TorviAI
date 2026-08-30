//! Direct SQLite writer for context chunks.
//!
//! Bypasses the `tauri-plugin-sql` JavaScript IPC path, which has been found to
//! silently fail on INSERT OR REPLACE (execute() resolves with rowsAffected=0 and
//! no error, but SQLite reports rows_affected=0 — meaning no rows are written).
//! By using sqlx directly in Rust, we eliminate the JS→IPC→Rust→SQLite boundary
//! that was dropping every write.
//!
//! The pool is owned by the watcher loop (initialized once on watcher start) and
//! shares the same physical DB file as tauri-plugin-sql.  WAL journal mode is set
//! so both pools can coexist without blocking each other.

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::app_context::AppContextSnapshot;

// ─── Pool wrapper ─────────────────────────────────────────────────────────────

pub struct ContextDb {
    pool: SqlitePool,
}

impl ContextDb {
    /// Open (or create) the `ai_assistant.db` file in the app data directory.
    /// Uses WAL journal mode so this pool can coexist with tauri-plugin-sql's
    /// own pool that serves the JavaScript read queries.
    pub async fn open(app: &AppHandle) -> Result<Self, String> {
        let db_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app_data_dir: {e}"))?;

        std::fs::create_dir_all(&db_dir)
            .map_err(|e| format!("create_dir_all: {e}"))?;

        let db_path = db_dir.join("ai_assistant.db");
        let url = format!("sqlite:{}", db_path.display());

        let opts = SqliteConnectOptions::from_str(&url)
            .map_err(|e| format!("SqliteConnectOptions: {e}"))?
            .create_if_missing(true)
            // WAL lets the JS-side tauri-plugin-sql pool read concurrently while we write.
            .journal_mode(SqliteJournalMode::Wal)
            // Wait up to 5 s if another connection has a write lock.
            .busy_timeout(std::time::Duration::from_secs(5));

        // Single-writer pool — SQLite only allows one writer at a time anyway.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .map_err(|e| format!("Pool::connect: {e}"))?;

        // Ensure the context_chunks table exists (idempotent — handles first-run
        // and the case where tauri-plugin-sql hasn't run its init yet).
        Self::ensure_schema(&pool).await?;

        log::info!("[ContextDB] Pool opened → {}", db_path.display());
        Ok(Self { pool })
    }

    async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS context_chunks (
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
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("CREATE TABLE context_chunks: {e}"))?;

        // Schema migrations for databases created before parent_capture_id /
        // chunk_index were added.  SQLite has no ADD COLUMN IF NOT EXISTS, so we
        // attempt each ALTER and ignore the "duplicate column name" error.
        for sql in &[
            "ALTER TABLE context_chunks ADD COLUMN parent_capture_id TEXT",
            "ALTER TABLE context_chunks ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0",
        ] {
            sqlx::query(sql).execute(pool).await.ok(); // ignore duplicate-column errors
        }

        // Indexes — must come AFTER migrations so idx_ctx_parent can reference
        // the parent_capture_id column that may have just been added.
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_ctx_captured_at \
             ON context_chunks(captured_at DESC)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_ctx_hash ON context_chunks(content_hash)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_ctx_app ON context_chunks(app_name)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_ctx_app_time \
             ON context_chunks(app_name, captured_at DESC)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_ctx_parent \
             ON context_chunks(parent_capture_id)",
        )
        .execute(pool)
        .await
        .ok();

        // ── Integrations (OAuth provider tokens — local-only, DPAPI blobs) ────
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS integrations (
                id               TEXT    PRIMARY KEY,
                provider         TEXT    NOT NULL,
                account_email    TEXT,
                scopes           TEXT    NOT NULL,
                access_token     BLOB    NOT NULL,
                refresh_token    BLOB,
                token_expires_at INTEGER,
                status           TEXT    NOT NULL DEFAULT 'connected',
                connected_at     INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("CREATE TABLE integrations: {e}"))?;

        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_provider \
             ON integrations(provider)",
        )
        .execute(pool)
        .await
        .ok();

        // ── Company Brain: structured knowledge (policies / processes / skills) ─
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS knowledge_entities (
                id                 TEXT    PRIMARY KEY,
                kind               TEXT    NOT NULL,
                title              TEXT    NOT NULL,
                body               TEXT    NOT NULL,
                status             TEXT    NOT NULL DEFAULT 'draft',
                version            INTEGER NOT NULL DEFAULT 1,
                created_at         INTEGER NOT NULL,
                updated_at         INTEGER NOT NULL,
                last_confirmed_at  INTEGER
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("CREATE TABLE knowledge_entities: {e}"))?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_entities_status \
             ON knowledge_entities(status)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS skills (
                id          TEXT    PRIMARY KEY,
                slug        TEXT    NOT NULL,
                title       TEXT    NOT NULL,
                yaml_body   TEXT    NOT NULL,
                status      TEXT    NOT NULL DEFAULT 'draft',
                version     INTEGER NOT NULL DEFAULT 1,
                entity_id   TEXT,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                last_confirmed_at INTEGER
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("CREATE TABLE skills: {e}"))?;

        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS knowledge_sources (
                id                  TEXT PRIMARY KEY,
                target_kind         TEXT NOT NULL,
                target_id           TEXT NOT NULL,
                source_type         TEXT NOT NULL,
                ref_id              TEXT NOT NULL,
                snippet             TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("CREATE TABLE knowledge_sources: {e}"))?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_sources_target \
             ON knowledge_sources(target_kind, target_id)",
        )
        .execute(pool)
        .await
        .ok();

        // Sync metadata for connector ingest (Gmail, …)
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS ingest_sync_state (
                provider       TEXT PRIMARY KEY,
                last_sync_at   INTEGER,
                last_status    TEXT NOT NULL DEFAULT 'idle',
                last_error     TEXT,
                items_synced   INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("CREATE TABLE ingest_sync_state: {e}"))?;

        Ok(())
    }

    /// Borrow the underlying pool (integrations token store, etc.).
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    // ─── Write ────────────────────────────────────────────────────────────────

    /// Persist a snapshot to the DB.
    ///
    /// The text is split into overlapping sliding-window chunks (10,000 chars,
    /// 1,000-char overlap) so the BM25 retrieval layer can rank individual passages.
    /// 10,000 chars ≈ 2,500 tokens — enough to capture a complete function or
    /// logical block with its surrounding context without mid-function splits.
    ///
    /// Returns the number of chunks written.  Returns 0 if the capture was
    /// deduplicated (same hash seen in the last 5 minutes).
    pub async fn save_snapshot(&self, snapshot: &AppContextSnapshot) -> usize {
        // ── Dedup ─────────────────────────────────────────────────────────────
        let cutoff = snapshot.captured_at - 300; // 5-minute window
        match sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM context_chunks \
             WHERE content_hash = ? AND captured_at > ?",
        )
        .bind(&snapshot.content_hash)
        .bind(cutoff)
        .fetch_one(&self.pool)
        .await
        {
            Ok(n) if n > 0 => {
                log::debug!(
                    "[ContextDB] Dedup hit (hash {:.8}…) — skipping",
                    &snapshot.content_hash
                );
                return 0;
            }
            Err(e) => {
                log::warn!("[ContextDB] Dedup check failed: {e} — proceeding anyway");
            }
            _ => {}
        }

        // ── Chunking ──────────────────────────────────────────────────────────
        let chunks = sliding_window_chunks(&snapshot.text_content, 10000, 1000);
        if chunks.is_empty() {
            return 0;
        }

        // ── Insert ────────────────────────────────────────────────────────────
        let first_id = Uuid::new_v4().to_string();
        let mut saved = 0usize;

        for (i, chunk_text) in chunks.iter().enumerate() {
            let id = if i == 0 {
                first_id.clone()
            } else {
                Uuid::new_v4().to_string()
            };
            let parent_id: Option<&str> = if i == 0 { None } else { Some(&first_id) };
            let hash = if i == 0 {
                snapshot.content_hash.clone()
            } else {
                format!("{}:{}", snapshot.content_hash, i)
            };

            match sqlx::query(
                "INSERT OR REPLACE INTO context_chunks \
                 (id, app_name, window_title, content_type, text_content, content_hash, \
                  captured_at, url, parent_capture_id, chunk_index) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&snapshot.app_name)
            .bind(&snapshot.window_title)
            .bind(&snapshot.content_type)
            .bind(chunk_text)
            .bind(&hash)
            .bind(snapshot.captured_at)
            .bind(snapshot.url.as_deref())
            .bind(parent_id)
            .bind(i as i32)
            .execute(&self.pool)
            .await
            {
                Ok(r) => {
                    log::debug!(
                        "[ContextDB] Chunk {}/{} rows_affected={}",
                        i + 1,
                        chunks.len(),
                        r.rows_affected()
                    );
                    saved += 1;
                }
                Err(e) => {
                    log::error!("[ContextDB] INSERT chunk {}: {e}", i);
                }
            }
        }

        if saved > 0 {
            log::info!(
                "[ContextDB] Saved {}/{} chunks: {} — {}",
                saved,
                chunks.len(),
                snapshot.app_name,
                snapshot.window_title
            );
        }

        saved
    }

    /// Insert a single context chunk (used by connector ingest). Dedups by hash
    /// within the last 7 days.
    pub async fn insert_chunk(
        &self,
        app_name: &str,
        window_title: &str,
        content_type: &str,
        text_content: &str,
        content_hash: &str,
        captured_at: i64,
        url: Option<&str>,
    ) -> Result<bool, String> {
        let cutoff = captured_at - 7 * 24 * 3600;
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM context_chunks \
             WHERE content_hash = ? AND captured_at > ?",
        )
        .bind(content_hash)
        .bind(cutoff)
        .fetch_one(&self.pool)
        .await
        .unwrap_or(0);

        if exists > 0 {
            return Ok(false);
        }

        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO context_chunks \
             (id, app_name, window_title, content_type, text_content, content_hash, \
              captured_at, url, parent_capture_id, chunk_index) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)",
        )
        .bind(&id)
        .bind(app_name)
        .bind(window_title)
        .bind(content_type)
        .bind(text_content)
        .bind(content_hash)
        .bind(captured_at)
        .bind(url)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("insert_chunk: {e}"))?;

        Ok(true)
    }

    /// Delete every row from `context_chunks`.
    /// Called by the "Delete Data" flow — stops the watcher before this runs.
    pub async fn clear_all(&self) -> Result<(), String> {
        sqlx::query("DELETE FROM context_chunks")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("DELETE context_chunks: {e}"))?;
        log::info!("[ContextDB] All context chunks deleted.");
        Ok(())
    }

    /// Distinct apps seen in captures — process name + a recent window title.
    pub async fn distinct_apps(&self) -> Result<Vec<(String, String)>, String> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT app_name, window_title FROM context_chunks \
             WHERE app_name != '' \
             GROUP BY app_name \
             ORDER BY MAX(captured_at) DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("distinct_apps: {e}"))?;
        Ok(rows)
    }

    /// Distinct website hosts from captured URLs.
    pub async fn distinct_website_hosts(&self) -> Result<Vec<(String, Option<String>)>, String> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT url, window_title FROM context_chunks \
             WHERE url IS NOT NULL AND url != '' \
             ORDER BY captured_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("distinct_website_hosts: {e}"))?;

        let mut hosts: std::collections::HashMap<String, Option<String>> =
            std::collections::HashMap::new();

        for (url, title) in rows {
            let host = extract_host(&url);
            if host.is_empty() {
                continue;
            }
            hosts.entry(host).or_insert_with(|| {
                if title.trim().is_empty() {
                    None
                } else {
                    Some(title)
                }
            });
        }

        let mut websites: Vec<_> = hosts.into_iter().collect();
        websites.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(websites)
    }
}

fn extract_host(url: &str) -> String {
    let mut value = url.trim().to_lowercase();
    if let Some(rest) = value.strip_prefix("https://") {
        value = rest.to_string();
    } else if let Some(rest) = value.strip_prefix("http://") {
        value = rest.to_string();
    }
    if let Some(rest) = value.strip_prefix("www.") {
        value = rest.to_string();
    }
    value
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string()
}

// ─── Chunking helper ──────────────────────────────────────────────────────────

/// Split `text` into overlapping sliding-window chunks.
///
/// `max_chars`  — maximum characters per chunk window  
/// `overlap`    — characters shared between adjacent windows
///
/// Chunks shorter than 20 characters are dropped (UI noise).
fn sliding_window_chunks(text: &str, max_chars: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len();

    if total == 0 {
        return vec![];
    }

    // Fits in a single chunk — no splitting needed.
    if total <= max_chars {
        let s = text.trim().to_string();
        return if s.len() >= 20 { vec![s] } else { vec![] };
    }

    let step = max_chars.saturating_sub(overlap).max(1);
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < total {
        let end = (start + max_chars).min(total);
        let chunk: String = chars[start..end].iter().collect();
        let trimmed = chunk.trim().to_string();
        if trimmed.len() >= 20 {
            chunks.push(trimmed);
        }
        if end >= total {
            break;
        }
        start += step;
    }

    chunks
}
