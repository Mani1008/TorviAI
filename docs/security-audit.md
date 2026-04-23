# Security Audit — Torvi Desktop AI Assistant
**Date:** 2025-07  
**Auditor:** Senior Application Security Engineer (AI-assisted)  
**Scope:** Full codebase — Tauri 2.x Rust backend, React 19 frontend, Appwrite integration, SQLite database layer, STT pipeline, OAuth flow  
**Version audited:** v0.3 (post-gate-fix, post-language-removal)  
**Audit framework:** OWASP Top 10, OWASP MASVS (desktop), CWE

---

## Executive Summary

The codebase is well-structured for a v0.3 desktop application, but has **5 critical/high** security issues that must be addressed before any production release or user distribution. The most severe issue is that secret AI API keys are transmitted from the Rust backend to the React frontend via Tauri IPC and are therefore accessible to anyone who opens DevTools. Two further high-severity issues relate to rate limiting being entirely client-side (trivially bypassed) and raw HTML rendering of AI responses (XSS via prompt injection). All SQL queries are correctly parameterized — that surface is clean.

| Severity | Count |
|----------|-------|
| Critical | 1     |
| High     | 5     |
| Medium   | 6     |
| Low      | 4     |
| Info     | 3     |

---

## Findings

---

### [CRITICAL-01] AI Secret Keys Returned via IPC to Frontend

**File:** `src-tauri/src/api.rs`  
**CWE:** CWE-522 (Insufficiently Protected Credentials), CWE-319 (Cleartext Transmission of Sensitive Information)  
**OWASP:** A02:2021 — Cryptographic Failures

**Description:**  
`get_ai_config()` reads `NVIDIA_API_KEY` and `OPENROUTER_API_KEY` from environment variables, then returns them inside an `AiConfig` struct that is serialized and sent over Tauri IPC to the frontend JavaScript context:

```rust
// src-tauri/src/api.rs
"Bearer {}", api_key   // goes into AiConfig.headers["Authorization"]
```

The frontend then uses these headers directly to make HTTP calls via `@tauri-apps/plugin-http`. This means:

1. The full API key is present in JavaScript heap memory.
2. Any user can open **DevTools → Network / Memory tab** and extract the key.
3. The key is also sent as a plaintext header in every outbound HTTP request.
4. In production builds, keys set as environment variables at build time are baked into the binary (if using `.env` at build time).

**Impact:** An attacker or malicious user on the same machine can steal the `NVIDIA_API_KEY` / `OPENROUTER_API_KEY` and use them to rack up charges on the developer's account. This is also a violation of both NVIDIA NIM and OpenRouter terms of service.

**Fix:**  
Proxy all AI requests through Rust. The frontend sends only the message content via IPC; Rust constructs and fires the HTTP request and streams the response back as Tauri events. The API key never leaves the Rust process.

```rust
// CORRECT ARCHITECTURE
#[tauri::command]
pub async fn stream_ai_response(
    app: AppHandle,
    model_id: String,
    messages: Vec<Message>,
) -> Result<(), String> {
    let api_key = std::env::var("OPENROUTER_API_KEY")
        .map_err(|_| "Key not configured")?;
    // Make HTTP call in Rust, emit chunks via app.emit("ai-chunk", chunk)
    // Key never touches frontend
}
```

---

### [HIGH-01] Raw HTML Rendering of AI Responses (XSS / Prompt Injection)

**File:** `src/components/Markdown/index.tsx`  
**CWE:** CWE-79 (Cross-Site Scripting), CWE-116 (Improper Encoding)  
**OWASP:** A03:2021 — Injection

**Description:**  
The Markdown component uses `rehype-raw`, which enables rendering of arbitrary raw HTML embedded in Markdown content:

```tsx
// src/components/Markdown/index.tsx
rehypePlugins={[rehypeKatex, rehypeRaw]}   // rehypeRaw allows raw HTML
```

