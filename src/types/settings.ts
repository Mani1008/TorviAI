/**
 * Screenshot capture configuration.
 */
export interface ScreenshotConfig {
  /** "auto" captures on every message, "manual" requires user trigger */
  mode: "auto" | "manual";
  /** System prompt used when analyzing screenshots */
  autoPrompt: string;
  /** Whether screenshot feature is enabled */
  enabled: boolean;
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
