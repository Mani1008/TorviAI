# Context Memory — Architecture & Workflow

## What Is Context Memory?

Context Memory is Torvi's passive background intelligence layer. It silently reads visible text from whatever window the user is working in, stores it locally, and automatically injects the most relevant pieces into every AI prompt — so you never have to copy-paste context manually.

No cloud sync. No screenshots sent to any server. Everything stays on device.

---

## High-Level Flow

```
Active Window
     │
     ▼
[Rust: screen_reader.rs]          ← UIAutomation COM APIs
     │  WindowContext { app_name, window_title, text_content, url, captured_at }
     ▼
[Rust: privacy_filter.rs]
     │  should_capture() → drop sensitive apps / incognito tabs
     │  redact_sensitive() → mask card numbers, SSNs, API keys, OTPs
     ▼
[Rust: app_context.rs]
     │  SHA-256 hash → skip if duplicate
     │  clean_captured_text() → strip U+FFFC icons, noise lines, separators
     │  classify_context() → "code" | "document" | "email" | ...
     │  emit("context-captured", snapshot)   ← Tauri event
     ▼
[TypeScript: context-store.ts]    ← tauri-plugin-sql / SQLite
     │  dedup check (same hash within 5 min → skip)
     │  INSERT INTO context_chunks
     ▼
[SQLite: ai_assistant.db]
  context_chunks table
     │
     ▼
[TypeScript: ai-response.function.ts]
     │  buildContextAwareSystemPrompt()
     │  getRecentContext(5 chunks, last 30 min)
     │  keyword relevance filter OR last-5-min freshness
     │  inject as "## Current Screen Context" block
     ▼
[Rust: api.rs]  →  AI Provider (NVIDIA NIM / OpenRouter)
```

---

## Component Breakdown

### 1. Screen Reader — `src-tauri/src/screen_reader.rs`

Reads the **foreground window** using Windows UIAutomation COM APIs. No screenshots, no image encoding, no vision tokens.

**Text extraction — 4-strategy fallback chain:**

| Priority | Strategy | Used for |
|----------|----------|----------|
| 1 | `IUIAutomationTextPattern` on root element | VS Code, Word, terminals |
| 1.5 | `IUIAutomationTextPattern` on first `Document` descendant | Chrome, Edge, Firefox (body content only, no browser chrome) |
| 2 | `IUIAutomationValuePattern` | Single-line input fields (skips password fields) |
| 3 | Recursive tree walk (depth ≤ 15) | All other apps |

Tree walk only collects `Name` from **content** element types (`Text`, `Edit`, `Document`, `Hyperlink`, `TreeItem`, `DataItem`, `Header`) and completely skips **UI-chrome** types (`Button`, `ToolBar`, `MenuItem`, `ScrollBar`, `TitleBar`, `StatusBar`, `AppBar`, etc.) to avoid capturing window controls and toolbar noise.

**Browser URL extraction**: For Chromium-based browsers (Chrome, Edge, Brave) the address-bar URL is extracted separately using `UIA_NamePropertyId` on the address bar element.

**Output**: `WindowContext { app_name, window_title, text_content, url, captured_at }`

---

### 2. Context Watcher — `src-tauri/src/app_context.rs`

A long-running background loop started via `start_context_watcher` Tauri command. Uses two triggers:

**Trigger A — WinEvent hook** (`SetWinEventHook EVENT_SYSTEM_FOREGROUND`):
- Fires instantly when the user switches foreground windows (Alt-Tab, taskbar click, etc.)
- Lives on a dedicated OS thread with a Win32 message pump
- Sends a signal to the async loop via an `mpsc::channel`
- 300 ms debounce so the new window can finish painting before capture

**Trigger B — 2-second timer** (`tokio::time::interval`):
- Catches content changes inside the same window (user typing, page loading)
- Runs via `tokio::select!` alongside the WinEvent receiver

**After capture:**
1. SHA-256 hash the cleaned text
2. Skip if hash matches last capture (identical content → no write)
3. Emit `context-captured` Tauri event to frontend with the `AppContextSnapshot`

