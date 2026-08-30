import { createBrowserRouter } from "react-router";
import { DashboardLayout } from "@/layouts";
import App from "@/pages/app";
import Gate from "@/pages/gate";
import Dashboard from "@/pages/dashboard";
import Chats from "@/pages/chats";
import ChatView from "@/pages/chats/view";
import Settings from "@/pages/settings";
import Shortcuts from "@/pages/shortcuts";
import Screenshot from "@/pages/screenshot";
import Responses from "@/pages/responses";
import Billing from "@/pages/billing";
import ContextMemory from "@/pages/context-memory";
import SkillsPage from "@/pages/skills";
import SupabaseTestPage from "@/pages/dev/supabase-test";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/gate",
    element: <Gate />,
  },
  {
    path: "/dev/supabase-test",
    element: <SupabaseTestPage />,
  },
  {
    element: <DashboardLayout />,
    children: [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/chats", element: <Chats /> },
      { path: "/chats/view/:conversationId", element: <ChatView /> },
      { path: "/settings", element: <Settings /> },
      { path: "/shortcuts", element: <Shortcuts /> },
      { path: "/screenshot", element: <Screenshot /> },
      { path: "/responses", element: <Responses /> },
      { path: "/billing", element: <Billing /> },
      { path: "/context-memory", element: <ContextMemory /> },
      { path: "/skills", element: <SkillsPage /> },
    ],
  },
]);
