import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";

const SESSION_MARKER = "pluely_session_active";

/**
 * Call once at app startup. Increments the lifetime session counter
 * if this is a new window/session (sessionStorage is cleared on close).
 */
export function initSessionTracking(): void {
  if (!sessionStorage.getItem(SESSION_MARKER)) {
    sessionStorage.setItem(SESSION_MARKER, "1");
    const prev = Number(safeLocalStorage.getItem(STORAGE_KEYS.SESSION_COUNT) ?? "0");
    safeLocalStorage.setItem(STORAGE_KEYS.SESSION_COUNT, String(prev + 1));
  }
}

export function loadSessionCount(): number {
  return Number(safeLocalStorage.getItem(STORAGE_KEYS.SESSION_COUNT) ?? "0");
}
