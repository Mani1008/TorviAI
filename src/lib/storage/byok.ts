import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";

export interface ByokConfig {
  providerId: string;
  apiKey: string;
  modelId: string;
}

export function saveByokConfig(config: ByokConfig): void {
  safeLocalStorage.setItem(STORAGE_KEYS.BYOK_CONFIG, JSON.stringify(config));
}

export function loadByokConfig(): ByokConfig | null {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.BYOK_CONFIG);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function clearByokConfig(): void {
  safeLocalStorage.removeItem(STORAGE_KEYS.BYOK_CONFIG);
}

export function loadProviderMode(): "openrouter" | "byok" {
  const v = safeLocalStorage.getItem(STORAGE_KEYS.PROVIDER_MODE);
  return v === "byok" ? "byok" : "openrouter";
}

export function saveProviderMode(mode: "openrouter" | "byok"): void {
  safeLocalStorage.setItem(STORAGE_KEYS.PROVIDER_MODE, mode);
}
