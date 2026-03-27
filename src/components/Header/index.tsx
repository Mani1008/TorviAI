import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description?: string;
  showBack?: boolean;
  rightSlot?: ReactNode;
}

export function Header({ title, description, showBack, rightSlot }: HeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            className="rounded-md p-1 hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {rightSlot && <div>{rightSlot}</div>}
    </div>
  );
}
