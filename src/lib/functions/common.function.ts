/**
 * Extract {{VARIABLE}} placeholders from a curl command template.
 */
export function extractVariables(curl: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const variables = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(curl)) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables);
}

/**
 * Replace {{TEXT}} and {{IMAGE}} placeholders in a user message template.
 */
export function processUserMessageTemplate(
  curl: string,
  text: string,
  images?: string[]
): string {
  let result = curl.replace(/\{\{TEXT\}\}/g, escapeJsonString(text));
  if (images && images.length > 0) {
    result = result.replace(/\{\{IMAGE\}\}/g, images[0]);
  }
  return result;
}

/**
 * Convert a Blob to a base64 data URL string.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Navigate into a nested object by dot/bracket path.
 * e.g., getByPath(obj, "results[0].alternatives[0].transcript")
 */
export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value at a nested path in an object.
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Escape special characters for JSON string embedding.
 */
function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
