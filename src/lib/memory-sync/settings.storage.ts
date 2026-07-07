import { safeLocalStorage } from "@/lib/storage/helper";

const STORAGE_KEY = "torvi_memory_sync_settings_v1";

export interface MemorySyncSettings {
  /** Opt-in: upload local context chunks to Supabase memory_items. */
  enabled: boolean;
  /** Encrypt content client-side before upload (recommended). */
  encryptCloud: boolean;
  lastSyncAt: number | null;
  lastSyncedCount: number;
  lastSyncError: string | null;
}

const DEFAULTS: MemorySyncSettings = {
  enabled: false,
  encryptCloud: true,
  lastSyncAt: null,
  lastSyncedCount: 0,
  lastSyncError: null,
};

export function loadMemorySyncSettings(): MemorySyncSettings {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveMemorySyncSettings(patch: Partial<MemorySyncSettings>): MemorySyncSettings {
  const next = { ...loadMemorySyncSettings(), ...patch };
  safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
