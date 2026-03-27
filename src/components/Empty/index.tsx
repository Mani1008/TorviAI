import { MessageSquare, Inbox } from "lucide-react";

interface EmptyProps {
  title?: string;
  description?: string;
  variant?: "chat" | "default";
}

export function Empty({
  title,
  description,
  variant = "default",
}: EmptyProps) {
  const isChat = variant === "chat";
  const Icon = isChat ? MessageSquare : Inbox;
  const displayTitle = title ?? (isChat ? "Ask me anything" : "Nothing here yet");
  const displayDesc = description ?? (isChat ? "Type a message below to start a conversation." : "Get started by creating something new.");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-muted/50 p-3">
        <Icon className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{displayTitle}</p>
        <p className="text-xs text-muted-foreground/60">{displayDesc}</p>
      </div>
    </div>
  );
}
