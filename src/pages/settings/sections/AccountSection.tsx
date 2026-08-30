import { invoke } from "@tauri-apps/api/core";
import { logout } from "@/lib/backend";
import { clearAuthToken, clearUserProfile, loadUserProfile } from "@/lib/storage/auth";

export function AccountSection() {
  const user = loadUserProfile();

  const handleSignOutAll = async () => {
    try {
      await logout();
    } catch {
      /* expired */
    }
    clearAuthToken();
    clearUserProfile();
    await invoke("lock_app").catch(() => {});
  };

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground max-w-xl">
        Sign in from the sidebar to manage account sessions.
      </p>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="rounded-xl border border-border p-4">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
      </section>

      <section className="flex items-center justify-between rounded-xl border border-border p-4">
        <div>
          <p className="text-sm font-medium">Sign out of all devices</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revokes every active session, including other browsers and devices.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOutAll}
          className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/15 transition-colors shrink-0 ml-4"
        >
          Sign out all
        </button>
      </section>
    </div>
  );
}
