import { useState } from "react";
import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";
import { Label } from "@/components/ui/label";
import { OPENROUTER_MODELS, MODEL_CATEGORIES, getModelById, type ModelCategory } from "@/config/models.constants";
import { loadSelectedModel, saveSelectedModel } from "@/lib/storage/ai-providers";
import { Sparkles, Eye, Zap, Brain, Code2, CheckCircle2 } from "lucide-react";

const CATEGORY_ICONS: Record<ModelCategory, React.ReactNode> = {
  general: <Sparkles className="h-3.5 w-3.5" />,
  vision: <Eye className="h-3.5 w-3.5" />,
  fast: <Zap className="h-3.5 w-3.5" />,
  reasoning: <Brain className="h-3.5 w-3.5" />,
  coding: <Code2 className="h-3.5 w-3.5" />,
};

export default function Settings() {
  const { systemPrompt, updateSystemPrompt } = useAppContext();
  const [promptValue, setPromptValue] = useState(systemPrompt);
  const [selectedModel, setSelectedModel] = useState(() => loadSelectedModel());
  const [activeCategory, setActiveCategory] = useState<ModelCategory | "all">("all");

  const handlePromptChange = (value: string) => {
    setPromptValue(value);
    updateSystemPrompt(value);
  };

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    saveSelectedModel(modelId);
  };

  const filtered = activeCategory === "all"
    ? OPENROUTER_MODELS
    : OPENROUTER_MODELS.filter((m) => m.category === activeCategory);

  const currentModel = getModelById(selectedModel);

  return (
    <PageLayout
      title="Settings"
      description="Configure your Pluely assistant"
    >
      <div className="space-y-10 max-w-2xl">

        {/* ── AI Model Selection ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              AI Model
            </h3>
            {currentModel && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                Active: {currentModel.name}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            All models are provided via OpenRouter. Your API key is managed by Pluely — you just pick a model.
          </p>

          {/* Category filter pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All
            </button>
            {(Object.keys(MODEL_CATEGORIES) as ModelCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {CATEGORY_ICONS[cat]}
                {MODEL_CATEGORIES[cat]}
              </button>
            ))}
          </div>

          {/* Model grid */}
          <div className="grid gap-2">
            {filtered.map((model) => {
              const isSelected = model.id === selectedModel;
              return (
                <button
                  key={model.id}
                  onClick={() => handleModelSelect(model.id)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50 hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{model.name}</span>
                        {model.isFree && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">
                            FREE
                          </span>
                        )}
                        {model.recommended && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 shrink-0">
                            RECOMMENDED
                          </span>
                        )}
                        {model.supportsVision && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 flex items-center gap-0.5">
                            <Eye className="h-2.5 w-2.5" /> Vision
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">{model.id}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      <span className="text-[10px] text-muted-foreground">
                        {(model.contextWindow / 1000).toFixed(0)}K ctx
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── System Prompt ── */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            System Prompt
          </h3>
          <div className="space-y-2">
            <Label>Default instruction for the AI assistant</Label>
            <textarea
              className="w-full min-h-30 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Enter a system prompt..."
              value={promptValue}
              onChange={(e) => handlePromptChange(e.target.value)}
            />
          </div>
        </section>

      </div>
    </PageLayout>
  );
}
