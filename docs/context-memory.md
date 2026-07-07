# Context Memory — Architecture & Workflow

## What Is Context Memory?

Context Memory is Torvi's passive background intelligence layer. It silently reads visible text from whatever window the user is working in, stores it locally in SQLite, and automatically injects the most relevant pieces into every AI prompt — so you never have to copy-paste context manually.

No cloud sync. No screenshots sent to any server. Everything stays on device.

---

## High-Level Flow

```
Active Window
     │
     ▼
[Rust: screen_reader.rs]          ← Windows UIAutomation COM APIs
     │  WindowContext { app_name, window_title, text_content, url, captured_at }
     ▼
[Rust: privacy_filter.rs]
     │  should_capture() → drop sensitive apps / incognito tabs
     │  redact_sensitive() → mask card numbers, SSNs, API keys, OTPs
     ▼
[Rust: app_context.rs]
     │  clean_captured_text() → strip U+FFFC, noise lines, separators, shortcut labels
     │  SHA-256 hash → skip if hash matches last capture (timer path only)
     │  Google Workspace near-empty guard → emit "google-docs-needs-screen-reader" event
     │  parse_window_title() → structure title per-app (VS Code, Slack, Teams, Office…)
     │  classify_context() → "code" | "document" | "email" | "meeting" | …
     │  emit("context-captured", snapshot)   ← Tauri event for UI counter / live dot
     ▼
[Rust: context_db.rs]             ← direct sqlx pool (bypasses tauri-plugin-sql IPC)
     │  dedup check (same content_hash within 5 min → skip)
     │  sliding_window_chunks(text, 10_000, 1_000) → N overlapping chunks
     │  INSERT OR REPLACE each chunk
     │  emit("context-chunks-saved")   ← signals UI to reload DB
     ▼
[SQLite: ai_assistant.db]         ← WAL mode, two concurrent pools (Rust + JS)
  context_chunks table
     │
     ▼
[TypeScript: ai-response.function.ts]
     │  buildContextAwareSystemPrompt()
     │  getRecentContext(20 chunks, last 30 min)
     │  tokenise all chunks → buildCorpus() (BM25 IDF statistics)
     │  tokenise query (current msg + last 3 user turns)
     │  bm25Score() + RECENCY_BONUS (< 5 min) → sort descending
     │  filter score ≥ BM25_MIN_SCORE (0.5)
     │  per-app dedup: up to 3 chunks per app_name
     │  cap at 10 chunks total
     │  truncate each to 2,000 chars at line boundary
     │  inject as "## Current Screen Context" block
     ▼
[Rust: api.rs]  →  AI Provider (NVIDIA NIM / OpenRouter) → streaming response
```

---

## Component Breakdown

### 1. Screen Reader — `src-tauri/src/screen_reader.rs`

Reads the **foreground window** using Windows UIAutomation COM APIs. No screenshots, no image encoding, no vision tokens. All extraction is text-only and completes in < 50 ms.

**Text extraction — 5-strategy fallback chain:**

| Priority | Strategy | Used for |
|----------|----------|----------|
| 0 | Targeted editor-pane search by AutomationId `workbench.parts.editor` / ClassName `monaco-editor` | VS Code, Cursor — bypasses sidebar/outline/status bar |
| 1 | `IUIAutomationTextPattern` on root element | Word, Notepad, terminals, most native apps |
| 1.5a | `IUIAutomationTextPattern` (then filtered tree walk) scoped to `AutomationId="RootWebArea"` | Chrome, Edge, Brave — skips browser chrome entirely |
| 1.5b | `IUIAutomationTextPattern` on first `Document`-type descendant | Firefox (no RootWebArea AutomationId) |
| 2 | `IUIAutomationValuePattern` | Single-line input fields (skips password fields) |
| 3 | Recursive tree walk (depth ≤ 15) | All other apps — filtered by element type |

**Strategy 0 — VS Code / Cursor detail:**

VS Code's accessibility tree exposes the entire IDE: Explorer sidebar, Source Control panel, Outline, Timeline, NPM Scripts, Breakpoints, status bar, terminal panel — everything. Strategy 0 detects VS Code / Cursor via window title (`"visual studio code"` or trailing `" — cursor"` / `" - cursor"`) and searches directly for:

