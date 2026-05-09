import { Permission, Role } from "appwrite";
import { databases, DATABASE_ID, COLLECTION_IDS, isAppwriteConfigured } from "./client";
import type { UserProfile } from "@/types/settings";

/**
 * Upsert the user profile in Appwrite user_profiles collection.
 *
 * NOTE: rate-limit counters (aiResponsesRemaining, listeningMinutesRemaining)
 * are NO LONGER stored here. They live in the separate `user_usage` collection
 * which users cannot write to. See src-tauri/src/usage.rs.
 */
export async function syncUserProfile(profile: UserProfile): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, profile.id);
    // Document exists → update non-sensitive profile fields only
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.USER_PROFILES, profile.id, {
      name: profile.name,
      email: profile.email,
      plan: profile.plan,
    });
  } catch {
    // Document does not exist → create with user read+write (profile info is not sensitive)
    await databases.createDocument(
      DATABASE_ID,
      COLLECTION_IDS.USER_PROFILES,
      profile.id,
      {
        name: profile.name,
        email: profile.email,
        plan: profile.plan,
        isActive: true,
      },
      [Permission.read(Role.user(profile.id)), Permission.write(Role.user(profile.id))]
    );
  }
}

/**
 * Fetch the usage from Appwrite (read from the secure user_usage collection).
 * Stores *used* counts (0 → N) — more readable in Appwrite Console.
 * Users can only read this document — all writes go through the Rust backend.
 */
export async function fetchRemoteUsage(userId: string): Promise<{ aiResponsesUsed: number; listeningSecondsUsed: number } | null> {
  if (!isAppwriteConfigured()) return null;
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_IDS.USER_USAGE, userId);
    return {
      aiResponsesUsed: doc.aiResponsesUsed ?? 0,
      listeningSecondsUsed: doc.listeningSecondsUsed ?? 0,
    };
  } catch {
    return null;
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
