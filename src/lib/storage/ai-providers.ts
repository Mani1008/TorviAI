import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import { DEFAULT_MODEL_ID } from "@/config/models.constants";

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
