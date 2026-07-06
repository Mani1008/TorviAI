export {
  getSupabaseClient,
  isSupabaseConfigured,
  pingSupabase,
} from "./client";

export {
  getCurrentUser,
  signInWithGoogle,
  exchangeOAuthCode,
  setSessionFromTokens,
  signOut,
  resolveUserProfile,
} from "./auth";

export {
  fetchProfile,
  upsertProfile,
  fetchPlan,
  fetchUsage,
  fetchSettings,
  pushSettings,
  listMemoryItems,
  getMemoryItem,
  createMemoryItem,
  updateMemoryItem,
  softDeleteMemoryItem,
  hardDeleteMemoryItem,
  listMemorySources,
  createMemorySource,
  deleteMemorySource,
} from "./database";

export { runSupabaseStartupSync } from "./sync";
