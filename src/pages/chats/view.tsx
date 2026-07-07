import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { PageLayout } from "@/layouts";
import { Markdown } from "@/components/Markdown";
import { SourceCitations } from "@/components/SourceCitations";
import { Empty } from "@/components/Empty";
import type { ChatConversation } from "@/types/completion";
import { getConversationById } from "@/lib/database";

export default function ChatView() {
  const { conversationId } = useParams();
  const [conversation, setConversation] = useState<ChatConversation | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!conversationId) return;
    setIsLoading(true);
    getConversationById(conversationId)
      .then(setConversation)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [conversationId]);

  return (
    <PageLayout title={conversation?.title ?? "Conversation"} showBack>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !conversation || conversation.messages.length === 0 ? (
        <Empty
          title="No messages"
          description="This conversation has no messages."
        />
      ) : (
        <div className="space-y-4">
          {conversation.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.role === "assistant" ? (
                  <>
                    <Markdown content={msg.content} />
                    {msg.sources && msg.sources.length > 0 && (
                      <SourceCitations sources={msg.sources} variant="dashboard" />
                    )}
                  </>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
                <p className="mt-1 text-[10px] opacity-50">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
