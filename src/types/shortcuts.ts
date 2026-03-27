/**
 * A global keyboard shortcut binding.
 */
export interface Shortcut {
  /** Unique action identifier (e.g., "toggle_window", "screenshot") */
  id: string;
  /** Human-readable label */
  label: string;
  /** Key combination (e.g., "CommandOrControl+Shift+S") */
  key: string;
  /** Description of what the shortcut does */
  description: string;
}
