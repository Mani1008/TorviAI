import type { Shortcut } from "@/types/shortcuts";

/**
 * Detect platform for key naming.
 */
const isMac = navigator.userAgent.includes("Mac");
const mod = isMac ? "Cmd" : "Ctrl";

/**
 * Default global keyboard shortcuts.
 */
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    id: "toggle_window",
    label: "Toggle Window",
    key: `${mod}+\\`,
    description: "Show or hide the overlay window",
  },
  {
    id: "toggle_dashboard",
    label: "Toggle Dashboard",
    key: `${mod}+Shift+D`,
    description: "Open or close the dashboard",
  },
  {
    id: "focus_input",
    label: "Focus Input",
    key: `${mod}+Shift+I`,
    description: "Focus the text input field",
  },
  {
    id: "screenshot",
    label: "Screenshot",
    key: `${mod}+Shift+S`,
    description: "Capture a screenshot for AI analysis",
  },
  {
    id: "audio_recording",
    label: "Audio Recording",
    key: `${mod}+Shift+A`,
    description: "Start/stop audio recording",
  },
  {
    id: "system_audio",
    label: "System Audio",
    key: `${mod}+Shift+M`,
    description: "Start/stop system audio capture",
  },
  {
    id: "move_window",
    label: "Move Window",
    key: `${mod}+Arrow Keys`,
    description: "Move the overlay window around the screen",
  },
];
