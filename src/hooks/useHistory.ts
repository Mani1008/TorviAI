import { useState, useCallback, useEffect } from "react";
import type { ChatConversation } from "@/types/completion";
import { getAllConversations, deleteConversation } from "@/lib/database/chat-history";

/**
 * Hook for managing conversation history list.
 *
 * TODO: Implement pagination.
 * TODO: Implement search/filter.
 */
export function useHistory() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getAllConversations();
      setConversations(data);
    } catch (err) {
      console.error("[useHistory] Failed to fetch:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const removeConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    },
    []
  );

  return {
    conversations,
    isLoading,
    refreshConversations: fetchConversations,
    removeConversation,
  };
}
