/**
 * AI provider routing — OpenRouter is primary; NVIDIA NIM is optional (testing).
 *
 * Rust mirror: NVIDIA_NIM_MODELS in src-tauri/src/api.rs (keep IDs in sync).
 */

export type AiProvider = "openrouter" | "nvidia";

/** Production default — all chat/completion traffic unless user picks an NVIDIA NIM model. */
export const PRIMARY_AI_PROVIDER: AiProvider = "openrouter";

/**
 * Model IDs routed to NVIDIA integrate.api.nvidia.com (not OpenRouter).
 * Must match `providerTag: "nvidia"` entries in models.constants.ts
 * AND `NVIDIA_NIM_MODELS` in src-tauri/src/api.rs.
 */
export const NVIDIA_NIM_MODEL_IDS = [
  "meta/llama-3.2-11b-vision-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "google/gemma-4-31b-it",
  "meta/llama-4-scout-17b-16e-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "mistralai/mistral-small-3.1-24b-instruct",
] as const;

const NVIDIA_SET = new Set<string>(NVIDIA_NIM_MODEL_IDS);

export function getProviderForModel(modelId: string): AiProvider {
  return NVIDIA_SET.has(modelId) ? "nvidia" : "openrouter";
}

export function isNvidiaNimModel(modelId: string): boolean {
  return NVIDIA_SET.has(modelId);
}
