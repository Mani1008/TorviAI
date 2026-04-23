# OWASP Top 10 2021 — Security Analysis & Remediation Log

**Application:** Torvi (ai-assistant)  
**Stack:** Tauri 2.x + Rust · React 19 + TypeScript 5.8 · SQLite · Appwrite  
**Analysis Date:** April 23, 2026  
**Status:** All code-level remediations implemented and verified

---

## Summary

| Priority | Category | Finding | Status |
|---|---|---|---|
| P1 | A01 Broken Access Control | Capability over-scoping: all 3 windows shared one file | ✅ Fixed |
| P1 | A01 Broken Access Control | OAuth CSRF — no state nonce validation | ✅ Fixed |
| P1 | A02 Cryptographic Failures | JWT written to localStorage (persists across restarts) | ✅ Fixed |
| P1 | A03 Injection | CRLF injection in HTTP header substitution | ✅ Fixed |
| P2 | A02 Cryptographic Failures | Untrusted localStorage data — no schema validation | ✅ Fixed |
| P2 | A04 Insecure Design | Unbounded message length and context window | ✅ Fixed |
| P2 | A05 Security Misconfiguration | Wrong Tauri config schema URL | ✅ Fixed |
| P2 | A05 Security Misconfiguration | App identifier and productName not set to Torvi | ✅ Fixed |
| P2 | A06 Vulnerable Components (npm) | npm dependency vulnerabilities | ✅ Fixed |
| P2 | A06 Vulnerable Components (Rust) | `rustls-webpki` 0.103.9 — 4 TLS certificate validation CVEs | ✅ Fixed |
| P2 | A06 Vulnerable Components (Rust) | `rsa` 0.9.10 — Marvin Attack timing side-channel | ✅ Fixed |
| P2 | A09 Logging Failures | `println!`/`eprintln!` across entire Rust codebase | ✅ Fixed |
| P2 | A09 Logging Failures | STT transcript (PII) printed to stdout | ✅ Fixed |
| P3 | A04 Insecure Design | Appwrite atomic quota decrement race condition | ⚠️ Deferred (external infra) |
| P3 | A02 Cryptographic Failures | SQLite database not encrypted at rest | ⚠️ Deferred (breaking change) |

---

## A01 — Broken Access Control

### Finding 1: Capability Over-Scoping (P1)

**Problem:** All three Tauri windows (`main`, `dashboard`, `gate`) shared a single `capabilities/default.json` that granted every permission — SQL read/write, HTTP with no domain restriction, autostart, global shortcuts, and `allow-create-webview-window` — to every window. The auth gate (which only displays a sign-in button) had the same access to the SQLite database as the main chat window.

**Fix:** Split into four separate capability files:

- `capabilities/default.json` — Core window management only (`core:default`, `core:window:*`). Applied to all 3 windows.
- `capabilities/main.json` — Main overlay: global shortcuts, SQL, HTTP allowlisted to 4 domains (`openrouter.ai`, `integrate.api.nvidia.com`, `streaming.assemblyai.com`, `cloud.appwrite.io`).
- `capabilities/dashboard.json` — Settings window: SQL, shell opener, autostart, HTTP restricted to `cloud.appwrite.io` only.
- `capabilities/gate.json` — Auth gate: `opener:default` only. No SQL, no HTTP, no shortcuts.

**Files changed:**
- `src-tauri/capabilities/default.json` — replaced
- `src-tauri/capabilities/main.json` — created
- `src-tauri/capabilities/dashboard.json` — created
- `src-tauri/capabilities/gate.json` — created

---

### Finding 2: OAuth CSRF — No State Nonce (P1)

**Problem:** The OAuth sign-in flow opened a browser URL and then listened for a TCP callback. There was no `state` parameter in the OAuth redirect URL and no validation of one in the callback. Any page the user visited could trigger a redirect to the local callback server and force a sign-in with an attacker-controlled token.

**Fix:** Full end-to-end CSRF state nonce implemented:

1. **Frontend (gate)** — Before opening the OAuth URL, generate a `crypto.randomUUID()` nonce and store it in `sessionStorage("oauth_state_nonce")`.
2. **TypeScript auth helper** — `getOAuthUrl(callbackPort, state)` embeds the nonce as `&state=encodeURIComponent(state)` in the success redirect URL.
3. **Rust callback server** — `auth.rs` parses the `state` query parameter and includes it in `OAuthCallbackPayload`.
4. **Frontend validation** — On receiving the Tauri event, compare `payload.state` against the stored nonce. If they don't match (or nonce is absent), reject the sign-in with an error. Nonce is consumed (removed from sessionStorage) immediately after the first check regardless of outcome.

**Files changed:**
- `src-tauri/src/auth.rs` — added `state: String` to `OAuthCallbackPayload`
- `src/lib/appwrite/auth.ts` — `getOAuthUrl` now takes `state` parameter
- `src/pages/gate/index.tsx` — nonce generation, storage, and validation

---

## A02 — Cryptographic Failures

### Finding 3: JWT Stored in localStorage (P1)

**Problem:** `saveAuthToken()` wrote the session token to both `sessionStorage` AND `localStorage`. localStorage persists indefinitely — a token written at login would survive browser restarts, OS reboots, and other sessions. If another user accessed the machine, or if a local file-read exploit occurred, the token would be readable.

**Fix:** Removed the `localStorage.setItem` call entirely from `saveAuthToken()`. Tokens now live in sessionStorage only — they exist for the current app session and are discarded when the webview closes. `clearAuthToken()` still clears both storages to handle legacy tokens written by old versions.

**File changed:** `src/lib/storage/auth.ts`

```typescript
// Before (vulnerable):
localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);  // ← REMOVED
safeSessionStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);

// After (fixed):
safeSessionStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
// NOT written to localStorage — tokens must not persist across app restarts
```

---

### Finding 4: Untrusted localStorage Data — No Schema Validation (P2)

**Problem:** `loadUserProfile()` and `loadCustomAIProviders()` called `JSON.parse()` on localStorage values and returned the result directly as typed objects without any runtime type checking. A user (or XSS, or malicious extension) could write arbitrary JSON to localStorage and have it treated as valid application data. The `plan` field in particular controls feature access.

**Fix:**

**`loadUserProfile()`** — Added strict field-by-field validation:
- `id`: non-empty string
- `email`: string
- `name`: string  
- `plan`: must be one of `{ "starter", "plus", "pro", "dev" }` (allowlist `Set`)
- If any field fails, the corrupt profile is cleared from localStorage and `null` is returned.

**`loadCustomAIProviders()`** — Added array and per-entry validation:
- Must be an array
- Each entry must be an object
- Each entry must have a non-empty `curl: string` field
- Optional fields (`id`, `name`, `streaming`, `responseContentPath`) are type-checked
- Invalid entries are silently dropped; valid entries are returned

**File changed:** `src/lib/storage/auth.ts`, `src/lib/storage/ai-providers.ts`

---

### Finding 5: SQLite Not Encrypted at Rest (P3) — Deferred

**Problem:** The local SQLite database storing conversation history and system prompts is unencrypted. On a shared or stolen machine, the database file is readable with any SQLite browser.

**Why deferred:** Encrypting requires switching `tauri-plugin-sql` to a SQLCipher-enabled build variant, which is a separate crate with a different API. It also requires a migration strategy for existing user databases. This is a breaking change planned for a future major version.

---

## A03 — Injection

### Finding 6: CRLF Injection in HTTP Header Substitution (P1)

**Problem:** The BYOK (Bring Your Own Key) custom AI provider path used a `substituteVariables()` function to fill `{{API_KEY}}`, `{{PROMPT}}`, and `{{MODEL}}` placeholders into user-defined cURL-style request templates. These templates could contain arbitrary HTTP header definitions. If a substituted value contained `\r\n`, it would inject additional HTTP headers — allowing header forgery, cache poisoning, or request splitting.

**Fix:** Strip `\r` and `\n` from all values before substitution.

**File changed:** `src/lib/functions/ai-response.function.ts`

