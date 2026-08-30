import { invoke } from "@tauri-apps/api/core";
import type { AvailableProvider, Integration } from "@/types/integrations";
import { isTauri } from "@/lib/platform";

export async function listIntegrations(): Promise<Integration[]> {
  if (!isTauri()) return [];
  return invoke<Integration[]>("list_integrations");
}

export async function listAvailableProviders(): Promise<AvailableProvider[]> {
  if (!isTauri()) {
    return [
      {
        id: "gmail",
        label: "Gmail",
        description: "Ingest support email into your company brain (read-only).",
        scopes: [],
      },
      {
        id: "google_calendar",
        label: "Google Calendar",
        description: "Let Torvi see your upcoming events (read-only).",
        scopes: [],
      },
    ];
  }
  return invoke<AvailableProvider[]>("list_available_providers");
}

export async function startOauthConnect(provider: string): Promise<Integration> {
  return invoke<Integration>("start_oauth_connect", { provider });
}

export async function disconnectIntegration(provider: string): Promise<void> {
  await invoke("disconnect_integration", { provider });
}

export async function syncGmailNow() {
  return invoke<{
    synced: number;
    skipped: number;
    status: {
      provider: string;
      lastSyncAt: number | null;
      lastStatus: string;
      lastError: string | null;
      itemsSynced: number;
    };
  }>("sync_gmail_now");
}

export async function getGmailSyncStatus() {
  if (!isTauri()) {
    return {
      provider: "gmail",
      lastSyncAt: null as number | null,
      lastStatus: "idle",
      lastError: null as string | null,
      itemsSynced: 0,
    };
  }
  return invoke<{
    provider: string;
    lastSyncAt: number | null;
    lastStatus: string;
    lastError: string | null;
    itemsSynced: number;
  }>("get_gmail_sync_status");
}
