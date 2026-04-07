import { useState, useCallback, useRef } from "react";
import type { ChatMessage, Message } from "@/types/completion";
import { streamAIFromConfig } from "@/lib/functions/ai-response.function";
import { useAppContext } from "@/contexts/app.context";
import {
  createConversation,
  addMessage,
} from "@/lib/database";

/**
 * Hook for the main overlay chat.
 * Manages messages, file attachments, streaming AI responses.
 */
export function useCompletion() {
  const { systemPrompt } = useAppContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(
    async (text: string, images?: string[]) => {
      if (!text.trim() || isLoading) return;
      setError(null);

      // Create a conversation if this is the first message
      if (!conversationIdRef.current) {
        conversationIdRef.current = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const title = text.length > 50 ? text.substring(0, 50) + "..." : text;
        createConversation(conversationIdRef.current, title).catch(console.error);
      }

      // Add user message
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Save user message to database
      if (conversationIdRef.current) {
        addMessage(conversationIdRef.current, userMessage).catch(console.error);
      }

      // Build API messages
      const apiMessages: Message[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      apiMessages.push({ role: "user", content: text });

      // Create assistant message placeholder
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Stream response (config + auth from Rust backend)
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        for await (const chunk of streamAIFromConfig({
          messages: apiMessages,
          systemPrompt,
          images,
          abortSignal: controller.signal,
        })) {
          assistantMessage.content += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg.role === "assistant") {
              lastMsg.content = assistantMessage.content;
            }
            return updated;
          });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
            setError("Authentication error. Please contact support.");
          } else if (errMsg.includes("429") || errMsg.includes("rate limit")) {
            setError("Rate limited. Please wait a moment and try again.");
          } else if (errMsg.includes("500") || errMsg.includes("server error")) {
            setError("AI provider server error. Try again later.");
          } else if (errMsg.includes("fetch") || errMsg.includes("network") || errMsg.includes("Failed to fetch")) {
            setError("Network error. Check your connection.");
          } else {
            setError(errMsg.length > 120 ? errMsg.substring(0, 120) + "…" : errMsg);
          }
          console.error("[useCompletion] Error:", err);
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;

        // Save completed assistant message to database
        if (conversationIdRef.current && assistantMessage.content) {
          addMessage(conversationIdRef.current, assistantMessage).catch(
            console.error
          );
        }
      }
    },
    [messages, isLoading, systemPrompt]
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    conversationIdRef.current = null;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    abort,
    clearMessages,
    clearError,
  };
}
