import type { TYPE_PROVIDER } from "@/types/provider.type";

/**
 * Built-in AI provider definitions.
 * Each provider's curl template uses {{VARIABLE}} placeholders that get replaced at runtime.
 */
export const AI_PROVIDERS: TYPE_PROVIDER[] = [
  {
    id: "modelslab",
    name: "ModelsLab",
    streaming: true,
    responseContentPath: "choices[0].delta.content",
    curl: `curl -X POST https://modelslab.com/api/v7/llm/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model_id": "{{MODEL}}", "stream": true, "max_tokens": 4096, "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}]}'`,
  },
  {
    id: "openai",
    name: "OpenAI",
    streaming: true,
    responseContentPath: "choices[0].delta.content",
    curl: `curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "stream": true, "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}]}'`,
  },
  {
    id: "claude",
    name: "Claude",
    streaming: true,
    responseContentPath: "delta.text",
    curl: `curl https://api.anthropic.com/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: {{API_KEY}}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{"model": "{{MODEL}}", "stream": true, "max_tokens": 4096, "system": "{{SYSTEM_PROMPT}}", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  },
  {
    id: "gemini",
    name: "Gemini",
    streaming: true,
    responseContentPath: "choices[0].delta.content",
    curl: `curl https://generativelanguage.googleapis.com/v1beta/openai/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "stream": true, "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}]}'`,
  },
  {
    id: "groq",
    name: "Groq",
    streaming: true,
    responseContentPath: "choices[0].delta.content",
    curl: `curl https://api.groq.com/openai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "stream": true, "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}]}'`,
  },
  {
    id: "mistral",
    name: "Mistral",
    streaming: true,
    responseContentPath: "choices[0].delta.content",
    curl: `curl https://api.mistral.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "stream": true, "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}]}'`,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    streaming: true,
    responseContentPath: "choices[0].delta.content",
    curl: `curl http://localhost:11434/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "{{MODEL}}", "stream": true, "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}]}'`,
  },
];