**Text cleaning (`clean_captured_text`)** before hashing/storing:
- Strips `U+FFFC` Object Replacement Characters (icon placeholders from accessibility trees)
- Removes C0/C1 control characters (keeps `\n`, `\r`, `\t`)
- Drops lines shorter than 3 printable chars (badge numbers, single letters)
- Removes known VS Code Source Control panel UI strings
- Removes separator lines (≥ 60% repeated punctuation)
- Collapses multiple blank lines into one

**Content classification (`classify_context`)** maps app name + URL to a semantic type:

| Type | Detection |
|------|-----------|
| `email` | Gmail, Outlook URLs; Outlook app |
| `project_management` | Linear, Jira, Trello, Asana URLs |
| `code` | VS Code, cursor, vim, JetBrains apps |
| `chat` | Slack, Teams, Discord, WhatsApp |
| `meeting` | Zoom, Teams meeting, Google Meet |
| `document` | Word, Google Docs, Notion, Confluence |
| `generic` | Everything else |

**State management**: `AppContextState` holds an `Arc<AtomicBool>` shared between the async loop and the WinEvent thread. `stop_context_watcher` sets it to `false`; both the timer loop and message pump check it every 200 ms.

---

### 3. Privacy Filter — `src-tauri/src/privacy_filter.rs`

Applied before any text is stored or emitted. Two layers:

**Layer 1 — `should_capture()`** — drops the entire snapshot for:
- Torvi itself (`ai-assistant`, `torvi`) — prevents the AI reading its own context feed
- Password managers: 1Password, KeePass, KeePassXC, Bitwarden, Dashlane, LastPass, Enpass, RoboForm
- Finance/banking: Mint
- Auth dialogs: `credui`, `consent`, `logonui`
- Remote Desktop: `mstsc`
- Windows lock screen: `lockapp`
- Task Manager: `taskmgr`
- Browser **incognito / private** tabs — detected by title containing "InPrivate", "Incognito", "Private Browsing", "Private Window"

**Layer 2 — `redact_sensitive()`** — replaces pattern matches with `[REDACTED]`:
- Credit/debit card numbers (`\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}`)
- US Social Security Numbers (`\d{3}-\d{2}-\d{4}`)
- API keys (prefixes: `sk-ant-`, `sk-`, `pk-`, `ghp_`, `ghs_`, `glpat-`, `AIza`, `AKIA` + 20+ chars)
- 6-digit OTP / 2FA codes

---

### 4. Context Store — `src/lib/database/context-store.ts`

Persists chunks to local SQLite (`ai_assistant.db`) via `tauri-plugin-sql`.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS context_chunks (
  id           TEXT    PRIMARY KEY,       -- UUID
  app_name     TEXT    NOT NULL,          -- "chrome", "Code", "Slack"
  window_title TEXT    NOT NULL,          -- window title bar text
  content_type TEXT    NOT NULL,          -- "code" | "document" | "email" | ...
  text_content TEXT    NOT NULL,          -- cleaned visible text
  content_hash TEXT    NOT NULL,          -- SHA-256 (Rust-side, for dedup)
  captured_at  INTEGER NOT NULL,          -- Unix timestamp (seconds)
  url          TEXT                       -- browser URL if applicable
);

