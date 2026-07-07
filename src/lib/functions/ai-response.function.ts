import type { Message, ContextSourceCitation } from "@/types/completion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSelectedModel } from "@/lib/storage/ai-providers";
import { getRecentContext, type ContextChunk } from "@/lib/database/context-store";
import { filterArchitectureCaptures } from "@/lib/context-memory/exclusions";

export interface ContextAwarePromptResult {
  systemPrompt: string;
  sources: ContextSourceCitation[];
}

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
 * Maximum number of distinct source chunks injected into a single prompt.
 * Raised to 10 to cover multi-app workflows (VS Code + Linear + Slack + browser
 * all contributing simultaneously), subject to per-app deduplication below.
 */
const RAG_MAX_CHUNKS = 10;

/**
 * Character budget per chunk after line-boundary truncation.
 * 2,000 chars ≈ 500 tokens — matches the Rust chunker window size so full
 * chunks reach the model without secondary truncation.
 */
const RAG_CHUNK_CHAR_LIMIT = 2_000;

/**
 * At most this many chunks from the same app_name are injected.
 * Raised to 3 so VS Code (the primary use-case) can contribute multiple
 * code sections (e.g. two open files or a function + its test) without
 * monopolising the full RAG_MAX_CHUNKS budget.
 */
const RAG_MAX_CHUNKS_PER_APP = 3;
// ─── BM25 ranking engine ───────────────────────────────────────────────────────

/** BM25 term-frequency saturation parameter (standard corpus value). */
const BM25_K1 = 1.5;

/** BM25 length-normalisation parameter (standard corpus value). */
const BM25_B = 0.75;

/**
 * Minimum BM25 score for a non-fresh chunk to survive the relevance filter.
 * Chunks below this threshold are pruned unless they fall within the recency
 * window, which keeps freshly-captured content always available.
 */
const BM25_MIN_SCORE = 0.5;

/**
 * Additive bonus applied to BM25 scores for chunks captured within the last
 * RECENCY_FRESH_SECS seconds. Ensures very recent screen activity is surfaced
 * even when it shares no vocabulary with the current query.
 */
const RECENCY_BONUS = 3.0;

/** Seconds within which a chunk is considered "fresh" and receives a bonus. */
const RECENCY_FRESH_SECS = 5 * 60;

/** Tokenise text: lowercase alphanumeric/underscore runs of 3+ chars. */
function tokenise(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
}

/** Count term occurrences within a token array. */
function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

interface BM25Corpus {
  /** Total number of documents in the corpus. */
  docCount: number;
  /** Average document length in tokens. */
  avgdl: number;
  /** Number of documents containing each term. */
  docFreq: Map<string, number>;
}