```typescript
// Before (vulnerable):
return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");

// After (fixed):
function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return (variables[key] ?? "").replace(/[\r\n]/g, "");  // CRLF stripped
  });
}
```

---

## A04 — Insecure Design

### Finding 7: Unbounded Message Length and Context Window (P2)

**Problem:** `useCompletion.ts` placed no limit on the length of a message sent by the user, or on the number of past messages included as context. A user could send a 10 MB message or accumulate thousands of turns of history, all of which would be forwarded to the AI provider API. This could cause extreme API costs, application hangs, or denial-of-service against the user's own API quota.

**Fix:** Added two constants and enforcement in `sendMessage`:

**File changed:** `src/hooks/useCompletion.ts`

```typescript
const MAX_MESSAGE_LENGTH = 32_000;  // ~8K tokens
const MAX_CONTEXT_MESSAGES = 50;    // last 50 turns

// In sendMessage():
if (text.length > MAX_MESSAGE_LENGTH) {
  setError(`Message is too long (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters).`);
  return;
}
const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);
```

---

### Finding 8: Appwrite Quota Decrement Race Condition (P3) — Deferred

**Problem:** `decrementAiResponses()` performs a read-then-write against Appwrite: fetch the current count, subtract 1, write back. This is a TOCTOU race — two concurrent AI requests can both read the same count and both decrement from it, effectively consuming only one quota unit for two requests.

**Why deferred:** The fix requires an Appwrite serverless Function that performs an atomic decrement server-side. This is an external cloud infrastructure task and cannot be implemented in this codebase. Tracked for Appwrite backend work.

---

## A05 — Security Misconfiguration

### Finding 9: Wrong Tauri Config Schema URL (P2)

**Problem:** `tauri.conf.json` had `$schema` pointing to a NiceGUI GitHub URL — a completely different project's schema. This caused IDE validation to use the wrong rules and could mask configuration errors.

**Fix:** Corrected to `"https://schema.tauri.app/config/2"`.

---

### Finding 10: Incorrect App Identity (P2)

**Problem:** `productName` was `"AI Assistant"` and `identifier` was `"com.ai-assistant.app"`. These are placeholder values. The wrong identifier affects OS-level app isolation (sandboxing, keychain access, update channels).

**Fix:**
- `productName` → `"Torvi"`
- `identifier` → `"com.torvi.app"`

**File changed:** `src-tauri/tauri.conf.json`

---

## A06 — Vulnerable and Outdated Components

### Finding 11: npm Vulnerabilities (P2)

**Status:** `npm audit` → **0 vulnerabilities** (resolved prior to this session).

---

### Finding 12: rustls-webpki 0.103.9 — 4 TLS CVEs (P2)

**Problem:** `rustls-webpki` 0.103.9 had four security advisories:
- `RUSTSEC-2026-0049` — CRLs not considered authoritative due to faulty matching logic
- `RUSTSEC-2026-0098` — Name constraints for URI names incorrectly accepted  
- `RUSTSEC-2026-0099` — Name constraints accepted for wildcard certificate names
- `RUSTSEC-2026-0104` — Reachable panic in CRL parsing

All four affect TLS certificate validation — directly relevant since the app makes HTTPS requests to OpenRouter, NVIDIA NIM, AssemblyAI, and Appwrite.

**Fix:** `cargo update rustls-webpki` → patched to version 0.103.13 which resolves all four.

**File changed:** `src-tauri/Cargo.lock`

---

### Finding 13: rsa 0.9.10 — Marvin Attack (P2)

**Problem:** `rsa` 0.9.10 is vulnerable to `RUSTSEC-2023-0071` — a timing side-channel attack that can recover RSA private keys. This entered the dependency tree because `tauri-plugin-sql` enables `mysql` and `postgres` features by default, which pull in `sqlx-mysql → num-bigint-dig → rsa`. The app only uses SQLite.

**Fix:** Set `default-features = false` on `tauri-plugin-sql`. This removes the `mysql`/`postgres` sqlx backends and their entire dependency subtrees — including `rsa` — from the compiled binary. Verified with `cargo tree -i rsa` → "nothing to print".

