import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import type { ChatConversation } from "@/types/completion";
import type { ContextChunk } from "@/lib/database/context-store";

interface ActivityItem {
  id: string;
  type: "chat" | "context";
  title: string;
  subtitle: string;
  timestamp: number;
  href: string;
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
  code: "Coding", document: "Document", email: "Email", chat: "Chat",
  meeting: "Meeting", project_management: "Project", browser: "Browser", generic: "App",
};

export function RecentActivityFeed({ conversations, contextChunks }: Props) {
  const navigate = useNavigate();

  const items: ActivityItem[] = useMemo(() => {
    const chatItems: ActivityItem[] = conversations.slice(0, 5).map((c) => ({
      id: `chat-${c.id}`,
      type: "chat",
      title: c.title,
      subtitle: c.messages.length > 0 ? `${c.messages.length} messages` : "No messages",
      timestamp: c.updatedAt,
      href: `/chats?id=${c.id}`,
    }));

    const ctxItems: ActivityItem[] = contextChunks.slice(0, 4).map((ch) => ({
      id: `ctx-${ch.id}`,
      type: "context",
      title: ch.window_title.split(" - ")[0].trim().slice(0, 60),
      subtitle: `${CONTENT_TYPE_LABELS[ch.content_type] ?? ch.content_type} · ${ch.app_name}`,
      // ch.captured_at is Unix seconds; convert to ms so it sorts and displays
      // correctly alongside chat conversations (which use Date.now() milliseconds).
      timestamp: ch.captured_at * 1000,
      href: "/context-memory",
    }));

    return [...chatItems, ...ctxItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 7);
  }, [conversations, contextChunks]);

  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground/50">
        No recent activity yet
      </p>
    );
  }

  return (
    <div>
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => navigate(item.href)}
          className={`group flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/40 rounded-lg px-2 -mx-2 ${
            i !== 0 ? "border-t border-border/30" : ""
          }`}
        >
          {/* tiny type dot */}
          <div
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              item.type === "chat" ? "bg-primary/60" : "bg-muted-foreground/30"
            }`}
          />

          {/* text */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight">{item.title}</p>
            <p className="truncate text-xs text-muted-foreground/50 mt-0.5">
              {item.subtitle}
            </p>
          </div>

          {/* timestamp + hover arrow */}
          <div className="shrink-0 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground/40">
              {relativeTime(item.timestamp)}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
          </div>
        </button>
      ))}
    </div>
  );
}

