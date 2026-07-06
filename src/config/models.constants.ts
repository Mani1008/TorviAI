/**
 * Curated model catalog for Torvi.
 *
 * **Primary provider:** OpenRouter (`OPENROUTER_API_KEY` in .env) — default for all models
 * unless `providerTag: "nvidia"`.
 *
 * **Optional testing:** NVIDIA NIM models (`NVIDIA_API_KEY`) — listed at the end.
 *
 * API keys are server-side only (Rust proxy); users pick a model or role.
 */
export {
  PRIMARY_AI_PROVIDER,
  getProviderForModel,
  isNvidiaNimModel,
} from "./ai-provider.constants";

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  category: ModelCategory;
  contextWindow: number;
  supportsVision: boolean;
  isFree: boolean;
  recommended?: boolean;
  /** When set, this model routes to the given provider instead of OpenRouter. */
  providerTag?: "nvidia";
}

export type ModelCategory =
  | "general"
  | "coding"
  | "reasoning"
  | "fast"
  | "vision";

export const MODEL_CATEGORIES: Record<ModelCategory, string> = {
  general: "General Purpose",
  coding: "Coding",
  reasoning: "Deep Reasoning",
  fast: "Fast & Lightweight",
  vision: "Vision & Images",
};

/** OpenRouter-hosted models (primary — requires OPENROUTER_API_KEY). */
const OPENROUTER_HOSTED_MODELS: ModelOption[] = [
  // ─── Free tier (OpenRouter) ─────────────────────────────────────────────
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron Super 120B (Free)",
    description: "Default free model on OpenRouter.",
    category: "general",
    contextWindow: 128000,
    supportsVision: false,
    isFree: true,
    recommended: true,
  },
  {
    id: "meta-llama/llama-4-maverick",
    name: "Llama 4 Maverick",
    description: "Meta Llama 4 multimodal (paid on OpenRouter).",
    category: "vision",
    contextWindow: 1000000,
    supportsVision: true,
    isFree: false,
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash (Free)",
    description: "Google's fast multimodal model. Excellent for speed + vision.",
    category: "fast",
    contextWindow: 1000000,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1 (Free)",
    description: "Strong reasoning model. Best for math, logic, and analysis.",
    category: "reasoning",
    contextWindow: 163840,
    supportsVision: false,
    isFree: true,
  },

  // ─── General Purpose ────────────────────────────────────────────────────
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    description: "OpenAI's flagship multimodal model. Best overall performance.",
    category: "general",
    contextWindow: 128000,
    supportsVision: true,
    isFree: false,
    recommended: true,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    description: "Affordable and fast. Great for most everyday tasks.",
    category: "fast",
    contextWindow: 128000,
    supportsVision: true,
    isFree: false,
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    name: "Claude 3.7 Sonnet",
    description: "Anthropic's best model. Excellent writing and reasoning.",
    category: "general",
    contextWindow: 200000,
    supportsVision: true,
    isFree: false,
    recommended: true,
  },
  {
    id: "anthropic/claude-3.5-haiku",
    name: "Claude 3.5 Haiku",
    description: "Fastest Claude model. Great for quick answers.",
    category: "fast",
    contextWindow: 200000,
    supportsVision: true,
    isFree: false,
  },
  {
    id: "google/gemini-flash-1.5",
    name: "Gemini 1.5 Flash",
    description: "Google's fast model with 1M token context.",
    category: "fast",
    contextWindow: 1000000,
    supportsVision: true,
    isFree: false,
  },
  {
    id: "google/gemini-pro-1.5",
    name: "Gemini 1.5 Pro",
    description: "Google's best model. 1M context window.",
    category: "general",
    contextWindow: 2000000,
    supportsVision: true,
    isFree: false,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    description: "Meta's open-weights model. Strong instruction following.",
    category: "general",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
  },

  // ─── Coding ─────────────────────────────────────────────────────────────
  {
    id: "anthropic/claude-3.7-sonnet:thinking",
    name: "Claude 3.7 Sonnet (Extended Thinking)",
    description: "Best for complex coding with step-by-step reasoning.",
    category: "coding",
    contextWindow: 200000,
    supportsVision: true,
    isFree: false,
    recommended: true,
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    name: "DeepSeek V3",
    description: "Top-tier coding model. Rivals GPT-4o at lower cost.",
    category: "coding",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B",
    description: "Specialized coding model from Alibaba.",
    category: "coding",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
  },

  // ─── Reasoning ──────────────────────────────────────────────────────────
  {
    id: "openai/o4-mini",
    name: "o4-mini",
    description: "OpenAI's fast reasoning model. Great for math and logic.",
    category: "reasoning",
    contextWindow: 200000,
    supportsVision: true,
    isFree: false,
    recommended: true,
  },
  {
    id: "openai/o3",
    name: "o3",
    description: "OpenAI's most powerful reasoning model.",
    category: "reasoning",
    contextWindow: 200000,
    supportsVision: true,
    isFree: false,
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    description: "Open-source reasoning model. Excellent for analysis.",
    category: "reasoning",
    contextWindow: 163840,
    supportsVision: false,
    isFree: false,
  },
];

/** NVIDIA NIM direct API (optional — requires NVIDIA_API_KEY, for testing). */
export const NVIDIA_NIM_MODELS: ModelOption[] = [
  {
    id: "meta/llama-3.2-11b-vision-instruct",
    name: "Llama 3.2 11B Vision (NVIDIA NIM)",
    description: "Vision model via NVIDIA NIM — testing only.",
    category: "vision",
    contextWindow: 128000,
    supportsVision: true,
    isFree: true,
    providerTag: "nvidia",
  },
  {
    id: "meta/llama-3.2-90b-vision-instruct",
    name: "Llama 3.2 90B Vision (NVIDIA NIM)",
    description: "Large vision model via NVIDIA NIM — testing only.",
    category: "vision",
    contextWindow: 128000,
    supportsVision: true,
    isFree: false,
    providerTag: "nvidia",
  },
  {
    id: "google/gemma-4-31b-it",
    name: "Gemma 4 31B (NVIDIA NIM)",
    description: "Gemma 4 via NVIDIA NIM — testing only.",
    category: "reasoning",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
    providerTag: "nvidia",
  },
  {
    id: "meta/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B (NVIDIA NIM)",
    description: "Llama 4 Scout via NVIDIA NIM — testing only.",
    category: "fast",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
    providerTag: "nvidia",
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1",
    name: "Nemotron Super 49B (NVIDIA NIM)",
    description: "Nemotron 49B via NVIDIA NIM — testing only.",
    category: "reasoning",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
    providerTag: "nvidia",
  },
  {
    id: "mistralai/mistral-small-3.1-24b-instruct",
    name: "Mistral Small 3.1 24B (NVIDIA NIM)",
    description: "Mistral Small via NVIDIA NIM — testing only.",
    category: "general",
    contextWindow: 131072,
    supportsVision: false,
    isFree: false,
    providerTag: "nvidia",
  },
];

/** Full catalog: OpenRouter first, NVIDIA NIM testing models last. */
export const OPENROUTER_MODELS: ModelOption[] = [
  ...OPENROUTER_HOSTED_MODELS,
  ...NVIDIA_NIM_MODELS,
];

// Default model when none selected — must exist in ALLOWED_MODELS (api.rs).
export const DEFAULT_MODEL_ID = "nvidia/nemotron-3-super-120b-a12b:free";

export function getModelById(id: string): ModelOption | undefined {
  return OPENROUTER_MODELS.find((m) => m.id === id);
}