1. `AutomationId = "workbench.parts.editor"` or `"editor container"` → finds all `Document` children → TextPattern on each → keeps longest
2. `ClassName = "monaco-editor"` → TextPattern fallback
3. If both fail (Welcome tab, Settings UI, extension views) → calls `walk_children()` scoped to the VS Code window root (never hits Strategy 1 which would read the full sidebar tree)

**Strategy 1.5a — Browser RootWebArea detail:**

The RootWebArea block is **hard-scoped**: if TextPattern on the web element returns empty (Google Docs canvas scenario), it falls back to a filtered tree walk scoped to the web element — not the root window. A hard `return Ok(String::new())` after both attempts prevents any escape to the root-window walk that would read browser chrome again.

**Tree walk filter (`walk_children`)**: Collects `Name` from content types (`Text`, `Edit`, `Document`, `Hyperlink`, `TreeItem`, `DataItem`, `Header`, `ListItem`, `Group`) and skips chrome types (`Button`, `ToolBar`, `MenuItem`, `MenuBar`, `ScrollBar`, `StatusBar`, `TitleBar`, `Separator`, `AppBar`, `TabControl`, `TabItem`, `CheckBox`). Depth cap: 15.

**Raw capture limit**: 20,000 chars at all strategies.

**Output**: `WindowContext { app_name, window_title, text_content, url, captured_at }`

---

### 2. Context Watcher — `src-tauri/src/app_context.rs`

A long-running background loop started via the `start_context_watcher` Tauri command. Two triggers feed one capture/emit/save pipeline.

**Trigger A — WinEvent hook** (`SetWinEventHook EVENT_SYSTEM_FOREGROUND`):
- Fires instantly (< 1 ms) when the user switches foreground windows
- Lives on a **dedicated OS thread** with a Win32 message pump (`GetMessageW` / `TranslateMessage` / `DispatchMessageW`)
- Sends a signal to the async loop via `mpsc::channel(4)`
- **300 ms debounce** so the new window finishes painting before UIAutomation reads it
- On WinEvent trigger: **always re-captures** even if the content hash matches (window switch forces re-emit to keep UI timestamp fresh)

**Trigger B — 2-second timer** (`tokio::time::interval`):
- Catches content changes inside the same window (user typing, page loading)
- On timer trigger with unchanged hash: skips re-capture unless the last emit was > **360 seconds** ago (STALE_SECS) — forces re-emit of stale content so AI context does not go dark during long reading sessions

**Text cleaning (`clean_captured_text`)** — applied before hashing:

| Filter | What it removes |
|--------|----------------|
| U+FFFC strip | Object Replacement Characters (icon placeholders from accessibility trees) |
| C0/C1 control chars | Non-printable control chars (keeps `\n`, `\r`, `\t`) |
| Short lines | Lines < 3 printable chars (badge numbers, single letters) |
| Pure-numeric lines | Lines containing only digits + `+:,./°%` — catches `"100%"`, `"10.5"`, `"99+"`, `"09:41"` |
| `UI_NOISE_LINES` exact-match | ~100 known UI chrome strings in 4 categories (see below) |
| Keyboard-shortcut tooltip lines | Lines ending with `)` AND containing `(Ctrl+`, `(Alt+`, etc. — e.g. `"Bold (Ctrl+B)"` |
| ARIA state-description lines | Lines ending with `" selected."` or `" selected"` — e.g. `"Normal text selected."` |
| Separator lines | Lines where ≥ 60% of chars are punctuation (`─━═-=·•|\~`) |
| Blank line collapse | Multiple consecutive blank lines → one blank line |

**`UI_NOISE_LINES` (~100 strings in 4 categories):**
- *VS Code sidebar/panel labels*: `OUTLINE`, `TIMELINE`, `NPM SCRIPTS`, `BREAKPOINTS`, `CALL STACK`, `VARIABLES`, `WATCH`, `SOURCE CONTROL`, `TERMINAL`, `PORTS`, etc.
- *Generic app chrome*: `New Tab`, `Close`, `Minimize`, `Back`, `Forward`, `Settings`, `Help`, `Cancel`, `Done`, `Submit`, `OK`, etc.
- *Chat / AI UI*: `Chats`, `Projects`, `Artifacts`, `Free plan`, `Upgrade`, `Stop generating`, `Regenerate`, `Copy code`, `Sign in`, `Sign out`, etc.
- *Browser chrome*: `Address and search bar`, `Bookmarks`, `History`, `Downloads`, `New incognito window`, `Pin tab`, `Close tab`, etc.
- *Google Workspace UI*: `FileEditViewInsertFormatToolsExtensionsHelp`, `Document content`, `Editing`, `Show tabs & outlines`, `Turn on screen reader support`, etc.