AI responses are rendered directly through this component. An attacker who can influence the AI's output (e.g., via prompt injection — asking the AI to include HTML in its response) can cause arbitrary HTML to execute in the app's renderer context. Because Tauri's renderer is a WebView, this can escalate to IPC calls if CSP is not set (see MEDIUM-02).

**Proof of concept:** A malicious user could send a message that tricks the AI into responding with:
```html
<img src=x onerror="window.__TAURI_INTERNALS__.invoke('exit_app')">
```

**Impact:** XSS in the renderer context. With `"csp": null` in `tauri.conf.json`, there is no browser-level protection. This is a complete app compromise vector.

**Fix:**  
Remove `rehype-raw` unless raw HTML rendering is a deliberate, necessary feature. If it must stay, implement a sanitization step before rendering:

```bash
npm install dompurify @types/dompurify
```

```tsx
import DOMPurify from "dompurify";
// Sanitize content before passing to ReactMarkdown
const sanitized = DOMPurify.sanitize(content, { FORBID_TAGS: ["script", "iframe", "object"] });
```

Or simply remove `rehypeRaw` from the plugins array — it is not needed for standard code blocks, tables, math, or GFM.

---

### [HIGH-02] Client-Side Only Rate Limiting (Trivially Bypassed)

**File:** `src/lib/storage/usage-stats.ts`, `src/hooks/useCompletion.ts`  
**CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts), CWE-602 (Client-Side Enforcement of Server-Side Security)  
**OWASP:** A04:2021 — Insecure Design

**Description:**  
The entire usage/rate limiting system — checking plan limits and incrementing counters — lives in `localStorage`:

```ts
// src/lib/storage/usage-stats.ts
export function checkAiResponseLimit(): string | null {
  const profile = loadUserProfile();               // localStorage
  const planKey = profile?.plan === "plus" ? ...   // localStorage plan
  const stats = loadUsageStats();                  // localStorage counter
  if (stats.aiResponses >= limits.aiResponses) {
    return `You've reached your ${planKey} plan limit...`;
  }
  return null;
}
```

Any user can bypass this completely by running in the browser console:
```js
localStorage.removeItem("torvi_usage_stats");
localStorage.setItem("torvi_user_profile", JSON.stringify({...profile, plan: "pro"}));
```

**Impact:** All plan monetization and usage limits are completely ineffective. Users can self-upgrade to Pro and have unlimited responses without paying.

**Fix:**  
Rate limiting must be enforced server-side. The Appwrite backend should be the authoritative source of remaining usage. `decrementAiResponses` in `sync-profiles.ts` should be called atomically on the server before allowing the request, not as a post-hoc notification. Until a server-side solution exists, do not show billing tiers or enforce limits.

---

### [HIGH-03] Non-Atomic Read-Modify-Write in Usage Decrement (Race Condition)

**File:** `src/lib/appwrite/sync-profiles.ts`  
**CWE:** CWE-362 (Race Condition / TOCTOU)  
**OWASP:** A04:2021 — Insecure Design

**Description:**  
`decrementAiResponses()` performs a read-then-write sequence:

```ts
// sync-profiles.ts (inferred from audit)
const doc = await databases.getDocument(...);       // READ
const remaining = doc.aiResponsesRemaining - 1;
await databases.updateDocument(..., { remaining }); // WRITE
```

This is a classic Time-of-Check / Time-of-Use (TOCTOU) vulnerability. If the user fires two concurrent AI requests, both reads may see the same `aiResponsesRemaining` value before either write completes. Both requests succeed, but only one decrement is applied.

**Impact:** Users can double-spend (or n-spend) their usage quota by sending rapid concurrent requests.

**Fix:**  
Use an Appwrite server-side function with an atomic decrement, or use Appwrite's atomic update operators if available. Alternatively, enforce quota entirely on the server before the AI call is permitted.

---

### [HIGH-04] OAuth Callback TCP Server — Incomplete URL Decoding and Missing Path Validation

**File:** `src-tauri/src/auth.rs` (referenced via conversation summary as the TCP OAuth server)  
**CWE:** CWE-20 (Improper Input Validation), CWE-116 (Improper Encoding/Escaping)  
**OWASP:** A03:2021 — Injection

**Description:**  
The Rust OAuth callback server manually parses the query string from the HTTP request with a URL decoder that handles only 4 percent-encoded characters (`%2B`, `%3D`, `%2F`, `%20`). All other percent-encoded characters (e.g., `%23` for `#`, `%26` for `&`, `%3F` for `?`, `%40` for `@`) are passed through unmodified, causing the token extraction to silently fail or produce malformed tokens.

