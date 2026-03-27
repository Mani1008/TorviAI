import { PageLayout } from "@/layouts";

/**
 * Dashboard page — overview, quick stats, and activity.
 *
 * TODO: Add activity chart (recharts).
 * TODO: Add quick action buttons.
 * TODO: Add usage statistics.
 */
export default function Dashboard() {
  return (
    <PageLayout
      title="Dashboard"
      description="Overview of your AI assistant usage"
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Total Conversations
          </h3>
          <p className="mt-2 text-3xl font-bold">0</p>
        </div>
        <div className="rounded-lg border border-border p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Messages Today
          </h3>
          <p className="mt-2 text-3xl font-bold">0</p>
        </div>
        <div className="rounded-lg border border-border p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Active Provider
          </h3>
          <p className="mt-2 text-lg font-semibold">Not configured</p>
        </div>
      </div>
    </PageLayout>
  );
}
