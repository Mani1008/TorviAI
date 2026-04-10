import type { ScreenshotConfig, CustomizableState } from "@/types/settings";

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
} as const;

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
  autoPrompt: "Analyze this screenshot and describe what you see.",
  enabled: true,
};

/**
 * Default app customization state.
 */
export const DEFAULT_CUSTOMIZABLE: CustomizableState = {
  appIcon: { isVisible: true },
  alwaysOnTop: { isEnabled: true },
  autostart: { isEnabled: false },
  cursor: { type: "default" },
};
