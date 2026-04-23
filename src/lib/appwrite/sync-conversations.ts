import { Query } from "appwrite";
import { databases, DATABASE_ID, COLLECTION_IDS, isAppwriteConfigured } from "./client";

// INFO-03: SECURITY REQUIREMENT — Before enabling cloud sync in production,
// verify ALL Appwrite collections (CONVERSATIONS, SYSTEM_PROMPTS, USER_PROFILES,
// USER_SETTINGS) have document-level security with:
//   Read:  Role.user($userId)
//   Write: Role.user($userId)
// Never use Role.any() or Role.users() without document-level scoping.
// Failure to do this allows any authenticated user to read all other users' data.

/**
 * Sync a conversation (metadata) to Appwrite.
 */
export async function syncConversation(
  userId: string,
  conv: { id: string; title: string; createdAt: number; updatedAt: number }
): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    await databases.getDocument(DATABASE_ID, COLLECTION_IDS.CONVERSATIONS, conv.id);
    await databases.updateDocument(DATABASE_ID, COLLECTION_IDS.CONVERSATIONS, conv.id, {
      title: conv.title,
      updatedAt: new Date(conv.updatedAt).toISOString(),
    });
  } catch {
    await databases.createDocument(DATABASE_ID, COLLECTION_IDS.CONVERSATIONS, conv.id, {
      userId,
      title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
    });
  }
}

/**
 * Delete a conversation from Appwrite.
 */
export async function deleteRemoteConversation(conversationId: string): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_IDS.CONVERSATIONS, conversationId);
  } catch {
    // May not exist remotely yet
  }
}

/**
 * Fetch all conversations for a user from Appwrite.
 */
export async function fetchRemoteConversations(
  userId: string
): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }[]> {
  if (!isAppwriteConfigured()) return [];
  try {
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_IDS.CONVERSATIONS, [
      Query.equal("userId", userId),
      Query.orderDesc("updatedAt"),
      Query.limit(500),
    ]);
    return res.documents.map((doc) => ({
      id: doc.$id,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  } catch {
    return [];
  }
}

/**
 * Delete all conversations for a user from Appwrite.
 */
export async function deleteAllRemoteConversations(userId: string): Promise<void> {
  if (!isAppwriteConfigured()) return;
  try {
    const convs = await fetchRemoteConversations(userId);
    await Promise.all(
      convs.map((c) =>
        databases.deleteDocument(DATABASE_ID, COLLECTION_IDS.CONVERSATIONS, c.id).catch(() => {})
      )
    );
  } catch {
    // Best effort
  }
}