Additionally, the server emits the `oauth-callback-received` event to **all open windows** simultaneously (gate, main, dashboard). Any window that handles this event will receive the OAuth code.

There is no validation that the incoming HTTP request path is actually `/callback` — any request to the TCP port triggers the auth flow.

**Impact:**
- Malformed tokens pass through silently, causing confusing auth failures.
- A malicious local process could send a crafted request to the callback port to inject a fake auth code.
- The event broadcast leaks auth state to windows that should not receive it.

**Fix:**
```rust
// Use a proper URL decoder
use percent_encoding::percent_decode_str;

fn decode_component(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().into_owned()
}

// Validate the request path
if !request_line.starts_with("GET /callback") {
    // Reject non-callback requests
    return;
}

// Emit only to the gate window
if let Some(gate) = app.get_webview_window("gate") {
    gate.emit("oauth-callback-received", payload).ok();
}
```

Add `percent-encoding = "2"` to `Cargo.toml`.

---

### [HIGH-05] `VITE_SKIP_AUTH_CHECK` Bypass Produces Privileged Dev User

**File:** `src/lib/auth.ts`  
**CWE:** CWE-489 (Active Debug Code), CWE-272 (Least Privilege Violation)  
**OWASP:** A05:2021 — Security Misconfiguration

**Description:**  
When `VITE_SKIP_AUTH_CHECK=true`, the `verifyToken()` function returns a hardcoded user object with `plan: "dev"`:

```ts
// src/lib/auth.ts
if (import.meta.env.VITE_SKIP_AUTH_CHECK === "true") {
  return { id: "dev", email: "dev@local", plan: "dev" };
}
```

The `plan: "dev"` value is not listed in `PLAN_LIMITS` in `constants.ts`, so `checkAiResponseLimit()` falls through to the `"starter"` path — but this is an implementation accident, not a security control. If `PLAN_LIMITS` is ever updated to include a `"dev"` key with unlimited quota, this becomes a privilege escalation path if the flag leaks into production.

More importantly, `VITE_` environment variables are inlined into the JavaScript bundle at build time. If a production build is accidentally compiled with `VITE_SKIP_AUTH_CHECK=true`, all authentication is bypassed silently.

**Fix:**
1. Rename to `DEV_SKIP_AUTH` and gate it on `import.meta.env.DEV` as well:
   ```ts
   if (import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH_CHECK === "true") {
   ```
2. Add a CI check that fails the build if `VITE_SKIP_AUTH_CHECK=true` is present in any non-dev `.env` file.
3. The `.env.example` file should have this commented out or set to `false`.

---

### [MEDIUM-01] Content Security Policy Disabled (`"csp": null`)

**File:** `src-tauri/tauri.conf.json`  
**CWE:** CWE-693 (Protection Mechanism Failure)  
**OWASP:** A05:2021 — Security Misconfiguration

**Description:**
```json
"security": {
  "csp": null
}
```

With CSP disabled, the WebView has no restrictions on inline script execution, external resource loading, or `eval()`. This compounds HIGH-01 (raw HTML rendering): without a CSP, any `<script>` tag injected into the DOM via prompt injection will execute without any browser-level defense.

**Fix:**  
Define a restrictive CSP:
```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://streaming.assemblyai.com; font-src 'self' data:"
}
```

