# Rate Limiting & Abuse Protection Analysis

**Application:** Torvi (ai-assistant)  
**Stack:** Tauri 2.x + Rust backend · React 19 + TypeScript · Appwrite Cloud · OpenRouter / NVIDIA NIM / AssemblyAI  
**Date:** April 23, 2026  
**Scope:** All abuse vectors, rate limiting gaps, and implementation recommendations

---

## 1. Architecture Context

Torvi is a **desktop application** — there is no traditional web server to protect with IP-level rate limiting. The attack model is fundamentally different from a web app:

| Layer | What it is | Who can abuse it |
|---|---|---|
| Appwrite Cloud (OAuth, DB) | External SaaS — their infra handles some rate limiting | Authenticated users, script-driven sign-in loops |
| OpenRouter / NVIDIA NIM | External AI APIs — billed per token | Any code that holds the API key (or bypasses our proxy) |
| AssemblyAI WebSocket | External STT API — billed per minute | Any code that invokes the Tauri STT commands |
| Rust Tauri commands | Local IPC — invoked by the WebView | Malicious JS injected into the WebView (XSS) |
| SQLite (local) | Local database — no network | Malicious JS injected into the WebView |
| `src/lib/storage/usage-stats.ts` | localStorage counters | Any user — trivially bypassed by editing DevTools |

The **API keys** (OpenRouter, NVIDIA NIM, AssemblyAI) live only in the Rust process, loaded from `.env`. They are never sent to the frontend. All AI/STT requests are proxied through Rust commands. This is the correct design — it means a compromised WebView cannot directly call the AI providers.

---

## 2. Abuse Vector Inventory

### 2.1 Login / Auth Endpoints

**Vector:** `gate/index.tsx` → `getOAuthUrl()` → system browser → Appwrite OAuth  
**Current protection:** CSRF state nonce (implemented), Appwrite's own OAuth rate limiting  
**Gaps:**

| Gap | Risk | Severity |
|---|---|---|
| No client-side delay between OAuth attempts | User can hammer "Sign In" button | Low — Appwrite server rejects repeated OAuth initiations |
| No lockout after repeated OAuth failures | Script can loop sign-in with invalid tokens | Low — bounded by Appwrite OAuth throttling |
| `verifyToken()` makes an HTTP call to `${apiBase}/auth/me` on every session check | A slow/unavailable backend makes every app launch hang | Medium — DoS against the app itself |
| No timeout on `verifyToken()` call | Hangs indefinitely if server is unresponsive | Medium |

**Recommended fixes:**

```typescript
// gate/index.tsx — minimum delay between OAuth initiations
const OAUTH_CLICK_COOLDOWN_MS = 2_000;
let lastOAuthClick = 0;

function handleSignIn() {
  const now = Date.now();
  if (now - lastOAuthClick < OAUTH_CLICK_COOLDOWN_MS) return;
  lastOAuthClick = now;
  // ... existing flow
}
```

