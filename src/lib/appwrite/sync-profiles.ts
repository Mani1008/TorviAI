import { databases, DATABASE_ID, COLLECTION_IDS, isAppwriteConfigured } from "./client";
import type { UserProfile } from "@/types/settings";
import { PLAN_LIMITS } from "@/config/constants";

/**
 * Upsert the user profile in Appwrite user_profiles collection.
 */
export async function syncUserProfile(profile: UserProfile): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, profile.id);
    // Document exists → update
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, profile.id, {
      name: profile.name,
      email: profile.email,
      plan: profile.plan,
    });
  } catch {
    // Document does not exist → create
    const planKey = (profile.plan === "plus" || profile.plan === "pro") ? profile.plan : "starter";
    const limits = PLAN_LIMITS[planKey];
    await databases.createDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, profile.id, {
      name: profile.name,
      email: profile.email,
      plan: profile.plan,
      listeningMinutesRemaining: limits.listeningSeconds === -1 ? 100000 : Math.floor(limits.listeningSeconds / 60),
      aiResponsesRemaining: limits.aiResponses === -1 ? 100000 : limits.aiResponses,
      isActive: true,
    });
  }
}

/**
 * Fetch the usage limits from Appwrite (server-side source of truth).
 */
export async function fetchRemoteUsage(userId: string): Promise<{ aiResponsesRemaining: number; listeningMinutesRemaining: number } | null> {
  if (!isAppwriteConfigured()) return null;
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, userId);
    return {
      aiResponsesRemaining: doc.aiResponsesRemaining ?? 0,
      listeningMinutesRemaining: doc.listeningMinutesRemaining ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Decrement AI response count in Appwrite.
 * Returns the new remaining count.
 *
 * NOTE (HIGH-03): This is a read-then-write operation and is NOT atomic.
 * Two concurrent calls can both read the same value and both decrement from it,
 * effectively "double-spending" one usage unit. Proper enforcement requires an
 * Appwrite serverless Function that performs an atomic decrement server-side.
 * Until that is implemented, this call serves as a best-effort sync only;
 * the authoritative rate limit enforcement must happen server-side.
 */
export async function decrementAiResponses(userId: string): Promise<number> {
  if (!isAppwriteConfigured()) return -1;
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, userId);
    const current = doc.aiResponsesRemaining ?? 0;
    const next = Math.max(0, current - 1);
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, userId, {
      aiResponsesRemaining: next,
    });
    return next;
  } catch (e) {
    console.warn("[Appwrite] Failed to decrement AI responses:", e);
    return -1;
  }
}

/**
 * Decrement listening minutes in Appwrite.
 */
export async function decrementListeningMinutes(userId: string, minutes: number): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, userId);
    const current = doc.listeningMinutesRemaining ?? 0;
    const next = Math.max(0, current - minutes);
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, userId, {
      listeningMinutesRemaining: next,
    });
  } catch (e) {
    console.warn("[Appwrite] Failed to decrement listening minutes:", e);
  }
}

/**
 * Fetch the plan from Appwrite (authoritative source).
 */
export async function fetchRemotePlan(userId: string): Promise<string | null> {
  if (!isAppwriteConfigured()) return null;
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, userId);
    return doc.plan ?? null;
  } catch {
    return null;
  }
}
