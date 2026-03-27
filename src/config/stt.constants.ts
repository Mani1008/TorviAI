import type { TYPE_PROVIDER } from "@/types/provider.type";

/**
 * Built-in speech-to-text provider definitions.
 */
export const STT_PROVIDERS: TYPE_PROVIDER[] = [
  {
    id: "openai-whisper",
    name: "OpenAI Whisper",
    responseContentPath: "text",
    curl: `curl https://api.openai.com/v1/audio/transcriptions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -F "file=@audio.wav" \\
  -F "model={{MODEL}}"`,
  },
  {
    id: "groq-whisper",
    name: "Groq Whisper",
    responseContentPath: "text",
    curl: `curl https://api.groq.com/openai/v1/audio/transcriptions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -F "file=@audio.wav" \\
  -F "model={{MODEL}}"`,
  },
  {
    id: "deepgram",
    name: "Deepgram",
    responseContentPath: "results.channels[0].alternatives[0].transcript",
    curl: `curl https://api.deepgram.com/v1/listen \\
  -H "Authorization: Token {{API_KEY}}" \\
  -H "Content-Type: audio/wav" \\
  --data-binary @audio.wav`,
  },
];
