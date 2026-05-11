import type { Message } from "@/types/completion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSelectedModel } from "@/lib/storage/ai-providers";
import { getRecentContext } from "@/lib/database/context-store";

interface StreamAIFromConfigParams {
  messages: Message[];
  systemPrompt: string;
  images?: string[];
  abortSignal?: AbortSignal;
  modelId?: string;
}

/**
 * Stream an AI response via the Rust backend proxy.
 *
 * The Rust command `stream_ai_request` holds the API keys and makes the HTTP
 * call. It emits:
 *   `ai-chunk-{requestId}` — { content: string }
 *   `ai-done-{requestId}`  — stream complete
 *   `ai-error-{requestId}` — { error: string } user-safe message
 *
 * API keys are never sent to the frontend.
 */
export async function* streamAIFromConfig(
  params: StreamAIFromConfigParams
): AsyncGenerator<string> {
  const { messages, systemPrompt, images, abortSignal, modelId } = params;

  if (abortSignal?.aborted) return;

  const resolvedModel = modelId ?? loadSelectedModel();
  const requestId = crypto.randomUUID();

  // Queue to bridge Tauri events → async generator
  const queue: string[] = [];
  let done = false;
  let streamError: string | null = null;
  let resolver: (() => void) | null = null;
  const wake = () => { const r = resolver; resolver = null; r?.(); };

  // Register listeners BEFORE invoke to guarantee no events are dropped
  const [unlistenChunk, unlistenDone, unlistenError] = await Promise.all([
    listen<{ content: string }>(`ai-chunk-${requestId}`, (e) => {
      queue.push(e.payload.content);
      wake();
    }),
    listen<unknown>(`ai-done-${requestId}`, () => {
      done = true;
      wake();
    }),
    listen<{ error: string }>(`ai-error-${requestId}`, (e) => {
      streamError = e.payload.error;
      done = true;
      wake();
    }),
  ]);

  // Filter out any system messages — Rust injects system_prompt as first message
  const apiMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  // Start the Rust streaming request (non-blocking; result arrives as events)
  invoke("stream_ai_request", {
    modelId: resolvedModel,
    messages: apiMessages,
    systemPrompt,
    images: images ?? null,
    requestId,
  }).catch((err: unknown) => {
    streamError = `Failed to start AI request: ${String(err)}`;
    done = true;
    wake();
  });

  try {
    while (true) {
      // Drain buffered chunks
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) {
        // Drain any final chunks that arrived before the done event
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (streamError) yield streamError;
        return;
      }
      if (abortSignal?.aborted) return;
      // Park until the next event
      await new Promise<void>((res) => {
        resolver = res;
        abortSignal?.addEventListener("abort", () => res(), { once: true });
      });
    }
  } finally {
    unlistenChunk();
    unlistenDone();
    unlistenError();
  }
}

// ─── RAG context injection ─────────────────────────────────────────────────────

/**
 * Augment the system prompt with the most recent screen context captured by the
 * UIAutomation watcher.  Used to give the AI awareness of what the user is
 * currently working on without any manual copy-paste.
 *
 * Only injects chunks that are relevant to the user's message (keyword overlap)
 * or were captured within the last 5 minutes.  Each chunk is truncated to
 * 500 characters to prevent runaway token usage on large files.
 *
 * Non-fatal: if context cannot be fetched (DB not ready, no chunks yet) the
 * original systemPrompt is returned unchanged.
 *
 * @param systemPrompt  The base system prompt to augment.
 * @param userMessage   The current user message (used for relevance filtering).
 */
export async function buildContextAwareSystemPrompt(
  systemPrompt: string,
  userMessage: string = ""
): Promise<string> {
  try {
    const chunks = await getRecentContext(5, 30);
    if (chunks.length === 0) return systemPrompt;

    // Build a set of significant words from the user's message (length > 4).
    const userWords = new Set(
      userMessage
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4)
    );

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;

    // Keep a chunk if:
    //   a) Any user word appears in its text (keyword relevance), OR
    //   b) It was captured in the last 5 minutes (always fresh context)
    const relevantChunks = chunks.filter((chunk) => {
      if (chunk.captured_at >= fiveMinutesAgo) return true;
      if (userWords.size === 0) return true; // no words to filter on — include all
      const lower = chunk.text_content.toLowerCase();
      return [...userWords].some((word) => lower.includes(word));
    });

    if (relevantChunks.length === 0) return systemPrompt;

    const CHUNK_LIMIT = 500;
    const contextBlock = relevantChunks
      .map((c) => {
        const meta = [c.app_name, c.window_title, c.url].filter(Boolean).join(" • ");
        // Truncate long chunks so a single file doesn’t dominate the context window.
        const text =
          c.text_content.length > CHUNK_LIMIT
            ? c.text_content.slice(0, CHUNK_LIMIT) + "…"
            : c.text_content;
        return `[${meta}]\n${text}`;
      })
      .join("\n\n---\n\n");

    return (
      systemPrompt +
      `\n\n## Current Screen Context\n` +
      `The user currently has the following content open on their screen:\n\n` +
      contextBlock +
      `\n\nReference this context when it is relevant to the user’s question. ` +
      `If it is not relevant, ignore it.`
    );
  } catch {
    // Context fetch failure is non-fatal — proceed without injection.
    return systemPrompt;
  }
}