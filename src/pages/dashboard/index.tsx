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
import { loadUserProfile } from "@/lib/storage/auth";
import { loadUsageStats } from "@/lib/storage/usage-stats";
import { PLAN_LIMITS } from "@/config/constants";
import type { UserProfile, UsageStats } from "@/types/settings";
import {
  MessageSquare,
  Bot,
  Layers,
  Activity,
  User,
  Crown,
  Headphones,
  Sparkles,
} from "lucide-react";

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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);

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

    // Load user profile + usage
    setUser(loadUserProfile());
    setUsage(loadUsageStats());
  }, []);

  const planLabel =
    user?.plan === "pro" ? "Pro" : user?.plan === "plus" ? "Plus" : "Starter";
  const planColor =
    user?.plan === "pro"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : user?.plan === "plus"
      ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
      : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";

  const planKey = (user?.plan === "plus" || user?.plan === "pro") ? user.plan : "starter";
  const limits = PLAN_LIMITS[planKey];
  const listeningUsed = usage?.listeningSeconds ?? 0;
  const responsesUsed = usage?.aiResponses ?? 0;

  const fmtTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <PageLayout title="Dashboard" description="Overview of your AI assistant usage">
      <div className="space-y-6">

        {/* ── User Account Card ── */}
        {user && (
          <div className="rounded-lg border border-border p-5 flex items-center gap-4">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="h-12 w-12 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <User className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{user.name}</h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${planColor}`}
                >
                  <Crown className="h-3 w-3" />
                  {planLabel}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        )}

        {/* ── Usage Bars ── */}
        {usage && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Headphones className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Listening Time</span>
              </div>
              <p className="text-2xl font-bold">
                {fmtTime(listeningUsed)}
                {limits.listeningSeconds !== -1 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {fmtTime(limits.listeningSeconds)}
                  </span>
                )}
              </p>
              {limits.listeningSeconds !== -1 && (
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${Math.min(100, (listeningUsed / limits.listeningSeconds) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">AI Responses</span>
              </div>
              <p className="text-2xl font-bold">
                {responsesUsed}
                {limits.aiResponses !== -1 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {limits.aiResponses}
                  </span>
                )}
              </p>
              {limits.aiResponses !== -1 && (
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{
                      width: `${Math.min(100, (responsesUsed / limits.aiResponses) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

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