/** Build IDF statistics from a list of already-tokenised documents. */
function buildCorpus(tokenisedDocs: string[][]): BM25Corpus {
  let totalLen = 0;
  const docFreq = new Map<string, number>();

  for (const tokens of tokenisedDocs) {
    totalLen += tokens.length;
    for (const term of new Set(tokens)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const docCount = tokenisedDocs.length;
  return {
    docCount,
    avgdl: docCount === 0 ? 1 : totalLen / docCount,
    docFreq,
  };
}

/**
 * BM25 score for one document against a query.
 * Returns 0 when neither side has tokens or there is no term overlap.
 */
function bm25Score(
  queryTerms: string[],
  docTokens: string[],
  corpus: BM25Corpus
): number {
  if (queryTerms.length === 0 || docTokens.length === 0) return 0;

  const tf = termFrequencies(docTokens);
  const dl = docTokens.length;
  let score = 0;

  for (const term of queryTerms) {
    const tfVal = tf.get(term) ?? 0;
    if (tfVal === 0) continue;

    const ni = corpus.docFreq.get(term) ?? 0;
    // Robertson–Spärck Jones IDF with smoothing.
    const idf = Math.log((corpus.docCount - ni + 0.5) / (ni + 0.5) + 1);
    const lenNorm = 1 - BM25_B + BM25_B * (dl / corpus.avgdl);
    score += idf * (tfVal * (BM25_K1 + 1)) / (tfVal + BM25_K1 * lenNorm);
  }

  return score;
}
/**
 * Truncate `text` to at most `limit` characters, snapping back to the nearest
 * preceding newline so the result is always a complete line.
 * Falls back to a hard character cut only when no newline exists in range.
 */
function truncateAtLineBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastNewline = slice.lastIndexOf("\n");
  // Only snap to newline when it is within the final 40% of the budget —
  // avoids discarding too much content when newlines appear early in the slice.
  return lastNewline > limit * 0.6
    ? slice.slice(0, lastNewline) + "\n…"
    : slice + "…";
}

/** Max characters shown in citation snippet previews. */
const CITATION_SNIPPET_CHARS = 160;

function chunkToCitation(chunk: ContextChunk, snippetLimit = CITATION_SNIPPET_CHARS): ContextSourceCitation {
  const raw = chunk.text_content.trim().replace(/\s+/g, " ");
  const snippet =
    raw.length <= snippetLimit ? raw : `${raw.slice(0, snippetLimit).trimEnd()}…`;
  return {
    chunkId: chunk.id,
    appName: chunk.app_name,
    windowTitle: chunk.window_title,
    contentType: chunk.content_type,
    url: chunk.url,
    capturedAt: chunk.captured_at,
    snippet,
  };
}

/**
 * Rank and select context chunks for RAG injection.
 * Returns the final chunk list used in the prompt (empty if none qualify).
 */
async function selectContextChunks(
  currentMessage: string,
  history: { role: string; content: string | unknown }[]
): Promise<ContextChunk[]> {
  const chunks = filterArchitectureCaptures(
    await getRecentContext(RAG_MAX_CHUNKS * 2, 30)
  );
  if (chunks.length === 0) return [];

  const tokenisedDocs = chunks.map((c) => tokenise(c.text_content));
  const corpus = buildCorpus(tokenisedDocs);

  const queryText = [
    currentMessage,
    ...history
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => (typeof m.content === "string" ? m.content : "")),
  ].join(" ");

  const queryTerms = [...new Set(tokenise(queryText))];
  const nowSecs = Math.floor(Date.now() / 1000);

  const scored = chunks
    .map((chunk, i) => {
      const isFresh = chunk.captured_at >= nowSecs - RECENCY_FRESH_SECS;
      const score =
        bm25Score(queryTerms, tokenisedDocs[i], corpus) +
        (isFresh ? RECENCY_BONUS : 0);
      return { chunk, score };
    })
    .filter(({ score }) => score >= BM25_MIN_SCORE);

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);

  const seenApps = new Set<string>();
  const dedupedChunks = scored
    .filter(({ chunk }) => {
      const count = [...seenApps].filter((k) => k === chunk.app_name).length;
      if (count >= RAG_MAX_CHUNKS_PER_APP) return false;
      seenApps.add(chunk.app_name);
      return true;
    })
    .map(({ chunk }) => chunk);

  return dedupedChunks.slice(0, RAG_MAX_CHUNKS);
}

/**
 * Augment the system prompt with ranked screen context and return citation metadata.
 *
 * Non-fatal: any DB failure returns the original systemPrompt and empty sources.
 */
export async function buildContextAwarePrompt(
  systemPrompt: string,
  currentMessage: string = "",
  history: { role: string; content: string | unknown }[] = []
): Promise<ContextAwarePromptResult> {
  try {
    const finalChunks = await selectContextChunks(currentMessage, history);
    if (finalChunks.length === 0) {
      return { systemPrompt, sources: [] };
    }

    const sources = finalChunks.map((c) => chunkToCitation(c));

    const contextBlock = finalChunks
      .map((c) => {
        const meta = [c.app_name, c.window_title, c.url].filter(Boolean).join(" • ");
        const text = truncateAtLineBoundary(c.text_content, RAG_CHUNK_CHAR_LIMIT);
        return `[${meta}]\n${text}`;
      })
      .join("\n\n---\n\n");

    const augmented =
      systemPrompt +
      `\n\n## Current Screen Context\n` +
      `The user currently has the following content open on their screen:\n\n` +
      contextBlock +
      `\n\nReference this context when it is relevant to the user's question. ` +
      `If it is not relevant, ignore it.`;

    return { systemPrompt: augmented, sources };
  } catch {
    return { systemPrompt, sources: [] };
  }
}

/** @deprecated Use buildContextAwarePrompt for sources; kept for callers that only need the string. */
export async function buildContextAwareSystemPrompt(
  systemPrompt: string,
  currentMessage: string = "",
  history: { role: string; content: string | unknown }[] = []
): Promise<string> {
  const { systemPrompt: augmented } = await buildContextAwarePrompt(
    systemPrompt,
    currentMessage,
    history
  );
  return augmented;
}
