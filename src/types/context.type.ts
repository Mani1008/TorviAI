import type { ScreenshotConfig, CustomizableState } from "./settings";

/**
 * Shape of the global AppContext value.
 * API provider configuration is handled by the Rust backend — not user-facing.
 */
export interface IContextType {
  // System Prompt
  systemPrompt: string;
  updateSystemPrompt: (prompt: string) => void;

  // Screenshot
  screenshotConfiguration: ScreenshotConfig;
  updateScreenshotConfiguration: (config: Partial<ScreenshotConfig>) => void;

  // Customization
  customizable: CustomizableState;
  updateCustomizable: (state: Partial<CustomizableState>) => void;

  // License
  torviApiEnabled: boolean;
  toggleTorviApi: (enabled: boolean) => void;
  hasActiveLicense: boolean;
  setHasActiveLicense: (active: boolean) => void;
}
