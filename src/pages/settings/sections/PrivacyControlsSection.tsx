import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Globe, Loader2, Search } from "lucide-react";
import { isTauri } from "@/lib/platform";
import { useAppIcon } from "@/hooks/useAppIcon";
import {
  addBlockedApp,
  addBlockedDomain,
  isAppExcluded,
  isDomainExcluded,
  loadCaptureExclusions,
  setAppExcluded,
  setDomainExcluded,
} from "@/lib/storage/capture-exclusions.storage";
import type { CaptureExclusions } from "@/types/settings";

interface CapturableApp {
  id: string;
  displayName: string;
  processName: string;
  /** Absolute `.exe` / `.lnk` path for icon extraction */
  iconPath?: string | null;
}

interface CapturableWebsite {
  id: string;
  host: string;
  sampleTitle?: string | null;
}

function AppIcon({
  iconPath,
  processName,
  displayName,
}: {
  iconPath?: string | null;
  processName: string;
  displayName: string;
}) {
  const lookup = (iconPath && iconPath.trim()) || processName || displayName;
  const icon = useAppIcon(lookup);
  const [imgFailed, setImgFailed] = useState(false);
  const letter = (displayName.trim().charAt(0) || "?").toUpperCase();

  useEffect(() => {
    setImgFailed(false);
  }, [icon]);

  if (icon && !imgFailed) {
    return (
      <img
        src={`data:image/png;base64,${icon}`}
        className="h-7 w-7 shrink-0 object-contain"
        alt=""
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-700">
      {letter}
    </div>
  );
}

function WebsiteFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100">
        <Globe className="h-3.5 w-3.5 text-neutral-500" />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden">
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        className="h-5 w-5"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? "bg-neutral-900" : "bg-neutral-300"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

export function PrivacyControlsSection() {
  const [exclusions, setExclusions] = useState<CaptureExclusions>(() =>
    loadCaptureExclusions()
  );
  const [activeTab, setActiveTab] = useState<"apps" | "websites">("apps");
  const [search, setSearch] = useState("");
  const [apps, setApps] = useState<CapturableApp[]>([]);
  const [websites, setWebsites] = useState<CapturableWebsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualApp, setManualApp] = useState("");
  const [manualDomain, setManualDomain] = useState("");
  const [showManual, setShowManual] = useState(false);

  const refreshLists = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [appRows, siteRows] = await Promise.all([
        invoke<CapturableApp[]>("list_capturable_apps"),
        invoke<CapturableWebsite[]>("list_capturable_websites"),
      ]);
      setApps(appRows);
      setWebsites(siteRows);
    } catch (err) {
      console.warn("[PrivacyControls] Failed to load apps:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  const excludedAppCount = exclusions.blockedApps.length;
  const excludedSiteCount = exclusions.blockedDomains.length;

  const filteredApps = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = [...apps];
    for (const blocked of exclusions.blockedApps) {
      if (!list.some((app) => app.processName === blocked)) {
        list.push({
          id: blocked,
          displayName: blocked,
          processName: blocked,
        });
      }
    }
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (!query) return list;
    return list.filter(
      (app) =>
        app.displayName.toLowerCase().includes(query) ||
        app.processName.toLowerCase().includes(query)
    );
  }, [apps, exclusions.blockedApps, search]);

  const filteredWebsites = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list: CapturableWebsite[] = [...websites];
    for (const host of exclusions.blockedDomains) {
      if (!list.some((site) => site.host === host)) {
        list.push({ id: host, host, sampleTitle: null });
      }
    }
    list.sort((a, b) => a.host.localeCompare(b.host));
    if (!query) return list;
    return list.filter((site) => site.host.toLowerCase().includes(query));
  }, [websites, exclusions.blockedDomains, search]);

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => {
            setActiveTab("apps");
            setSearch("");
            setShowManual(false);
          }}
          className={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${
            activeTab === "apps"
              ? "bg-neutral-200/80 text-neutral-900"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          }`}
        >
          Exclude Apps ({excludedAppCount})
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("websites");
            setSearch("");
            setShowManual(false);
          }}
          className={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${
            activeTab === "websites"
              ? "bg-neutral-200/80 text-neutral-900"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          }`}
        >
          Exclude Websites ({excludedSiteCount})
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            activeTab === "apps"
              ? "Search applications…"
              : "Search websites…"
          }
          className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : activeTab === "apps" ? (
          filteredApps.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-neutral-500">
              No applications found. Use Torvi for a bit or add one manually below.
            </p>
          ) : (
            <ul className="max-h-[440px] overflow-y-auto divide-y divide-neutral-100">
              {filteredApps.map((app) => {
                const allowed = !isAppExcluded(exclusions, app.processName);
                return (
                  <li
                    key={app.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50/80"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <AppIcon
                        iconPath={app.iconPath}
                        processName={app.processName}
                        displayName={app.displayName}
                      />
                      <p className="truncate text-[13px] font-semibold tracking-tight text-neutral-900">
                        {app.displayName}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={allowed}
                      label={`Allow capture from ${app.displayName}`}
                      onChange={(next) =>
                        setExclusions((prev) =>
                          setAppExcluded(prev, app.processName, !next)
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )
        ) : filteredWebsites.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-neutral-500">
            No websites seen yet. Browse in Chrome or Edge, or add a domain below.
          </p>
        ) : (
          <ul className="max-h-[440px] overflow-y-auto divide-y divide-neutral-100">
            {filteredWebsites.map((site) => {
              const allowed = !isDomainExcluded(exclusions, site.host);
              return (
                <li
                  key={site.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50/80"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <WebsiteFavicon host={site.host} />
                    <p className="truncate text-[13px] font-semibold tracking-tight text-neutral-900">
                      {site.host}
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={allowed}
                    label={`Allow capture from ${site.host}`}
                    onChange={(next) =>
                      setExclusions((prev) =>
                        setDomainExcluded(prev, site.host, !next)
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!showManual ? (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="text-[13px] text-neutral-500 underline-offset-2 transition-colors hover:text-neutral-800 hover:underline"
        >
          Can&apos;t find your {activeTab === "apps" ? "app" : "website"}? Add it
          manually
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] text-neutral-500">
            Can&apos;t find your {activeTab === "apps" ? "app" : "website"}? Add it
            manually.
          </p>
          {activeTab === "apps" ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={manualApp}
                onChange={(e) => setManualApp(e.target.value)}
                placeholder="e.g. chrome, slack"
                className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              />
              <button
                type="button"
                disabled={!manualApp.trim()}
                onClick={() => {
                  setExclusions((prev) => addBlockedApp(prev, manualApp));
                  setManualApp("");
                }}
                className="rounded-lg bg-neutral-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                Exclude
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={manualDomain}
                onChange={(e) => setManualDomain(e.target.value)}
                placeholder="e.g. gmail.com"
                className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              />
              <button
                type="button"
                disabled={!manualDomain.trim()}
                onClick={() => {
                  setExclusions((prev) => addBlockedDomain(prev, manualDomain));
                  setManualDomain("");
                }}
                className="rounded-lg bg-neutral-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                Exclude
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