```typescript
// lib/storage/auth.ts — timeout on verifyToken
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000); // 5s max
const res = await fetch(`${apiBase}/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: controller.signal,
});
clearTimeout(timeout);
```

---

### 2.2 AI Endpoints — Token Abuse / Cost Explosion

**Vector:** `useCompletion.ts` → `streamAIFromConfig()` → Rust `stream_ai_request` command → OpenRouter / NVIDIA NIM  
**Current protection:**
- Message length cap: `MAX_MESSAGE_LENGTH = 32_000` chars
- Context window cap: `MAX_CONTEXT_MESSAGES = 50` turns
- Plan quota check via `checkAiResponseLimit()` (client-side only — bypassable)
- API keys held in Rust, never exposed to frontend

**Gaps:**

| Gap | Risk | Severity |
|---|---|---|
| `checkAiResponseLimit()` reads from localStorage — trivially bypassed by clearing it in DevTools | Quota enforcement is non-binding for technical users | High |
| No in-flight request deduplication | Double-click or race condition can fire two concurrent AI calls | Medium |
| No per-session request rate limit | A script looping `invoke("stream_ai_request")` can generate thousands of API calls | High |
| No token count estimation before dispatch | A message with 31,999 chars + a 50-message history is ~120K tokens — a single query can cost ~$1.20 on some models | Medium |
| No maximum image count per request | `images?: string[]` is unbounded — sending 100 images in one call is allowed | Medium |
| No cost cap or circuit breaker in Rust | If OpenRouter/NVIDIA return HTTP 200 indefinitely, costs accumulate with no kill switch | High |
| Images sent as base64 over IPC | A 4K screenshot is ~6 MB base64 — many in a session can exhaust memory | Medium |

**Recommended fixes (Rust — `api.rs`):**

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

/// Shared per-session AI request counter.
pub struct AiRequestCounter(pub Arc<AtomicU64>);

impl Default for AiRequestCounter {
    fn default() -> Self {
        AiRequestCounter(Arc::new(AtomicU64::new(0)))
    }
}

/// Per-session limit: 200 AI requests max (prevents runaway script abuse).
const MAX_AI_REQUESTS_PER_SESSION: u64 = 200;
/// Max images per request.
const MAX_IMAGES_PER_REQUEST: usize = 4;

#[tauri::command]
pub async fn stream_ai_request(
    app: AppHandle,
    counter: State<'_, AiRequestCounter>,
    model_id: Option<String>,
    messages: Vec<serde_json::Value>,
    system_prompt: String,
    images: Option<Vec<String>>,
    request_id: String,
) -> Result<(), String> {
    // Enforce per-session request cap
    let count = counter.0.fetch_add(1, Ordering::Relaxed);
    if count >= MAX_AI_REQUESTS_PER_SESSION {
        return Err("Session AI request limit reached. Please restart the app.".to_string());
    }

    // Enforce max images per request
    if let Some(ref imgs) = images {
        if imgs.len() > MAX_IMAGES_PER_REQUEST {
            return Err(format!("Too many images (max {})", MAX_IMAGES_PER_REQUEST));
        }
    }
    // ... rest of existing implementation
}
```

Register the state in `lib.rs`:
```rust
.manage(api::AiRequestCounter::default())
```

**Recommended fixes (TypeScript — `useCompletion.ts`):**

```typescript
// In-flight deduplication — reject if a request is already running
const sendMessage = useCallback(async (text: string, images?: string[]) => {
  if (!text.trim() || isLoading) return; // existing guard — already prevents overlap
  // isLoading is already set true during streaming — this is correct
}, []);
```

The `isLoading` guard already prevents concurrent requests from the UI. The Rust-level counter above handles script-driven abuse bypassing the UI.

---

### 2.3 STT Endpoints — Audio Abuse / Billing Explosion

**Vector:** `streaming_stt.rs` → AssemblyAI WebSocket (`wss://streaming.assemblyai.com`)  
**Current protection:**  
- STT is started/stopped via explicit Tauri commands (`start_streaming_stt`, `stop_streaming_stt`)
- AssemblyAI bills per minute of audio

**Gaps:**

| Gap | Risk | Severity |
|---|---|---|
| No maximum session duration for a single STT stream | A script could hold the WebSocket open indefinitely, billing $$/hour | High |
| No per-session STT minute cap enforced in Rust | `checkAiResponseLimit()` tracks AI responses, but not STT minutes independently at the Rust layer | Medium |
| No reconnect cap — auto-reconnect loops forever on connection drops | Could create runaway billing if AssemblyAI drops but the session appears active | Medium |

**Recommended fixes (`streaming_stt.rs`):**

```rust
/// Maximum duration for a single STT session: 10 minutes.
const MAX_STT_SESSION_SECS: u64 = 600;

// After connecting, spawn a watchdog task:
let app_handle_wd = app.clone();
tokio::spawn(async move {
    tokio::time::sleep(std::time::Duration::from_secs(MAX_STT_SESSION_SECS)).await;
    log::warn!("[STT] Session exceeded max duration — force-stopping");
    // Emit stop event to frontend
    let _ = app_handle_wd.emit("stt-force-stopped", ());
});
```

