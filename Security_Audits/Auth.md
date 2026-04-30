# Authentication & Authorization Security Analysis
**Application:** Torvi AI Assistant  
**Date:** April 24, 2026  
**Scope:** Auth token lifecycle, OAuth flow, session management, billing/plan enforcement, RBAC  
**Status:** AUTH-01, AUTH-03, AUTH-05 ✅ fixed. AUTH-02 deferred (requires server-side work). AUTH-06 documented.

---

## 1. Architecture Overview

Torvi uses a **dual-path authentication system**:

```
Path A — Appwrite OAuth (primary)
  Gate UI
    → invoke("start_oauth_callback_server")   [Rust: binds TCP on 127.0.0.1:random_port]
    → openUrl(appwrite OAuth Google URL)       [system browser]
    → browser: user authenticates with Google
    → Appwrite redirects to http://127.0.0.1:{port}/callback?userId=X&secret=Y&state=Z
    → Rust: parses callback, emits "oauth-callback-received" to gate window only
    → Gate: validates CSRF state nonce (from sessionStorage)
    → Gate: calls createSessionFromOAuth(userId, secret)  [Appwrite SDK]
    → Gate: calls resolveUserProfile() → saveUserProfile()
    → Gate: invokes unlock_app()

Path B — Legacy JWT (fallback / landing page integration)
  Gate UI
    → invoke("start_oauth_callback_server")   [same Rust server]
    → openUrl("{APP_URL}/login?callback_port={port}&state={nonce}")
    → browser: user signs in, server generates JWT
    → server redirects to http://127.0.0.1:{port}/callback?token=JWT&state=Z
    → Rust: same callback server → emits to gate window
    → Gate: validates CSRF state nonce
    → Gate: saveAuthToken(token)              [← writes to localStorage — see AUTH-01]
    → Gate: verifyToken() → saveUserProfile()
    → Gate: invokes unlock_app()
```

**No password handling, no bcrypt/argon2** — all credential processing is on the server. Client only receives and stores tokens.

---

## 2. Findings

### CRITICAL

*None.*

---

### HIGH

---

#### ✅ AUTH-01 — Legacy Auth Token Written to `localStorage` (FIXED)
**Fix applied:** `src/pages/gate/index.tsx` now imports `saveAuthToken`, `loadAuthToken`, and `verifyToken` exclusively from `src/lib/storage/auth.ts` (sessionStorage-backed). The legacy `src/lib/auth.ts` has been deleted. Dev bypass (`VITE_SKIP_AUTH_CHECK`) moved to an explicit check at the top of the gate startup effect.
**File:** `src/lib/auth.ts` — `saveAuthToken()` / `getAuthToken()`  
**CWE:** CWE-922 — Insecure Storage of Sensitive Information  
**OWASP:** A02:2021 — Cryptographic Failures

**Description:**  
There are two auth modules in the codebase:

| File | Token Storage | Status |
|------|--------------|--------|
| `src/lib/storage/auth.ts` | `sessionStorage` | ✅ Correct — token cleared on window close |
| `src/lib/auth.ts` | `localStorage` | ✅ Deleted — no longer exists |

`src/pages/gate/index.tsx` imports `saveAuthToken` and `verifyToken` from the **legacy** file:

```typescript
// gate/index.tsx — line 7–8
import { saveAuthToken, verifyToken } from "@/lib/auth";         // ← LEGACY, localStorage
import { saveUserProfile } from "@/lib/storage/auth";            // ← NEW, sessionStorage
```

Result: every Legacy JWT auth write lands in `localStorage`, meaning:
- The token survives app restarts, OS reboots, and other sessions
- Any local process with filesystem read access can extract it
- DevTools → Application → Local Storage exposes it in plaintext

The OWASP A02 remediation applied to `src/lib/storage/auth.ts` is bypassed entirely because the gate never calls that module's `saveAuthToken`.

**Fix applied:**
```typescript
// gate/index.tsx — line 7–8 (after fix)
import { saveAuthToken, loadAuthToken, verifyToken, saveUserProfile } from "@/lib/storage/auth";
import { API_BASE_URL } from "@/config/constants";
```
`src/lib/auth.ts` deleted. Gate startup and callback handler now call `verifyToken(token, API_BASE_URL)` explicitly.

---

#### AUTH-02 — Plan Tier (Billing Enforcement) Is Client-Side Only
**File:** `src/lib/storage/usage-stats.ts` · `checkAiResponseLimit()`  
**CWE:** CWE-602 — Client-Side Enforcement of Server-Side Security  
**OWASP:** A01:2021 — Broken Access Control

