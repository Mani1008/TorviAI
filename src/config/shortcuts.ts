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
    key: `${mod}+Shift+H`,
    description: "Show, focus, or hide the overlay window (global)",
  },
  {
    id: "focus_input",
    label: "Focus Input",
    key: `${mod}+Shift+I`,
    description: "Show overlay and focus the text input (global)",
  },
  {
    id: "toggle_dashboard",
    label: "Toggle Dashboard",
    key: `${mod}+Shift+D`,
    description: "Open or close the dashboard",
  },
  {
    id: "screenshot",
    label: "Screenshot Analysis",
    key: `${mod}+Shift+S`,
    description: "Capture a screenshot for AI vision analysis",
  },
  {
    id: "system_audio",
    label: "System Audio",
    key: `${mod}+Shift+A`,
    description: "Start/stop system audio capture & transcription",
  },
  {
    id: "microphone",
    label: "Microphone",
    key: `${mod}+Shift+M`,
    description: "Toggle microphone voice input",
  },
  {
    id: "clear_chat",
    label: "Clear Chat",
    key: `${mod}+Shift+X`,
    description: "Clear the current conversation",
  },
  {
    id: "glass_decrease",
    label: "Glass −",
    key: `${mod}+[`,
    description: "Decrease glass transparency by 5%",
  },
  {
    id: "glass_increase",
    label: "Glass +",
    key: `${mod}+]`,
    description: "Increase glass transparency by 5%",
  },
  {
    id: "move_window",
    label: "Move Window",
    key: `${mod}+Arrow Keys`,
    description: "Move the overlay window by 20px",
  },
  {
    id: "close_panel",
    label: "Close Panel",
    key: "Escape",
    description: "Clear chat and collapse the response panel",
  },
];