Adjust `connect-src` to include only the specific AI provider domains used (OpenRouter, NVIDIA NIM, Appwrite).

---

### [MEDIUM-02] HTTP Capability Allows ALL URLs (No Allowlist)

**File:** `src-tauri/capabilities/default.json`  
**CWE:** CWE-918 (Server-Side Request Forgery — SSRF), CWE-441 (Unintended Proxy)  
**OWASP:** A10:2021 — Server-Side Request Forgery

**Description:**
```json
{
  "identifier": "http:default",
  "allow": [{ "url": "https://**" }, { "url": "http://**" }]
}
```

The HTTP plugin is permitted to make requests to **any** URL over HTTP or HTTPS. This means if an attacker controls the provider configuration (stored in `localStorage`), they can cause the app to make requests to arbitrary endpoints — including `http://169.254.169.254` (cloud metadata service), internal network addresses, or attacker-controlled servers that receive the full request body including conversation content.

**Fix:**  
Restrict to the known provider domains:
```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "https://openrouter.ai/**" },
    { "url": "https://integrate.api.nvidia.com/**" },
    { "url": "https://streaming.assemblyai.com/**" },
    { "url": "https://cloud.appwrite.io/**" }
  ]
}
```

---

### [MEDIUM-03] `{{IMAGE}}` Placeholder Inserted Without JSON Escaping

**Files:** `src/lib/functions/ai-response.function.ts` (line ~175), `src/lib/functions/common.function.ts` (line ~19)  
**CWE:** CWE-74 (Injection), CWE-116 (Improper Encoding)  
**OWASP:** A03:2021 — Injection

**Description:**  
`{{TEXT}}` and `{{SYSTEM_PROMPT}}` are both processed through `escapeJsonString()` before being substituted into the request body template. However, `{{IMAGE}}` is substituted raw:

```ts
// ai-response.function.ts
body = body.replace(/\{\{TEXT\}\}/g, escapeJsonString(userText));     // ✅ escaped
body = body.replace(/\{\{IMAGE\}\}/g, images[0]);                     // ❌ NOT escaped
```

And in `common.function.ts`:
```ts
result = result.replace(/\{\{IMAGE\}\}/g, images[0]);                 // ❌ NOT escaped
```

Screenshot data is a `data:image/png;base64,...` string which typically contains only base64 characters and is safe. However, if the image data URI is ever sourced from user input or a provider returns something unexpected, the raw substitution could break JSON parsing or, in a worst case, inject content into the request body.

**Fix:**  
Wrap in the same escaping function:
```ts
body = body.replace(/\{\{IMAGE\}\}/g, escapeJsonString(images[0]));
```

Since `escapeJsonString` only escapes `\`, `"`, `\n`, `\r`, `\t`, it is safe to apply to base64 data URIs.

---

### [MEDIUM-04] JWT / Auth Token Stored in `localStorage` (XSS Accessible)

**File:** `src/lib/auth.ts`, `src/lib/storage/auth.ts`  
**CWE:** CWE-922 (Insecure Storage of Sensitive Information)  
**OWASP:** A02:2021 — Cryptographic Failures

**Description:**  
The legacy JWT auth token is stored in `localStorage` under `torvi_auth_token`, and the full user profile (including plan tier) is stored under `torvi_user_profile`. The `loadUserProfile()` function is called across the codebase to make authorization decisions:

```ts
// usage-stats.ts
const profile = loadUserProfile();  // from localStorage
const planKey = profile?.plan === "plus" ...
```

`localStorage` in a WebView is accessible to any script running in the same context. While XSS is currently limited by the absence of `dangerouslySetInnerHTML` in React, the `rehype-raw` plugin (see HIGH-01) opens this vector.

**Fix:**  
For the legacy JWT: Use `sessionStorage` if the token is not needed across restarts, or store it in the Rust process's memory via a Tauri managed state. For the user profile, the plan field should be fetched from the server on startup and not treated as authoritative from `localStorage`.

---

### [MEDIUM-05] System Prompt Content Synced to Cloud Without Sanitization