```rust
/// Maximum auto-reconnect attempts before giving up.
const MAX_RECONNECT_ATTEMPTS: u32 = 3;
```

---

### 2.4 Screen Capture

**Vector:** `capture.rs` → `start_screen_capture()` → returns base64 PNG string over IPC  
**Current protection:** None  
**Gaps:**

| Gap | Risk | Severity |
|---|---|---|
| No capture rate limit | Script can call `invoke("start_screen_capture")` in a tight loop — captures 30 fps, exhausts RAM | Medium |
| No size cap on returned base64 string | A 4K monitor returns ~8 MB base64 per capture — 10 rapid captures = 80 MB over IPC | Medium |
| No cooldown between captures | — | Low |

**Recommended fix (`capture.rs`):**

```rust
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct CaptureCooldown(pub Mutex<Option<Instant>>);
impl Default for CaptureCooldown {
    fn default() -> Self { CaptureCooldown(Mutex::new(None)) }
}

const CAPTURE_COOLDOWN: Duration = Duration::from_millis(500); // max 2 fps

#[tauri::command]
pub async fn start_screen_capture(
    _app: AppHandle,
    cooldown: tauri::State<'_, CaptureCooldown>,
) -> Result<String, String> {
    // Enforce cooldown
    {
        let mut last = cooldown.0.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < CAPTURE_COOLDOWN {
                return Err("Capture cooldown — please wait".to_string());
            }
        }
        *last = Some(Instant::now());
    }
    // ... existing capture logic
}
```

---

### 2.5 Sync / Appwrite API Calls

**Vector:** `src/lib/appwrite/sync*.ts` → Appwrite Cloud REST API  
**Current protection:** Appwrite's own request rate limiting  
**Gaps:**

| Gap | Risk | Severity |
|---|---|---|
| `runStartupSync()` runs on every auth success, with no debounce | If auth oscillates (network issues), sync fires repeatedly — hammers Appwrite API | Low |
| `syncConversation()` called per conversation in a loop | A user with 10,000 conversations would fire 10,000 Appwrite requests on first sync | Medium |
| No exponential backoff on sync failures | `catch(console.warn)` — retries are left to the next app launch, but no retry logic with backoff | Low |

**Recommended fix (sync.ts):**

```typescript
// Batch conversation sync instead of one-per-request
// Push only conversations modified in the last 30 days on startup
const SYNC_LOOKBACK_DAYS = 30;
const cutoff = Date.now() - SYNC_LOOKBACK_DAYS * 86_400_000;
const recentConvs = localConvs.filter(c => new Date(c.updatedAt).getTime() > cutoff);

// Sync with a concurrency limit of 5 (not N)
const SYNC_CONCURRENCY = 5;
for (let i = 0; i < recentConvs.length; i += SYNC_CONCURRENCY) {
  const batch = recentConvs.slice(i, i + SYNC_CONCURRENCY);
  await Promise.all(batch.map(conv => syncConversation(userId, conv)));
}
```

---

## 3. Rate Limiting Strategy

Because Torvi is a desktop app (not a web server), traditional server-side per-IP rate limiting does not apply to most vectors. The strategy is **layered**:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: UI Guards (TypeScript)                        │
│  • isLoading guard prevents duplicate AI calls          │
│  • Button cooldown on OAuth sign-in                     │
│  • Client-side quota check (soft limit, UX only)        │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Rust IPC Gate (Tauri Commands)                │
│  • Per-session AI request counter (hard cap: 200)       │
│  • Per-session STT duration watchdog (hard cap: 10 min) │
│  • Screenshot cooldown (max 2 fps)                      │
│  • Max images per AI request (hard cap: 4)              │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Upstream Provider Limits                      │
│  • OpenRouter / NVIDIA NIM: per-key RPM/TPM limits      │
│  • AssemblyAI: per-key concurrent session limit         │
│  • Appwrite: built-in API rate limiting on OAuth/DB     │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Appwrite Serverless Function (future)         │
│  • Atomic quota decrement — authoritative quota check   │
│  • Per-user daily/monthly token budget enforcement      │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Per-Session Limits (Rust Layer)

These are enforced by the Rust process and cannot be bypassed from the WebView:

