import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { TYPE_PROVIDER } from "@/types/provider.type";

/**
 * Save custom AI providers to localStorage.
 */
export function saveCustomAIProviders(providers: TYPE_PROVIDER[]): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.CUSTOM_AI_PROVIDERS,
    JSON.stringify(providers)
  );
}

/**
 * Load custom AI providers from localStorage.
 */
export function loadCustomAIProviders(): TYPE_PROVIDER[] {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Save the selected AI provider + variables.
 */
export function saveSelectedAIProvider(
  provider: string,
  variables: Record<string, string>
): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.SELECTED_AI_PROVIDER,
    JSON.stringify({ provider, variables })
  );
}
