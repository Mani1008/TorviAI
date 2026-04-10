import { useEffect, useState } from "react";
import { PageLayout } from "@/layouts";
import {
  getTotalConversationCount,
  getTodayMessageCount,
  getTotalMessageCount,
} from "@/lib/database";
import { loadSessionCount } from "@/lib/storage/usage";
import { loadSelectedModel } from "@/lib/storage/ai-providers";
import { getModelById } from "@/config/models.constants";
import { MessageSquare, Bot, Layers, Activity } from "lucide-react";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-5 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-3xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalConversations: 0,
    todayMessages: 0,
    totalMessages: 0,
    sessions: 0,
  });
  const [activeProvider, setActiveProvider] = useState("Loading…");

  useEffect(() => {
    Promise.all([
      getTotalConversationCount(),
      getTodayMessageCount(),
      getTotalMessageCount(),
    ])
      .then(([totalConversations, todayMessages, totalMessages]) => {
        setStats({
          totalConversations,
          todayMessages,
          totalMessages,
          sessions: loadSessionCount(),
        });
      })
      .catch(console.error);

    // Derive active provider label
    const model = getModelById(loadSelectedModel());
    setActiveProvider(model ? `OpenRouter — ${model.name}` : "OpenRouter");
  }, []);

  return (
    <PageLayout title="Dashboard" description="Overview of your AI assistant usage">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={MessageSquare}
            label="Conversations"
            value={stats.totalConversations}
            sub="all time"
          />
          <StatCard
            icon={Activity}
            label="Messages Today"
            value={stats.todayMessages}
            sub={`${stats.totalMessages} total`}
          />
          <StatCard
            icon={Layers}
            label="Sessions"
            value={stats.sessions}
            sub="lifetime app opens"
          />
          <StatCard
            icon={Bot}
            label="Active Provider"
            value=""
            sub={activeProvider}
          />
        </div>

        {/* Quick tips */}
        <div className="rounded-lg border border-border p-5 space-y-2">
          <h3 className="text-sm font-semibold">Quick Tips</h3>
          <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
            <li><kbd className="kbd">Ctrl+Shift+H</kbd> — toggle the overlay from anywhere</li>
            <li><kbd className="kbd">Ctrl+Shift+S</kbd> — capture a screenshot for AI analysis</li>
            <li><kbd className="kbd">Ctrl+Shift+M</kbd> — start/stop microphone voice input</li>
            <li>Use <strong>Settings → Provider</strong> to switch to your own API key</li>
          </ul>
        </div>
      </div>
    </PageLayout>
  );
}
