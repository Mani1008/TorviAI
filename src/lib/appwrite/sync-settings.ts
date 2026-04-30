import { databases, DATABASE_ID, COLLECTION_IDS, isAppwriteConfigured } from "./client";
import { loadResponseSettings } from "@/lib/storage/response-settings.storage";
import { loadSelectedModel } from "@/lib/storage/ai-providers";
import { STORAGE_KEYS, DEFAULT_SYSTEM_PROMPT } from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage/helper";

interface RemoteSettings {
  selectedModel: string;
  responseLength: string;
  language: string;
  systemPrompt: string;
}

/**
 * Push current local settings to Appwrite user_settings collection.
 * Uses userId as the document ID (1:1 relationship).
 */
export async function pushSettings(userId: string): Promise<void> {
  if (!isAppwriteConfigured()) return;

  const resp = loadResponseSettings();
  const model = loadSelectedModel();
  const rawPrompt = safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) ?? DEFAULT_SYSTEM_PROMPT;

  // Enforce a maximum size before syncing — system prompts may contain sensitive
  // instructions or context that should not be pushed to cloud unbounded.
  const MAX_PROMPT_BYTES = 10_000;
  const sysPrompt = typeof rawPrompt === "string" ? rawPrompt : JSON.stringify(rawPrompt);
  if (sysPrompt.length > MAX_PROMPT_BYTES) {
    console.warn("[Sync] System prompt exceeds 10 000 chars — skipping cloud sync for privacy.");
    return;
  }

  const data: Record<string, string> = {
    selectedModel: model,
    responseLength: resp.length,
    language: resp.language,
    systemPrompt: sysPrompt,
  };

  try {
    await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_SETTINGS, userId);
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.USER_SETTINGS, userId, data);
  } catch {
    await databases.createDocument(DATABASE_ID, COLLECTION_IDS.USER_SETTINGS, userId, data);
  }
}

/**
 * Fetch settings from Appwrite.
 */
export async function fetchRemoteSettings(userId: string): Promise<RemoteSettings | null> {
  if (!isAppwriteConfigured()) return null;
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_SETTINGS, userId);
    return {
      selectedModel: doc.selectedModel ?? "openrouter/auto",
      responseLength: doc.responseLength ?? "auto",
      language: doc.language ?? "English",
      systemPrompt: doc.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    };
  } catch {
    return null;
  }
}
