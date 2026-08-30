# Torvi AI — "Integrations" Feature Implementation Plan

Goal: replicate Littlebird's Settings → Integrations screen — a list of connectable
providers (Gmail, Google Calendar, etc.), an "Add integration" flow that runs OAuth 2.0,
and secure local token storage so other Torvi subsystems (RAG, context capture) can call
those APIs on the user's behalf.

---

## 0. Where this fits in your architecture

- **Layer**: This is a new subsystem alongside your screen-capture and RAG layers —
  call it the **Integrations Layer**. It doesn't touch UIAutomation at all; it's a
  separate data source (external APIs) feeding the same SQLite-backed context store.
- **New DB table**: `integrations` (local SQLite, not Supabase — tokens should stay local
  unless you explicitly want cross-device sync, in which case encrypt before syncing).
- **New Rust module**: `src-tauri/src/integrations/` — one file per provider + a shared
  OAuth client + a secure token store using DPAPI (you're already using DPAPI elsewhere).
- **New React route**: `SettingsIntegrations.tsx` matching the screenshot's layout
  (empty state → provider icon grid → "Add integration" → modal/list of available
  providers → connected state with account email + disconnect button).

---

## 1. Data model

```sql
-- migrations/00X_create_integrations.sql
CREATE TABLE IF NOT EXISTS integrations (
    id              TEXT PRIMARY KEY,          -- uuid
    provider        TEXT NOT NULL,             -- 'gmail' | 'google_calendar' | ...
    account_email   TEXT,                      -- shown in UI once connected
    scopes          TEXT NOT NULL,             -- space-separated, as granted
    access_token    BLOB NOT NULL,             -- DPAPI-encrypted
    refresh_token   BLOB,                      -- DPAPI-encrypted, nullable
    token_expires_at INTEGER,                  -- unix epoch seconds
    status          TEXT NOT NULL DEFAULT 'connected', -- connected | expired | revoked
    connected_at    INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
```

One row per provider (re-connecting overwrites). If you'll ever support multiple accounts
per provider, drop the unique index and key by `(provider, account_email)` instead.

---

## 2. OAuth flow design (desktop app specifics)

Google's OAuth for installed/desktop apps uses the **Authorization Code + PKCE** flow with
a **loopback redirect** (`http://127.0.0.1:<port>/callback`) — this is the Google-recommended
approach for native apps and avoids embedding a client secret.

Flow:
1. Rust spins up a short-lived local HTTP listener on a random port (e.g. via `tiny_http`
   or `axum` in a background task).
2. Rust generates a PKCE `code_verifier`/`code_challenge`, builds the Google auth URL, and
   opens it in the user's default browser (`tauri-plugin-shell`'s `open()`).
3. User signs in and grants scopes in the browser.
4. Google redirects to `http://127.0.0.1:<port>/callback?code=...`.
5. The local listener captures the code, immediately shuts down, and shows a simple
   "You can close this tab" static HTML page.
6. Rust exchanges the code (+ verifier) for tokens via `https://oauth2.googleapis.com/token`.
7. Tokens get DPAPI-encrypted and written to the `integrations` table.
8. Rust emits a Tauri event (`integration-connected`) so the frontend updates without polling.

This avoids needing a custom URI scheme registration (`torvi://oauth-callback`), which is
an alternative but adds Windows registry/protocol-handler complexity you don't need yet.

### Scopes you'll want initially
- Gmail: `https://www.googleapis.com/auth/gmail.readonly` (start read-only; only request
  `.send`/`.modify` if a feature actually needs it — narrower scopes = smoother consent
  screen and less user hesitation)
- Calendar: `https://www.googleapis.com/auth/calendar.readonly`

