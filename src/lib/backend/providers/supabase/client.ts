import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** Fixed OAuth callback port — must match Rust `OAUTH_CALLBACK_PORT` and Supabase Redirect URLs. */
export const SUPABASE_OAUTH_CALLBACK_PORT = 18427;

let _client: SupabaseClient | null = null;

/** Singleton Supabase client (anon key — RLS enforced). Sessions use PKCE storage. */
export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
    }
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
  }
  return _client;
}

/**
 * One-shot client for system-browser Google OAuth.
 *
 * Desktop apps open the authorize URL in Chrome/Edge, so PKCE flow-state
 * cookies never round-trip correctly and Supabase returns
 * `Error loading flow state` on Site URL. Implicit + hash bridge avoids that.
 */
export function createOAuthClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
    },
  });
}

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function pingSupabase(): void {
  if (!isSupabaseConfigured()) {
    console.warn("[Supabase] Not configured — skipping ping");
    return;
  }

  let host = "";
  try {
    host = new URL(SUPABASE_URL).hostname;
  } catch {
    console.error(
      "[Supabase] Invalid VITE_SUPABASE_URL — expected https://<project-ref>.supabase.co"
    );
    return;
  }
  if (!host.endsWith(".supabase.co")) {
    console.warn("[Supabase] VITE_SUPABASE_URL host does not look like a Supabase project:", host);
  }

  void (async () => {
    try {
      const health = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/health`, {
        headers: { apikey: SUPABASE_ANON_KEY },
      });
      if (!health.ok) {
        console.warn("[Supabase] Auth health check failed:", health.status, host);
        return;
      }
      const { error } = await getSupabaseClient().from("profiles").select("id").limit(1);
      if (error) {
        console.warn("[Supabase] Ping failed:", error.message);
      } else {
        console.log("[Supabase] Ping OK —", SUPABASE_URL);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[Supabase] Cannot reach ${host} — check VITE_SUPABASE_URL in .env (DNS / typo / deleted project).`,
        msg
      );
    }
  })();
}