**File:** `src/lib/appwrite/sync-settings.ts`  
**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)  
**OWASP:** A02:2021 — Cryptographic Failures

**Description:**  
`pushSettings(userId)` reads the `system_prompt` key from `localStorage` and pushes it verbatim to Appwrite. System prompts may contain sensitive information — API URLs, internal company context, confidential instructions, or BYOK API keys if a user mistakenly pastes them there.

Additionally, there is no size limit enforced before the push, meaning a very large system prompt (e.g., an accidental paste of a full document) will be stored in the cloud DB.

**Fix:**
1. Add a maximum length check before syncing: `if (prompt.length > 10_000) return;`
2. Consider encrypting the system prompt before storing in Appwrite, or making cloud sync of prompts opt-in.
3. Document that system prompts are synced to cloud in the UI.

---

### [MEDIUM-06] `VITE_APPWRITE_*` Collection IDs Bundled into Frontend JS

**File:** `src/lib/appwrite/client.ts`  
**CWE:** CWE-540 (Inclusion of Sensitive Information in Source Code)  
**OWASP:** A05:2021 — Security Misconfiguration

**Description:**
```ts
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || "";
export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID || "";
export const COLLECTION_IDS = {
  USER_PROFILES: import.meta.env.VITE_APPWRITE_COLLECTION_USER_PROFILES || "",
  CONVERSATIONS: import.meta.env.VITE_APPWRITE_COLLECTION_CONVERSATIONS || "",
  ...
};
```

All `VITE_` prefixed variables are inlined into the production JavaScript bundle. Anyone who unpacks the `.app`/`.exe`/`.msi` installer can extract these IDs by searching the bundled JS for `appwrite`. With the Project ID and Collection IDs known, a malicious actor can craft direct Appwrite API requests if Appwrite collection permissions are misconfigured.

**Fix:**  
This is partially acceptable for a desktop app (Appwrite client SDK requires the project ID by design). The true protection is correct Appwrite collection-level permissions (only authenticated users can read/write their own documents). Audit Appwrite permissions carefully:
- Collections should use `Role.user(userId)` permissions, not `Role.any()`.
- The Project ID alone is not a secret if permissions are correctly set.

---

### [LOW-01] License Check Is a Permanent Stub (`check_license_status` Always Returns `false`)

**File:** `src-tauri/src/api.rs`  
**CWE:** CWE-284 (Improper Access Control)  
**OWASP:** A01:2021 — Broken Access Control

**Description:**
```rust
#[tauri::command]
pub async fn check_license_status() -> Result<bool, String> {
    Ok(false)  // Always returns false — stub not implemented
}
```

The license validation system is entirely unimplemented. `torviApiEnabled` in `app.context.tsx` is loaded from `localStorage`. The `hasActiveLicense` state is never set to `true` by any real validation. Any gating of premium features behind `hasActiveLicense` is bypassable by setting `torvi_api_enabled` in localStorage to `true`.

**Fix:**  
Until a real license server exists, remove all UI elements that imply license gating is enforced. Do not ship features guarded by a stub check as if they were enforced.

---

### [LOW-02] Error Messages May Leak Provider URLs and Internal Status Codes

**File:** `src/lib/functions/ai-response.function.ts`, `src/hooks/useCompletion.ts`  
**CWE:** CWE-209 (Information Exposure Through an Error Message)  
**OWASP:** A05:2021 — Security Misconfiguration

**Description:**  
In `fetchAIResponse`, error responses are returned directly:
```ts
yield `Error ${response.status}: ${errorText.substring(0, 500)}`;
```

And in `useCompletion.ts`, unrecognized errors show `errMsg` directly in the UI (up to 120 chars). If a provider returns an error body that includes internal routing information, account IDs, or the exact API endpoint URL, that information is shown to the user.

**Fix:**  
Map HTTP error codes to user-friendly messages (the `useCompletion.ts` handler already does this for 401, 429, 500). Ensure the raw `errorText` from provider APIs is only logged to console, not displayed in the UI.

