import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import { DEFAULT_MODEL_ID } from "@/config/models.constants";
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
 * Each entry is validated: must have a non-empty `curl` string.
 * Invalid entries are silently dropped to prevent injection via a
 * tampered localStorage value.
 */
export function loadCustomAIProviders(): TYPE_PROVIDER[] {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is TYPE_PROVIDER =>
        typeof p === "object" &&
        p !== null &&
        typeof p.curl === "string" &&
        p.curl.trim().length > 0 &&
        (p.id === undefined || typeof p.id === "string") &&
        (p.name === undefined || typeof p.name === "string") &&
        (p.streaming === undefined || typeof p.streaming === "boolean") &&
        (p.responseContentPath === undefined || typeof p.responseContentPath === "string")
    );
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

/**
 * Save the selected OpenRouter model ID.
 */
export function saveSelectedModel(modelId: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, modelId);
}

/**
 * Load the selected OpenRouter model ID.
 */
export function loadSelectedModel(): string {
  return safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) ?? DEFAULT_MODEL_ID;
}
