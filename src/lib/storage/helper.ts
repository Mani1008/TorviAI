/**
 * Safe localStorage wrapper that catches errors (e.g., storage full, disabled).
 */
export const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      console.warn(`[Storage] Failed to write key "${key}"`);
    }
  },

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      console.warn(`[Storage] Failed to remove key "${key}"`);
    }
  },
};
