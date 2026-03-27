import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { Send, Mic, MicOff } from "lucide-react";

interface TextInputProps {
  onSend: (text: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  isListening?: boolean;
  onMicToggle?: () => void;
  externalText?: string;
  onExternalTextConsumed?: () => void;
}

export function TextInput({
  onSend,
  isLoading = false,
  placeholder = "Ask me anything...",
  isListening = false,
  onMicToggle,
  externalText,
  onExternalTextConsumed,
}: TextInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (externalText) {
      setText((prev) => {
        const sep = prev && !prev.endsWith(" ") ? " " : "";
        return prev + sep + externalText;
      });
      onExternalTextConsumed?.();
      inputRef.current?.focus();
    }
  }, [externalText, onExternalTextConsumed]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="flex items-center flex-1 gap-1.5">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isListening ? "Listening..." : placeholder}
        className="
          flex-1 bg-transparent text-[13px] outline-none
          text-white/80 placeholder:text-white/25
          transition-colors duration-150
        "
      />

      {onMicToggle && (
        <button
          onClick={onMicToggle}
          className={`
            rounded-lg p-1 transition-all duration-150
            ${
              isListening
                ? "text-rose-400 animate-pulse"
                : "text-white/30 hover:text-white/70"
            }
          `}
          title={isListening ? "Stop listening" : "Voice input"}
        >
          {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
      )}

      <button
        onClick={handleSend}
        disabled={!text.trim() || isLoading}
        className={
          `rounded-lg p-1 text-white/30 hover:text-indigo-400 transition-all duration-150 ` +
          ((!text.trim() || isLoading) ? "opacity-90" : "")
        }
        tabIndex={-1}
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

