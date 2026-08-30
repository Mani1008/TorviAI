import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CalendarDays, Loader2, Mail, Plus, X } from "lucide-react";
import { isTauri } from "@/lib/platform";
import {
  disconnectIntegration,
  listAvailableProviders,
  listIntegrations,
  startOauthConnect,
} from "@/lib/integrations";
import type { AvailableProvider, Integration } from "@/types/integrations";

function ProviderIcon({ providerId, className }: { providerId: string; className?: string }) {
  if (providerId === "google_calendar") {
    return <CalendarDays className={className ?? "h-5 w-5 text-blue-600"} />;
  }
  return <Mail className={className ?? "h-5 w-5 text-red-500"} />;
}

function providerLabel(id: string, catalog: AvailableProvider[]): string {
  return catalog.find((p) => p.id === id)?.label ?? id;
}

function statusLabel(status: string): string {
  if (status === "expired") return "Needs reconnect";
  if (status === "revoked") return "Revoked";
  return "Connected";
}

export function IntegrationsSection() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [catalog, setCatalog] = useState<AvailableProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rows, providers] = await Promise.all([
        listIntegrations(),
        listAvailableProviders(),
      ]);
      setIntegrations(rows);
      setCatalog(providers);
      setError(null);
    } catch (err) {
      console.warn("[Integrations] Failed to load:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    void (async () => {
      const u1 = await listen("integration-connected", () => {
        if (!cancelled) {
          setConnecting(null);
          void refresh();
        }
      });
      const u2 = await listen("integration-disconnected", () => {
        if (!cancelled) void refresh();
      });
      const u3 = await listen("integration-expired", () => {
        if (!cancelled) void refresh();
      });
      unsubs.push(u1, u2, u3);
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [refresh]);

  const connectedIds = useMemo(
    () => new Set(integrations.map((i) => i.provider)),
    [integrations]
  );

  const availableToAdd = useMemo(
    () => catalog.filter((p) => !connectedIds.has(p.id)),
    [catalog, connectedIds]
  );

  const handleConnect = async (providerId: string) => {
    setError(null);
    setConnecting(providerId);
    setModalOpen(false);
    try {
      await startOauthConnect(providerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (providerId: string) => {
    setError(null);
    setDisconnecting(providerId);
    try {
      await disconnectIntegration(providerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading integrations…
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {connecting && (
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Waiting for browser… Finish signing in to{" "}
          {providerLabel(connecting, catalog)}, then return here.
        </div>
      )}

      {integrations.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-neutral-200 bg-white px-6 py-14 text-center shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm">
              <Mail className="h-5 w-5 text-red-500" />
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm">
              <CalendarDays className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          <p className="text-[15px] font-semibold tracking-tight text-neutral-900">
            No integrations connected
          </p>
          <p className="mt-1.5 max-w-sm text-[13px] text-neutral-500">
            Connect Gmail or Google Calendar so Torvi can use them for context.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!!connecting}
            className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add integration
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm divide-y divide-neutral-100">
            {integrations.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-4 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white">
                    <ProviderIcon providerId={row.provider} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-neutral-900">
                      {providerLabel(row.provider, catalog)}
                    </p>
                    <p className="truncate text-[12px] text-neutral-500">
                      {row.accountEmail ?? statusLabel(row.status)}
                      {row.status === "expired" && row.accountEmail
                        ? " · Needs reconnect"
                        : null}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.status === "expired" && (
                    <button
                      type="button"
                      disabled={!!connecting}
                      onClick={() => void handleConnect(row.provider)}
                      className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Reconnect
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disconnecting === row.provider || !!connecting}
                    onClick={() => void handleDisconnect(row.provider)}
                    className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 disabled:opacity-50"
                  >
                    {disconnecting === row.provider ? "Removing…" : "Disconnect"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {availableToAdd.length > 0 && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={!!connecting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Add integration
            </button>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-integration-title"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2
                id="add-integration-title"
                className="text-[15px] font-semibold text-neutral-900"
              >
                Add integration
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="max-h-[360px] overflow-y-auto divide-y divide-neutral-100">
              {(availableToAdd.length > 0 ? availableToAdd : catalog).map((provider) => {
                const already = connectedIds.has(provider.id);
                return (
                  <li key={provider.id}>
                    <button
                      type="button"
                      disabled={already || !!connecting}
                      onClick={() => void handleConnect(provider.id)}
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-neutral-50 disabled:opacity-50"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200">
                        <ProviderIcon providerId={provider.id} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-neutral-900">
                          {provider.label}
                        </p>
                        <p className="text-[12px] text-neutral-500">
                          {already ? "Already connected" : provider.description}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
