import type { Message } from "@/types/completion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSelectedModel } from "@/lib/storage/ai-providers";

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