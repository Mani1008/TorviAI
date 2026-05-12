import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { ArrowUp, Mic } from "lucide-react";
import type { ContextChunk } from "@/lib/database/context-store";

interface Props {
  recentChunks: ContextChunk[];
}

const PROMPT_TEMPLATES: Record<string, (title: string) => string> = {
  code:               (t) => `Explain what I was doing in ${t}`,
  document:           (t) => `Summarize this document: ${t}`,
  email:              (t) => `Draft a reply to the email about: ${t}`,
  chat:               (t) => `Key points from my chat about ${t}?`,
  meeting:            (t) => `Action items from my meeting: ${t}`,
  project_management: (t) => `What's the status of ${t}?`,
  generic:            (t) => `What was I working on in ${t}?`,
};

const FALLBACK_SUGGESTIONS = [
  "How do I know if context is being collected?",
  "What am I working on right now?",
  "Summarize what I've done today",
];

function makeSuggestions(chunks: ContextChunk[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks.slice(0, 4)) {
    const tpl = PROMPT_TEMPLATES[chunk.content_type] ?? PROMPT_TEMPLATES.generic;
    const s = tpl(chunk.window_title.split(" - ")[0].trim().slice(0, 40));
    if (!seen.has(s)) { seen.add(s); out.push(s); }
    if (out.length >= 3) break;
  }
  return out.length > 0 ? out : FALLBACK_SUGGESTIONS;
}

export function QuickChatInput({ recentChunks }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    navigate("/chats", { state: { prefill: trimmed } });
  };

  const suggestions = makeSuggestions(recentChunks);

  return (
    <div className="w-full space-y-4">
      {/* ── Main input box ── */}
      <div className="group relative">
        {/* Gradient border ring — only visible on focus */}
        <div
          className="pointer-events-none absolute -inset-[1px] rounded-2xl opacity-0 transition-opacity duration-300 group-focus-within:opacity-100"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.55 0.20 264 / 0.7) 0%, oklch(0.50 0.18 290 / 0.5) 100%)",
            borderRadius: "inherit",
          }}
        />

        <div className="relative rounded-2xl border border-border bg-card shadow-sm group-focus-within:border-transparent transition-colors">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            rows={2}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(value);
              }
            }}
            placeholder="Ask Torvi…"
            className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-sm text-foreground placeholder:text-foreground/25 focus:outline-none leading-relaxed"
            autoFocus
          />

          {/* Bottom action bar */}
          <div className="flex items-center justify-between px-4 pb-3 pt-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate("/chats")}
                className="rounded-lg px-2.5 py-1.5 text-xs text-foreground/40 hover:bg-secondary hover:text-foreground/65 transition-colors"
              >
                New chat
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/audio")}
                title="Voice input"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/35 hover:bg-secondary hover:text-foreground/65 transition-colors"
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => submit(value)}
                disabled={!value.trim()}
                title="Send (Enter)"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/90 text-white shadow-sm shadow-primary/30 disabled:opacity-20 hover:bg-primary transition-all"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Suggestion chips ── */}
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => submit(s)}
            className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs text-foreground/45 hover:border-primary/30 hover:bg-primary/8 hover:text-foreground/70 transition-all duration-150"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

