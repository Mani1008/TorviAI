import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { ResponseSettings } from "@/types/settings";
import { pushSettings } from "@/lib/appwrite";
import { loadUserProfile } from "./auth";

const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  length: "auto",
  language: "English",
};

export function saveResponseSettings(settings: ResponseSettings): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.RESPONSE_SETTINGS,
    JSON.stringify(settings)
  );
  // Async sync to Appwrite
  const profile = loadUserProfile();
  if (profile?.id) {
    pushSettings(profile.id).catch(console.warn);
  }
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