| Resource | Limit | Rationale |
|---|---|---|
| AI requests per session | 200 | ~$2–20 at typical pricing; forces restart to reset |
| STT session max duration | 10 minutes | Caps max billing per invoke |
| STT reconnect attempts | 3 | Prevents runaway reconnect billing |
| Images per AI request | 4 | Prevents multi-image abuse |
| Screen captures per second | 2 | Prevents memory exhaustion via IPC |

### 3.2 Per-User Limits (Appwrite Layer — Future)

These require the Appwrite serverless Function for atomic enforcement:

| Metric | Starter | Plus | Pro |
|---|---|---|---|
| AI responses/month | 50 | 500 | Unlimited |
| STT minutes/month | 30 min | 300 min | Unlimited |
| Conversations synced | 100 | 1,000 | Unlimited |

### 3.3 Per-API-Key Limits (Provider Config)

Set these directly in the provider dashboards:

| Provider | Recommended limit |
|---|---|
| OpenRouter | Set a monthly spend cap in dashboard (e.g. $50) |
| NVIDIA NIM | Set RPM (requests per minute) limit in NIM dashboard |
| AssemblyAI | Set concurrent session limit to 3 in dashboard |

### 3.4 Burst vs Sustained Traffic

| Traffic type | Handling |
|---|---|
| Burst (rapid clicks, script loop) | Rust per-session counter stops it after 200 requests regardless of speed |
| Sustained (long session) | STT watchdog cuts off after 10 min; AI counter limits total volume |
| Concurrent (two windows open) | Each Tauri window shares the same Rust `AiRequestCounter` state — counter is global per app process |

---

## 4. Exponential Backoff Strategy

### 4.1 AI Request Retries (TypeScript)

Currently there is no retry logic in `ai-response.function.ts`. If the provider returns 429 (rate limited) or 5xx (server error), the error is shown to the user and no retry occurs. This is correct behavior — do not auto-retry AI requests (cost implications).

For the sync layer (`sync.ts`), add exponential backoff for Appwrite API failures:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage in sync.ts:
await withRetry(() => syncConversation(userId, conv));
```

### 4.2 STT Reconnect Backoff (Rust)

The current reconnect uses a flat 2-second delay. Replace with exponential backoff and a cap:

```rust
const RECONNECT_BASE_MS: u64 = 1_000;
const RECONNECT_MAX_MS: u64 = 30_000;
const MAX_RECONNECT_ATTEMPTS: u32 = 3;

let mut attempt = 0u32;
loop {
    if attempt >= MAX_RECONNECT_ATTEMPTS {
        log::error!("[STT] Max reconnect attempts reached — giving up");
        break;
    }
    let delay = RECONNECT_BASE_MS * (1 << attempt); // 1s, 2s, 4s
    let delay = delay.min(RECONNECT_MAX_MS);
    tokio::time::sleep(Duration::from_millis(delay)).await;
    attempt += 1;
    // ... reconnect attempt
}
```

---

## 5. Redis-Based Rate Limiting

Redis is the standard solution for rate limiting web APIs. **For Torvi's Tauri desktop app, Redis is not directly applicable** because there is no web server to enforce it on. However, it becomes relevant in two scenarios:

### 5.1 If a Web Backend Is Added (e.g., token verification endpoint)

The `verifyToken()` function calls `${apiBase}/auth/me`. If this web backend exists, it should use Redis-backed rate limiting:

```
Architecture:
  Tauri client → HTTPS → Express/Fastify API → Redis rate limiter → Appwrite

Redis rate limiter (using ioredis + rate-limiter-flexible):
```

```typescript
// Backend: src/middleware/rateLimiter.ts
import { RateLimiterRedis } from "rate-limiter-flexible";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

// Per-IP: 20 requests per minute to /auth/me
export const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl_auth",
  points: 20,           // requests
  duration: 60,         // per 60 seconds
  blockDuration: 300,   // block for 5 minutes on exhaustion
});

// Per-user: 10 token verifications per 10 seconds  
export const tokenVerifyLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl_token",
  points: 10,
  duration: 10,
});

