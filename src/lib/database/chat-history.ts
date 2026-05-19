import Database from "@tauri-apps/plugin-sql";
import type { ChatConversation, ChatMessage } from "@/types/completion";
import { deleteRemoteConversation, deleteAllRemoteConversations } from "@/lib/appwrite";
import { loadUserProfile } from "@/lib/storage/auth";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:ai_assistant.db");
  }
  return db;
}

/**
 * Initialize the database: create tables and indexes.
 * Called once at app startup.
 */
export async function initDatabase(): Promise<void> {
  const conn = await getDb();

  // Conversations table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)`
  );

  // Messages table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      attached_files TEXT
    )
  `);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp ON messages(conversation_id, timestamp)`
  );

  // Screenshots table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
      image_data TEXT NOT NULL,
      prompt TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      conversation_id TEXT
    )
  `);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at DESC)`
  );
}

export async function createConversation(
  id: string,
  title: string
): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  await conn.execute(
    "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    [id, title, now, now]
  );
}

export async function getConversationById(
  id: string
): Promise<ChatConversation | null> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; title: string; created_at: number; updated_at: number }[]
  >("SELECT * FROM conversations WHERE id = $1", [id]);

  if (rows.length === 0) return null;

  const row = rows[0];
  const messages = await getMessagesByConversation(id);

  return {
    id: row.id,
    title: row.title,
    messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllConversations(): Promise<ChatConversation[]> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; title: string; created_at: number; updated_at: number }[]
  >("SELECT * FROM conversations ORDER BY updated_at DESC");

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messages: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getConversationsPaged(
  limit: number,
  offset: number
): Promise<ChatConversation[]> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; title: string; created_at: number; updated_at: number }[]
  >("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT $1 OFFSET $2", [limit, offset]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messages: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function searchConversations(
  query: string,
  limit: number,
  offset: number
): Promise<ChatConversation[]> {
  const conn = await getDb();
  const rows = await conn.select<
    { id: string; title: string; created_at: number; updated_at: number }[]
  >(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE title LIKE $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
    [`%${query}%`, limit, offset]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messages: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function updateConversation(
  id: string,
  title: string
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3",
    [title, Date.now(), id]
  );
}

export async function deleteConversation(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM messages WHERE conversation_id = $1", [id]);
  await conn.execute("DELETE FROM conversations WHERE id = $1", [id]);
  deleteRemoteConversation(id).catch(console.warn);
}

export async function deleteAllConversations(): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM messages");
  await conn.execute("DELETE FROM conversations");
  const profile = loadUserProfile();
  if (profile?.id) {
    deleteAllRemoteConversations(profile.id).catch(console.warn);
  }
}

export async function addMessage(
  conversationId: string,
  message: ChatMessage
): Promise<void> {
  const conn = await getDb();
  const attachedFiles = message.attachedFiles
    ? JSON.stringify(message.attachedFiles)
    : null;
  await conn.execute(
    "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, timestamp, attached_files) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      message.id,
      conversationId,
      message.role,
      message.content,
      message.timestamp,
      attachedFiles,
    ]
  );
}

export async function getMessagesByConversation(
  conversationId: string
): Promise<ChatMessage[]> {
  const conn = await getDb();
  const rows = await conn.select<
    {
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      timestamp: number;
      attached_files: string | null;
    }[]
  >(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC",
    [conversationId]
  );

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    attachedFiles: row.attached_files ? JSON.parse(row.attached_files) : undefined,
  }));
}

export async function getTotalConversationCount(): Promise<number> {
  const conn = await getDb();
  const rows = await conn.select<[{ count: number }]>(
    "SELECT COUNT(*) as count FROM conversations"
  );
  return rows[0]?.count ?? 0;
}

export async function getTodayMessageCount(): Promise<number> {
  const conn = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await conn.select<[{ count: number }]>(
    "SELECT COUNT(*) as count FROM messages WHERE timestamp >= $1",
    [startOfDay.getTime()]
  );
  return rows[0]?.count ?? 0;
}

export async function getTotalMessageCount(): Promise<number> {
  const conn = await getDb();
  const rows = await conn.select<[{ count: number }]>(
    "SELECT COUNT(*) as count FROM messages"
  );
  return rows[0]?.count ?? 0;
}
