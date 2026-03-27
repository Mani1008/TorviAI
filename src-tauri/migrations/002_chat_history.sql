-- Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    attached_files TEXT  -- JSON array of AttachedFile objects
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp ON messages(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_role ON messages(conversation_id, role);

-- Auto-update conversation.updated_at when a message is inserted
CREATE TRIGGER IF NOT EXISTS trg_messages_insert_update_conversation
    AFTER INSERT ON messages
    FOR EACH ROW
BEGIN
    UPDATE conversations SET updated_at = NEW.timestamp WHERE id = NEW.conversation_id;
END;

-- Auto-update conversation.updated_at when a message is updated
CREATE TRIGGER IF NOT EXISTS trg_messages_update_update_conversation
    AFTER UPDATE ON messages
    FOR EACH ROW
BEGIN
    UPDATE conversations SET updated_at = NEW.timestamp WHERE id = NEW.conversation_id;
END;
