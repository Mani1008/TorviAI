import { useState, useCallback } from "react";

/**
 * Hook for copying text to clipboard with success state.
 */
export function useCopyToClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), resetDelay);
      } catch (err) {
        console.error("[Clipboard] Failed to copy:", err);
      }
    },
    [resetDelay]
  );

  return { copied, copy };
}
