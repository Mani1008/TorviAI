import type { UserProfile } from "@/types/settings";

/** Provider-agnostic authenticated user (maps Appwrite $id → id). */
export interface BackendUser {
  id: string;
  name: string;
  email: string;
}

export interface RemoteUsage {
  aiResponsesUsed: number;
  listeningSecondsUsed: number;
}

export interface RemoteConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSyncInput {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface SystemPromptSyncInput {
  id: number;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteSystemPrompt {
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteSettings {
  selectedModel: string;
  responseLength: string;
  language: string;
  systemPrompt: string;
}

export interface ScreenshotSyncPayload {
  id: string;
  imageData: string;
  prompt: string;
  capturedAt: number;
}

export type MemoryCreatedBy = "user" | "ai" | "import" | "connector";

export type MemorySourceKind =
  | "local_chunk"
  | "screen_capture"
  | "screenshot"
  | "chat_excerpt"
  | "meeting"
  | "browser_tab"
  | "connector"
  | "manual";

export interface MemoryItem {
  id: string;
  userId: string;
  title: string;
  tags: string[];
  content: string;
  summary: string | null;
  knowledgeType: string;
  domain: string;
  importance: number;
  createdBy: MemoryCreatedBy;
  contentHash: string | null;
  confirmedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MemorySource {
  id: string;
  memoryId: string;
  userId: string;
  sourceKind: MemorySourceKind;
  sourceRef: string | null;
  connector: string | null;
  connectorRef: string | null;
  appName: string | null;
  windowTitle: string | null;
  contentType: string | null;
  url: string | null;
  capturedAt: string | null;
  excerpt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateMemoryItemInput {
  title?: string;
  tags?: string[];
  content: string;
  summary?: string | null;
  knowledgeType?: string;
  domain?: string;
  importance?: number;
  createdBy?: MemoryCreatedBy;
  contentHash?: string | null;
  confirmedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryItemInput {
  title?: string;
  tags?: string[];
  content?: string;
  summary?: string | null;
  knowledgeType?: string;
  domain?: string;
  importance?: number;
  createdBy?: MemoryCreatedBy;
  contentHash?: string | null;
  confirmedAt?: string | null;
  metadata?: Record<string, unknown>;
  deletedAt?: string | null;
}

export interface CreateMemorySourceInput {
  memoryId: string;
  sourceKind: MemorySourceKind;
  sourceRef?: string | null;
  connector?: string | null;
  connectorRef?: string | null;
  appName?: string | null;
  windowTitle?: string | null;
  contentType?: string | null;
  url?: string | null;
  capturedAt?: string | null;
  excerpt?: string | null;
  metadata?: Record<string, unknown>;
}

export type { UserProfile };
