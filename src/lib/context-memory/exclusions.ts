import type { ContextChunk } from "@/lib/database/context-store";

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

function haystack(chunk: Pick<ContextChunk, "window_title" | "url" | "text_content">): string {
  return [
    chunk.window_title ?? "",
    chunk.url ?? "",
    chunk.text_content.slice(0, 400),
  ]
    .join(" ")
    .toLowerCase();
}

/** True when a capture is internal Torvi architecture / roadmap documentation. */
export function isExcludedArchitectureCapture(
  chunk: Pick<ContextChunk, "window_title" | "url" | "text_content" | "app_name">
): boolean {
  const app = (chunk.app_name ?? "").toLowerCase();
  if (app.includes("ai-assistant") || app.includes("torvi")) return true;

  const text = haystack(chunk);

  if (EXCLUDED_TITLE_OR_URL_FRAGMENTS.some((frag) => text.includes(frag))) {
    return true;
  }

  // Vite dev server static architecture HTML under /docs/
  const url = (chunk.url ?? "").toLowerCase();
  if (url.includes("/docs/") && url.endsWith(".html")) return true;

  const body = chunk.text_content.toLowerCase();
  const markerHits = EXCLUDED_CONTENT_MARKERS.filter((m) => body.includes(m)).length;
  if (markerHits >= 2) return true;

  return false;
}

export function filterArchitectureCaptures<T extends ContextChunk>(chunks: T[]): T[] {
  return chunks.filter((c) => !isExcludedArchitectureCapture(c));
}
