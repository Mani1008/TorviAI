import { useMemo } from "react";
import { useNavigate } from "react-router";
import { MessageSquare, Clock } from "lucide-react";
import type { ChatConversation } from "@/types/completion";
import type { ContextChunk } from "@/lib/database/context-store";

interface ActivityItem {
  id: string;
  type: "chat" | "context";
  title: string;
  subtitle: string;
  timestamp: number;
  href?: string;
}

interface Props {
  conversations: ChatConversation[];
  contextChunks: ContextChunk[];
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const minutes = Math.floor(delta / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  code: "Coding",
  document: "Document",
  email: "Email",
  chat: "Chat",
  meeting: "Meeting",
  project_management: "Project",
  browser: "Browser",
  generic: "App",
};

export function RecentActivityFeed({ conversations, contextChunks }: Props) {
  const navigate = useNavigate();

  const items: ActivityItem[] = useMemo(() => {
    const chatItems: ActivityItem[] = conversations.slice(0, 6).map((c) => ({
      id: `chat-${c.id}`,
      type: "chat",
      title: c.title,
      subtitle: `${c.messages.length > 0 ? `${c.messages.length} message${c.messages.length !== 1 ? "s" : ""}` : "No messages"}`,
      timestamp: c.updatedAt,
      href: `/chats?id=${c.id}`,
    }));

    const ctxItems: ActivityItem[] = contextChunks.slice(0, 6).map((ch) => ({
      id: `ctx-${ch.id}`,
      type: "context",
      title: ch.window_title.split(" - ")[0].trim().slice(0, 60),
      subtitle: `${CONTENT_TYPE_LABELS[ch.content_type] ?? ch.content_type} · ${ch.app_name}`,
      timestamp: ch.captured_at,
      href: "/context-memory",
    }));

    return [...chatItems, ...ctxItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 8);
  }, [conversations, contextChunks]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground">
        <MessageSquare className="mb-2 h-8 w-8 opacity-30" />
        <p className="text-sm font-medium">No recent activity</p>
        <p className="text-xs mt-1 opacity-70">Start a conversation or wait for context to be captured</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => item.href && navigate(item.href)}
          className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-border hover:bg-accent/50 transition-all"
        >
          {/* Icon */}
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              item.type === "chat"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {item.type === "chat" ? (
              <MessageSquare className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
          </div>

          {/* Text */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight group-hover:text-foreground">
              {item.title}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">{item.subtitle}</p>
          </div>

          {/* Timestamp */}
          <span className="shrink-0 text-xs text-muted-foreground/50">
            {relativeTime(item.timestamp)}
          </span>
        </button>
      ))}
    </div>
  );
}
