/**
 * AI or STT provider definition.
 * Each provider is defined by a curl template with {{VARIABLE}} placeholders.
 */
export interface TYPE_PROVIDER {
  /** Unique provider identifier (e.g., "openai", "claude") */
  id?: string;
  /** Display name for the provider */
  name?: string;
  /** Curl command template with {{API_KEY}}, {{MODEL}}, {{TEXT}}, {{IMAGE}}, {{SYSTEM_PROMPT}} placeholders */
  curl: string;
  /** Whether the provider supports streaming responses */
  streaming?: boolean;
  /** JSONPath to extract response content (e.g., "choices[0].delta.content") */
  responseContentPath?: string;
  /** Whether this is a user-defined custom provider */
  isCustom?: boolean;
}
