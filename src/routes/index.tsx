import { createBrowserRouter } from "react-router";
import { DashboardLayout } from "@/layouts";
import App from "@/pages/app";
import Gate from "@/pages/gate";
import Dashboard from "@/pages/dashboard";
import Chats from "@/pages/chats";
import ChatView from "@/pages/chats/view";
import Settings from "@/pages/settings";
import SystemPrompts from "@/pages/system-prompts";
import Shortcuts from "@/pages/shortcuts";
import Screenshot from "@/pages/screenshot";
import Audio from "@/pages/audio";
import Responses from "@/pages/responses";

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
    element: <DashboardLayout />,
    children: [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/chats", element: <Chats /> },
      { path: "/chats/view/:conversationId", element: <ChatView /> },
      { path: "/settings", element: <Settings /> },
      { path: "/system-prompts", element: <SystemPrompts /> },
      { path: "/shortcuts", element: <Shortcuts /> },
      { path: "/screenshot", element: <Screenshot /> },
      { path: "/audio", element: <Audio /> },
      { path: "/responses", element: <Responses /> },
    ],
  },
]);
