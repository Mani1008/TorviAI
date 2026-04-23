import { STORAGE_KEYS, API_BASE_URL } from "@/config/constants";

/** Read the stored auth token from localStorage. */
export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
}

/** Persist the token received from the OAuth callback. */
export function saveAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
}

/** Remove the token (logout). */
export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
}

/**
 * Verify the stored token is still valid by calling the web API.
 * Returns the user object on success, null if invalid / no token.
 *
 * During development (no API yet), set VITE_SKIP_AUTH_CHECK=true in .env
 * to bypass this and let the app open without a real token.
 */
export async function verifyToken(): Promise<{ id: string; name: string; email: string; plan: string } | null> {
  // Dev bypass — only active in dev builds; always false in production bundles.
  // VITE_SKIP_AUTH_CHECK has no effect when import.meta.env.DEV is false.
  if (import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH_CHECK === "true") {
    return { id: "dev", name: "Dev User", email: "dev@local", plan: "starter" };
  }

  const token = getAuthToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.valid ? data.user : null;
  } catch {
    // Network down / API not set up yet — fail open only in dev
    if (import.meta.env.DEV) return null;
    return null;
  }
}
