import { useCallback, useEffect, useState } from "react";
import {
  getBackendProvider,
  getMemorySyncQueueStatus,
  isSupabaseProvider,
  isBackendConfigured,
  loadMemorySyncSettings,
  saveMemorySyncSettings,
  syncContextChunksToCloud,
} from "@/lib/backend";
import { Cloud, CloudOff, Loader2, Shield } from "lucide-react";

function formatLastSync(ts: number | null): string {
  if (!ts) return "Never";
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function CloudMemorySyncCard() {
  const [enabled, setEnabled] = useState(() => loadMemorySyncSettings().enabled);
  const [encryptCloud, setEncryptCloud] = useState(
    () => loadMemorySyncSettings().encryptCloud
  );
  const [pending, setPending] = useState(0);
  const [synced, setSynced] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const provider = getBackendProvider();
  const configured = isBackendConfigured();
  const canUseCloud = isSupabaseProvider() && configured;

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getMemorySyncQueueStatus();
      setPending(status.pending);
      setSynced(status.synced);
      setLastSyncAt(status.settings.lastSyncAt);
      setLastError(status.settings.lastSyncError);
      setEnabled(status.settings.enabled);
      setEncryptCloud(status.settings.encryptCloud);
    } catch {
      /* local SQLite may be unavailable in browser dev */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), 15_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    saveMemorySyncSettings({ enabled: next });
    setStatusMsg(next ? "Cloud sync enabled — chunks will upload when Supabase is ready." : "Cloud sync paused.");
  };

  const handleEncryptToggle = () => {
    const next = !encryptCloud;
    setEncryptCloud(next);
    saveMemorySyncSettings({ encryptCloud: next });
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setStatusMsg(null);
    try {
      const result = await syncContextChunksToCloud({ force: true, limit: 100 });
      if (result.reason === "not_configured") {
        setStatusMsg("Supabase URL not configured — set VITE_SUPABASE_URL in .env, then restart.");
      } else if (result.reason === "not_authenticated") {
        setStatusMsg("Sign in to upload memories to the cloud.");
      } else if (result.reason === "not_supabase_provider") {
        setStatusMsg("Set VITE_BACKEND_PROVIDER=supabase to use cloud second brain.");
      } else if (result.synced === 0 && result.failed === 0) {
        setStatusMsg("Nothing new to upload.");
      } else {
        const errHint = result.errors[0] ? ` — ${result.errors[0]}` : "";
        setStatusMsg(
          `Uploaded ${result.synced} chunk(s)${result.failed ? `, ${result.failed} failed` : ""}.${errHint}`
        );
      }
      await refreshStatus();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {canUseCloud ? (
            <Cloud className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
          ) : (
            <CloudOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          )}
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Cloud second brain</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Opt-in upload of local context chunks to Supabase{" "}
              <code className="text-[10px]">memory_items</code>. Content is{" "}
              {encryptCloud ? "encrypted on this device before upload" : "uploaded as plaintext"}.
              Works offline — chunks queue locally until Supabase is configured.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-indigo-500" : "bg-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Provider: <strong className="text-foreground">{provider}</strong></span>
        <span>Pending: <strong className="text-foreground">{pending}</strong></span>
        <span>Uploaded: <strong className="text-foreground">{synced}</strong></span>
        <span>Last sync: <strong className="text-foreground">{formatLastSync(lastSyncAt)}</strong></span>
      </div>

      {!canUseCloud && (
        <p className="text-xs text-amber-600/90 dark:text-amber-400/90">
          {isSupabaseProvider()
            ? "Add a valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env — chunks stay local until then."
            : "Set VITE_BACKEND_PROVIDER=supabase in .env for cloud memory sync."}
        </p>
      )}

      {lastError && (
        <p className="text-xs text-red-500/90">Last error: {lastError}</p>
      )}

      {statusMsg && (
        <p className="text-xs text-indigo-300/90">{statusMsg}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSyncNow()}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Cloud className="h-3.5 w-3.5" />
          )}
          Sync now
        </button>

        <button
          type="button"
          onClick={handleEncryptToggle}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
            encryptCloud
              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          {encryptCloud ? "Encryption on" : "Encryption off"}
        </button>
      </div>
    </div>
  );
}
