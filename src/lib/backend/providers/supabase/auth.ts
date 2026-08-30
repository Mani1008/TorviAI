import { invoke } from "@tauri-apps/api/core";
import type { UserProfile } from "@/types/settings";
import type { BackendUser } from "../../types";
import {
  createOAuthClient,
  getSupabaseClient,
  isSupabaseConfigured,
} from "./client";
import { upsertProfile, fetchPlan } from "./database";

function toBackendUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): BackendUser {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    "";
  return {
    id: user.id,
    name,
    email: typeof user.email === "string" ? user.email : "",
  };
}

/** Return the active session user, or null if signed out / expired. */
export async function getCurrentUser(): Promise<BackendUser | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error || !data.user) return null;
  return toBackendUser(data.user);
}

/**
 * Build Google OAuth URL for the Tauri local callback server.
 *
 * Uses implicit flow so tokens arrive in the URL hash at
 * `http://127.0.0.1:{port}/callback` — PKCE flow-state breaks when the
 * authorize page runs in the system browser instead of the WebView
 * (`Error loading flow state` → redirect to Site URL / localhost:1420).
 */
export async function signInWithGoogle(
  callbackPort: number,
  state: string
): Promise<string> {
  const redirectTo =
    `http://127.0.0.1:${callbackPort}/callback` +
    `?state=${encodeURIComponent(state)}`;

  const { data, error } = await createOAuthClient().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error("Supabase OAuth URL missing");
  return data.url;
}

/** Exchange PKCE authorization code from OAuth callback for a session. */
export async function exchangeOAuthCode(code: string): Promise<BackendUser> {
  const { data, error } = await getSupabaseClient().auth.exchangeCodeForSession(code);
  if (error) throw error;
  if (!data.user) throw new Error("No user after OAuth exchange");
  return toBackendUser(data.user);
}

/** Set session from tokens bridged from the OAuth hash fragment (implicit flow). */
export async function setSessionFromTokens(
  accessToken: string,
  refreshToken: string
): Promise<BackendUser> {
  const { data, error } = await getSupabaseClient().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  if (!data.user) throw new Error("No user after setSession");
  return toBackendUser(data.user);
}

/** End the current cloud session. */
export async function signOut(): Promise<void> {
  try {
    await getSupabaseClient().auth.signOut();
  } catch {
    // Session may already be expired
  }
}

/**
 * Resolve cloud user → local UserProfile.
 * Profile/usage rows are seeded by on_auth_user_created; we refresh plan from DB.
 */
export async function resolveUserProfile(
  user: BackendUser,
  plan?: string
): Promise<UserProfile> {
  let resolvedPlan = (plan as UserProfile["plan"]) || "starter";

  try {
    const remotePlan = await fetchPlan(user.id);
    if (remotePlan) {
      resolvedPlan = (remotePlan === "free" ? "starter" : remotePlan) as UserProfile["plan"];
    }
  } catch (e) {
    console.warn("[Supabase] Failed to fetch plan:", e);
  }

  const profile: UserProfile = {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: resolvedPlan,
  };

  try {
    await upsertProfile(profile);
  } catch (e) {
    console.warn("[Supabase] Failed to sync profile:", e);
  }

  invoke("initialize_user_usage", { userId: profile.id, plan: profile.plan }).catch(
    (e: unknown) => console.warn("[Supabase] Failed to initialize usage:", e)
  );

  return profile;
}