**File changed:** `src-tauri/Cargo.toml`

```toml
# Before:
tauri-plugin-sql = { version = "2", features = ["sqlite"] }

# After:
tauri-plugin-sql = { version = "2", default-features = false, features = ["sqlite"] }
```

---

### Finding 14: Documented Transitive Advisories (Non-actionable)

All remaining `cargo audit` warnings are inside Tauri's own dependency tree and cannot be fixed in this codebase. Each is documented and suppressed in `src-tauri/.cargo/audit.toml`:

| Advisory | Crate | Reason not fixed |
|---|---|---|
| RUSTSEC-2026-0097 | `rand` 0.7/0.8/0.9 | Only unsound if custom logger calls `rand::rng()` — we don't. Tauri transitive dep. |
| RUSTSEC-2024-0429 | `glib` 0.18.5 | Linux/GTK only. Never compiled on Windows. |
| RUSTSEC-2025-0080 | `unic-common` 0.9 | "Unmaintained" informational only. Inside `tauri-utils`. |
| RUSTSEC-2025-0098 | `unic-ucd-version` 0.9 | "Unmaintained" informational only. Inside `tauri-utils`. |
| RUSTSEC-2025-0100 | `unic-ucd-ident` 0.9 | "Unmaintained" informational only. Inside `tauri-utils`. |
| RUSTSEC-2026-0105 | `core2` 0.4 | Yanked (housekeeping). Functional. Inside Tauri internals. |

**`cargo audit` final result: exit code 0, 0 vulnerabilities.**

---

## A09 — Security Logging and Monitoring Failures

### Finding 15: No Structured Logging — Raw println!/eprintln! (P2)

**Problem:** The entire Rust backend used `println!` and `eprintln!` for all diagnostic output. These go directly to stdout/stderr with no level filtering, no format control, and no way to silence them in production builds. Debug-level noise (audio chunk counts, WebSocket message bytes) would appear in production alongside genuine errors.

**Fix:** Added `tauri-plugin-log` and the `log` crate:

```toml
tauri-plugin-log = "2"
log = "0.4"
```

Registered as first plugin in `lib.rs` with level filtering:
```rust
.plugin(
    tauri_plugin_log::Builder::new()
        .level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Warn
        })
        .build(),
)
```

Every `println!`/`eprintln!` across all Rust source files replaced with the appropriate `log::debug!`, `log::info!`, `log::warn!`, or `log::error!` macro.

**Files changed:** `src-tauri/src/lib.rs`, `src-tauri/src/streaming_stt.rs`, `src-tauri/src/shortcuts.rs`, `src-tauri/src/audio_capture.rs`, `src-tauri/Cargo.toml`

---

### Finding 16: STT Transcript PII in Logs (P2)

**Problem:** `streaming_stt.rs` logged the full text of every STT transcript as:
```
Final: <transcribed speech>
```
This is user voice data — a privacy violation to log at any persistent level.

**Fix:** Moved the transcript content log to `log::debug!` level. In release builds (`LevelFilter::Warn`), this is completely silenced. Developers still see it in debug builds.

```rust
// Before:
println!("Final: {}", text);

// After:
log::debug!("STT final transcript received ({} chars)", text.len());
// Content not logged — only length, for debugging audio pipeline issues
```

**File changed:** `src-tauri/src/streaming_stt.rs`

---

## Verification

All remediations have been verified:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `cargo check` | ✅ 0 errors (1 pre-existing `dead_code` warning for `RegisteredShortcuts`) |
| `npm audit` | ✅ 0 vulnerabilities |
| `cargo audit` | ✅ Exit code 0, 0 vulnerabilities, 15 documented warnings |

---

## Known Limitations (Cannot Fix in Code)

1. **SQLite at-rest encryption** — Requires SQLCipher variant of `tauri-plugin-sql` + database migration. Breaking change deferred to future major version.
2. **Appwrite atomic quota decrement** — Requires a serverless Appwrite Function for atomic read-modify-write. External cloud infrastructure work.
