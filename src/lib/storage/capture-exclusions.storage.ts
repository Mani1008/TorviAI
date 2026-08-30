import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "@/config/constants";
import type { CaptureExclusions } from "@/types/settings";
import { isTauri } from "@/lib/platform";
import { safeLocalStorage } from "./helper";

const DEFAULT_CAPTURE_EXCLUSIONS: CaptureExclusions = {
  blockedApps: [],
  blockedDomains: [],
};

/** Normalize an app / process name for blocklist matching. */
export function normalizeBlockedApp(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/\s+/g, " ");
}

/** Normalize a domain or URL for blocklist matching. */
export function normalizeBlockedDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0] ?? "";
  value = value.split(":")[0] ?? "";
  return value;
}

function normalizeExclusions(exclusions: CaptureExclusions): CaptureExclusions {
  const blockedApps = [
    ...new Set(
      exclusions.blockedApps
        .map(normalizeBlockedApp)
        .filter((entry) => entry.length > 0)
    ),
  ];
  const blockedDomains = [
    ...new Set(
      exclusions.blockedDomains
        .map(normalizeBlockedDomain)
        .filter((entry) => entry.length > 0)
    ),
  ];
  return { blockedApps, blockedDomains };
}

export function loadCaptureExclusions(): CaptureExclusions {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.CAPTURE_EXCLUSIONS);
  if (!stored) return { ...DEFAULT_CAPTURE_EXCLUSIONS };
  try {
    const parsed = JSON.parse(stored) as Partial<CaptureExclusions>;
    return normalizeExclusions({
      blockedApps: Array.isArray(parsed.blockedApps) ? parsed.blockedApps : [],
      blockedDomains: Array.isArray(parsed.blockedDomains)
        ? parsed.blockedDomains
        : [],
    });
  } catch {
    return { ...DEFAULT_CAPTURE_EXCLUSIONS };
  }
}

/** Push exclusions to the Rust capture filter (no-op in browser dev). */
export async function applyCaptureExclusionsToBackend(
  exclusions: CaptureExclusions = loadCaptureExclusions()
): Promise<void> {
  if (!isTauri()) return;
  const normalized = normalizeExclusions(exclusions);
  await invoke("set_capture_exclusions", {
    blockedApps: normalized.blockedApps,
    blockedDomains: normalized.blockedDomains,
  });
}

export function saveCaptureExclusions(exclusions: CaptureExclusions): CaptureExclusions {
  const normalized = normalizeExclusions(exclusions);
  safeLocalStorage.setItem(
    STORAGE_KEYS.CAPTURE_EXCLUSIONS,
    JSON.stringify(normalized)
  );
  void applyCaptureExclusionsToBackend(normalized).catch(console.warn);
  return normalized;
}

export function addBlockedApp(
  exclusions: CaptureExclusions,
  raw: string
): CaptureExclusions {
  const entry = normalizeBlockedApp(raw);
  if (!entry || exclusions.blockedApps.includes(entry)) return exclusions;
  return saveCaptureExclusions({
    ...exclusions,
    blockedApps: [...exclusions.blockedApps, entry],
  });
}

export function removeBlockedApp(
  exclusions: CaptureExclusions,
  app: string
): CaptureExclusions {
  return saveCaptureExclusions({
    ...exclusions,
    blockedApps: exclusions.blockedApps.filter((entry) => entry !== app),
  });
}

export function addBlockedDomain(
  exclusions: CaptureExclusions,
  raw: string
): CaptureExclusions {
  const entry = normalizeBlockedDomain(raw);
  if (!entry || exclusions.blockedDomains.includes(entry)) return exclusions;
  return saveCaptureExclusions({
    ...exclusions,
    blockedDomains: [...exclusions.blockedDomains, entry],
  });
}

export function removeBlockedDomain(
  exclusions: CaptureExclusions,
  domain: string
): CaptureExclusions {
  return saveCaptureExclusions({
    ...exclusions,
    blockedDomains: exclusions.blockedDomains.filter((entry) => entry !== domain),
  });
}

export function isAppExcluded(
  exclusions: CaptureExclusions,
  processName: string
): boolean {
  const app = normalizeBlockedApp(processName);
  return exclusions.blockedApps.some(
    (blocked) => app.includes(blocked) || blocked.includes(app)
  );
}

export function isDomainExcluded(
  exclusions: CaptureExclusions,
  host: string
): boolean {
  const normalized = normalizeBlockedDomain(host);
  return exclusions.blockedDomains.some(
    (domain) =>
      normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

export function setAppExcluded(
  exclusions: CaptureExclusions,
  processName: string,
  excluded: boolean
): CaptureExclusions {
  const key = normalizeBlockedApp(processName);
  if (!key) return exclusions;
  if (excluded) return addBlockedApp(exclusions, key);
  return saveCaptureExclusions({
    ...exclusions,
    blockedApps: exclusions.blockedApps.filter(
      (blocked) => !(key.includes(blocked) || blocked.includes(key))
    ),
  });
}

export function setDomainExcluded(
  exclusions: CaptureExclusions,
  host: string,
  excluded: boolean
): CaptureExclusions {
  const key = normalizeBlockedDomain(host);
  if (!key) return exclusions;
  if (excluded) return addBlockedDomain(exclusions, key);
  return saveCaptureExclusions({
    ...exclusions,
    blockedDomains: exclusions.blockedDomains.filter((entry) => entry !== key),
  });
}