// Middleware
export async function rateLimitAuth(req, res, next) {
  try {
    await authLimiter.consume(req.ip);
    next();
  } catch {
    res.status(429).json({ error: "Too many requests. Try again later." });
  }
}
```

### 5.2 If an Appwrite Serverless Function Is Added (quota decrement)

The Appwrite Function for atomic quota decrement should include Redis-backed rate limiting per user ID:

```javascript
// Appwrite Function: decrement-ai-quota/index.js
import { RateLimiterRedis } from "rate-limiter-flexible";

const limiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "rl_ai_quota",
  points: 10,        // 10 AI requests per user
  duration: 60,      // per 60 seconds (burst prevention)
});

export default async function ({ req, res, log }) {
  const userId = req.headers["x-appwrite-user-id"];
  
  try {
    await limiter.consume(userId);
  } catch {
    return res.json({ error: "Rate limit exceeded", code: 429 }, 429);
  }
  
  // ... atomic decrement logic
}
```

---

## 6. Middleware-Based Throttling

### 6.1 Tauri Command Middleware Pattern

Tauri doesn't have HTTP middleware, but the same pattern can be implemented via a Rust wrapper function:

```rust
// src-tauri/src/middleware.rs

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::collections::HashMap;

/// Simple token-bucket rate limiter for Tauri commands.
pub struct CommandRateLimiter {
    limits: Mutex<HashMap<String, (u32, Instant)>>,
}

impl CommandRateLimiter {
    pub fn new() -> Self {
        CommandRateLimiter { limits: Mutex::new(HashMap::new()) }
    }

    /// Check if a command call is within the allowed rate.
    /// Returns Ok(()) if allowed, Err(String) if rate exceeded.
    pub fn check(&self, command: &str, max_per_minute: u32) -> Result<(), String> {
        let mut limits = self.limits.lock().unwrap();
        let now = Instant::now();
        let entry = limits.entry(command.to_string())
            .or_insert((0, now));
        
        // Reset window after 1 minute
        if entry.1.elapsed() > Duration::from_secs(60) {
            *entry = (0, now);
        }
        
        entry.0 += 1;
        if entry.0 > max_per_minute {
            Err(format!("Rate limit: {} max {} calls/min", command, max_per_minute))
        } else {
            Ok(())
        }
    }
}
```

```rust
// Usage in api.rs:
#[tauri::command]
pub async fn stream_ai_request(
    limiter: tauri::State<'_, CommandRateLimiter>,
    // ... other params
) -> Result<(), String> {
    limiter.check("stream_ai_request", 30)?; // max 30 AI calls per minute
    // ... rest of implementation
}
```

Register in `lib.rs`:
```rust
.manage(middleware::CommandRateLimiter::new())
```

---

## 7. Bot Protection Strategies

### 7.1 Context: Torvi is a Desktop App

Traditional bot protection (CAPTCHAs, Cloudflare Turnstile, browser fingerprinting) is designed for web browsers. For Tauri, the threat model is:

1. **Automated script driving the app via `invoke()`** — script calls Tauri commands in a tight loop
2. **Modified app binary** — user patches the Rust binary to remove limits
3. **WebView script injection** — XSS or devtools script calls `window.__TAURI__.core.invoke()`

### 7.2 Mitigations by Threat

**Threat 1: Automated invoke() loops**

The Rust-layer per-session counter (Section 3.1) and the `CommandRateLimiter` (Section 6.1) are the primary defenses. They cannot be bypassed from JavaScript.

```rust
// Additional protection: validate request_id format to reject scripted calls
// that use predictable/sequential IDs
fn validate_request_id(id: &str) -> Result<(), String> {
    // Must be a UUID v4 — reject sequential numeric IDs
    if id.len() != 36 || !id.contains('-') {
        return Err("Invalid request_id format".to_string());
    }
    Ok(())
}
```

**Threat 2: Modified binary**

Cannot be fully prevented. Mitigations:
- Server-side quota enforcement via Appwrite Function (deferred — see OWASP Analysis)
- The API keys are in `.env`, not compiled into the binary — an attacker needs the key file, not just a patched binary
- In production distribution, the `.env` file should be replaced by runtime secrets from a key management service (Doppler, AWS Secrets Manager, etc.)

**Threat 3: WebView script injection**

The Tauri capability system (already hardened — see OWASP Analysis) limits which commands each window can call. The CSP header should also be set to prevent inline script injection:

In `tauri.conf.json`, under each window config:
```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
    }
  }
}
```

This prevents injected `<script>` tags and inline event handlers from executing, even if an attacker finds an HTML injection point.

### 7.3 Appwrite OAuth Bot Protection

Appwrite provides no built-in CAPTCHA on OAuth. For additional protection:

- Configure Appwrite's **rate limits** per project in the Appwrite console (Settings → Security)
- Set a maximum of **10 OAuth sessions per hour per IP** in Appwrite console
- Enable Appwrite's **email OTP as MFA** fallback if Google OAuth is unavailable

### 7.4 Anomaly Detection (Future)

Because Torvi has no backend server to analyze request patterns today, anomaly detection requires the Appwrite Function layer. Once that exists, add:

```javascript
// In the quota-decrement Appwrite Function:
// Log anomalous usage patterns for review
const ANOMALY_THRESHOLD_PER_HOUR = 50; // 50 AI calls in an hour = unusual

