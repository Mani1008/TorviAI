import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sparkles, Loader2 } from "lucide-react";
import { APP_URL } from "@/config/constants";
import { saveAuthToken, verifyToken } from "@/lib/auth";

// ─── Local HTTP callback server ───────────────────────────────────────────────
// Rust command `start_oauth_callback_server` binds a random loopback port and
// returns it. We tell the web app to redirect to that port after login.
// When the token arrives via the `oauth-callback-received` event, we store it
// and unlock the pill bar.
// ─────────────────────────────────────────────────────────────────────────────

interface CallbackPayload {
  token: string;
}

export default function Gate() {
  const [status, setStatus] = useState<"idle" | "checking" | "waiting" | "done">("checking");
  const [error, setError] = useState<string | null>(null);

  // On mount: check if a valid stored token already exists
  useEffect(() => {
    verifyToken().then((user) => {
      if (user) {
        // Already authenticated — unlock immediately
        invoke("unlock_app").catch(console.error);
        setStatus("done");
      } else {
        setStatus("idle");
      }
    });
  }, []);

  // Listen for the token delivered by the local callback server
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<CallbackPayload>("oauth-callback-received", async (event) => {
      const { token } = event.payload;
      if (!token) return;
      saveAuthToken(token);
      const user = await verifyToken();
      if (user) {
        invoke("unlock_app").catch(console.error);
        setStatus("done");
      } else {
        setError("Sign-in failed — the token was invalid. Please try again.");
        setStatus("idle");
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  const handleSignIn = async () => {
    setError(null);
    setStatus("waiting");
    try {
      // Start the local callback server → gets a free port
      const port = await invoke<number>("start_oauth_callback_server");
      // Open the landing page login URL, pass callback port as a query param
      const loginUrl = `${APP_URL}/login?callback_port=${port}`;
      await openUrl(loginUrl);
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
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to Pluely</h1>
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
