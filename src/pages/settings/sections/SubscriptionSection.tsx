import { SettingsLinkCard } from "@/components/settings/SettingsLinkCard";

export function SubscriptionSection() {
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        View your plan, usage limits, and upgrade options on the billing page.
      </p>
      <SettingsLinkCard
        title="Billing & usage"
        description="Plan details, listening time, and AI response limits."
        to="/billing"
      />
    </div>
  );
}