CREATE INDEX idx_ctx_captured_at ON context_chunks(captured_at DESC);
CREATE INDEX idx_ctx_hash        ON context_chunks(content_hash);
CREATE INDEX idx_ctx_app         ON context_chunks(app_name);
CREATE INDEX idx_ctx_app_time    ON context_chunks(app_name, captured_at DESC);
```

**Double dedup**: Rust skips if the hash matches the *last* capture. TypeScript does a second check — if the same `content_hash` exists within the last 5 minutes, the INSERT is dropped. This prevents duplicates arriving from the two concurrent triggers.

**Retention**: `pruneOldContext()` deletes chunks older than 24 hours.

---

### 5. RAG Injection — `src/lib/functions/ai-response.function.ts`

Called by `useCompletion` before every AI request via `buildContextAwareSystemPrompt()`.

**Steps:**
1. `getRecentContext(5, 30)` — fetch up to 5 chunks from the last 30 minutes
2. Extract significant words from the user message (length > 4 chars)
3. Filter chunks: keep if (a) captured within the last 5 minutes **OR** (b) any user word appears in the chunk text
4. Truncate each chunk to 500 characters
5. Format each chunk as:
   ```
   [app_name • window_title • url]
   <text content>
   ```
6. Append to system prompt as:
   ```
   ## Current Screen Context
   The user currently has the following content open on their screen:

   [chunk 1]

   ---

   [chunk 2]

   Reference this context when it is relevant to the user's question. If it is not relevant, ignore it.
   ```

Non-fatal: if the DB isn't ready or no chunks exist, the original system prompt is returned unchanged.

---

### 6. UI — `src/pages/context-memory/index.tsx`

The Context Memory page provides a live view of captured chunks:

- **Live listener**: subscribes to the `context-captured` Tauri event — new chunks appear in real-time without a page reload
- **Filter tabs**: All / Code / Docs / Email / Chat / Meeting / PM / Generic — with counts
- **Expandable cards**: shows app name, window title, URL, time ago, content type badge, and truncated/full text
- **Pause / Resume**: invokes `stop_context_watcher` / `start_context_watcher` directly
- **Clear**: calls `pruneOldContext()` to wipe all stored chunks

---

## Data Flow Diagram

```
User switches to VS Code
         │
         ▼
WinEvent EVENT_SYSTEM_FOREGROUND fires (< 1 ms)
         │
         ▼
300ms debounce  (window finishes painting)
         │
         ▼
UIAutomation TextPattern → extract up to 8,000 chars of visible text
         │
         ▼
PrivacyFilter.should_capture() → "Code" (not blocked)
         │
         ▼
PrivacyFilter.redact_sensitive() → no PII found
         │
         ▼
clean_captured_text() → strip icon chars, noise lines
         │
         ▼
SHA-256("function useCompletion() { ... }") = "a3f9..."
         │   Same as last hash? → DROP
         ▼
classify_context("Code", "useCompletion.ts - VS Code") → "code"
         │
         ▼
emit("context-captured", { app_name: "Code", window_title: "...", text_content: "...", content_type: "code", content_hash: "a3f9...", ... })
         │
         ▼
TypeScript: dedup check → INSERT INTO context_chunks
         │
         ▼
User types: "explain this hook"
         │
         ▼
buildContextAwareSystemPrompt():
  • getRecentContext(5, 30) → [{ app_name: "Code", text_content: "function useCompletion..." }]
  • keyword "explain" matches → include chunk
  • inject as "## Current Screen Context"
         │
         ▼
Rust api.rs → NVIDIA NIM / OpenRouter → streaming response
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| UIAutomation instead of screenshots | No image tokens, no vision API cost, faster (< 50 ms vs 500 ms+ for OCR), natively skips password fields |
| Rust-side capture, TypeScript-side storage | Rust has access to Win32 APIs; TypeScript has direct SQLite access via tauri-plugin-sql |
| SHA-256 dedup at two levels | Prevents duplicate writes from both the timer and WinEvent triggers firing close together |
| 500-char chunk truncation at inject time | Caps token usage per chunk — a single huge file can't dominate the context window |
| 5-minute freshness override | Always includes very recent context even if it doesn't keyword-match the question |
| Non-fatal RAG injection | If the DB isn't initialised yet, the AI still responds using the base system prompt |
| Privacy filter before any storage | PII is stripped at the Rust layer, never written to disk |

---

## File Reference

| File | Role |
|------|------|
| `src-tauri/src/screen_reader.rs` | UIAutomation text extraction |
| `src-tauri/src/app_context.rs` | Background watcher loop, WinEvent hook, text cleaning, content classification |
| `src-tauri/src/privacy_filter.rs` | App block-list, PII redaction |
| `src/lib/database/context-store.ts` | SQLite schema, read/write/prune |
| `src/lib/functions/ai-response.function.ts` | RAG injection (`buildContextAwareSystemPrompt`) |
| `src/pages/context-memory/index.tsx` | Context Memory dashboard page |
| `src/components/Sidebar.tsx` | Watcher status poll, pause/resume toggle |
