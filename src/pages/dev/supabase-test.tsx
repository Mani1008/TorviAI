import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getBackendProvider,
  isBackendConfigured,
  getActiveSession,
  getOAuthUrl,
  exchangeOAuthCode,
  setSessionFromTokens,
  listMemoryItems,
  createMemoryItem,
  logout,
} from "@/lib/backend";
import type { MemoryItem } from "@/lib/backend";

/**
 * Temporary dev page — verify Supabase auth + memory_items CRUD.
 * Route: /dev/supabase-test (DEV builds only).
 */
export default function SupabaseTestPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const append = (msg: string) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 30));
  };

  const handleSignIn = async () => {
    setBusy(true);
    try {
      const stateNonce = crypto.randomUUID();
      sessionStorage.setItem("oauth_state_nonce", stateNonce);
      const port = await invoke<number>("start_oauth_callback_server");

      const unlisten = await listen<{
        token: string;
        code: string;
        provider: string;
        state: string;
        access_token: string;
        refresh_token: string;
      }>("oauth-callback-received", async (event) => {
        unlisten();
        const expected = sessionStorage.getItem("oauth_state_nonce");
        sessionStorage.removeItem("oauth_state_nonce");
        if (!expected || event.payload.state !== expected) {
          append("OAuth state mismatch");
          return;
        }
        const { access_token, refresh_token, code, token } = event.payload;
        const user =
          access_token && refresh_token
            ? await setSessionFromTokens(access_token, refresh_token)
            : await exchangeOAuthCode(code || token);
        setUserId(user.id);
        append(`Signed in: ${user.email} (${user.id})`);
      });

      const url = await getOAuthUrl(port, stateNonce);
      await openUrl(url);
      append("Opened OAuth URL in browser…");
    } catch (e) {
      append(`Sign-in error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCheckSession = async () => {
    setBusy(true);
    try {
      const user = await getActiveSession();
      if (user) {
        setUserId(user.id);
        append(`Session active: ${user.email}`);
      } else {
        setUserId(null);
        append("No active session");
      }
    } catch (e) {
      append(`Session check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMemory = async () => {
    if (!userId) {
      append("Sign in first");
      return;
    }
    setBusy(true);
    try {
      const item = await createMemoryItem(userId, {
        title: `Test memory ${new Date().toISOString()}`,
        content: "Created from /dev/supabase-test",
        tags: ["test", "dev"],
        createdBy: "user",
      });
      append(`Created memory: ${item.id}`);
      await handleFetchMemories();
    } catch (e) {
      append(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleFetchMemories = async () => {
    if (!userId) {
      append("Sign in first");
      return;
    }
    setBusy(true);
    try {
      const items = await listMemoryItems(userId, { limit: 20 });
      setMemories(items);
      append(`Fetched ${items.length} memory item(s)`);
    } catch (e) {
      append(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await logout();
      setUserId(null);
      setMemories([]);
      append("Signed out");
    } catch (e) {
      append(`Sign-out failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!import.meta.env.DEV) {
    return (
      <div className="p-8 text-white">
        <p>Supabase test page is only available in development builds.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] p-8 text-white">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Supabase Provider Test</h1>
          <p className="mt-1 text-sm text-white/50">
            Provider: <code className="text-indigo-300">{getBackendProvider()}</code>
            {" · "}
            Configured: <code className="text-indigo-300">{String(isBackendConfigured())}</code>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleSignIn}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            Sign in (Google)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleCheckSession}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Check session
          </button>
          <button
            type="button"
            disabled={busy || !userId}
            onClick={handleCreateMemory}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Create test memory
          </button>
          <button
            type="button"
            disabled={busy || !userId}
            onClick={handleFetchMemories}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Fetch memories
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSignOut}
            className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            Sign out
          </button>
        </div>

        {userId && (
          <p className="text-sm text-green-400">
            User ID: <code>{userId}</code>
          </p>
        )}

        {memories.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-white/70">Memory items</h2>
            <ul className="space-y-2 text-sm">
              {memories.map((m) => (
                <li key={m.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="font-medium">{m.title}</div>
                  <div className="text-white/50">{m.content}</div>
                  <div className="mt-1 text-xs text-white/30">{m.id}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h2 className="mb-2 text-sm font-medium text-white/70">Log</h2>
          <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/60">
            {log.length ? log.join("\n") : "No events yet."}
          </pre>
        </div>
      </div>
    </div>
  );
}
