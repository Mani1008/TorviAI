import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { IContextType } from "@/types/context.type";
import type { ScreenshotConfig, CustomizableState } from "@/types/settings";
import {
  STORAGE_KEYS,
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SCREENSHOT_CONFIG,
  DEFAULT_CUSTOMIZABLE,
} from "@/config/constants";
import { pushSettings } from "@/lib/appwrite";
import { loadUserProfile } from "@/lib/storage/auth";

const AppContext = createContext<IContextType | undefined>(undefined);

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Silently fail if storage is full
  }
}

function loadSystemPromptFromStorage(): string {
  const storedPrompt = loadFromStorage(STORAGE_KEYS.SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT);

  if (storedPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT) {
    saveToStorage(STORAGE_KEYS.SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT);
    return DEFAULT_SYSTEM_PROMPT;
  }

  return storedPrompt;
}

export function AppProvider({ children }: { children: ReactNode }) {
  // --- System Prompt ---
  const [systemPrompt, setSystemPrompt] = useState(() => loadSystemPromptFromStorage());

  // --- Screenshot Config ---
  const [screenshotConfiguration, setScreenshotConfiguration] = useState<ScreenshotConfig>(
    loadFromStorage(STORAGE_KEYS.SCREENSHOT_CONFIG, DEFAULT_SCREENSHOT_CONFIG)
  );

  // --- Customization ---
  const [customizable, setCustomizable] = useState<CustomizableState>(
    loadFromStorage(STORAGE_KEYS.CUSTOMIZABLE, DEFAULT_CUSTOMIZABLE)
  );

  // --- License ---
  const [torviApiEnabled, setTorviApiEnabled] = useState(
    loadFromStorage(STORAGE_KEYS.API_ENABLED, false)
  );
  const [hasActiveLicense, setHasActiveLicense] = useState(false);

  // --- Update handlers ---
  const updateSystemPrompt = useCallback((prompt: string) => {
    setSystemPrompt(prompt);
    saveToStorage(STORAGE_KEYS.SYSTEM_PROMPT, prompt);
    // Sync to Appwrite
    const profile = loadUserProfile();
    if (profile?.id) {
      pushSettings(profile.id).catch(console.warn);
    }
  }, []);

  const updateScreenshotConfiguration = useCallback(
    (config: Partial<ScreenshotConfig>) => {
      setScreenshotConfiguration((prev) => {
        const updated = { ...prev, ...config };
        saveToStorage(STORAGE_KEYS.SCREENSHOT_CONFIG, updated);
        return updated;
      });
    },
    []
  );

  const updateCustomizable = useCallback(
    (state: Partial<CustomizableState>) => {
      setCustomizable((prev) => {
        const updated = { ...prev, ...state };
        saveToStorage(STORAGE_KEYS.CUSTOMIZABLE, updated);
        return updated;
      });
    },
    []
  );

  const toggleTorviApi = useCallback((enabled: boolean) => {
    setTorviApiEnabled(enabled);
    saveToStorage(STORAGE_KEYS.API_ENABLED, enabled);
  }, []);

  const value: IContextType = {
    systemPrompt,
    updateSystemPrompt,
    screenshotConfiguration,
    updateScreenshotConfiguration,
    customizable,
    updateCustomizable,
    torviApiEnabled,
    toggleTorviApi,
    hasActiveLicense,
    setHasActiveLicense,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): IContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
}
