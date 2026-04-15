import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS, DEFAULT_USAGE_STATS } from "@/config/constants";
import type { UsageStats } from "@/types/settings";

export function saveUsageStats(stats: UsageStats): void {
  safeLocalStorage.setItem(STORAGE_KEYS.USAGE_STATS, JSON.stringify(stats));
}

export function loadUsageStats(): UsageStats {
  const raw = safeLocalStorage.getItem(STORAGE_KEYS.USAGE_STATS);
  if (!raw) return { ...DEFAULT_USAGE_STATS };
  try {
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_USAGE_STATS };
  }
}

export function incrementAiResponses(): UsageStats {
  const stats = loadUsageStats();
  stats.aiResponses += 1;
  saveUsageStats(stats);
  return stats;
}

export function addListeningSeconds(seconds: number): UsageStats {
  const stats = loadUsageStats();
  stats.listeningSeconds += seconds;
  saveUsageStats(stats);
  return stats;
}

export function resetUsageStats(): void {
  saveUsageStats({
    listeningSeconds: 0,
    aiResponses: 0,
    periodStart: new Date().toISOString().slice(0, 10),
  });
}