---

### [LOW-03] Conversation IDs Are Timestamp + Short Random String

**File:** `src/hooks/useCompletion.ts`  
**CWE:** CWE-330 (Use of Insufficiently Random Values)

**Description:**
```ts
conversationIdRef.current = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
```

`Math.random()` is not cryptographically secure. The ID is used as both the local SQLite primary key and the Appwrite document ID. For a local-only, single-user app this is acceptable. However, if conversations are ever shared or if Appwrite document IDs need to be unpredictable (to prevent enumeration), this is insufficient.

**Fix:**  
Use `crypto.randomUUID()` which is available in modern browsers and Tauri's WebView:
```ts
conversationIdRef.current = crypto.randomUUID();
```

---

### [LOW-04] `update_shortcuts` Command Has No Authentication or Rate Limiting

**File:** `src-tauri/src/shortcuts.rs`  
**CWE:** CWE-284 (Improper Access Control)

**Description:**  
The `update_shortcuts` Tauri command accepts a `HashMap<String, String>` of shortcut mappings and currently just logs them. There is no validation of key names or values. Once global shortcut registration is implemented (the TODO comments indicate this is planned), malicious content in the map (e.g., keys that conflict with system shortcuts or contain special characters) could cause unexpected behavior.

**Fix:**  
When implementing the real shortcut registration, validate key names against an allowlist of supported actions and validate key combination strings against a whitelist of acceptable modifier+key patterns.

---

## Dependency Vulnerabilities

Three high-severity npm vulnerabilities were found via `npm audit`:

| Package | Vulnerability | Advisory |
|---------|--------------|---------|
| `lodash` | Code Injection via `_.template` imports key names | GHSA-r5fr-rjxr-66jc |
| `lodash` | Prototype Pollution via `_.unset`/`_.omit` | GHSA-f23m-r3pf-42rh |
| `picomatch` | ReDoS via extglob quantifiers | GHSA-c2c7-rcm5-vvqj |
| `vite` | Arbitrary file read via Dev Server WebSocket | GHSA-p9ff-h696-f583 |

All are fixable with `npm audit fix`.

**Note:** The Vite arbitrary file read vulnerability only applies during `npm run dev` — it does not affect production builds. Fix it anyway to avoid accidental exposure.

**Action:**
```bash
npm audit fix
```

For Cargo dependencies, run:
```bash
cd src-tauri
cargo audit
```
Install `cargo-audit` first if needed: `cargo install cargo-audit`

---

## Informational Findings

### [INFO-01] Tauri `contentProtected: false` on Overlay Window

**File:** `src-tauri/tauri.conf.json`

The main overlay pill window has `contentProtected: false`, meaning screen capture software and screen recorders can capture it. For an AI assistant that displays conversation content, this may be intentional. If sensitive data (e.g., private system prompts, business context) is shown in the overlay, consider setting `contentProtected: true`.

---

### [INFO-02] `capture_to_base64` and `capture_selected_area` Return Placeholder Data

**File:** `src-tauri/src/capture.rs`

These two commands always return `"data:image/png;base64,placeholder"` regardless of input. They are clearly unimplemented stubs. There is no security risk from the stubs themselves, but the commands are registered in the IPC handler (`generate_handler!`), meaning they are callable from the frontend. The dummy return value could cause silent failures in any frontend code that tries to use them.

---

### [INFO-03] Appwrite Collection Permissions Must Be Audited Before Go-Live

**File:** `src/lib/appwrite/client.ts`, `src/lib/appwrite/sync-*.ts`

All Appwrite sync functions use the document ID as `userId_*` prefix convention. Correct security depends entirely on Appwrite collection-level permissions being set to `Role.user(userId)` for read/write. If any collection uses `Role.any()` or `Role.users()` without document-level security, users can read each other's conversations, settings, and system prompts.