### Google Cloud Console setup (do this first, outside Cursor)
1. Create a project at console.cloud.google.com.
2. Enable Gmail API and Google Calendar API.
3. Configure OAuth consent screen (external, testing mode is fine while you're solo).
4. Create an **OAuth Client ID** of type **Desktop app**.
5. You'll get a `client_id` (and a `client_secret` — for desktop apps this isn't truly
   secret, but Google still issues one; ship it in the binary, it's not a security boundary
   for installed apps per Google's own model).

---

## 3. Rust backend

### 3.1 Dependencies (`src-tauri/Cargo.toml`)
```toml
[dependencies]
oauth2 = "4"
tiny_http = "0.12"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# you already have: rusqlite (or sqlx), windows crate for DPAPI
```

### 3.2 Module layout
```
src-tauri/src/integrations/
  mod.rs
  oauth_client.rs      // builds the oauth2::basic::BasicClient per provider
  loopback_server.rs   // tiny_http listener, one-shot capture of ?code=
  token_store.rs       // DPAPI encrypt/decrypt + sqlite read/write
  providers/
    mod.rs
    gmail.rs           // provider metadata + scope list
    google_calendar.rs
  commands.rs          // #[tauri::command] functions exposed to frontend
```

### 3.3 Core commands to expose

```rust
// commands.rs
#[tauri::command]
pub async fn list_integrations(state: tauri::State<'_, AppState>) -> Result<Vec<IntegrationDto>, String> {
    // SELECT provider, account_email, status, connected_at FROM integrations
}

#[tauri::command]
pub async fn start_oauth_connect(
    provider: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // 1. look up provider config (client_id, scopes, auth/token endpoints)
    // 2. spin up loopback server, get redirect_uri
    // 3. build auth URL with PKCE challenge
    // 4. tauri_plugin_shell::open(app, auth_url)
    // 5. await the one-shot code capture (with timeout, e.g. 5 min)
    // 6. exchange code -> tokens
    // 7. fetch account email (Google's userinfo endpoint) for display
    // 8. encrypt + upsert into integrations table
    // 9. app.emit("integration-connected", provider)?;
}

#[tauri::command]
pub async fn disconnect_integration(
    provider: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // optionally call Google's revoke endpoint, then DELETE the row
}
```

### 3.4 Token refresh
Add a background check (reuse your existing "hourly prune" scheduler pattern from the
upgrade plan) that looks for tokens expiring within 5 minutes and refreshes them using the
stored `refresh_token`, so API calls never hit a 401 mid-use.

### 3.5 Token encryption
Reuse whatever DPAPI wrapper you already have for other secrets. Pattern:
```rust
// token_store.rs
pub fn encrypt_token(plain: &str) -> Result<Vec<u8>, String> {
    // windows::Win32::Security::Cryptography::CryptProtectData
}
pub fn decrypt_token(cipher: &[u8]) -> Result<String, String> {
    // CryptUnprotectData
}
```

---

## 4. Frontend (React/TypeScript)

### 4.1 Component structure
```
src/pages/settings/
  IntegrationsPage.tsx       // matches the screenshot layout
  components/
    IntegrationEmptyState.tsx
    IntegrationCard.tsx       // connected-state row: icon, email, disconnect
    AddIntegrationModal.tsx   // picker: Gmail, Calendar, (future) Slack, Notion...
```

### 4.2 `IntegrationsPage.tsx` (sketch matching the screenshot)
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Integration {
  provider: string;
  accountEmail: string | null;
  status: "connected" | "expired" | "revoked";
  connectedAt: number;
}

const PROVIDER_META: Record<string, { label: string; icon: string }> = {
  gmail: { label: "Gmail", icon: "/icons/gmail.svg" },
  google_calendar: { label: "Google Calendar", icon: "/icons/gcal.svg" },
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const refresh = async () => {
    const rows = await invoke<Integration[]>("list_integrations");
    setIntegrations(rows);
  };

  useEffect(() => {
    refresh();
    const unlisten = listen("integration-connected", () => {
      setConnecting(null);
      refresh();
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const handleConnect = async (provider: string) => {
    setConnecting(provider);
    setModalOpen(false);
    try {
      await invoke("start_oauth_connect", { provider });
    } catch (e) {
      setConnecting(null);
      // surface toast/error
    }
  };

  const handleDisconnect = async (provider: string) => {
    await invoke("disconnect_integration", { provider });
    refresh();
  };

  return (
    <div className="integrations-page">
      <h1 className="integrations-title">Your Integrations</h1>

      {integrations.length === 0 ? (
        <div className="integrations-empty">
          <div className="integrations-empty-icons">
            <img src="/icons/gmail.svg" alt="Gmail" />
            <img src="/icons/gcal.svg" alt="Google Calendar" />
          </div>
          <p className="integrations-empty-title">No integrations connected</p>
          <p className="integrations-empty-subtitle">
            Connect your apps to let Torvi work across them.
          </p>
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            + Add integration
          </button>
        </div>
      ) : (
        <div className="integrations-list">
          {integrations.map((i) => (
            <IntegrationCard
              key={i.provider}
              meta={PROVIDER_META[i.provider]}
              integration={i}
              onDisconnect={() => handleDisconnect(i.provider)}
            />
          ))}
          <button className="btn-secondary" onClick={() => setModalOpen(true)}>
            + Add integration
          </button>
        </div>
      )}

      {modalOpen && (
        <AddIntegrationModal
          onSelect={handleConnect}
          onClose={() => setModalOpen(false)}
          connecting={connecting}
        />
      )}
    </div>
  );
}
```

Match the screenshot's visual language via your `frontend-design` conventions: cream
background (`#F7F4EE`-ish), serif heading for "Your Integrations", muted gray body text,
black pill button with `+` icon. Keep this consistent with your existing Context Memory
page styling.

### 4.3 `AddIntegrationModal.tsx`
Simple list/grid of available providers (Gmail, Google Calendar now; leave room to add
Slack/Notion later), each row triggering `onSelect(provider)`. Show a spinner/"Waiting for
browser..." state while `connecting === provider`, since the user has to complete the flow
in their browser.

---

## 5. Step-by-step build order (feed these to Cursor one at a time)

Doing this in small, testable slices will go much better in Cursor than asking for the
whole feature at once — each prompt below should be a separate Cursor request, and you
should verify it builds/runs before moving to the next.

1. **Migration**: "Add a new SQLite migration creating the `integrations` table per this
   schema: [paste section 1]. Wire it into our existing migration runner."
2. **Token store**: "Create `src-tauri/src/integrations/token_store.rs` with DPAPI
   encrypt/decrypt functions matching the pattern used in `[your existing DPAPI file]`,
   plus `save_integration`, `get_integration`, `delete_integration`, `list_integrations`
   functions against the `integrations` table."
3. **Loopback server**: "Create `src-tauri/src/integrations/loopback_server.rs` using
   `tiny_http` that starts a listener on an OS-assigned port, returns the port + a
   oneshot::Receiver<String> that resolves with the `code` query param from the first
   `/callback` request, then shuts down and serves a static 'You can close this tab' page."
4. **OAuth client + Gmail provider config**: "Create
   `src-tauri/src/integrations/providers/gmail.rs` defining the Google OAuth endpoints,
   client_id [yours], scopes, and a function building an `oauth2::basic::BasicClient`
   with PKCE."
5. **`start_oauth_connect` command**: "Implement the Tauri command in
   `commands.rs` wiring together the loopback server, oauth2 crate's authorize_url +
   PKCE + code exchange, and token_store — see the flow in section 2/3.3 of this doc."
6. **`list_integrations` / `disconnect_integration` commands**: straightforward CRUD
   wrappers around token_store.
7. **Register commands**: "Add these new commands to the `invoke_handler` in
   `src-tauri/src/main.rs`."
8. **Frontend page**: "Create `IntegrationsPage.tsx` and its two child components per
   this sketch: [paste section 4]. Match styling to our existing settings pages."
9. **Wire into Settings nav**: hook the new page into whatever router/tab system your
   Settings modal already uses (visible in the left nav in your screenshot).
10. **Token refresh scheduler**: "Add a background task alongside our existing hourly
    prune job that refreshes any integration token expiring within 5 minutes."
11. **End-to-end test**: connect Gmail, kill and restart the app, confirm the integration
    still shows as connected and a token refresh succeeds silently.

---

## 6. Security notes
- Never log raw tokens, even in debug builds — log `provider` and `status` only.
- DPAPI ties encrypted tokens to the Windows user account; if you ever sync `integrations`
  to Supabase, you'd need a different encryption scheme (DPAPI blobs aren't portable
  across machines) — for now, keep this table local-only.
- Handle the "no browser available" / user closes tab without completing flow case with a
  timeout on the loopback server (don't hang forever).
- Respect Google's verification requirements if you ever move `gmail.readonly` or broader
  scopes out of testing mode — unverified apps cap at 100 test users and show an "unverified
  app" warning.

---

## 7. Later extensions (not now)
- Additional providers (Slack, Notion) follow the exact same pattern — new file under
  `providers/`, new icon, no changes to the OAuth machinery itself.
- Per Phase 2/3 of your upgrade plan, once Gmail/Calendar are connected you can start
  feeding calendar events into the "routines/digest scheduler" and Gmail into
  `user_facts` extraction — this integrations layer is the prerequisite for both.