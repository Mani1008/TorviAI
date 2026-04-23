import { useState, useCallback, useRef } from "react";
import type { ChatMessage, Message } from "@/types/completion";
import { streamAIFromConfig } from "@/lib/functions/ai-response.function";
import { useAppContext } from "@/contexts/app.context";
import {
  createConversation,
  addMessage,
} from "@/lib/database";
import { incrementAiResponses, checkAiResponseLimit } from "@/lib/storage/usage-stats";
import { decrementAiResponses, syncConversation } from "@/lib/appwrite";
import { loadUserProfile } from "@/lib/storage/auth";

/**
 * Hook for the main overlay chat.
 * Manages messages, file attachments, streaming AI responses.
 */

/** Maximum character length for a single user message. */
const MAX_MESSAGE_LENGTH = 32_000;
/** Maximum number of messages to include in the API context window. */
const MAX_CONTEXT_MESSAGES = 50;

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

      // Enforce message length limit
      if (text.length > MAX_MESSAGE_LENGTH) {
        setError(`Message is too long (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters).`);
        return;
      }

      setError(null);

      // Enforce plan limit before making the AI call
      const limitError = checkAiResponseLimit();
      if (limitError) {
        setError(limitError);
        return;
      }

      // Create a conversation if this is the first message
      if (!conversationIdRef.current) {
        conversationIdRef.current = crypto.randomUUID();
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

      // Build API messages — cap history to avoid unbounded token growth
      const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);
      const apiMessages: Message[] = recentMessages.map((m) => ({
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
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.content = assistantMessage.content;
            }
            return updated;
          });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const errMsg = (err as Error).message || String(err);
          // Map provider errors to user-safe messages — do not expose raw API responses
          if (errMsg.includes("401") || errMsg.includes("Unauthorized") || errMsg.includes("Authentication error")) {
            setError("Authentication error. Please contact support.");
          } else if (errMsg.includes("429") || errMsg.includes("rate limit") || errMsg.includes("Rate limited")) {
            setError("Rate limited. Please wait a moment and try again.");
          } else if (errMsg.includes("500") || errMsg.includes("server error") || errMsg.includes("Server error")) {
            setError("AI provider server error. Try again later.");
          } else if (errMsg.includes("fetch") || errMsg.includes("network") || errMsg.includes("Failed to fetch") || errMsg.includes("Network error")) {
            setError("Network error. Check your connection.");
          } else if (errMsg.includes("Stream interrupted")) {
            setError("Stream interrupted. Try again.");
          } else {
            // Generic fallback — do not show raw provider error text to the user
            setError("Something went wrong. Please try again.");
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
          // Track AI response for usage/billing (local + remote)
          incrementAiResponses();
          const profile = loadUserProfile();
          if (profile?.id) {
            decrementAiResponses(profile.id).catch(console.warn);
            syncConversation(profile.id, {
              id: conversationIdRef.current,
              title: messages[0]?.content?.slice(0, 50) || "New conversation",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }).catch(console.warn);
          }
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
