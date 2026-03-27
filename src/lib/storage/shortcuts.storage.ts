import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import type { Shortcut } from "@/types/shortcuts";

export function saveShortcuts(shortcuts: Shortcut[]): void {
  safeLocalStorage.setItem(STORAGE_KEYS.SHORTCUTS, JSON.stringify(shortcuts));
}

export function loadShortcuts(): Shortcut[] | null {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.SHORTCUTS);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}
