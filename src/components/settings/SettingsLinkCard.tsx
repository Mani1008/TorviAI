import { Link } from "react-router";
import { ChevronRight } from "lucide-react";

interface SettingsLinkCardProps {
  title: string;
  description: string;
  to: string;
}

export function SettingsLinkCard({ title, description, to }: SettingsLinkCardProps) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border border-border p-4 hover:bg-muted/40 transition-colors group"
    >
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </Link>
  );
}
