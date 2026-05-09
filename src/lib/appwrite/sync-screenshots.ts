import { Permission, Role } from "appwrite";
import { databases, storage, DATABASE_ID, COLLECTION_IDS, BUCKET_IDS, isAppwriteConfigured } from "./client";
import { loadUserProfile } from "@/lib/storage/auth";

// Appwrite screenshot sync:
// - Metadata (id, prompt, capturedAt) → Screenshots collection in Database
// - Image file → Screenshots bucket in Storage (only if VITE_APPWRITE_BUCKET_SCREENSHOTS is set)
//
// SECURITY: The screenshots collection must have Role.user($userId) for read/write.
// Never use Role.any() — screenshots are private per-user.

export interface ScreenshotSyncPayload {
  id: string;
  imageData: string; // base64 PNG
  prompt: string;
  capturedAt: number;
}

/**
 * Sync a screenshot to Appwrite.
 * - Uploads image to Storage bucket (if configured).
 * - Writes metadata to Database collection (if configured).
 * Fails silently — local SQLite is the source of truth.
 */
export async function syncScreenshot(payload: ScreenshotSyncPayload): Promise<void> {
  if (!isAppwriteConfigured()) return;

  const user = loadUserProfile();
  if (!user?.id) return;

  let storageFileId: string | null = null;

  // Upload image to Storage bucket if bucket is configured
  if (BUCKET_IDS.SCREENSHOTS) {
    try {
      const blob = base64ToBlob(payload.imageData, "image/png");
      const file = new File([blob], `${payload.id}.png`, { type: "image/png" });
      const uploaded = await storage.createFile(
        BUCKET_IDS.SCREENSHOTS,
        payload.id,
        file,
        [Permission.read(Role.user(user.id)), Permission.write(Role.user(user.id))]
      );
      storageFileId = uploaded.$id;
    } catch {
      // Storage upload failed — proceed without it
    }
  }

  // Write metadata to Database collection if collection is configured
  if (COLLECTION_IDS.SCREENSHOTS) {
    try {
      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_IDS.SCREENSHOTS,
        payload.id,
        {
          userid: user.id,
          prompt: payload.prompt,
          capturedAt: new Date(payload.capturedAt).toISOString(),
          storageField: storageFileId ?? "",
        },
        [Permission.read(Role.user(user.id)), Permission.write(Role.user(user.id))]
      );
    } catch {
      // Metadata write failed — local copy still intact
    }
  }
}

/**
 * Delete a screenshot from Appwrite (both metadata and stored file).
 */
export async function deleteRemoteScreenshot(id: string): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    if (COLLECTION_IDS.SCREENSHOTS) {
      await databases.deleteDocument(DATABASE_ID, COLLECTION_IDS.SCREENSHOTS, id);
    }
    if (BUCKET_IDS.SCREENSHOTS) {
      await storage.deleteFile(BUCKET_IDS.SCREENSHOTS, id);
    }
  } catch {
    // May not exist remotely
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  // Strip data URI prefix if present (e.g. "data:image/png;base64,...")
  const raw = base64.includes(",") ? base64.split(",")[1] : base64;
  const bytes = atob(raw);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    buffer[i] = bytes.charCodeAt(i);
  }
  return new Blob([buffer], { type: mimeType });
}