const hourlyCount = await getHourlyCount(userId); // Redis counter
if (hourlyCount > ANOMALY_THRESHOLD_PER_HOUR) {
  log.warn(`Anomalous usage: user ${userId} made ${hourlyCount} AI calls in 1 hour`);
  // Could trigger automatic account flag or notification
}
```

---

## 8. Implementation Priority

| Priority | Action | Layer | Effort |
|---|---|---|---|
| **P1** | Add `AiRequestCounter` Rust state (200/session hard cap) | Rust | 1 hour |
| **P1** | Register `AiRequestCounter` in `lib.rs` | Rust | 10 min |
| **P1** | Add STT session max-duration watchdog (10 min) | Rust | 1 hour |
| **P1** | Add STT reconnect cap (3 attempts, exponential backoff) | Rust | 1 hour |
| **P2** | Add max images per AI request validation (4 max) | Rust | 30 min |
| **P2** | Add `CaptureCooldown` state + screenshot rate limit (2 fps) | Rust | 1 hour |
| **P2** | Add `CommandRateLimiter` middleware (30 AI calls/min) | Rust | 2 hours |
| **P2** | Add OAuth button cooldown in gate (2s) | TypeScript | 30 min |
| **P2** | Add timeout on `verifyToken()` (5s) | TypeScript | 30 min |
| **P2** | Add `withRetry()` with exponential backoff for Appwrite sync | TypeScript | 1 hour |
| **P2** | Add conversation sync batching (limit 30-day lookback, 5 concurrent) | TypeScript | 1 hour |
| **P2** | Add CSP headers in `tauri.conf.json` | Config | 30 min |
| **P3** | Appwrite Function: atomic quota decrement with Redis rate limiter | Cloud infra | 1 day |
| **P3** | Provider dashboard: set spend caps and RPM limits | Config | 30 min |
| **P3** | Anomaly detection in Appwrite Function | Cloud infra | 4 hours |

---

## 9. What Cannot Be Fixed in This Codebase

| Limitation | Reason | Mitigation |
|---|---|---|
| True per-IP rate limiting on AI calls | No web server — requests go Tauri → Rust → provider directly | Rust-layer per-session counter is the best available equivalent |
| Redis-backed rate limiting for the app itself | No server to run Redis on | In-memory Rust rate limiter is sufficient for the desktop threat model |
| Authoritative quota enforcement | Client-side `checkAiResponseLimit()` is bypassable | Requires Appwrite serverless Function (deferred — noted in OWASP Analysis) |
| CAPTCHA on sign-in | Tauri webviews can't easily integrate CAPTCHA services | Appwrite OAuth inherits Google's own bot protection via Google sign-in |
| Binary tampering prevention | Platform DRM / code signing — out of scope | API keys in `.env` (not in binary) limits blast radius |