**Google Workspace guard**: After cleaning, if the URL contains `docs.google.com/document`, `/spreadsheets`, or `/presentation` AND the cleaned text has < 150 alphanumeric characters:
- Skips the save entirely (near-empty toolbar-only capture — document body is canvas-rendered and invisible without screen reader mode)
- Emits `"google-docs-needs-screen-reader"` Tauri event to prompt the user in the UI

**Pipeline after cleaning:**
1. SHA-256 hash the cleaned text
2. Dedup logic (WinEvent → always continue; timer → skip if same hash & not stale)
3. `parse_window_title()` — structure title per-app
4. `classify_context()` — assign content type
5. `emit("context-captured", snapshot)` — UI live counter / dot
6. `ctx_db.save_snapshot(snapshot)` — Rust-direct SQLite write
7. `emit("context-chunks-saved")` — UI reload signal

**Window title parsing (`parse_window_title`)**:

| App | Raw title | Stored as |
|-----|-----------|-----------|
| VS Code / Cursor | `main.rs — torvi — Visual Studio Code` | `main.rs \| torvi` |
| Slack | `#engineering — Acme HQ` | `#engineering \| Acme HQ` |
| Teams (chat) | `General \| Engineering \| Microsoft Teams` | `General \| Engineering` |
| Teams (meeting) | `Weekly Sync \| Microsoft Teams` | `Weekly Sync` (type → `meeting`) |
| Word / Excel / PowerPoint | `Q3 Report.docx - Microsoft Word` | `Q3 Report.docx` |
| Outlook | `RE: Budget Review - Outlook` | `RE: Budget Review` |
| Generic | `Foo - Bar - AppName` | `Foo \| Bar` |

**Content classification (`classify_context`)** — 7 types, 45+ URL domains:

| Type | URL domains (examples) | App names |
|------|------------------------|-----------|
| `email` | gmail.com, outlook.live.com, mail.yahoo.com, protonmail.com | Outlook, Thunderbird, Mailspring |
| `project_management` | linear.app, jira.atlassian.com, trello.com, asana.com, monday.com, notion.so | — |
| `code` | github.com, gitlab.com, bitbucket.org | VS Code, Cursor, PyCharm, WebStorm, CLion, GoLand, Vim, Neovim, Emacs |
| `chat` | slack.com, discord.com, teams.microsoft.com (non-meeting) | Slack, Teams (chat), Discord, WhatsApp |
| `meeting` | zoom.us, meet.google.com, teams.microsoft.com/meeting, whereby.com | Zoom, Teams (meeting) |
| `document` | docs.google.com, notion.so, confluence.atlassian.com | Word, Excel, PowerPoint |
| `design` | figma.com, miro.com, canva.com | Figma, Miro |
| `generic` | everything else | everything else |

Meeting detection override: title containing `"meeting"`, `"call"`, `"conference"`, or `"join now"` forces type → `meeting`.

---

### 3. Privacy Filter — `src-tauri/src/privacy_filter.rs`

Applied before any text is stored or emitted. PII is **never written to disk**.

**Layer 1 — `should_capture()`** — drops the entire snapshot for:
- Torvi itself (`ai-assistant`, `torvi`)
- Password managers: 1Password, KeePass, KeePassXC, Bitwarden, Dashlane, LastPass, Enpass, RoboForm
- Finance/banking: Mint
- Auth dialogs: `credui`, `consent`, `logonui`
- Remote Desktop: `mstsc`
- Windows lock screen: `lockapp`
- Task Manager: `taskmgr`
- Browser **incognito / private** tabs — title containing `"InPrivate"`, `"Incognito"`, `"Private Browsing"`, `"Private Window"`

**Layer 2 — `redact_sensitive()`** — replaces with `[REDACTED]`:
- Credit/debit card numbers: `\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}`
- US Social Security Numbers: `\d{3}-\d{2}-\d{4}`
- API keys (prefixes): `sk-ant-`, `sk-`, `pk-`, `ghp_`, `ghs_`, `glpat-`, `AIza`, `AKIA` + 20+ chars
- 6-digit OTP / 2FA codes

