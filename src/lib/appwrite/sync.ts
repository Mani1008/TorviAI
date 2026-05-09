import { client, isAppwriteConfigured } from "./client";
import { invoke } from "@tauri-apps/api/core";
import { getActiveSession } from "./auth";
import { fetchRemoteUsage, fetchRemotePlan } from "./sync-profiles";
import { fetchRemoteConversations, syncConversation } from "./sync-conversations";
import { pushSettings, fetchRemoteSettings } from "./sync-settings";
import { loadUserProfile, saveUserProfile } from "@/lib/storage/auth";
import { loadUsageStats, saveUsageStats } from "@/lib/storage/usage-stats";
import { getAllConversations } from "@/lib/database/chat-history";
import { STORAGE_KEYS, DEFAULT_SYSTEM_PROMPT } from "@/config/constants";
import { loadResponseSettings } from "@/lib/storage/response-settings.storage";
import { saveSelectedModel } from "@/lib/storage/ai-providers";
import { safeLocalStorage } from "@/lib/storage/helper";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run an async operation with exponential backoff retry.
 * Attempts: maxRetries+1 total. Delays: baseMs, 2×baseMs, 4×baseMs, …
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

/**
 * Run an array of async tasks with a maximum concurrency limit.
 */
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];
  for (const task of tasks) {
    const p = task().then((r) => { results.push(r); });
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove settled promises
      for (let i = executing.length - 1; i >= 0; i--) {
        await executing[i].then(() => executing.splice(i, 1)).catch(() => executing.splice(i, 1));
      }
    }
  }
  await Promise.allSettled(executing);
  return results;
}

/** 30-day lookback cutoff (ms since epoch) */
const SYNC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Full sync: runs on app startup after auth succeeds.
 * Pulls remote data to reconcile with local, then pushes local data.
 */
export async function runStartupSync(): Promise<void> {
  // Ping Appwrite to verify backend connectivity on every app launch.
  // Fires regardless of auth state — logs success/failure for diagnostics.
  client.ping().then(() => {
    console.log("[Appwrite] Ping OK — backend reachable at", import.meta.env.VITE_APPWRITE_ENDPOINT);
  }).catch((e: unknown) => {
    console.warn("[Appwrite] Ping failed — check endpoint/project config:", e);
  });

  if (!isAppwriteConfigured()) return;

  const user = await getActiveSession();
  if (!user) return;

  const userId = user.$id;
  console.log("[Sync] Starting startup sync for", userId);

  // 1. Sync plan from Appwrite (authoritative)
  try {
    const remotePlan = await fetchRemotePlan(userId);
    if (remotePlan) {
      // Normalize Appwrite's "free" to our canonical "starter"
      const normalizedPlan = remotePlan === "free" ? "starter" : remotePlan;
      const local = loadUserProfile();
      if (local && local.plan !== normalizedPlan) {
        local.plan = normalizedPlan as typeof local.plan;
        saveUserProfile(local);
        console.log("[Sync] Plan updated from remote:", normalizedPlan);
      }
    }
  } catch (e) {
    console.warn("[Sync] Plan sync failed:", e);
  }

  // 2. Sync usage — bidirectional reconciliation.
  // Appwrite stores *used* counts (0 → N). Local stats also count upward.
  // Ratchet: always take the higher used count between local and remote so
  // neither side can "forget" usage that was recorded elsewhere.
  try {
    const remoteUsage = await fetchRemoteUsage(userId);
    if (remoteUsage) {
      const stats = loadUsageStats();

      // Take the max of local and remote — never discard usage recorded on either side
      const syncedAi = Math.max(stats.aiResponses, remoteUsage.aiResponsesUsed);
      const syncedListening = Math.max(stats.listeningSeconds, remoteUsage.listeningSecondsUsed);

      // If local is ahead of remote, push via Rust (API key) so Appwrite catches up.
      // Users cannot forge increments by calling this directly — Rust validates the ratchet.
      if (syncedAi > remoteUsage.aiResponsesUsed || syncedListening > remoteUsage.listeningSecondsUsed) {
        invoke("push_local_usage", {
          userId,
          aiUsed: syncedAi,
          listeningUsed: syncedListening,
        }).catch((e: unknown) => console.warn("[Sync] push_local_usage failed:", e));
      }

      stats.aiResponses = syncedAi;
      stats.listeningSeconds = syncedListening;
      saveUsageStats(stats);
      console.log("[Sync] Usage reconciled — AI used:", stats.aiResponses, "/ listening:", Math.round(stats.listeningSeconds / 60), "min");
    }
  } catch (e) {
    console.warn("[Sync] Usage sync failed:", e);
  }

  // 3. Push local conversations to Appwrite (30-day lookback, max 5 concurrent, with retry)
  try {
    const cutoff = Date.now() - SYNC_LOOKBACK_MS;
    const localConvs = await getAllConversations();
    // Only sync conversations created/updated within the last 30 days
    const recentConvs = localConvs.filter((c) => {
      const ts = new Date(c.updatedAt ?? c.createdAt ?? 0).getTime();
      return ts >= cutoff;
    });

    const remoteConvs = await fetchRemoteConversations(userId);
    const remoteIds = new Set(remoteConvs.map((c) => c.id));

    const toSync = recentConvs.filter((c) => !remoteIds.has(c.id));
    const syncTasks = toSync.map((conv) => () =>
      withRetry(() =>
        syncConversation(userId, {
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        }),
      ),
    );
    await runWithConcurrencyLimit(syncTasks, 5);
    console.log("[Sync] Conversations synced:", localConvs.length, "local,", remoteConvs.length, "remote,", toSync.length, "pushed");
  } catch (e) {
    console.warn("[Sync] Conversation sync failed:", e);
  }

  // 4. Pull remote settings and apply locally (remote is authoritative for cross-device sync).
  // Only overwrite if the remote value is non-empty and differs from local.
  try {
    const remote = await fetchRemoteSettings(userId);
    if (remote) {
      const localResp = loadResponseSettings();
      // Apply response settings if they differ
      if (remote.responseLength && remote.responseLength !== localResp.length) {
        safeLocalStorage.setItem(STORAGE_KEYS.RESPONSE_SETTINGS, JSON.stringify({
          ...localResp,
          length: remote.responseLength,
          language: remote.language || localResp.language,
        }));
      }
      // Apply selected model if non-empty
      if (remote.selectedModel) {
        saveSelectedModel(remote.selectedModel);
      }
      // Apply system prompt if non-empty and not the default
      if (remote.systemPrompt && remote.systemPrompt !== DEFAULT_SYSTEM_PROMPT) {
        safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, remote.systemPrompt);
      }
      console.log("[Sync] Remote settings applied");
    }
  } catch (e) {
    console.warn("[Sync] Settings pull failed:", e);
  }

  // 5. Push local settings to Appwrite (keeps remote up to date with latest local changes)
  try {
    await pushSettings(userId);
    console.log("[Sync] Settings pushed");
  } catch (e) {
    console.warn("[Sync] Settings push failed:", e);
  }

  console.log("[Sync] Startup sync complete");
}
