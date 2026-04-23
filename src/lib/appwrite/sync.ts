import { isAppwriteConfigured } from "./client";
import { getActiveSession } from "./auth";
import { fetchRemoteUsage, fetchRemotePlan } from "./sync-profiles";
import { fetchRemoteConversations, syncConversation } from "./sync-conversations";
import { pushSettings } from "./sync-settings";
import { loadUserProfile, saveUserProfile } from "@/lib/storage/auth";
import { loadUsageStats } from "@/lib/storage/usage-stats";
import { getAllConversations } from "@/lib/database/chat-history";

/**
 * Full sync: runs on app startup after auth succeeds.
 * Pulls remote data to reconcile with local, then pushes local data.
 */
export async function runStartupSync(): Promise<void> {
  if (!isAppwriteConfigured()) return;

  const user = await getActiveSession();
  if (!user) return;

  const userId = user.$id;
  console.log("[Sync] Starting startup sync for", userId);

  // 1. Sync plan from Appwrite (authoritative)
  try {
    const remotePlan = await fetchRemotePlan(userId);
    if (remotePlan) {
      const local = loadUserProfile();
      if (local && local.plan !== remotePlan) {
        local.plan = remotePlan as typeof local.plan;
        saveUserProfile(local);
        console.log("[Sync] Plan updated from remote:", remotePlan);
      }
    }
  } catch (e) {
    console.warn("[Sync] Plan sync failed:", e);
  }

  // 2. Sync usage limits from Appwrite
  try {
    const remoteUsage = await fetchRemoteUsage(userId);
    if (remoteUsage) {
      // Update local stats to reflect server-side remaining
      loadUsageStats();
      // We keep local granular stats but log sync
      console.log("[Sync] Remote usage — AI remaining:", remoteUsage.aiResponsesRemaining, "Listening remaining:", remoteUsage.listeningMinutesRemaining, "min");
    }
  } catch (e) {
    console.warn("[Sync] Usage sync failed:", e);
  }

  // 3. Push local conversations to Appwrite
  try {
    const localConvs = await getAllConversations();
    const remoteConvs = await fetchRemoteConversations(userId);
    const remoteIds = new Set(remoteConvs.map((c) => c.id));

    // Push conversations that are local-only
    for (const conv of localConvs) {
      if (!remoteIds.has(conv.id)) {
        await syncConversation(userId, {
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      }
    }
    console.log("[Sync] Conversations synced:", localConvs.length, "local,", remoteConvs.length, "remote");
  } catch (e) {
    console.warn("[Sync] Conversation sync failed:", e);
  }

  // 4. Push settings to Appwrite
  try {
    await pushSettings(userId);
    console.log("[Sync] Settings pushed");
  } catch (e) {
    console.warn("[Sync] Settings sync failed:", e);
  }

  console.log("[Sync] Startup sync complete");
}
