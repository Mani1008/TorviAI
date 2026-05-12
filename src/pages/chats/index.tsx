import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router";
import { useCompletion } from "@/hooks/useCompletion";
import { useHistory } from "@/hooks/useHistory";
import { Markdown } from "@/components/Markdown";
import { getConversationById } from "@/lib/database";
import type { ChatConversation, ChatMessage } from "@/types/completion";
import {
  Square,
  MessageSquare,
  ArrowUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── ThinkingDots ─────────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/30 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-neutral-100 text-foreground rounded-bl-sm"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content as string}</p>
        ) : (
          <Markdown content={msg.content as string} />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Chats() {
  const location = useLocation();
  const locState = location.state as { prefill?: string; conversationId?: string } | null;
  const prefill = locState?.prefill ?? "";
  const incomingConvId = locState?.conversationId ?? "";

  const {
    messages: liveMessages,
    isLoading,
    error,
    sendMessage,
    abort,
    clearMessages,
    clearError,
  } = useCompletion();

  const { refreshConversations } = useHistory();

  // "new" = live session, string = viewing past conversation by id
  const [mode, setMode] = useState<"new" | string>("new");
  const [historyConv, setHistoryConv] = useState<ChatConversation | null>(null);

  // Text input state
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveMessages, historyConv]);

  // Handle prefill — auto-send on mount
  const prefillSent = useRef(false);
  useEffect(() => {
    if (prefill && !prefillSent.current) {
      prefillSent.current = true;
      setMode("new");
      clearMessages();
      setTimeout(() => sendMessage(prefill), 100);
    }
  }, [prefill, sendMessage, clearMessages]);

  // When a live session completes an exchange, refresh the history list
  useEffect(() => {
    if (!isLoading && liveMessages.length > 0) {
      refreshConversations();
    }
  }, [isLoading, liveMessages.length, refreshConversations]);

  const startNewChat = useCallback(() => {
    clearMessages();
    clearError?.();
    setMode("new");
    setHistoryConv(null);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [clearMessages, clearError]);

  const openConversation = useCallback(async (id: string) => {
    setMode(id);
    try {
      const conv = await getConversationById(id);
      setHistoryConv(conv);
    } catch {
      setHistoryConv(null);
    }
  }, []);

  // Open a conversation navigated to from the sidebar Recents list
  const incomingConvIdRef = useRef("");
  useEffect(() => {
    if (incomingConvId && incomingConvId !== incomingConvIdRef.current) {
      incomingConvIdRef.current = incomingConvId;
      openConversation(incomingConvId);
    }
  }, [incomingConvId, openConversation]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    if (mode !== "new") {
      // Start fresh live session
      clearMessages();
      setMode("new");
      setHistoryConv(null);
    }
    setInput("");
    sendMessage(text);
  };

  const displayMessages: ChatMessage[] =
    mode === "new" ? liveMessages : historyConv?.messages ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Full-width chat panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-dashboard-bg">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Empty state for new chat */}
          {mode === "new" && liveMessages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <MessageSquare className="h-10 w-10 text-foreground/10" />
              <p className="text-sm font-medium text-foreground/30">
                Ask Torvi anything
              </p>
              <p className="text-xs text-muted-foreground/40 max-w-xs">
                Your active screen context is automatically included for relevant questions.
              </p>
            </div>
          )}

          {/* History read-only banner */}
          {mode !== "new" && historyConv && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200/60 bg-amber-50/50 px-4 py-2">
              <p className="text-xs text-amber-700/70">Viewing past conversation</p>
              <button
                onClick={startNewChat}
                className="text-xs font-medium text-primary hover:opacity-75 transition-opacity"
              >
                Start new chat
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="space-y-4 max-w-3xl mx-auto">
            {displayMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {isLoading && mode === "new" && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-neutral-100 px-4 py-2.5">
                  <ThinkingDots />
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 max-w-3xl mx-auto">
                {error}
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </div>

        {/* ── Input bar ── */}
        <div className="shrink-0 border-t border-border/50 bg-card/80 px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="group relative rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-primary/40 focus-within:shadow-md">
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                placeholder={mode === "new" ? "Ask Torvi…" : "Reply or start a new topic…"}
                className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none leading-relaxed"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <div className="flex items-center justify-between px-4 pb-3 pt-1">
                <p className="text-[10px] text-muted-foreground/35">
                  Enter to send · Shift+Enter for new line
                </p>
                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <button
                      onClick={abort}
                      title="Stop generating"
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-red-300 hover:text-red-500 transition-colors"
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      title="Send (Enter)"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm shadow-primary/20 disabled:opacity-20 hover:bg-primary/90 transition-all"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

