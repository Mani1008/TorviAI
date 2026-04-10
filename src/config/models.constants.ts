/**
 * Curated list of OpenRouter models available to users.
 * Grouped by use-case category.
 * Model IDs match OpenRouter's routing format.
 * API key is managed server-side — users only pick a model.
 */

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  category: ModelCategory;
  contextWindow: number;
  supportsVision: boolean;
  isFree: boolean;
  recommended?: boolean;
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

export const OPENROUTER_MODELS: ModelOption[] = [
  // ─── Free / Test ────────────────────────────────────────────────────────
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron Super 120B (Free)",
    description: "NVIDIA's largest free model. Great for testing.",
    category: "general",
    contextWindow: 128000,
    supportsVision: false,
    isFree: true,
    recommended: true,
  },
  {
    id: "meta-llama/llama-4-maverick:free",
    name: "Llama 4 Maverick (Free)",
    description: "Meta's latest Llama 4 multimodal model. Free tier.",
    category: "vision",
    contextWindow: 1000000,
    supportsVision: true,
    isFree: true,
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

export const DEFAULT_MODEL_ID = "nvidia/nemotron-3-super-120b-a12b:free";

export function getModelById(id: string): ModelOption | undefined {
  return OPENROUTER_MODELS.find((m) => m.id === id);
}
