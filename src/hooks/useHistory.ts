import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatConversation } from "@/types/completion";
import {
  deleteConversation,
  getConversationsPaged,
  searchConversations,
} from "@/lib/database/chat-history";

const PAGE_SIZE = 20;

export function useHistory() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  // Keep a stable ref to current search so callbacks don't go stale
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchPage = useCallback(async (pageIndex: number, query: string, replace: boolean) => {
    if (pageIndex === 0) setIsLoading(true);
    else setIsLoadingMore(true);

    try {
      const offset = pageIndex * PAGE_SIZE;
      // Fetch one extra to detect if there is a next page
      const data = query
        ? await searchConversations(query, PAGE_SIZE + 1, offset)
        : await getConversationsPaged(PAGE_SIZE + 1, offset);

      const hasMore = data.length > PAGE_SIZE;
      const items = data.slice(0, PAGE_SIZE);

      setConversations((prev) => (replace ? items : [...prev, ...items]));
      setHasMorePages(hasMore);
      setPage(pageIndex);
    } catch (err) {
      console.error("[useHistory] Failed to fetch:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // Re-fetch from page 0 whenever search changes
  useEffect(() => {
    fetchPage(0, search, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadMore = useCallback(() => {
    if (!hasMorePages || isLoadingMore) return;
    fetchPage(page + 1, searchRef.current, false);
  }, [hasMorePages, isLoadingMore, page, fetchPage]);

  const refreshConversations = useCallback(() => {
    fetchPage(0, searchRef.current, true);
  }, [fetchPage]);

  const removeConversation = useCallback(async (id: string) => {
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    conversations,
    isLoading,
    isLoadingMore,
    hasMorePages,
    search,
    setSearch,
    loadMore,
    refreshConversations,
    removeConversation,
  };
}
