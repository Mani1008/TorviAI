import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";

/**
 * Bump when icon extraction changes so HMR doesn't keep broken base64
 * from a previous Rust build in this module Map.
 */
const CACHE_VERSION = "v4";

/** Module cache so remounts / StrictMode don't re-hit Rust for the same key. */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** PNG files always start with bytes 89 50 4E 47 → base64 "iVBOR…". */
function isPngBase64(b64: string): boolean {
  return b64.startsWith("iVBOR");
}

function cacheKey(appName: string): string {
  return `${CACHE_VERSION}:${appName.trim().toLowerCase()}`;
}

function fetchIcon(appName: string): Promise<string | null> {
  const key = cacheKey(appName);
  if (!appName.trim()) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  if (inflight.has(key)) return inflight.get(key)!;

  const promise = invoke<string>("get_app_icon", { appName })
    .then((b64) => {
      const value = b64 && isPngBase64(b64) ? b64 : null;
      cache.set(key, value);
      return value;
    })
    .catch(() => {
      cache.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Load a Windows app icon as a base64 PNG via `get_app_icon`.
 * Pass an exe name ("chrome"), process name ("Cursor"), or full `.exe` / `.lnk` path.
 * Returns `null` while loading or when no icon is found.
 */
export function useAppIcon(appName: string): string | null {
  const key = appName.trim();
  const [icon, setIcon] = useState<string | null>(() => {
    if (!key) return null;
    return cache.get(cacheKey(key)) ?? null;
  });

  useEffect(() => {
    if (!key || !isTauri()) {
      setIcon(null);
      return;
    }

    let cancelled = false;
    const cached = cache.get(cacheKey(key));
    if (cached !== undefined) {
      setIcon(cached);
      return;
    }

    setIcon(null);
    void fetchIcon(key).then((b64) => {
      if (!cancelled) setIcon(b64);
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return icon;
}
