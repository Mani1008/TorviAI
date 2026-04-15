import type { ScreenshotConfig, CustomizableState, UsageStats } from "@/types/settings";

/**
 * LocalStorage key constants.
 */
export const STORAGE_KEYS = {
  SYSTEM_PROMPT: "system_prompt",
  SCREENSHOT_CONFIG: "screenshot_config",
  CUSTOMIZABLE: "customizable",
  CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
  CUSTOM_STT_PROVIDERS: "curl_custom_speech_providers",
  SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
  SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
  SELECTED_MODEL: "pluely_selected_model",
  API_ENABLED: "pluely_api_enabled",
  RESPONSE_SETTINGS: "response_settings",
  SHORTCUTS: "shortcuts",
  PROVIDER_MODE: "pluely_provider_mode",
  BYOK_CONFIG: "pluely_byok_config",
  ONBOARDED: "pluely_onboarded",
  SESSION_COUNT: "pluely_session_count",
  AUTH_TOKEN: "pluely_auth_token",
  USER_PROFILE: "pluely_user_profile",
  USAGE_STATS: "pluely_usage_stats",
} as const;

/** Base URL of the landing page / web app (set in .env) */
export const APP_URL = import.meta.env.VITE_APP_URL || "http://localhost:3000";
/** Base URL for the web API */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

/**
 * Default system prompt for new conversations.
 */
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Be concise, accurate, and helpful.";

/**
 * Default screenshot configuration.
 */
export const DEFAULT_SCREENSHOT_CONFIG: ScreenshotConfig = {
  mode: "manual",
  autoIntervalSeconds: 10,
  autoPrompt: "Look at this screenshot carefully. Identify what is being shown \u2014 if it's a coding problem, provide a complete working solution with explanation; if it's an error or bug, diagnose and fix it; if it's a UI or design, critique and suggest improvements; if it's a document or article, summarize the key points. Be specific and actionable.",
  enabled: true,
};

/**
 * Default usage stats (reset each billing period).
 */
export const DEFAULT_USAGE_STATS: UsageStats = {
  listeningSeconds: 0,
  aiResponses: 0,
  periodStart: new Date().toISOString().slice(0, 10),
};

/**
 * Plan limits.
 */
export const PLAN_LIMITS = {
  starter: { listeningSeconds: 30 * 60, aiResponses: 30 },
  plus: { listeningSeconds: 2 * 60 * 60, aiResponses: 120 },
  pro: { listeningSeconds: -1, aiResponses: -1 },
} as const;

/**
 * Default app customization state.
 */
export const DEFAULT_CUSTOMIZABLE: CustomizableState = {
  appIcon: { isVisible: true },
  alwaysOnTop: { isEnabled: true },
  autostart: { isEnabled: false },
  cursor: { type: "default" },
};
