import type { TYPE_PROVIDER } from "@/types/provider.type";
import { getByPath } from "./common.function";
import { fetch } from "@tauri-apps/plugin-http";

interface STTParams {
  audioBlob: Blob;
  selectedProvider: TYPE_PROVIDER;
  variables: Record<string, string>;
}

/**
 * Replace {{VARIABLE}} placeholders with values from the variables map.
 */
function substituteVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");
}

/**
 * Parse an STT curl template to extract URL, headers, form fields, and request style.
 *
 * STT providers use two styles:
 *  - Multipart form: `-F "file=@audio.wav"` and `-F "model=whisper-1"`
 *  - Raw binary:     `--data-binary @audio.wav` with `-H "Content-Type: audio/wav"`
 */
function parseSttCurl(curl: string, variables: Record<string, string>) {
  // Normalize line continuations
  const normalized = curl
    .replace(/\\\n/g, " ")
    .replace(/\\\r\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Substitute variables first
  const resolved = substituteVariables(normalized, variables);

  // Extract URL
  const urlMatch = resolved.match(
    /curl\s+(?:-[Xx]\s+\w+\s+)?['"]?(https?:\/\/[^\s'"]+)['"]?/
  );
  const url = urlMatch ? urlMatch[1] : "";

  // Extract headers
  const headers: Record<string, string> = {};
  const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headerRegex.exec(resolved)) !== null) {
    const colonIdx = hMatch[1].indexOf(":");
    if (colonIdx > 0) {
      headers[hMatch[1].substring(0, colonIdx).trim()] = hMatch[1]
        .substring(colonIdx + 1)
        .trim();
    }
  }

  // Extract -F form fields (multipart)
  const formFields: { key: string; value: string; isFile: boolean }[] = [];
  const formRegex = /-F\s+['"]([^'"]+)['"]/g;
  let fMatch: RegExpExecArray | null;
  while ((fMatch = formRegex.exec(resolved)) !== null) {
    const eqIdx = fMatch[1].indexOf("=");
    if (eqIdx > 0) {
      const key = fMatch[1].substring(0, eqIdx);
      const value = fMatch[1].substring(eqIdx + 1);
      formFields.push({
        key,
        value,
        isFile: value.startsWith("@"),
      });
    }
  }

  // Check for --data-binary (raw binary mode)
  const isRawBinary = resolved.includes("--data-binary");

  return { url, headers, formFields, isRawBinary };
}

/**
 * Transcribe audio to text using the selected STT provider.
 *
 * Parses the provider's curl template, builds either a multipart form
 * or raw binary request with the audio data, and extracts the transcription
 * from the response using `responseContentPath`.
 */
export async function fetchSTT(params: STTParams): Promise<string> {
  const { audioBlob, selectedProvider, variables } = params;

  if (!selectedProvider.curl) {
    throw new Error("STT provider has no curl template");
  }

  const { url, headers, formFields, isRawBinary } = parseSttCurl(
    selectedProvider.curl,
    variables
  );

  if (!url) {
    throw new Error("Could not extract URL from STT curl template");
  }

  console.log("[STT] Provider:", selectedProvider.id);
  console.log("[STT] URL:", url);
  console.log("[STT] Audio size:", audioBlob.size, "bytes");

  let response: Response;

  if (isRawBinary) {
    // Raw binary mode (e.g. Deepgram): send audio bytes directly
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": headers["Content-Type"] ?? "audio/wav",
      },
      body: audioBlob,
    });
  } else if (formFields.length > 0) {
    // Multipart form mode (e.g. OpenAI Whisper, Groq)
    const formData = new FormData();
    for (const field of formFields) {
      if (field.isFile) {
        // File field: attach the audio blob
        formData.append(field.key, audioBlob, "audio.wav");
      } else {
        // Regular form field (e.g. model name)
        formData.append(field.key, field.value);
      }
    }

    response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
  } else {
    throw new Error("STT curl template has no form fields or binary data");
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`STT request failed (${response.status}): ${errorText}`);
  }

  // Parse the response and extract transcription
  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();

  if (contentType.includes("application/json") && selectedProvider.responseContentPath) {
    try {
      const json = JSON.parse(responseText);
      const extracted = getByPath(json, selectedProvider.responseContentPath);
      if (typeof extracted === "string") {
        return extracted;
      }
      // Fallback: stringify whatever we got
      return String(extracted ?? "");
    } catch {
      console.warn("[STT] JSON parse failed, returning raw text");
      return responseText;
    }
  }

  // Plain text response (some providers return text directly)
  return responseText;
}
