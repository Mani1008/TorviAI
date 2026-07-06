/**
 * Storage service — provider-agnostic file/blob sync facade.
 * Current implementation delegates to Appwrite Storage (src/lib/appwrite).
 * Swap provider imports when migrating to Supabase Storage.
 */
import {
  syncScreenshot as appwriteSyncScreenshot,
  deleteRemoteScreenshot as appwriteDeleteScreenshot,
} from "@/lib/appwrite/sync-screenshots";
import type { ScreenshotSyncPayload } from "./types";

export type { ScreenshotSyncPayload };

export async function syncScreenshot(payload: ScreenshotSyncPayload): Promise<void> {
  return appwriteSyncScreenshot(payload);
}

export async function deleteScreenshot(id: string): Promise<void> {
  return appwriteDeleteScreenshot(id);
}
