/**
 * Screenshot capture configuration.
 */
export interface ScreenshotConfig {
  /** "auto" captures at intervals, "manual" requires user trigger */
  mode: "auto" | "manual";
  /** Interval in seconds for auto capture (5, 10, 15, 30, 60) */
  autoIntervalSeconds: number;
  /** System prompt used when analyzing screenshots */
  autoPrompt: string;
  /** Whether screenshot feature is enabled */
  enabled: boolean;
}

/**
 * Authenticated user profile (from landing page / web backend).
 */
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  plan: "starter" | "plus" | "pro" | "dev";
}

/**
 * Usage tracking for billing / credits.
 */
export interface UsageStats {
  /** Listening time in seconds (mic + system audio combined) */
  listeningSeconds: number;
  /** Number of AI responses received */
  aiResponses: number;
  /** Date string (YYYY-MM-DD) when usage tracking started / last reset */
  periodStart: string;
}

/**
 * Billing plan limits.
 */
export interface PlanLimits {
  /** Max listening seconds (-1 = unlimited) */
  listeningSeconds: number;
  /** Max AI responses (-1 = unlimited) */
  aiResponses: number;
}

/**
 * App customization state (persisted to localStorage).
 */
export interface CustomizableState {
  appIcon: { isVisible: boolean };
  alwaysOnTop: { isEnabled: boolean };
  autostart: { isEnabled: boolean };
  cursor: { type: "invisible" | "default" | "auto" };
}

/**
 * Response generation preferences.
 */
export interface ResponseSettings {
  /** "short" = 2-4 sentences, "medium" = 1-2 paragraphs, "auto" = AI decides */
  length: "short" | "medium" | "auto";
  /** Language for responses (e.g., "English", "Spanish") */
  language: string;
}
