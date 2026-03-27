import Database from "@tauri-apps/plugin-sql";
import type { SystemPrompt } from "@/types/system-prompts";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:ai_assistant.db");
  }
  return db;
}

/**
 * Initialize system prompts table.
 */
export async function initSystemPromptsTable(): Promise<void> {
  const conn = await getDb();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_system_prompts_name ON system_prompts(name)`
  );
}

export async function createSystemPrompt(
  name: string,
  prompt: string
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "INSERT INTO system_prompts (name, prompt) VALUES ($1, $2)",
    [name, prompt]
  );
}

export async function getAllSystemPrompts(): Promise<SystemPrompt[]> {
  const conn = await getDb();
  const rows = await conn.select<
    {
      id: number;
      name: string;
      prompt: string;
      created_at: string;
      updated_at: string;
    }[]
  >("SELECT * FROM system_prompts ORDER BY updated_at DESC");

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function updateSystemPrompt(
  id: number,
  name: string,
  prompt: string
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE system_prompts SET name = $1, prompt = $2, updated_at = datetime('now') WHERE id = $3",
    [name, prompt, id]
  );
}

export async function deleteSystemPrompt(id: number): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM system_prompts WHERE id = $1", [id]);
}
