import type { ContextChunk } from "@/lib/database/context-store";
import type { CaptureExclusions } from "@/types/settings";
import {
  loadCaptureExclusions,
  normalizeBlockedApp,
} from "@/lib/storage/capture-exclusions.storage";

/**
 * Internal architecture / product-doc filenames and URL fragments.
 * Keep in sync with `privacy_filter.rs` (Rust capture path).
 */
const EXCLUDED_TITLE_OR_URL_FRAGMENTS = [
  "company-brain.html",
  "company-brain.md",
  "architecture.html",
  "context-memory.html",
  "context-memory.md",
  "littlebird_architecture",
  "architecture.md",
  "desktop-app-features-roadmap.md",
  "supabase-schema-plan.md",
  "supabase-migration-report.md",
  "context-memory-architecture-review.md",
] as const;

/** Torvi dashboard / dev-server routes — never capture our own UI. */
const TORVI_APP_ROUTE_FRAGMENTS = [
  "/context-memory",
  "/dashboard",
  "/settings",
  "/chats",
  "/billing",
  "/shortcuts",
  "/screenshot",
  "/responses",
  "/gate",
  "/dev/supabase-test",
] as const;

const TORVI_DEV_HOST_FRAGMENTS = ["localhost:1420", "127.0.0.1:1420"] as const;

/** Distinctive phrases from generated architecture HTML viewers. */
const EXCLUDED_CONTENT_MARKERS = [
  "context memory — deep dive",
  "generated from architecture.md",
  "company brain — vision",
  "high-level pipeline",
  "rust modules",
  "no cloud sync",
  "on-device only",
] as const;

/** Distinctive phrases from Torvi's own dashboard UI (self-capture). */
const TORVI_UI_MARKERS = [
  "live feed of what the ai is observing from your screen",
  "cloud second brain",
  "how context memory works",
  "opt-in upload of local context chunks",
  "captured this session",
  "new chat",
  "context active",
] as const;

function haystack(chunk: Pick<ContextChunk, "window_title" | "url" | "text_content">): string {
  return [
    chunk.window_title ?? "",
    chunk.url ?? "",
    chunk.text_content.slice(0, 600),
  ]
    .join(" ")
    .toLowerCase();
}

function isTorviOwnUi(
  chunk: Pick<ContextChunk, "window_title" | "url" | "text_content" | "app_name">
): boolean {
  const app = (chunk.app_name ?? "").toLowerCase();
  const title = (chunk.window_title ?? "").toLowerCase();
  if (app.includes("ai-assistant") || app.includes("torvi")) return true;
  if (app.includes("msedgewebview2") && title.includes("ai assistant")) return true;

  if (title.includes("ai assistant - dashboard") || title.includes("ai assistant - torvi")) {
    return true;
  }

  const url = (chunk.url ?? "").toLowerCase();
  if (TORVI_DEV_HOST_FRAGMENTS.some((host) => url.includes(host))) {
    if (TORVI_APP_ROUTE_FRAGMENTS.some((route) => url.includes(route))) {
      return true;
    }
  }

  const body = chunk.text_content.toLowerCase();
  const uiHits = TORVI_UI_MARKERS.filter((m) => body.includes(m)).length;
  if (uiHits >= 3) return true;

  return false;
}

function isArchitectureDoc(
  chunk: Pick<ContextChunk, "window_title" | "url" | "text_content">
): boolean {
  const text = haystack(chunk);

  if (EXCLUDED_TITLE_OR_URL_FRAGMENTS.some((frag) => text.includes(frag))) {
    return true;
  }

  const url = (chunk.url ?? "").toLowerCase();
  if (url.includes("/docs/") && url.endsWith(".html")) return true;

  const body = chunk.text_content.toLowerCase();
  const markerHits = EXCLUDED_CONTENT_MARKERS.filter((m) => body.includes(m)).length;
  if (markerHits >= 2) return true;

  return false;
}

/** True when a capture is Torvi-internal (own UI, architecture docs, dev routes). */
export function isExcludedArchitectureCapture(
  chunk: Pick<ContextChunk, "window_title" | "url" | "text_content" | "app_name">
): boolean {
  return isTorviOwnUi(chunk) || isArchitectureDoc(chunk);
}

function hostFromUrl(url: string): string {
  let value = url.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  return (value.split("/")[0] ?? "").split(":")[0] ?? "";
}

/** True when the chunk matches a user-defined app or domain blocklist entry. */
export function isUserExcludedCapture(
  chunk: Pick<ContextChunk, "window_title" | "url" | "text_content" | "app_name">,
  exclusions: CaptureExclusions = loadCaptureExclusions()
): boolean {
  const app = normalizeBlockedApp(chunk.app_name ?? "");
  if (
    app &&
    exclusions.blockedApps.some(
      (blocked) => app.includes(blocked) || blocked.includes(app)
    )
  ) {
    return true;
  }

  const url = chunk.url ?? "";
  if (url) {
    const host = hostFromUrl(url);
    if (
      host &&
      exclusions.blockedDomains.some(
        (domain) => host === domain || host.endsWith(`.${domain}`)
      )
    ) {
      return true;
    }
  }

  const title = (chunk.window_title ?? "").toLowerCase();
  if (
    exclusions.blockedDomains.some((domain) => title.includes(domain))
  ) {
    return true;
  }

  return false;
}

/** True when a capture should be hidden from memory, RAG, and cloud sync. */
export function isExcludedCapture(
  chunk: Pick<ContextChunk, "window_title" | "url" | "text_content" | "app_name">
): boolean {
  return isExcludedArchitectureCapture(chunk) || isUserExcludedCapture(chunk);
}

export function filterExcludedCaptures<T extends ContextChunk>(chunks: T[]): T[] {
  return chunks.filter((c) => !isExcludedCapture(c));
}

/** @deprecated Use filterExcludedCaptures */
export function filterArchitectureCaptures<T extends ContextChunk>(chunks: T[]): T[] {
  return filterExcludedCaptures(chunks);
}
