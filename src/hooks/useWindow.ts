import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const TOOLBAR_HEIGHT = 40;
const EXPANDED_HEIGHT = 600;

/**
 * Hook for controlling the overlay window height.
 * The window starts as a 600×54 toolbar and expands to 600×600 when showing responses.
 */
export function useWindow() {
  const expand = useCallback(async () => {
    try {
      await invoke("set_window_height", { height: EXPANDED_HEIGHT });
    } catch (e) {
      console.error("Failed to expand window:", e);
    }
  }, []);

  const collapse = useCallback(async () => {
    try {
      await invoke("set_window_height", { height: TOOLBAR_HEIGHT });
    } catch (e) {
      console.error("Failed to collapse window:", e);
    }
  }, []);

  const setHeight = useCallback(async (height: number) => {
    try {
      await invoke("set_window_height", { height });
    } catch (e) {
      console.error("Failed to set window height:", e);
    }
  }, []);

  return { expand, collapse, setHeight, TOOLBAR_HEIGHT, EXPANDED_HEIGHT };
}