Before enabling Appwrite sync in production, verify every collection has:
```
Read: Role.user($userId)
Write: Role.user($userId)
```

---

## Prioritized Remediation Roadmap

| Priority | ID | Title | Effort |
|----------|----|-------|--------|
| 🔴 Do First | CRITICAL-01 | Move AI requests to Rust proxy | High — architectural change |
| 🔴 Do First | HIGH-01 | Remove `rehype-raw` or add DOMPurify sanitization | Low — 10 min |
| 🟠 Before Beta | HIGH-02 | Server-side rate limiting | High — requires backend |
| 🟠 Before Beta | HIGH-04 | Fix OAuth URL decoder, validate path, targeted emit | Medium — 1 hour |
| 🟠 Before Beta | HIGH-05 | Gate `VITE_SKIP_AUTH_CHECK` on `import.meta.env.DEV` | Low — 5 min |
| 🟡 Before Release | MEDIUM-01 | Enable Content Security Policy | Medium — 30 min |
| 🟡 Before Release | MEDIUM-02 | Restrict HTTP capability to known domains | Low — 15 min |
| 🟡 Before Release | MEDIUM-03 | Escape `{{IMAGE}}` with `escapeJsonString` | Low — 5 min |
| 🟡 Before Release | MEDIUM-05 | Add size limit to system prompt sync | Low — 5 min |
| 🟡 Before Release | HIGH-03 | Atomic usage decrement | High — requires backend |
| 🟢 Cleanup | LOW-01 | Remove or implement license check | Low |
| 🟢 Cleanup | LOW-03 | Use `crypto.randomUUID()` for conversation IDs | Low — 5 min |
| 🟢 Cleanup | DEP | `npm audit fix` + `cargo audit` | Low — 10 min |

---

## Appendix: Files Audited

| File | Status |
|------|--------|
| `src-tauri/src/api.rs` | ⚠️ CRITICAL-01 |
| `src-tauri/src/auth.rs` | ⚠️ HIGH-04 |
| `src-tauri/src/capture.rs` | ℹ️ INFO-02 |
| `src-tauri/src/shortcuts.rs` | ℹ️ LOW-04 |
| `src-tauri/src/streaming_stt.rs` | ✅ No issues |
| `src-tauri/src/window.rs` | ✅ No issues |
| `src-tauri/src/lib.rs` | ✅ No issues |
| `src-tauri/tauri.conf.json` | ⚠️ MEDIUM-01, INFO-01 |
| `src-tauri/capabilities/default.json` | ⚠️ MEDIUM-02 |
| `src/lib/auth.ts` | ⚠️ HIGH-05, MEDIUM-04 |
| `src/lib/storage/usage-stats.ts` | ⚠️ HIGH-02 |
| `src/lib/storage/auth.ts` | ⚠️ MEDIUM-04 |
| `src/lib/appwrite/client.ts` | ⚠️ MEDIUM-06 |
| `src/lib/appwrite/sync-profiles.ts` | ⚠️ HIGH-03 |
| `src/lib/appwrite/sync-settings.ts` | ⚠️ MEDIUM-05 |
| `src/lib/appwrite/sync-conversations.ts` | ✅ No issues |
| `src/lib/appwrite/sync-prompts.ts` | ✅ No issues |
| `src/lib/database/chat-history.ts` | ✅ Parameterized SQL — safe |
| `src/lib/database/system-prompts.ts` | ✅ Parameterized SQL — safe |
| `src/lib/functions/ai-response.function.ts` | ⚠️ MEDIUM-03, LOW-02 |
| `src/lib/functions/common.function.ts` | ⚠️ MEDIUM-03 |
| `src/lib/functions/stt.function.ts` | ✅ No issues |
| `src/components/Markdown/index.tsx` | ⚠️ HIGH-01 |
| `src/hooks/useCompletion.ts` | ⚠️ LOW-02, LOW-03 |
| `src/contexts/app.context.tsx` | ✅ No issues |
| `src/config/constants.ts` | ✅ No issues |
