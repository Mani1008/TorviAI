import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import type { ContextChunk } from "@/lib/database/context-store";

interface Props {
  recentChunks: ContextChunk[];
}

const PROMPT_TEMPLATES: Record<string, (title: string) => string> = {
  code:               (t) => `Explain what I was doing in ${t}`,
  document:           (t) => `Summarize the document I was reading: ${t}`,
  email:              (t) => `Draft a reply to the email about: ${t}`,
  chat:               (t) => `What were the key points from my conversation about ${t}?`,
  meeting:            (t) => `Generate action items from my meeting: ${t}`,
  project_management: (t) => `What's the status of ${t}?`,
  generic:            (t) => `What was I working on in ${t}?`,
};

function makeSuggestions(chunks: ContextChunk[]): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const chunk of chunks.slice(0, 3)) {
    const template = PROMPT_TEMPLATES[chunk.content_type] ?? PROMPT_TEMPLATES.generic;
    const prompt = template(chunk.window_title.split(" - ")[0].trim().slice(0, 40));
    if (!seen.has(prompt)) {
      seen.add(prompt);
      suggestions.push(prompt);
    }
    if (suggestions.length >= 3) break;
  }
  // Fallback generic suggestions if no context yet
  if (suggestions.length === 0) {
    return [
      "What am I working on right now?",
      "Summarize what I've been doing today",
      "Help me write something",
    ];
  }
  return suggestions;
}

export function QuickChatInput({ recentChunks }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const suggestions = makeSuggestions(recentChunks);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Navigate to chats with prefilled message via location state
    navigate("/chats", { state: { prefill: trimmed } });
  };

  return (
    <div className="space-y-3">
      {/* Input row */}
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(value)}
          placeholder="Ask anything about what you're working on…"
          className="w-full rounded-xl border border-border bg-card px-4 py-3.5 pr-12 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
          autoFocus
        />
        <button
          onClick={() => submit(value)}
          disabled={!value.trim()}
          className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-30 hover:opacity-90 transition-opacity"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Suggested prompts */}
      <div className="flex flex-wrap gap-2">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground/50 mt-1 shrink-0" />
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => submit(s)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground hover:border-primary/30 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
