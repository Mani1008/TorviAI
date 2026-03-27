-- System Prompts Table
CREATE TABLE IF NOT EXISTS system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_prompts_name ON system_prompts(name);

-- Auto-update updated_at on changes
CREATE TRIGGER IF NOT EXISTS trg_system_prompts_updated_at
    AFTER UPDATE ON system_prompts
    FOR EACH ROW
BEGIN
    UPDATE system_prompts SET updated_at = datetime('now') WHERE id = OLD.id;
END;
