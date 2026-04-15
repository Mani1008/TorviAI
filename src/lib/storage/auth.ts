import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { UserProfile } from "@/types/settings";

export function saveAuthToken(token: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
}

export function loadAuthToken(): string | null {
  return safeLocalStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
}

export function clearAuthToken(): void {
  safeLocalStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
}

export function saveUserProfile(profile: UserProfile): void {
  safeLocalStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profile));
}

export function loadUserProfile(): UserProfile | null {
  const raw = safeLocalStorage.getItem(STORAGE_KEYS.USER_PROFILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
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
  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
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
  }
}
