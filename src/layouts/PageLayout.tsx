import type { ReactNode } from "react";
import { Header } from "@/components/Header";

interface PageLayoutProps {
  title: string;
  description?: string;
  showBack?: boolean;
  rightSlot?: ReactNode;
  children: ReactNode;
}

export function PageLayout({
  title,
  description,
  showBack,
  rightSlot,
  children,
}: PageLayoutProps) {
  return (
    <div className="flex h-full flex-col">
      <Header
        title={title}
        description={description}
        showBack={showBack}
        rightSlot={rightSlot}
      />
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
}
