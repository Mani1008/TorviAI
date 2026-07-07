import type { ContextChunk } from "@/lib/database/context-store";
import type { CreateMemoryItemInput, CreateMemorySourceInput } from "@/lib/backend/types";

const MAX_EXCERPT = 2_000;
const MAX_TITLE = 200;
const MAX_SUMMARY = 500;

/** Map local content_type → memory_items.domain */
export function mapContentTypeToDomain(
  contentType: string,
  url: string | null
): string {
  if (url) return "browser";
  switch (contentType) {
    case "code":
      return "code";
    case "meeting":
      return "meeting";
    case "email":
      return "email";
    case "chat":
      return "people";
    case "document":
    case "project_management":
      return "project";
    default:
      return "generic";
  }
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export interface ChunkMemoryPayload {
  item: CreateMemoryItemInput;
  source: Omit<CreateMemorySourceInput, "memoryId">;
}

/**
 * Build Supabase memory_items + memory_sources rows from a local context chunk.
 * `cloudContent` is already encrypted when encryption is enabled.
 */
export function buildMemoryPayloadFromChunk(
  chunk: ContextChunk,
  cloudContent: string,
  encrypted: boolean
): ChunkMemoryPayload {
  const title =
    truncate(chunk.window_title || chunk.app_name || "Screen capture", MAX_TITLE);
  const summary = truncate(chunk.text_content, MAX_SUMMARY);
  const excerpt = truncate(chunk.text_content, MAX_EXCERPT);
  const capturedAt = new Date(chunk.captured_at * 1000).toISOString();

  return {
    item: {
      title,
      tags: [chunk.content_type, chunk.app_name].filter(Boolean),
      content: cloudContent,
      summary,
      knowledgeType: "reference",
      domain: mapContentTypeToDomain(chunk.content_type, chunk.url),
      importance: 5,
      createdBy: "import",
      contentHash: chunk.content_hash,
      metadata: {
        local_chunk_id: chunk.id,
        encrypted,
        app_name: chunk.app_name,
        window_title: chunk.window_title,
        content_type: chunk.content_type,
        chunk_index: chunk.chunk_index,
        parent_capture_id: chunk.parent_capture_id,
      },
    },
    source: {
      sourceKind: "local_chunk",
      sourceRef: chunk.id,
      appName: chunk.app_name,
      windowTitle: chunk.window_title,
      contentType: chunk.content_type,
      url: chunk.url,
      capturedAt,
      excerpt,
      metadata: {
        content_hash: chunk.content_hash,
        chunk_index: chunk.chunk_index,
      },
    },
  };
}
