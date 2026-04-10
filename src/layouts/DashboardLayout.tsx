import { useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "@/components/Sidebar";
import { Onboarding, isOnboarded } from "@/components/Onboarding";

export function DashboardLayout() {
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboarded());

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}
