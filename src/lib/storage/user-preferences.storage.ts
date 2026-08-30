import { STORAGE_KEYS } from "@/config/constants";
import { safeLocalStorage } from "./helper";
import { loadUserProfile } from "./auth";

export interface UserPreferences {
  displayName: string;
  aliases: string;
  assistantNotes: string;
}

function defaultPreferences(): UserPreferences {
  const user = loadUserProfile();
  return {
    displayName: user?.name ?? "",
    aliases: "",
    assistantNotes: "",
  };
}

export function loadUserPreferences(): UserPreferences {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
  if (!stored) return defaultPreferences();
  try {
    const parsed = JSON.parse(stored) as Partial<UserPreferences>;
    const defaults = defaultPreferences();
    return {
      displayName:
        typeof parsed.displayName === "string"
          ? parsed.displayName
          : defaults.displayName,
      aliases: typeof parsed.aliases === "string" ? parsed.aliases : "",
      assistantNotes:
        typeof parsed.assistantNotes === "string" ? parsed.assistantNotes : "",
    };
  } catch {
    return defaultPreferences();
  }
}

export function saveUserPreferences(prefs: UserPreferences): void {
  safeLocalStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(prefs));
}
