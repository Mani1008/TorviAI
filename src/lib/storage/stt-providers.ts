import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { TYPE_PROVIDER } from "@/types/provider.type";

/**
 * Save custom STT providers to localStorage.
 */
export function saveCustomSttProviders(providers: TYPE_PROVIDER[]): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.CUSTOM_STT_PROVIDERS,
    JSON.stringify(providers)
  );
}

/**
 * Load custom STT providers from localStorage.
 */
export function loadCustomSttProviders(): TYPE_PROVIDER[] {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_STT_PROVIDERS);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}
