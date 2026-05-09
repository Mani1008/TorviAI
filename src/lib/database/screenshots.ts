import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:ai_assistant.db");
  }
  return db;
}

export interface ScreenshotRecord {
  id: string;
  imageData: string;
  prompt: string;
  capturedAt: number;
  conversationId: string | null;
}

export async function saveScreenshot(record: ScreenshotRecord): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO screenshots (id, image_data, prompt, captured_at, conversation_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [record.id, record.imageData, record.prompt, record.capturedAt, record.conversationId ?? null]
  );
}

export async function getAllScreenshots(): Promise<Omit<ScreenshotRecord, "imageData">[]> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; prompt: string; captured_at: number; conversation_id: string | null }[]
  >(
    `SELECT id, prompt, captured_at, conversation_id
     FROM screenshots ORDER BY captured_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    capturedAt: r.captured_at,
    conversationId: r.conversation_id,
  }));
}

export async function getScreenshotById(id: string): Promise<ScreenshotRecord | null> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; image_data: string; prompt: string; captured_at: number; conversation_id: string | null }[]
  >("SELECT * FROM screenshots WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, imageData: r.image_data, prompt: r.prompt, capturedAt: r.captured_at, conversationId: r.conversation_id };
}

export async function deleteScreenshot(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM screenshots WHERE id = $1", [id]);
}

export async function getRecentScreenshots(limit = 20): Promise<Omit<ScreenshotRecord, "imageData">[]> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; prompt: string; captured_at: number; conversation_id: string | null }[]
  >(
    `SELECT id, prompt, captured_at, conversation_id
     FROM screenshots ORDER BY captured_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    capturedAt: r.captured_at,
    conversationId: r.conversation_id,
  }));
}
