import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { UserProfile } from "@/types/settings";

// Auth token lives exclusively in sessionStorage.
// sessionStorage is cleared when the app (all WebView windows) is closed,
// preventing tokens from persisting across separate app launches.
// Auth is re-verified on every launch via Appwrite session check in the gate.
const safeSessionStorage = {
  getItem: (key: string): string | null => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    try { sessionStorage.setItem(key, value); } catch { /* storage full */ }
  },
  removeItem: (key: string): void => {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export function saveAuthToken(token: string): void {
  safeSessionStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  // NOTE: Intentionally NOT written to localStorage — tokens must not persist
  // across app restarts. Cross-window access is handled by Appwrite session
  // re-check on each window's mount (gate always runs first).
}

export function loadAuthToken(): string | null {
  return safeSessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
}

export function clearAuthToken(): void {
  safeSessionStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  // Also clear any legacy localStorage copy left by older builds
  safeLocalStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
}

const ALLOWED_PLANS = new Set(["starter", "free", "plus", "pro", "dev"]);

/** Normalize Appwrite's "free" plan value to the app's canonical "starter". */
function normalizePlan(plan: string): UserProfile["plan"] {
  return plan === "free" ? "starter" : plan as UserProfile["plan"];
}

export function saveUserProfile(profile: UserProfile): void {
  // Normalize before saving so "free" never ends up in localStorage
  const normalized = { ...profile, plan: normalizePlan(profile.plan) };
  safeLocalStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(normalized));
}

export function loadUserProfile(): UserProfile | null {
  const raw = safeLocalStorage.getItem(STORAGE_KEYS.USER_PROFILE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Validate required fields — reject any tampered or malformed profile
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.id !== "string" || parsed.id.length === 0 ||
      typeof parsed.email !== "string" ||
      typeof parsed.name !== "string" ||
      !ALLOWED_PLANS.has(parsed.plan)
    ) {
      console.warn("[Storage] Corrupt user profile — clearing");
      safeLocalStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
      return null;
    }
    return parsed as UserProfile;
  } catch {
    safeLocalStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
    return null;
  }
}

export function clearUserProfile(): void {
  safeLocalStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
}

/**
 * Verify a JWT token against the web backend.
 * Returns the user profile if valid, null otherwise.
 */
export async function verifyToken(token: string, apiBase: string): Promise<UserProfile | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id ?? data.userId ?? "",
      email: data.email ?? "",
      name: data.name ?? data.displayName ?? "",
      avatarUrl: data.avatarUrl ?? data.avatar ?? undefined,
      plan: data.plan ?? "starter",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
