/**
 * Response length options for AI generation.
 */
export const RESPONSE_LENGTHS = [
  { id: "short", label: "Short", description: "2-4 sentences" },
  { id: "medium", label: "Medium", description: "1-2 paragraphs" },
  { id: "auto", label: "Auto", description: "AI decides the appropriate length" },
] as const;

/**
 * Supported response languages.
 */
export const RESPONSE_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Russian",
  "Chinese",
  "Japanese",
  "Korean",
  "Arabic",
  "Hindi",
  "Turkish",
  "Polish",
] as const;
