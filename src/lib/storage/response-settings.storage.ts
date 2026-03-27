import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { ResponseSettings } from "@/types/settings";

const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  length: "auto",
  language: "English",
};

export function saveResponseSettings(settings: ResponseSettings): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.RESPONSE_SETTINGS,
    JSON.stringify(settings)
  );
}

export function loadResponseSettings(): ResponseSettings {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.RESPONSE_SETTINGS);
  if (!stored) return DEFAULT_RESPONSE_SETTINGS;
  try {
    return JSON.parse(stored);
  } catch {
    return DEFAULT_RESPONSE_SETTINGS;
  }
}