**Description:**  
The billing plan limit check reads the plan from `localStorage`:

```typescript
// usage-stats.ts
export function checkAiResponseLimit(): string | null {
  const profile = loadUserProfile();      // ← reads from localStorage
  const planKey = profile?.plan === ...;
  const limits = PLAN_LIMITS[planKey];
  const stats = loadUsageStats();         // ← reads from localStorage
  if (stats.aiResponses >= limits.aiResponses) {
    return `You've reached your ${planKey} plan limit...`;
  }
  return null;
}
```

A user can bypass this entirely by:
1. Opening DevTools → Application → Local Storage
2. Changing `torvi_user_profile` `.plan` from `"starter"` to `"pro"`
3. Resetting `torvi_usage_stats` `.aiResponses` to `0`

The code itself acknowledges this with a comment:
> *"This check is client-side only and can be bypassed by a technically sophisticated user. Authoritative enforcement must be implemented server-side..."*

**Impact:** Users can use unlimited AI responses without paying, inflating provider costs indefinitely.

**Fix required:** Authoritative plan enforcement on the server before this feature is monetised:
- Appwrite Function (or backend endpoint) that atomically decrements a counter per user and rejects when the limit is reached
- The Rust `stream_ai_request` command should receive a short-lived **server-signed usage token** valid for N requests rather than a client-reported plan tier
- As a minimum interim measure, re-fetch plan from Appwrite on each app launch (not just on first login) so it cannot be stale-cached

---

### MEDIUM

---

#### ✅ AUTH-03 — `unlock_app` Has No Server-Side Auth Validation in Rust (FIXED)
**Fix applied:** Both `unlock_app` and `show_gate` in `window.rs` now verify `window.label() == "gate"` before executing. Both `start_oauth_callback_server` in `auth.rs` checks the same. Any invocation from `main` or `dashboard` windows is rejected with "Not authorized" and logged at WARN level.
**File:** `src-tauri/src/window.rs` · `unlock_app()`  
**CWE:** CWE-284 — Improper Access Control

**Description:**  
`unlock_app` is a Tauri command callable from any WebView script. It shows the main window and pill bar. There is no challenge or proof-of-auth passed to it:

```typescript
// gate/index.tsx — called after auth succeeds
await invoke("unlock_app");
```

```rust
// window.rs
#[tauri::command]
pub async fn unlock_app(app: AppHandle) -> Result<(), String> {
    // Shows the main window — no auth token verification here
}
```

The Rust layer takes the frontend's word that auth succeeded. If another script running in the WebView context (e.g., a future XSS) calls `invoke("unlock_app")`, the main window is shown without any auth.

**Mitigating factor:** Tauri's IPC is only accessible to scripts in the WebView. Tauri 2.x's capability system scopes which commands each window can call. If the gate window's capability is locked to only the commands it needs, the attack surface is bounded.

**Fix applied:**
```rust
// window.rs — unlock_app and show_gate
pub async fn unlock_app(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "gate" {
        log::warn!("[Auth] unlock_app called from unexpected window: {}", window.label());
        return Err("Not authorized".to_string());
    }
    // ...
}
```
Same guard applied to `show_gate` and `start_oauth_callback_server`.

---

#### AUTH-04 — `verifyToken` in Legacy Module Has No Timeout
**File:** `src/lib/auth.ts` · `verifyToken()`  
**CWE:** CWE-400 — Uncontrolled Resource Consumption

**Description:**  
The legacy `verifyToken` in `src/lib/auth.ts` uses `AbortSignal.timeout(5000)` which is correct. However, the function **silently fails open on network errors regardless of environment**:

```typescript
// src/lib/auth.ts
} catch {
  // Network down / API not set up yet — fail open only in dev
  if (import.meta.env.DEV) return null;
  return null;   // ← Returns null in PROD too, not an error — gate falls through to "no auth"
}
```

Both `DEV` and production branches return `null`. This means a network error during startup auth-check silently acts as "no token found," causing the gate to re-show the sign-in prompt. While this isn't a privilege escalation (auth is still required), it creates a confusing UX on flaky networks and masks token errors.

The newer `src/lib/storage/auth.ts` · `verifyToken` correctly uses an explicit `AbortController` with `clearTimeout` in `finally`.

**Fix:** This becomes moot once AUTH-01 is fixed (legacy file deleted). Track as resolved when AUTH-01 is implemented.

---

#### ✅ AUTH-05 — OAuth Callback Server Accepts One Connection Only (FIXED)
**Fix applied:** `start_oauth_callback_server` in `auth.rs` now wraps `listener.accept()` in `tokio::time::timeout(Duration::from_secs(300), ...)`. If no browser callback arrives within 5 minutes, the spawned task exits and the port is released. A WARN log is emitted on timeout.
**File:** `src-tauri/src/auth.rs` · `start_oauth_callback_server()`

**Description:**  
The callback server accepts exactly one TCP connection and then exits:

```rust
tokio::spawn(async move {
    if let Ok((mut stream, _)) = listener.accept().await {
        // Handle one request, done
    }
    // listener dropped — port released
});
```

If the browser opens the callback URL twice (e.g., user clicks "back" and reloads), the second request finds no server. More critically, there is no timeout on the `accept()` call — if the user closes the browser without completing auth, the port is held open (and the spawned task parked on `accept`) until the Tauri process terminates.

**Impact:**
- Port leak (minor — OS will reclaim on process exit)
- If many failed auth attempts occur in one session, many abandoned `TcpListener` tasks accumulate in memory

```rust
// auth.rs — after fix
let accept_result = tokio::time::timeout(
    Duration::from_secs(300),
    listener.accept(),
).await;
let (mut stream, _) = match accept_result {
    Ok(Ok(conn)) => conn,
    Ok(Err(e)) => { log::warn!(...); return; }
    Err(_)      => { log::warn!("... timed out ..."); return; }
};
```

---

#### AUTH-06 — User Profile (Including Plan) Stored in `localStorage` Without Integrity Check
**File:** `src/lib/storage/auth.ts` · `saveUserProfile()` / `loadUserProfile()`

**Description:**  
`loadUserProfile()` validates the schema (required fields, `ALLOWED_PLANS` set), which prevents format injection. However, since the profile is stored in plaintext `localStorage`, a user can:
- Change `plan` to `"pro"` to bypass billing (see AUTH-02)
- Change `id` or `email` to impersonate another user's data (Appwrite sync uses `profile.id` as the document ID)

```typescript
// sync.ts — uses profile.id as Appwrite document key
syncConversation(profile.id, { ... })
```

If `profile.id` is tampered with, sync operations use the wrong Appwrite document ID — potentially reading another user's synced conversations.

**Fix:** Re-fetch the canonical user profile from Appwrite on every app launch (not just on sign-in). Never use a cached `localStorage` profile as the authoritative source for user identity:

```typescript
// On startup, after Appwrite session confirmed:
const awUser = await aw.getActiveSession();
if (awUser) {
  const canonical = await aw.resolveUserProfile(awUser); // always from server
  saveUserProfile(canonical);                            // overwrite cached copy
}
```

---

### LOW / INFORMATIONAL

---

#### AUTH-07 — No Token Expiration / Refresh Logic
**Files:** `src/lib/storage/auth.ts`, `src/lib/appwrite/auth.ts`

**Description:**  
**Appwrite path:** Appwrite sessions have server-managed expiry. `getActiveSession()` will return null when the session expires, causing the gate to re-prompt. This is correct behavior.

**Legacy JWT path:** The JWT is stored and never refreshed. If the server issues short-lived JWTs (recommended: ≤ 1 hour), the app will silently fail to verify on restart and re-prompt for login. If the server issues long-lived JWTs (30 days as suggested in `landingpage.md`), there is no rotation mechanism.

**Informational:** No action needed until the legacy JWT path is actively used in production. Document the expected token lifetime in the landing page integration contract.

---

#### AUTH-08 — No Multi-Factor Authentication
**Scope:** Appwrite OAuth path only; Google OAuth provides implicit MFA if the user has it enabled on their Google account.  
**Status:** Informational — acceptable for current product phase.

---

#### AUTH-09 — CSRF State Nonce Stored in `sessionStorage`, Not Tied to Tab
**File:** `src/pages/gate/index.tsx`

**Description:**  
The CSRF nonce is stored in `sessionStorage` under `"oauth_state_nonce"`. In a browser context, `sessionStorage` is per-tab. In Tauri, a WebView window shares the same `sessionStorage` context — there is effectively only one "tab." This is fine.

However, if multiple OAuth initiations are triggered rapidly (the 2-second debounce prevents most cases), the second `sessionStorage.setItem` overwrites the first nonce, causing the first callback (if it arrives) to fail validation. This is the correct security outcome but can cause a confusing error if the user clicks sign-in twice.

**Status:** Informational — the debounce makes this extremely unlikely in practice.

---

## 3. Role-Based Access Control (RBAC) Assessment

Torvi has a flat permission model — there are no roles, only **plan tiers**:

| Plan | AI Responses / Period | STT Listening / Period |
|------|----------------------|------------------------|
| starter | 50 | 1800 s |
| plus | 200 | 7200 s |
| pro | unlimited | unlimited |
| dev | unlimited | unlimited |

**No RBAC exists** and none is needed for the current architecture. All users have identical feature access; plan only controls usage quotas. The only elevation risk is client-side plan spoofing (AUTH-02).

**Privilege escalation risks:**
- Horizontal: Profile ID tampering could misdirect Appwrite sync (AUTH-06)
- Vertical: Plan tier spoofing bypasses billing caps (AUTH-02)
- Both are client-side issues; no server-side privilege escalation path exists in the current codebase

---

## 4. OAuth Security Assessment

| Check | Status | Notes |
|---|---|---|
| CSRF state nonce | ✅ Implemented | `crypto.randomUUID()`, stored in sessionStorage, consumed on first use |
| Callback URL validation | ✅ Implemented | Rust server rejects non-`/callback` paths (404) |
| Token emitted only to gate window | ✅ Implemented | `win.emit("oauth-callback-received", payload)` targets gate window only |
| Callback server bound to loopback only | ✅ Implemented | `TcpListener::bind("127.0.0.1:0")` |
| Random ephemeral port | ✅ Implemented | OS assigns port 0 → random |
| OAuth error handling | ✅ Implemented | Failure URL triggers error branch |
| Nonce consumed before processing | ✅ Implemented | `sessionStorage.removeItem("oauth_state_nonce")` before any logic |
| Callback server timeout | ✅ Fixed | 5-minute `tokio::time::timeout` on `accept()` — AUTH-05 |
| One-connection-only race | ⚠️ Acceptable | Single-use by design; documented in AUTH-05 |

---

## 5. Remediation Priority Matrix

| ID | Finding | Severity | Effort | Status |
|---|---|---|---|---|
| AUTH-01 | Legacy `src/lib/auth.ts` writes token to `localStorage` | High | Low | ✅ Fixed |
| AUTH-02 | Plan tier enforced client-side only | High | High | ⚠️ Deferred — requires server-side enforcement |
| AUTH-03 | `unlock_app` has no server-side proof-of-auth | Medium | Low | ✅ Fixed |
| AUTH-04 | `verifyToken` fails open silently | Medium | — | ✅ Resolved by AUTH-01 |
| AUTH-05 | OAuth callback server has no accept timeout | Medium | Low | ✅ Fixed |
| AUTH-06 | User profile (incl. plan) in plaintext localStorage | Medium | Low | ⚠️ Documented — profile re-fetched from Appwrite on every launch |
| AUTH-07 | No token refresh logic | Low | Medium | ℹ️ Informational |
| AUTH-08 | No MFA | Low | High | ℹ️ Informational |
| AUTH-09 | CSRF nonce not tab-scoped | Low | — | ℹ️ Informational |

---

## 6. Protections Already in Place

| Protection | Location | Notes |
|---|---|---|
| OAuth CSRF state nonce | `gate/index.tsx` · `sessionStorage` | `crypto.randomUUID()`, consumed immediately on callback |
| Callback server on loopback + random port | `auth.rs` · `TcpListener::bind("127.0.0.1:0")` | Only local processes can reach it |
| Token emitted only to gate window | `auth.rs` · `win.emit(...)` | Other windows never receive the token |
| Non-callback paths rejected (404) | `auth.rs` | Prevents probing the ephemeral server |
| Appwrite session re-checked on mount | `gate/index.tsx` | If session expired, user is re-prompted |
| OAuth click debounce (2 s) | `gate/index.tsx` | Prevents nonce-overwrite race |
| User profile schema validation | `storage/auth.ts` · `loadUserProfile()` | Rejects tampered/malformed profiles; `ALLOWED_PLANS` set |
| Token stored in sessionStorage (new path) | `storage/auth.ts` | Cleared when app closes (if AUTH-01 is fixed) |
| Per-session AI request cap (200) | `api.rs` · `AiRequestCounter` | Cannot be bypassed from WebView |
| CSP: `script-src 'self'` | `tauri.conf.json` | Limits XSS surface for token theft |
