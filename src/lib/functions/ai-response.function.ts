import type { Message } from "@/types/completion";
import type { TYPE_PROVIDER } from "@/types/provider.type";
import { getByPath } from "./common.function";
import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSelectedModel } from "@/lib/storage/ai-providers";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AIResponseParams {
  messages: Message[];
  systemPrompt: string;
  selectedProvider: TYPE_PROVIDER;
  variables: Record<string, string>;
  images?: string[];
  abortSignal?: AbortSignal;
}

interface StreamAIFromConfigParams {
  messages: Message[];
  systemPrompt: string;
  images?: string[];
  abortSignal?: AbortSignal;
  modelId?: string;
}

/**
 * Parse a curl command template into URL, headers, and body.
 */
function parseCurlTemplate(curl: string): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
} {
  const headers: Record<string, string> = {};
  let method = "POST";
  let url = "";
  let body = "";

  // Normalize: remove line continuations and collapse whitespace
  const normalized = curl
    .replace(/\\\n/g, " ")
    .replace(/\\\r\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Extract URL (first non-flag argument after 'curl')
  const urlMatch = normalized.match(/curl\s+(?:-[Xx]\s+\w+\s+)?['"]?(https?:\/\/[^\s'"]+)['"]?/);
  if (urlMatch) {
    url = urlMatch[1];
  }

  // Extract method (-X or --request)
  const methodMatch = normalized.match(/-X\s+(\w+)/);
  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
  }

  // Extract headers (-H)
  const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headerRegex.exec(normalized)) !== null) {
    const colonIndex = hMatch[1].indexOf(":");
    if (colonIndex > 0) {
      const key = hMatch[1].substring(0, colonIndex).trim();
      const value = hMatch[1].substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  // Extract body (-d or --data)
  const bodyMatch = normalized.match(/-d\s+'((?:[^'\\]|\\.)*)'/) ||
    normalized.match(/-d\s+"((?:[^"\\]|\\.)*)"/);
  if (bodyMatch) {
    body = bodyMatch[1];
  }

  return { url, method, headers, body };
}

/**
 * Replace {{VARIABLE}} placeholders in a string with values from the variables map.
 * CRLF characters are stripped from substituted values to prevent HTTP header injection
 * when the result is used as a header value.
 */
function substituteVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return (variables[key] ?? "").replace(/[\r\n]/g, "");
  });
}

/**
 * Build the request body by injecting messages into the provider's curl template.
 * Handles different provider message formats (OpenAI, Claude, etc.)
 */
function buildRequestBody(
  bodyTemplate: string,
  messages: Message[],
  systemPrompt: string,
  variables: Record<string, string>,
  images?: string[]
): string {
  // First, substitute known variables
  let body = substituteVariables(bodyTemplate, variables);

  // Now handle message content
  // The template has {{SYSTEM_PROMPT}} and {{TEXT}} placeholders
  body = body.replace(/\{\{SYSTEM_PROMPT\}\}/g, escapeJsonString(systemPrompt));

  // Find the last user message for {{TEXT}}
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const userText =
    typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
  body = body.replace(/\{\{TEXT\}\}/g, escapeJsonString(userText));

  // Handle {{IMAGE}} placeholder — escape to prevent JSON injection
  if (images && images.length > 0) {
    body = body.replace(/\{\{IMAGE\}\}/g, escapeJsonString(images[0]));
  }

  // Try to inject full message history into the body
  // Parse the template body as JSON, find the "messages" array, and replace it
  try {
    const parsed = JSON.parse(body);
    if (parsed.messages && Array.isArray(parsed.messages)) {
      // Build the full messages array with history
      const fullMessages: Message[] = [];

      // Add system prompt as first message for OpenAI-style APIs
      if (systemPrompt && !parsed.system) {
        fullMessages.push({ role: "system", content: systemPrompt });
      }

      // Add all conversation messages
      for (const msg of messages) {
        fullMessages.push({
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content : msg.content,
        });
      }

      parsed.messages = fullMessages;
    }

    // For Claude-style: system is a top-level field, messages don't include system
    if ("system" in parsed) {
      parsed.system = systemPrompt;
      if (parsed.messages) {
        parsed.messages = messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));
      }
    }

    return JSON.stringify(parsed);
  } catch {
    // If body isn't valid JSON after substitution, return as-is
    return body;
  }
}

function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Fetch a streaming AI response from the selected provider.
 * Yields text chunks as they arrive.
 *
 * Uses @tauri-apps/plugin-http to bypass CORS restrictions.
 * Parses SSE (Server-Sent Events) stream format.
 * Extracts text from provider-specific JSON paths.
 */
export async function* fetchAIResponse(
  params: AIResponseParams
): AsyncGenerator<string> {
  const { messages, systemPrompt, selectedProvider, variables, images, abortSignal } =
    params;

  if (abortSignal?.aborted) return;

  // Parse the curl template
  const { url, method, headers, body: bodyTemplate } = parseCurlTemplate(
    selectedProvider.curl
  );

  if (!url) {
    yield "Error: Could not parse URL from provider template.";
    return;
  }

  // Substitute variables in URL and headers
  const finalUrl = substituteVariables(url, variables);
  const finalHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    finalHeaders[key] = substituteVariables(value, variables);
  }

  // Build the request body with full message history
  const finalBody = buildRequestBody(
    bodyTemplate,
    messages,
    systemPrompt,
    variables,
    images
  );

  try {
    // Use Tauri's HTTP plugin to make the request (bypasses CORS)
    const response = await fetch(finalUrl, {
      method,
      headers: finalHeaders,
      body: finalBody || undefined,
      signal: abortSignal,
    });

    if (!response.ok) {
      // Do not expose raw provider error bodies — log to console, yield safe message
      const errorText = await response.text();
      console.error(`[fetchAIResponse] HTTP ${response.status}:`, errorText.substring(0, 500));
      const msg = response.status === 401 || response.status === 403
        ? "Authentication error. Please contact support."
        : response.status === 429
        ? "Rate limited. Please wait a moment."
        : response.status >= 500
        ? "AI provider error. Try again later."
        : "Request failed. Please try again.";
      yield msg;
      return;
    }

    const contentPath = selectedProvider.responseContentPath ?? "choices[0].delta.content";

    if (selectedProvider.streaming !== false) {
      // SSE streaming mode
      yield* parseSSEStream(response, contentPath, abortSignal);
    } else {
      // Non-streaming mode: single JSON response
      const json = await response.json();
      const content = getByPath(json, contentPath.replace(".delta.", ".message."));
      if (typeof content === "string") {
        yield content;
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    // Log full error but yield only a safe generic message
    console.error("[fetchAIResponse]", err);
    yield "Request failed. Please check your connection and try again.";
  }
}

/**
 * Parse an SSE stream and yield text chunks.
 */
async function* parseSSEStream(
  response: Response,
  contentPath: string,
  abortSignal?: AbortSignal
): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield "Error: Response body is not readable.";
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (abortSignal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines, comments, and event markers
        if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) {
          continue;
        }

        // Check for stream termination
        if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
          return;
        }

        // Extract data payload
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (!data) continue;

          try {
            const json = JSON.parse(data);
            const content = getByPath(json, contentPath);
            if (typeof content === "string" && content.length > 0) {
              yield content;
            }
          } catch {
            // Some providers may send non-JSON data lines, ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Config-based AI Streaming ───────────────────────────────────────────────
// Sends messages to the Rust backend which holds API keys and proxies the HTTP
// request. Chunks are received as Tauri events keyed by request_id, converted
// to an async generator so callers are unchanged.

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