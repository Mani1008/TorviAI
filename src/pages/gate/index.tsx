import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sparkles, Loader2 } from "lucide-react";
import { APP_URL, API_BASE_URL } from "@/config/constants";
import { saveAuthToken, loadAuthToken, verifyToken, saveUserProfile } from "@/lib/storage/auth";

// Lazy-import Appwrite modules to prevent gate crash if appwrite isn't configured
type AppwriteModule = Awaited<typeof import("@/lib/appwrite")>;
let _appwrite: AppwriteModule | null = null;
async function getAppwrite(): Promise<AppwriteModule> {
  if (!_appwrite) _appwrite = await import("@/lib/appwrite");
  return _appwrite;
}

interface CallbackPayload {
  token: string;
  user_id: string;
  secret: string;
  provider: string;
  state: string;
}

// Module-level timestamp used to debounce OAuth initiations (2-second cooldown).
let _lastOAuthClick = 0;

async function unlockAndSync() {
  try {
    await invoke("unlock_app");
    // Run background Appwrite sync (non-blocking)
    const aw = await getAppwrite();
    aw.runStartupSync().catch((e: unknown) => console.warn("[Gate] Startup sync error:", e));
  } catch (e) {
    console.error("[Gate] unlock_app failed:", e);
  }
}

export default function Gate() {
  const [status, setStatus] = useState<"idle" | "checking" | "waiting" | "done">("checking");
  const [error, setError] = useState<string | null>(null);

  // On mount: check for existing session (Appwrite first, then legacy)
  useEffect(() => {
    (async () => {
      // Dev bypass — only active in DEV builds; never fires in production bundles.
      if (import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH_CHECK === "true") {
        saveUserProfile({ id: "dev", name: "Dev User", email: "dev@local", plan: "starter" });
        setStatus("done");
        await unlockAndSync();
        return;
      }

      try {
        // Try Appwrite session first — always re-fetches from server, never uses cached profile
        const aw = await getAppwrite();
        if (aw.isAppwriteConfigured()) {
          const awUser = await aw.getActiveSession();
          if (awUser) {
            const profile = await aw.resolveUserProfile(awUser);
            saveUserProfile(profile);
            setStatus("done");
            await unlockAndSync();
            return;
          }
        }
      } catch (e) {
        console.warn("[Gate] Appwrite check failed, falling back to legacy:", e);
      }

      try {
        // Fall back to legacy JWT verification
        const token = loadAuthToken();
        const user = token ? await verifyToken(token, API_BASE_URL) : null;
        if (user) {
          saveUserProfile(user);
          setStatus("done");
          await unlockAndSync();
          return;
        }
      } catch (e) {
        console.warn("[Gate] Legacy auth check failed:", e);
      }

      // No auth found — show the gate window so user can sign in
      setStatus("idle");
      invoke("show_gate").catch((e) => console.warn("[Gate] show_gate failed:", e));
    })();
  }, []);

  // Listen for the OAuth callback from the local HTTP server
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<CallbackPayload>("oauth-callback-received", async (event) => {
      const { token, user_id, secret, state } = event.payload;

      // Validate CSRF state nonce before processing
      const expectedNonce = sessionStorage.getItem("oauth_state_nonce");
      sessionStorage.removeItem("oauth_state_nonce"); // consume immediately
      if (!expectedNonce || state !== expectedNonce) {
        console.error("[Gate] OAuth state nonce mismatch — possible CSRF");
        setError("Sign-in failed — invalid state. Please try again.");
        setStatus("idle");
        return;
      }

      try {
        // ── Appwrite OAuth callback ──
        if (user_id && secret) {
          const aw = await getAppwrite();
          const awUser = await aw.createSessionFromOAuth(user_id, secret);
          const profile = await aw.resolveUserProfile(awUser);
          saveUserProfile(profile);
          setStatus("done");
          await unlockAndSync();
          return;
        }

        // ── Legacy OAuth callback (JWT from landing page) ──
        if (token) {
          saveAuthToken(token);
          const user = await verifyToken(token, API_BASE_URL);
          if (user) {
            saveUserProfile(user);
            setStatus("done");
            await unlockAndSync();
            return;
          }
        }

        setError("Sign-in failed — please try again.");
        setStatus("idle");
      } catch (err) {
        console.error("[Gate] Auth callback error:", err);
        setError("Sign-in failed — please try again.");
        setStatus("idle");
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  const handleSignIn = async () => {
    // Debounce: prevent rapid repeated OAuth initiations (2-second cooldown)
    const now = Date.now();
    if (now - _lastOAuthClick < 2000) return;
    _lastOAuthClick = now;
    setError(null);
    setStatus("waiting");
    try {
      // Generate a cryptographic nonce for CSRF protection.
      // Stored in sessionStorage and validated when the callback arrives.
      const stateNonce = crypto.randomUUID();
      sessionStorage.setItem("oauth_state_nonce", stateNonce);

      const port = await invoke<number>("start_oauth_callback_server");

      const aw = await getAppwrite();
      if (aw.isAppwriteConfigured()) {
        // Open Appwrite's Google OAuth URL — nonce is embedded in success redirect URL
        const oauthUrl = aw.getOAuthUrl(port, stateNonce);
        await openUrl(oauthUrl);
      } else {
        // Legacy: open landing page login with state nonce
        const loginUrl = `${APP_URL}/login?callback_port=${port}&state=${encodeURIComponent(stateNonce)}`;
        await openUrl(loginUrl);
      }
    } catch (err) {
      console.error("[Gate] Failed to open sign-in:", err);
      setError("Could not open the browser. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0a12] text-white">
      <div className="w-full max-w-sm space-y-8 px-6">

        {/* Logo */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-500/20">
            <Sparkles className="h-8 w-8 text-indigo-400" />
          </div>
          <div>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome to Torvi</h1>
            <p className="mt-1 text-sm text-white/40">Sign in to unlock your AI assistant</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/8 bg-white/4 p-6 space-y-4">
          {status === "checking" && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking your session…
            </div>
          )}

          {status === "done" && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-emerald-400">
              ✓ Authenticated — opening app…
            </div>
          )}

          {(status === "idle" || status === "waiting") && (
            <>
              <button
                onClick={handleSignIn}
                disabled={status === "waiting"}
                className="flex w-full items-center justify-center gap-3 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "waiting" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for browser…
                  </>
                ) : (
                  "Get Started — Sign In"
                )}
              </button>

              {status === "waiting" && (
                <p className="text-center text-xs text-white/35">
                  Complete sign-in in your browser, then return here.
                </p>
              )}

              {error && (
                <p className="text-center text-xs text-rose-400">{error}</p>
              )}
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/20">
          By signing in you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}
