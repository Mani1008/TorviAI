/**
 * A single part of a multimodal message (text or image).
 */
export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

/**
 * Message payload for API calls.
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * File attached to a chat message.
 */
export interface AttachedFile {
  id: string;
  name: string;
  type: string;
  base64: string;
}

/**
 * A single screen-context source cited for an AI response.
 */
export interface ContextSourceCitation {
  chunkId: string;
  appName: string;
  windowTitle: string;
  contentType: string;
  url: string | null;
  /** Unix timestamp (seconds) when the chunk was captured. */
  capturedAt: number;
  /** Short preview shown in the citation card (truncated chunk text). */
  snippet: string;
}

/**
 * A single chat message stored in the database.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
  /** Screen context chunks injected into this assistant reply (RAG sources). */
  sources?: ContextSourceCitation[];
}

/**
 * A conversation containing multiple messages.
 */
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
