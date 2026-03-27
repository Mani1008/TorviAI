import { Link } from "react-router";
import { PageLayout } from "@/layouts";
import { Empty } from "@/components/Empty";
import { useHistory } from "@/hooks/useHistory";
import { Trash2 } from "lucide-react";

export default function Chats() {
  const { conversations, isLoading, removeConversation } = useHistory();

  return (
    <PageLayout title="Chats" description="Your conversation history">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : conversations.length === 0 ? (
        <Empty
          title="No conversations yet"
          description="Start chatting in the overlay to see your history here."
        />
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className="flex items-center gap-2 rounded-lg border border-border transition-colors hover:bg-accent"
            >
              <Link
                to={`/chats/view/${conv.id}`}
                className="flex-1 p-4"
              >
                <h3 className="font-medium">{conv.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {new Date(conv.updatedAt).toLocaleDateString()}
                </p>
              </Link>
              <button
                onClick={() => removeConversation(conv.id)}
                className="mr-3 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Delete conversation"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
