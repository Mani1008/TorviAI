import { getCurrentUser } from "./auth";
import { fetchPlan, fetchUsage, fetchSettings, pushSettings } from "./database";
import { isSupabaseConfigured } from "./client";
import { loadUserProfile, saveUserProfile } from "@/lib/storage/auth";
import { loadUsageStats, saveUsageStats } from "@/lib/storage/usage-stats";
import { STORAGE_KEYS, DEFAULT_SYSTEM_PROMPT } from "@/config/constants";
import { loadResponseSettings } from "@/lib/storage/response-settings.storage";
import { saveSelectedModel } from "@/lib/storage/ai-providers";
import { DEFAULT_MODEL_ID, OPENROUTER_MODELS } from "@/config/models.constants";
import { safeLocalStorage } from "@/lib/storage/helper";

/**
 * Startup sync for Supabase provider.
 * Pulls plan, usage, settings — conversations/prompts stay local-only in v1.
 */
export async function runSupabaseStartupSync(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const user = await getCurrentUser();
  if (!user) return;

  const userId = user.id;
  console.log("[Supabase Sync] Starting for", userId);

  try {
    const remotePlan = await fetchPlan(userId);
    if (remotePlan) {
      const normalizedPlan = remotePlan === "free" ? "starter" : remotePlan;
      const local = loadUserProfile();
      if (local && local.plan !== normalizedPlan) {
        local.plan = normalizedPlan as typeof local.plan;
        saveUserProfile(local);
        console.log("[Supabase Sync] Plan updated:", normalizedPlan);
      }
    }
  } catch (e) {
    console.warn("[Supabase Sync] Plan sync failed:", e);
  }

  try {
    const remoteUsage = await fetchUsage(userId);
    if (remoteUsage) {
      const stats = loadUsageStats();
      stats.aiResponses = remoteUsage.aiResponsesUsed;
      stats.listeningSeconds = remoteUsage.listeningSecondsUsed;
      saveUsageStats(stats);
      console.log("[Supabase Sync] Usage loaded");
    }
  } catch (e) {
    console.warn("[Supabase Sync] Usage sync failed:", e);
  }

  try {
    const remote = await fetchSettings(userId);
    if (remote) {
      const localResp = loadResponseSettings();
      if (remote.responseLength && remote.responseLength !== localResp.length) {
        safeLocalStorage.setItem(
          STORAGE_KEYS.RESPONSE_SETTINGS,
          JSON.stringify({
            ...localResp,
            length: remote.responseLength,
            language: remote.language || localResp.language,
          })
        );
      }
      // Only apply known, non-deprecated model IDs — ignore legacy DB defaults
      const deprecatedModels = new Set(["meta-llama/llama-4-maverick:free"]);
      const knownModels = new Set(OPENROUTER_MODELS.map((m) => m.id));
      if (
        remote.selectedModel &&
        knownModels.has(remote.selectedModel) &&
        !deprecatedModels.has(remote.selectedModel)
      ) {
        saveSelectedModel(remote.selectedModel);
      } else if (deprecatedModels.has(remote.selectedModel ?? "")) {
        saveSelectedModel(DEFAULT_MODEL_ID);
      }
      if (remote.systemPrompt && remote.systemPrompt !== DEFAULT_SYSTEM_PROMPT) {
        safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, remote.systemPrompt);
      }
      console.log("[Supabase Sync] Remote settings applied");
    }
  } catch (e) {
    console.warn("[Supabase Sync] Settings pull failed:", e);
  }

  try {
    await pushSettings(userId);
    console.log("[Supabase Sync] Settings pushed");
  } catch (e) {
    console.warn("[Supabase Sync] Settings push failed:", e);
  }

  console.log("[Supabase Sync] Complete");
}
