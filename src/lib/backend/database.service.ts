/**
 * Database service — provider-agnostic cloud data sync facade.
 * Delegates to Appwrite Databases or Supabase Postgres based on VITE_BACKEND_PROVIDER.
 */
import {
  syncUserProfile,
  fetchRemoteUsage,
  fetchRemotePlan,
} from "@/lib/appwrite/sync-profiles";
import {
  syncConversation,
  deleteRemoteConversation,
  fetchRemoteConversations,
  deleteAllRemoteConversations,
} from "@/lib/appwrite/sync-conversations";
import {
  syncSystemPrompt,
  deleteRemoteSystemPrompt,
  fetchRemoteSystemPrompts,
} from "@/lib/appwrite/sync-prompts";
import {
  pushSettings as appwritePushSettings,
  fetchRemoteSettings,
} from "@/lib/appwrite/sync-settings";
import { runStartupSync as runAppwriteStartupSync } from "@/lib/appwrite/sync";
import { isSupabaseProvider } from "./config";
import * as supabase from "./providers/supabase";
import type { UserProfile } from "./types";
import type {
  RemoteUsage,
  RemoteConversation,
  ConversationSyncInput,
  SystemPromptSyncInput,
  RemoteSystemPrompt,
  RemoteSettings,
  MemoryItem,
  MemorySource,
  CreateMemoryItemInput,
  UpdateMemoryItemInput,
  CreateMemorySourceInput,
} from "./types";

export async function runStartupSync(): Promise<void> {
  if (isSupabaseProvider()) {
    return supabase.runSupabaseStartupSync();
  }
  return runAppwriteStartupSync();
}

export async function syncUserProfileRemote(profile: UserProfile): Promise<void> {
  if (isSupabaseProvider()) {
    return supabase.upsertProfile(profile);
  }
  return syncUserProfile(profile);
}

export async function fetchUsage(userId: string): Promise<RemoteUsage | null> {
  if (isSupabaseProvider()) {
    return supabase.fetchUsage(userId);
  }
  return fetchRemoteUsage(userId);
}

export async function fetchPlan(userId: string): Promise<string | null> {
  if (isSupabaseProvider()) {
    return supabase.fetchPlan(userId);
  }
  return fetchRemotePlan(userId);
}

export async function syncConversationRemote(
  userId: string,
  conv: ConversationSyncInput
): Promise<void> {
  if (isSupabaseProvider()) return;
  return syncConversation(userId, conv);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  if (isSupabaseProvider()) return;
  return deleteRemoteConversation(conversationId);
}

export async function fetchConversations(userId: string): Promise<RemoteConversation[]> {
  if (isSupabaseProvider()) return [];
  return fetchRemoteConversations(userId);
}

export async function deleteAllConversations(userId: string): Promise<void> {
  if (isSupabaseProvider()) return;
  return deleteAllRemoteConversations(userId);
}

export async function syncSystemPromptRemote(
  userId: string,
  prompt: SystemPromptSyncInput
): Promise<void> {
  if (isSupabaseProvider()) return;
  return syncSystemPrompt(userId, prompt);
}

export async function deleteSystemPrompt(userId: string, promptId: number): Promise<void> {
  if (isSupabaseProvider()) return;
  return deleteRemoteSystemPrompt(userId, promptId);
}

export async function fetchSystemPrompts(userId: string): Promise<RemoteSystemPrompt[]> {
  if (isSupabaseProvider()) return [];
  return fetchRemoteSystemPrompts(userId);
}

export async function pushUserSettings(userId: string): Promise<void> {
  if (isSupabaseProvider()) {
    return supabase.pushSettings(userId);
  }
  return appwritePushSettings(userId);
}

export async function fetchUserSettings(userId: string): Promise<RemoteSettings | null> {
  if (isSupabaseProvider()) {
    return supabase.fetchSettings(userId);
  }
  return fetchRemoteSettings(userId);
}

// ─── Memory (Supabase only in v1) ────────────────────────────────────────────

export async function listMemoryItems(
  userId: string,
  options?: { limit?: number; includeDeleted?: boolean }
): Promise<MemoryItem[]> {
  if (!isSupabaseProvider()) return [];
  return supabase.listMemoryItems(userId, options);
}

export async function getMemoryItem(id: string): Promise<MemoryItem | null> {
  if (!isSupabaseProvider()) return null;
  return supabase.getMemoryItem(id);
}

export async function createMemoryItem(
  userId: string,
  input: CreateMemoryItemInput
): Promise<MemoryItem> {
  if (!isSupabaseProvider()) {
    throw new Error("Memory sync requires VITE_BACKEND_PROVIDER=supabase");
  }
  return supabase.createMemoryItem(userId, input);
}

export async function updateMemoryItem(
  id: string,
  input: UpdateMemoryItemInput
): Promise<MemoryItem> {
  if (!isSupabaseProvider()) {
    throw new Error("Memory sync requires VITE_BACKEND_PROVIDER=supabase");
  }
  return supabase.updateMemoryItem(id, input);
}

export async function softDeleteMemoryItem(id: string): Promise<void> {
  if (!isSupabaseProvider()) return;
  return supabase.softDeleteMemoryItem(id);
}

export async function listMemorySources(memoryId: string): Promise<MemorySource[]> {
  if (!isSupabaseProvider()) return [];
  return supabase.listMemorySources(memoryId);
}

export async function createMemorySource(
  userId: string,
  input: CreateMemorySourceInput
): Promise<MemorySource> {
  if (!isSupabaseProvider()) {
    throw new Error("Memory sync requires VITE_BACKEND_PROVIDER=supabase");
  }
  return supabase.createMemorySource(userId, input);
}

export async function deleteMemorySource(id: string): Promise<void> {
  if (!isSupabaseProvider()) return;
  return supabase.deleteMemorySource(id);
}
