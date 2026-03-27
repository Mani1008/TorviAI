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
 * A single chat message stored in the database.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
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
