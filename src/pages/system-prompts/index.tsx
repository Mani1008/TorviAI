import { PageLayout } from "@/layouts";
import { Empty } from "@/components/Empty";

/**
 * System prompts management page.
 *
 * TODO: List existing prompts from SQLite.
 * TODO: Create/edit/delete prompts.
 * TODO: Pre-populate with default templates.
 */
export default function SystemPrompts() {
  return (
    <PageLayout
      title="System Prompts"
      description="Manage your AI instruction templates"
    >
      <Empty
        title="No custom prompts yet"
        description="Create system prompts to customize AI behavior for different use cases."
      />
    </PageLayout>
  );
}
