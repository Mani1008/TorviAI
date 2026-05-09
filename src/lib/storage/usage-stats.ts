import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS, DEFAULT_USAGE_STATS, PLAN_LIMITS } from "@/config/constants";
import { loadUserProfile } from "./auth";
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

/**
 * Check if the user has exceeded their plan's AI response limit.
 * Returns null if within limits, or an error message string if exceeded.
 *
 * HIGH-02 NOTE: This check is client-side only and can be bypassed by a
 * technically sophisticated user. Authoritative enforcement must be implemented
 * server-side (e.g. an Appwrite Function that decrements atomically and rejects
 * requests when the counter reaches zero) before this feature is monetised.
 */
export function checkAiResponseLimit(): string | null {
  const profile = loadUserProfile();
  // "dev" plan (used by VITE_SKIP_AUTH_CHECK) and "pro" are treated as unlimited
  if (!profile) return null;
  const planKey = profile.plan === "dev" || profile.plan === "pro" ? profile.plan : (profile.plan === "plus" ? "plus" : "starter");
  const limits = PLAN_LIMITS[planKey];

  if ((limits.aiResponses as number) === -1) return null; // unlimited

  const stats = loadUsageStats();
  if (stats.aiResponses >= limits.aiResponses) {
    return `You've reached your ${planKey} plan limit of ${limits.aiResponses} AI responses. Upgrade your plan to continue.`;
  }
  return null;
}

/**
 * Check if the user has exceeded their plan's listening time limit.
 * Returns null if within limits, or an error message string if exceeded.
 */
export function checkListeningLimit(): string | null {
  const profile = loadUserProfile();
  if (!profile) return null;
  const planKey = profile.plan === "dev" || profile.plan === "pro" ? profile.plan : (profile.plan === "plus" ? "plus" : "starter");
  const limits = PLAN_LIMITS[planKey];

  if ((limits.listeningSeconds as number) === -1) return null; // unlimited

  const stats = loadUsageStats();
  if (stats.listeningSeconds >= limits.listeningSeconds) {
    const limitMin = Math.round(limits.listeningSeconds / 60);
    return `You've reached your ${planKey} plan limit of ${limitMin} minutes of listening time. Upgrade your plan to continue.`;
  }
  return null;
}
