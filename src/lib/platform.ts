type Platform = "macos" | "windows" | "linux" | "unknown";

/**
 * Detect the current operating system.
 */
export function getPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export const isMac = getPlatform() === "macos";
export const isWindows = getPlatform() === "windows";
export const isLinux = getPlatform() === "linux";
