/**
 * Auth service — provider-agnostic authentication facade.
 * Delegates to Appwrite or Supabase based on VITE_BACKEND_PROVIDER.
 */
import {
  getOAuthUrl as appwriteGetOAuthUrl,
  createSessionFromOAuth as appwriteCreateSession,
  getActiveSession as appwriteGetActiveSession,
  logout as appwriteLogout,
  resolveUserProfile as appwriteResolveUserProfile,
} from "@/lib/appwrite/auth";
import { isAppwriteConfigured, pingAppwrite } from "@/lib/appwrite/client";
import type { AppwriteUser } from "@/lib/appwrite/auth";
import { isSupabaseProvider } from "./config";
import * as supabase from "./providers/supabase";
import type { BackendUser, UserProfile } from "./types";

function toBackendUserFromAppwrite(user: AppwriteUser): BackendUser {
  return {
    id: user.$id,
    name: typeof user.name === "string" ? user.name : "",
    email: typeof user.email === "string" ? user.email : "",
  };
}

/** True when the active cloud backend credentials are configured. */
export function isBackendConfigured(): boolean {
  if (isSupabaseProvider()) return supabase.isSupabaseConfigured();
  return isAppwriteConfigured();
}

/** Ping cloud backend on launch — logs result to console. */
export function pingBackend(): void {
  if (isSupabaseProvider()) {
    supabase.pingSupabase();
    return;
  }
  pingAppwrite();
}

/**
 * Build OAuth sign-in URL for the system browser (Google).
 * Supabase returns a Promise (PKCE); Appwrite is synchronous.
 */
export function getOAuthUrl(callbackPort: number, state: string): string | Promise<string> {
  if (isSupabaseProvider()) {
    return supabase.signInWithGoogle(callbackPort, state);
  }
  return appwriteGetOAuthUrl(callbackPort, state);
}

/** Exchange OAuth callback credentials for a session (Appwrite). */
export async function createSessionFromOAuth(
  userId: string,
  secret: string
): Promise<BackendUser> {
  const user = await appwriteCreateSession(userId, secret);
  return toBackendUserFromAppwrite(user);
}

/** Exchange Supabase PKCE authorization code for a session. */
export async function exchangeOAuthCode(code: string): Promise<BackendUser> {
  return supabase.exchangeOAuthCode(code);
}

/** Set Supabase session from OAuth hash tokens (implicit flow bridge). */
export async function setSessionFromTokens(
  accessToken: string,
  refreshToken: string
): Promise<BackendUser> {
  return supabase.setSessionFromTokens(accessToken, refreshToken);
}

/** Return the active session user, or null if signed out / expired. */
export async function getActiveSession(): Promise<BackendUser | null> {
  if (isSupabaseProvider()) {
    return supabase.getCurrentUser();
  }
  const user = await appwriteGetActiveSession();
  return user ? toBackendUserFromAppwrite(user) : null;
}

/** End the current cloud session. */
export async function logout(): Promise<void> {
  if (isSupabaseProvider()) {
    return supabase.signOut();
  }
  return appwriteLogout();
}

/**
 * Resolve cloud user → local UserProfile and sync profile to remote DB.
 * Also initializes server-side usage counters via Tauri.
 */
export async function resolveUserProfile(
  user: BackendUser,
  plan?: string
): Promise<UserProfile> {
  if (isSupabaseProvider()) {
    return supabase.resolveUserProfile(user, plan);
  }
  const awUser: AppwriteUser = {
    $id: user.id,
    name: user.name,
    email: user.email,
  };
  return appwriteResolveUserProfile(awUser, plan);
}
