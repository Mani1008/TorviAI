import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pencil } from "lucide-react";
import { loadUserProfile, clearAuthToken, clearUserProfile } from "@/lib/storage/auth";
import {
  loadUserPreferences,
  saveUserPreferences,
} from "@/lib/storage/user-preferences.storage";
import { logout } from "@/lib/backend";

export function GeneralSection() {
  const user = loadUserProfile();
  const [prefs, setPrefs] = useState(() => loadUserPreferences());

  const handleSignOut = async () => {
    try {
      await logout();
    } catch {
      /* expired */
    }
    clearAuthToken();
    clearUserProfile();
    await invoke("lock_app").catch(() => {});
  };

  const updatePrefs = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveUserPreferences(next);
  };

  return (
    <div className="space-y-8 max-w-xl">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          What should Torvi call you?
        </label>
        <input
          type="text"
          value={prefs.displayName}
          onChange={(e) => updatePrefs({ displayName: e.target.value })}
          placeholder="Your name"
          className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Aliases</label>
        <input
          type="text"
          value={prefs.aliases}
          onChange={(e) => updatePrefs({ aliases: e.target.value })}
          placeholder="e.g. Rob, Robby, robert2025"
          className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Include nicknames, online handles, and other identifiers, separated by commas.
        </p>
      </div>

      {user && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Email</label>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={user.email}
              readOnly
              className="flex-1 rounded-xl border border-input bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground"
            />
            <button
              type="button"
              title="Edit email in account settings"
              className="rounded-lg border border-border p-2.5 text-muted-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-border pt-6 space-y-3">
        <p className="text-sm text-muted-foreground">Torvi v0.1.0</p>
        {user && (
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