---

### 4. Context DB — `src-tauri/src/context_db.rs`

Direct `sqlx` SQLite writer. Bypasses `tauri-plugin-sql` IPC entirely — the JS IPC path silently dropped writes (`rowsAffected=0`, no error).

**Why two pools?**
- Rust pool (`sqlx`, `max_connections=1`): all **writes** — INSERT chunks, schema migrations
- JS pool (`tauri-plugin-sql`): all **reads** — `getRecentContext()`, UI queries
- WAL journal mode allows both pools to coexist on the same file without blocking

**Chunking — `sliding_window_chunks(text, 10_000, 1_000)`:**
- 10,000-char windows (≈ 2,500 tokens) — large enough to hold a complete function with surrounding context
- 1,000-char overlap (10%) — prevents BM25 from missing a hit that spans a chunk boundary
- Chunks < 20 chars are dropped

**Dedup**: SHA-256 hash checked against the last 5-minute window before any INSERT.

**ID linkage**: Chunk 0 has `parent_capture_id = NULL`; chunks 1..N get `parent_capture_id = first_chunk_id` and a positional hash suffix `"${hash}:N"`.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS context_chunks (
  id                TEXT    PRIMARY KEY,  -- UUID v4
  app_name          TEXT    NOT NULL,
  window_title      TEXT    NOT NULL,
  content_type      TEXT    NOT NULL,
  text_content      TEXT    NOT NULL,     -- one sliding-window chunk
  content_hash      TEXT    NOT NULL,     -- SHA-256 of full cleaned text
  captured_at       INTEGER NOT NULL,     -- Unix timestamp seconds
  url               TEXT,
  parent_capture_id TEXT,
  chunk_index       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_ctx_captured_at  ON context_chunks(captured_at DESC);
CREATE INDEX idx_ctx_hash         ON context_chunks(content_hash);
CREATE INDEX idx_ctx_app          ON context_chunks(app_name);
CREATE INDEX idx_ctx_app_time     ON context_chunks(app_name, captured_at DESC);
CREATE INDEX idx_ctx_parent       ON context_chunks(parent_capture_id);
```

---

### 5. Context Store — `src/lib/database/context-store.ts`

TypeScript read layer — uses `tauri-plugin-sql` for all SELECT queries.

- **`getRecentContext(limit, minutesBack)`** — fetches the N most recent chunks from the last M minutes
- **`pruneOldContext()`** — deletes chunks older than 24 hours; called on app startup + **1-hour `setInterval`** in `src/main.tsx`
- **`initContextStore()`** — ensures schema exists at startup (safety net; schema primarily owned by `context_db.rs`)

> Note: `saveContextChunk()` still exists but is **no longer called**. All writes are Rust-only.

---

### 6. RAG Injection — `src/lib/functions/ai-response.function.ts`

Called by `useCompletion` before every AI request via `buildContextAwareSystemPrompt()`.

**Search engine: BM25 (keyword-based TF-IDF ranking)**

**BM25 constants:**

| Constant | Value | Role |
|---|---|---|
| `RAG_MAX_CHUNKS` | `10` | Hard cap on total injected chunks |
| `RAG_CHUNK_CHAR_LIMIT` | `2,000` | Max chars per injected chunk (≈ 500 tokens) |
| `RAG_MAX_CHUNKS_PER_APP` | `3` | Max chunks from the same `app_name` |
| `BM25_K1` | `1.5` | Term-frequency saturation |
| `BM25_B` | `0.75` | Document-length normalisation |
| `BM25_MIN_SCORE` | `0.5` | Minimum score to survive relevance filter |
| `RECENCY_BONUS` | `3.0` | Additive score boost for chunks < 5 min old |
| `RECENCY_FRESH_SECS` | `300` | Fresh-chunk window (5 minutes) |
| `RAG_OVERHEAD_RESERVE` | `20,000` | Chars reserved for system prompt + history before RAG budget is counted (prevents oversized payloads) |

**10-step pipeline:**

1. **Over-fetch** — `getRecentContext(20, 30)` — 20 candidates from the last 30 minutes
2. **Tokenise corpus** — `[a-z0-9_]{3,}` tokens; `buildCorpus()` computes IDF statistics
3. **Tokenise query** — current message + last 3 user turns → deduplicated token set
4. **BM25 score** — Robertson–Spärck Jones IDF formula per chunk
5. **Recency bonus** — add 3.0 to chunks captured < 5 min ago
6. **Filter** — drop score < 0.5
7. **Sort** — descending by score
8. **Per-app dedup** — first (highest-scoring) occurrence per `app_name`; up to 3 per app
9. **Hard cap** — `slice(0, 10)`
10. **Truncate & inject** — each chunk to 2,000 chars at line boundary; injected as `## Current Screen Context` block

---

### 7. UI — `src/pages/context-memory/index.tsx`

- **`context-captured` listener**: increments session counter, lights Watching dot
- **`context-chunks-saved` listener**: triggers `loadChunks()` after all INSERTs committed
- **`google-docs-needs-screen-reader` listener**: shows dismissable yellow banner prompting `Ctrl+Alt+Z`
- **Focus reload**: `onFocusChanged` re-fetches DB when user returns to Torvi
- **Periodic refresh**: `setInterval(loadChunks, 30_000)` keeps timestamps current
- **Watcher status polling**: `setInterval(get_watcher_status, 2_000)` keeps `isPaused` / `isWatching` in sync with external changes (e.g. paused from Sidebar); updates UI indicator within ≤ 2 s
- **Filter tabs**: All / Code / Docs / Email / Chat / Meeting / PM / Generic
- **Pause / Resume**: `stop_context_watcher` / `start_context_watcher` Tauri commands; pause intent stored in `localStorage["ctx_watcher_paused"]` (shared across all Tauri webviews)
- **Clear**: calls `pruneOldContext()` to wipe all chunks

### 8. Proactive Suggestion Chips — `src/pages/app/index.tsx`

Shown **below** the pill-bar toolbar when the context watcher fires a `context-captured` event with a new `app_name`. Auto-dismiss after 30 seconds.

**Content-type → chip map (`CONTEXT_SUGGESTIONS`):**

| content_type | Chips |
|---|---|
| `code` | Explain this · Review this code · What does this do? |
| `document` | Summarize this · Key points? · Explain this |
| `meeting` | Summarize meeting · Action items? · Key decisions? |
| `email` | Summarize this · Draft a reply · Key points? |
| `chat` | Summarize conversation · Key points? |
| `project_management` | What's the status? · Summarize this |
| `design` | Describe this · Feedback on this |
| `generic` | Help with this · Summarize this · Explain this |

**Behaviour:**
- Chips appear only when `!isExpanded` (pill bar collapsed / no response panel open)
- Window height extends to **82 px** tier when chips are visible
- Clicking a chip: dismisses chips + pre-fills TextInput via `externalText` / `setSttText`
- ✕ button dismisses without selecting
- Cleared automatically when AI starts generating (`isLoading → true`)
- `prevAppNameRef` tracks last `app_name`; chips only shown on **app switch**, not repeated captures from the same app

### 9. Auto System-Prompt Switching — `src/hooks/useCompletion.ts`

Before every `sendMessage`, `resolveContextAwarePrompt(fallback)` silently tries to select a saved system prompt that matches the current screen context type.

**`CONTENT_TYPE_KEYWORDS` map:**

| content_type | Matched name keywords |
|---|---|
| `code` | code, coding, developer, programming, dev, technical, engineer |
| `meeting` | meeting, note, standup, call, conference, minutes |
| `email` | email, mail, inbox, gmail |
| `document` | document, writing, writer, doc, essay, draft |
| `project_management` | project, task, ticket, pm, linear, jira |
| `design` | design, figma, ui, ux |
| `chat` | chat, slack, discord, message |

**Matching logic:** `getRecentContext(1, 5)` fetches the most recent chunk from the last 5 minutes → extracts `content_type` → looks for a saved system prompt (from SQLite) whose `name.toLowerCase()` contains any keyword for that type (case-insensitive substring match).

**Fallback:** If no match, DB is empty, or any error — silently returns the user's currently active system prompt unchanged. Never throws.

**Opt-in via naming convention:** Users name their saved system prompts descriptively (e.g. *"Coding assistant"*, *"Meeting notes helper"*, *"Email drafting"*) to enable auto-selection. No special config needed.

---

## BM25 vs Vector Embeddings

### Current implementation: BM25

BM25 is an enhanced TF-IDF ranking algorithm. It scores chunks by how well their word vocabulary matches the query vocabulary, weighting rare terms higher (IDF) and normalising for document length.

**Why BM25 works well for Torvi:**
- **Zero latency** — pure in-memory JavaScript math, no model inference, no network call
- **Exact identifier matching** — code symbols like `useCompletion`, `sliding_window_chunks`, `UIA_AutomationIdPropertyId` score extremely high when they appear in both query and chunk. This is the dominant query pattern for developer users.
- **No infrastructure** — no embedding model to download, host, or pay for
- **Deterministic** — same query always produces the same ranking
- **Recency bonus** compensates for the vocabulary-overlap gap when the user's query is short (`"explain this"`, `"what does this do?"`)

**BM25 weaknesses:**
- **Zero vocabulary overlap = zero score** — `"what does this function return?"` scores 0 against a chunk about `fn compute_hash() -> String` (no shared tokens; recency bonus is the only lifeline)
- **No synonym understanding** — `"delete a row"` does not match `"remove an entry"`
- **No semantic intent** — `"my deployment is failing"` does not retrieve a Kubernetes YAML chunk unless it contains the word `"deployment"`

### Alternative: Vector Embeddings

Query and chunks are converted to float vectors by an embedding model. Cosine similarity replaces BM25 scoring.

**Strengths:**
- Semantic matching: `"delete a row"` matches `"remove an entry from the table"`
- Cross-vocabulary: matches conceptual intent with different words
- Better for natural-language conceptual queries: `"how does auth work here?"`

**Weaknesses for Torvi:**
- **Latency**: local embedding models (nomic-embed-text, all-MiniLM-L6-v2) add 50–200 ms per request; cloud APIs add network cost
- **Poor identifier matching**: code-specific symbols like `useCompletion`, `content_hash` embed similarly to unrelated long tokens since the model has never seen your codebase
- **Storage**: each chunk produces ~384–1536 floats; 1,000 chunks ≈ 6 MB of vector data requiring a vector DB or SQLite extension (`sqlite-vec`)
- **Complexity**: requires an embedding pipeline, vector storage, and ANN index (HNSW/IVF)

### Recommendation

**Keep BM25. Add a hybrid reranker only when needed.**

The majority of Torvi's context queries are code-heavy: function names, variable names, file names, error messages — exact-token queries where BM25 is unbeatable. The recency bonus handles the short-query case.

**When to add embeddings**: If natural-language conceptual queries (`"how does auth work in this project?"`, `"what's the data model?"`) are a common user complaint, use a **hybrid pipeline**:

```
BM25 rank (fast)  →  top-20 candidates  →  embedding rerank (semantic)  →  top-10 inject
```

Embeddings only run on 20 pre-filtered candidates, keeping the extra latency to < 100 ms.

**Recommended stack if needed:**
- Model: `nomic-embed-text` via `ollama` (local, no API cost)
- Storage: `sqlite-vec` extension (zero extra infrastructure)
- Trigger: only rerank if BM25 top score < 1.0 (weak keyword match)

---

## Where Context Memory Can Be Used

### Currently Active

| Use case | File | Status |
|----------|------|--------|
| AI prompt context injection | `ai-response.function.ts` | ✅ Active — injects up to 10 relevant chunks into every message |
| Proactive context suggestion chips | `src/pages/app/index.tsx` | ✅ Active — chips shown below pill-bar toolbar when context switches to a new app/file; 30 s auto-dismiss; click pre-fills TextInput |
| Auto system-prompt switching | `src/hooks/useCompletion.ts` | ✅ Active — `resolveContextAwarePrompt()` checks `content_type` of most recent chunk against saved system-prompt names (keyword match) before each request |

### High-Value Additions

| Use case | Description | Implementation hint |
|----------|-------------|---------------------|
| **Smart conversation title** | Auto-name new conversations from active context | `getRecentContext(1, 2)` at conversation creation → use `window_title` |
| **"What am I looking at?" slash command** | Describe the current screen in one shot | Already captured — just inject recent context into a dedicated summarise prompt |
| **Meeting summaries** | Aggregate `meeting`-type chunks over last 60 min and summarise | Triggered manually or when user asks "summarise this meeting" |
| **Context export** | Export last N chunks as Markdown | Add export button to context-memory page |
| **Per-conversation context isolation** | Each conversation has its own context window | Add `conversation_id TEXT` column; filter in `getRecentContext` |

### Future / Advanced

| Use case | Description |
|----------|-------------|
| **Cross-session memory** | Summarise yesterday's context at session start (`"You were working on screen_reader.rs auth flow"`) |
| **Work pattern detection** | Detect recurring patterns from context history (`"Every morning: Linear + Slack + GitHub — brief you?"`) |
| **Integration connectors** | Pull from Google Docs API / Notion API / Linear API directly instead of UIAutomation screen-reading for canvas-rendered apps |

---

## Data Flow Example

```
User switches to VS Code (editing useCompletion.ts)
         │
         ▼
WinEvent EVENT_SYSTEM_FOREGROUND fires (< 1 ms)
         │
         ▼
300ms debounce — window finishes painting
         │
         ▼
Strategy 0: UIAutomation → workbench.parts.editor → Document → TextPattern
  → "function useCompletion() { const [tokens, setTokens] = ..."
  → up to 20,000 chars raw
         │
         ▼
privacy_filter.should_capture("Code") → allowed
privacy_filter.redact_sensitive() → no PII found
         │
         ▼
clean_captured_text():
  strip U+FFFC, drop "OUTLINE" / "TIMELINE" / shortcut tooltip lines
  → clean code text
         │
         ▼
SHA-256 hash → "a3f9..."
  WinEvent trigger → always continue (no hash skip)
         │
         ▼
classify_context("Code", "useCompletion.ts | torvi") → "code"
         │
         ▼
emit("context-captured", snapshot) → UI counter +1, Watching dot
         │
         ▼
context_db.save_snapshot():
  dedup: no matching hash in last 5 min
  sliding_window_chunks(text, 10_000, 1_000) → [chunk_0, ...]
  INSERT INTO context_chunks
         │
         ▼
emit("context-chunks-saved") → UI reloads chunk list
         │
         ▼
User types: "explain this hook"
         │
         ▼
buildContextAwareSystemPrompt():
  getRecentContext(20, 30) → 20 recent chunks
  tokenise corpus → IDF stats
  query tokens: ["explain", "hook", "use", "completion"]
  bm25Score per chunk + RECENCY_BONUS (captured < 5 min ago)
  filter score ≥ 0.5 → sort → per-app dedup (up to 3 per app) → cap at 10
  truncate each to 2,000 chars at line boundary
  inject as "## Current Screen Context"
         │
         ▼
api.rs → NVIDIA NIM / OpenRouter → streaming AI response
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|----------|
| UIAutomation instead of screenshots | No image tokens, no vision API cost, < 50 ms, natively skips password fields |
| 5-strategy screen reader fallback chain | No single UIAutomation strategy works for all apps; the chain handles native apps, browsers, and Electron IDEs without app-specific caller logic |
| Strategy 0 early-return for VS Code | VS Code's full accessibility tree includes sidebar, source control, NPM scripts — reading it drowns context with UI chrome. Targeting the editor pane directly gives clean code text. |
| RootWebArea hard-scope for browsers | Browser chrome is above RootWebArea in the accessibility tree. Hard-scoping ensures only page content is captured; hard return prevents fallback to root-window walk. |
| Direct `sqlx` pool for writes | `tauri-plugin-sql` IPC silently dropped writes; sqlx bypasses the JS↔IPC↔Rust boundary |
| WAL journal mode | Allows Rust write pool and JS read pool to coexist on the same SQLite file |
| 10,000-char / 1,000-overlap sliding window | 10k chars ≈ 2,500 tokens — holds a complete function + context. 10% overlap prevents BM25 from missing cross-boundary hits. |
| SHA-256 dedup at two levels | Rust: skip write if hash matches last 5 min. Timer trigger: skip re-capture if unchanged. WinEvent trigger: always re-capture to keep timestamps fresh. |
| `parse_window_title()` per-app title shaping | Raw title bar strings contain app name noise; structured titles make source attribution readable and reduce token waste. |
| BM25 with recency bonus | BM25 handles code identifier queries better than embeddings. Recency bonus ensures fresh screen activity is surfaced for short queries like "explain this". |
| `RAG_MAX_CHUNKS_PER_APP = 3` | Allows VS Code to contribute multiple code sections without monopolising the full injection budget. |
| 2,000-char line-boundary truncation | Caps token usage per chunk; never ends mid-identifier. Matches Rust chunk size so full chunks pass without secondary truncation. |
| `pruneOldContext()` on 1-hour setInterval | Once at startup + every hour; 24-hour retention keeps same-day context available without accumulating stale rows. |
| Non-fatal RAG injection | DB not ready? AI still responds with base system prompt. Context is enhancement, not a dependency. |
| Privacy filter before any storage | PII stripped in Rust memory, never written to disk. |
| Google Workspace emit instead of silent skip | Near-empty Docs captures now emit a `"google-docs-needs-screen-reader"` event that surfaces a contextual banner exactly when the user needs to act. |

---

## Bug Fixes

### Pause/Resume State Desync (`sessionStorage` → `localStorage`)

**Problem:** The pause intent flag `ctx_watcher_paused` was stored in `sessionStorage`. Tauri webviews (the main pill-bar window and the dashboard window) each have **separate** `sessionStorage` instances. Consequently:
- Pausing from the Sidebar or Context Memory page wrote to the **dashboard window's** sessionStorage.
- The 10-second watchdog in `main.tsx` read from the **main window's** sessionStorage — a completely different object.
- Result: watchdog never saw the pause flag and restarted the watcher 10 seconds after every pause.
- Additionally, closing and reopening the dashboard window cleared its sessionStorage, so the paused state was lost and the watcher auto-restarted on next open.

**Fix:** All three locations changed from `sessionStorage` to `localStorage` (shared across all webviews on the same origin):

| File | Change |
|---|---|
| `src/main.tsx` | Watchdog reads `localStorage.getItem("ctx_watcher_paused")` |
| `src/components/Sidebar.tsx` | `handlePause`/`handleResume` write `localStorage.setItem/removeItem` |
| `src/pages/context-memory/index.tsx` | Mount check + `handleTogglePause` read/write `localStorage` |

### Context Memory Page Not Reflecting External Pause

**Problem:** The Context Memory page read `get_watcher_status` only **once on mount**. If the watcher was paused from the Sidebar after mount, the page's `isPaused` / `isWatching` state was never updated — the header continued to show "Watching".

**Fix:** Added a 2-second polling `setInterval` in `context-memory/index.tsx` that calls `get_watcher_status` and syncs `isPaused` / `isWatching`. UI now updates within ≤ 2 s of any external status change.

### Active App Indicator Pushed Settings Icon Off-Screen

**Problem:** The `activeApp` indicator (pulsing dot + truncated app name, e.g. `● msedgeweb...`) in the pill-bar toolbar's right section consumed variable width, pushing the Settings icon beyond the 600 px window boundary when a response was loading.

**Fix:** Removed the `activeApp` state, `activeAppTimerRef`, its `setActiveApp` calls in the context-captured listener, and the JSX block from the toolbar. The `prevAppNameRef` used for suggestion chip logic was preserved. The right section now contains only `UsageTimer` + Settings icon.

---

## File Reference

| File | Role |
|------|------|
| `src-tauri/src/screen_reader.rs` | UIAutomation text extraction — 5-strategy fallback chain |
| `src-tauri/src/app_context.rs` | Background watcher loop, WinEvent hook + message pump, text cleaning, title parsing, content classification |
| `src-tauri/src/context_db.rs` | Direct sqlx SQLite write pool — chunking, dedup, schema migrations, 5 indexes |
| `src-tauri/src/privacy_filter.rs` | App block-list, PII redaction (cards, SSN, API keys, OTPs) |
| `src/lib/database/context-store.ts` | TypeScript read layer — `getRecentContext()`, `pruneOldContext()`, schema init |
| `src/lib/functions/ai-response.function.ts` | BM25 RAG injection — `buildContextAwareSystemPrompt()` |
| `src/pages/context-memory/index.tsx` | Context Memory dashboard — live feed, filter tabs, Google Docs nudge, pause/resume, 2 s watcher-status poll |
| `src/components/Sidebar.tsx` | Watcher status poll (3 s), pause/resume toggle; localStorage pause flag; conversation search + paginated load |
| `src/hooks/useCompletion.ts` | `resolveContextAwarePrompt()` — auto system-prompt switching by content type before each request |
| `src/main.tsx` | App startup: `initContextStore()`, `pruneOldContext()` on startup + hourly `setInterval`; watchdog reads `localStorage["ctx_watcher_paused"]` |
| `src/pages/app/index.tsx` | Pill bar: `context-captured` listener → `prevAppNameRef` → suggestion chips; `CONTEXT_SUGGESTIONS` map; 30 s auto-dismiss |
