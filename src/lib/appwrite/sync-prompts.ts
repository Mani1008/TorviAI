import { Query } from "appwrite";
import { databases, DATABASE_ID, COLLECTION_IDS, isAppwriteConfigured } from "./client";

/**
 * Sync a system prompt to Appwrite.
 */
export async function syncSystemPrompt(
  userId: string,
  prompt: { id: number; name: string; prompt: string; createdAt: string; updatedAt: string }
): Promise<void> {
  if (!isAppwriteConfigured()) return;
  const docId = `${userId}_sp_${prompt.id}`;
  try {
    await databases.getDocument(DATABASE_ID, COLLECTION_IDS.SYSTEM_PROMPTS, docId);
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.SYSTEM_PROMPTS, docId, {
      name: prompt.name,
      prompt: prompt.prompt,
      updatedAt: prompt.updatedAt,
    });
  } catch {
    await databases.createDocument(DATABASE_ID, COLLECTION_IDS.SYSTEM_PROMPTS, docId, {
      userId,
      name: prompt.name,
      prompt: prompt.prompt,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
    });
  }
}

/**
 * Delete a system prompt from Appwrite.
 */
export async function deleteRemoteSystemPrompt(userId: string, promptId: number): Promise<void> {
  if (!isAppwriteConfigured()) return;
  const docId = `${userId}_sp_${promptId}`;
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_IDS.SYSTEM_PROMPTS, docId);
  } catch {
    // May not exist remotely
  }
}

/**
 * Fetch all system prompts for a user from Appwrite.
 */
export async function fetchRemoteSystemPrompts(
  userId: string
): Promise<{ name: string; prompt: string; createdAt: string; updatedAt: string }[]> {
  if (!isAppwriteConfigured()) return [];
  try {
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_IDS.SYSTEM_PROMPTS, [
      Query.equal("userId", userId),
      Query.orderDesc("updatedAt"),
      Query.limit(100),
    ]);
    return res.documents.map((doc) => ({
      name: doc.name,
      prompt: doc.prompt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  } catch {
    return [];
  }
}
