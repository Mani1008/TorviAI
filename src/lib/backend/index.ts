/**
 * Cloud backend abstraction layer.
 *
 * Application code MUST import from here — never from @/lib/appwrite or
 * providers/supabase directly.
 */

export type {
  BackendUser,
  UserProfile,
  RemoteUsage,
  RemoteConversation,
  ConversationSyncInput,
  SystemPromptSyncInput,
  RemoteSystemPrompt,
  RemoteSettings,
  ScreenshotSyncPayload,
  MemoryItem,
  MemorySource,
  MemoryCreatedBy,
  MemorySourceKind,
  CreateMemoryItemInput,
  UpdateMemoryItemInput,
  CreateMemorySourceInput,
} from "./types";

export type { MemorySyncResult, MemorySyncSkipReason } from "@/lib/memory-sync";

export { getBackendProvider, isSupabaseProvider, isAppwriteProvider } from "./config";
export type { BackendProvider } from "./config";

export {
  isBackendConfigured,
  pingBackend,
  getOAuthUrl,
  createSessionFromOAuth,
  exchangeOAuthCode,
  setSessionFromTokens,
  getActiveSession,
  logout,
  resolveUserProfile,
} from "./auth.service";

export {
  runStartupSync,
  syncUserProfileRemote,
  fetchUsage,
  fetchPlan,
  syncConversationRemote,
  deleteConversation,
  fetchConversations,
  deleteAllConversations,
  syncSystemPromptRemote,
  deleteSystemPrompt,
  fetchSystemPrompts,
  pushUserSettings,
  fetchUserSettings,
  listMemoryItems,
  getMemoryItem,
  createMemoryItem,
  updateMemoryItem,
  softDeleteMemoryItem,
  listMemorySources,
  createMemorySource,
  deleteMemorySource,
  findMemoryByContentHash,
} from "./database.service";

export {
  syncContextChunksToCloud,
  getMemorySyncQueueStatus,
  scheduleMemoryChunkSync,
  loadMemorySyncSettings,
  saveMemorySyncSettings,
  initMemorySyncState,
  decryptFromCloud,
  isEncryptedCloudContent,
} from "@/lib/memory-sync";

export {
  syncScreenshot,
  deleteScreenshot,
} from "./storage.service";
