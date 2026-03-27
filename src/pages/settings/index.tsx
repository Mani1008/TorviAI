import { useState } from "react";
import { PageLayout } from "@/layouts";
import { useAppContext } from "@/contexts/app.context";
import { Label } from "@/components/ui/label";

export default function Settings() {
  const { systemPrompt, updateSystemPrompt } = useAppContext();
  const [promptValue, setPromptValue] = useState(systemPrompt);

  const handlePromptChange = (value: string) => {
    setPromptValue(value);
    updateSystemPrompt(value);
  };

  return (
    <PageLayout
      title="Settings"
      description="Configure your Pluely assistant"
    >
      <div className="space-y-8 max-w-lg">
        {/* System Prompt */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            System Prompt
          </h3>
          <div className="space-y-2">
            <Label>Default instruction for the AI assistant</Label>
            <textarea
              className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
