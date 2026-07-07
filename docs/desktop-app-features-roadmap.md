# Torvi Desktop App — Complete Feature Roadmap

**Subtitle:** Privacy-first AI second brain for Windows & macOS — screen-aware context, local RAG, cloud sync, and optional integrations.

---

## Contents

1. [How to read this document](#how-to-read-this-document)
2. [Product vision](#product-vision-one-paragraph)
3. [Architecture map (target state)](#architecture-map-target-state)
4. [Application shell & platforms](#1-application-shell--platforms)
5. [UI modules](#2-ui-modules-user-facing-product-surfaces)
6. [Local capture & processing engine](#3-local-capture--processing-engine)
7. [Audio capture & speech](#4-audio-capture--speech)
8. [Screenshot capture](#5-screenshot-capture-supplement-to-screen-text)
9. [AI inference & RAG](#6-ai-inference--rag)
10. [Cloud backend & sync](#7-cloud-backend--sync)
11. [Third-party integrations](#8-third-party-integrations-additive-post-core-loop)
12. [Security, privacy & compliance](#9-security-privacy--compliance)
13. [Observability & operations](#10-observability--operations)
14. [Priority roadmap](#11-priority-roadmap-recommended-build-order)
15. [Definition of done — Torvi v1](#12-definition-of-done--torvi-v1-second-brain)
16. [Quick reference — shipped vs gap](#13-quick-reference--shipped-vs-gap-count)
17. [Related documents](#related-documents)

---

> **Purpose:** Single source of truth for what Torvi must include to reach Littlebird-class “second brain” parity, plus what is already shipped.  
> **Reference:** [`littlebird_architecture.md`](./littlebird_architecture.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md)  
> **Last updated:** July 2026

---

## How to read this document

| Status | Meaning |
|--------|---------|
| ✅ **Shipped** | Implemented and usable in the current codebase |
| 🟡 **Partial** | Scaffolded, incomplete, or works on limited platforms |
| 🔲 **Planned** | Required for full product vision; not built yet |
| ⏸️ **Deferred** | Nice-to-have; lower priority than core second-brain loop |

Each feature includes a short **acceptance criteria** block so engineering and QA can verify “done.”

---

## Product vision (one paragraph)

Torvi is a **privacy-first desktop AI assistant** that passively observes what the user is doing (screen text + optional audio), stores it locally, retrieves relevant context into every AI reply, and syncs account data to the cloud. It should work **without integrations on day one**, with optional connectors (Gmail, Calendar, Slack, etc.) added later.

---

## Architecture map (target state)

```
User (Windows / macOS)
        │
        ▼
┌───────────────────────────────────────┐
│  UI: Overlay · Chat · Context · Settings │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Local Capture: Screen · Audio · Privacy │
│  Chunker · Local DB · (optional) Embed  │
└───────────────────────────────────────┘
        │ encrypted sync (batched)
        ▼
┌───────────────────────────────────────┐
│  Cloud: Auth · Profiles · Usage · Sync  │
│  memory_items · (future) Vector search  │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  AI: Streaming LLM · RAG · ASR · Prompts │
└───────────────────────────────────────┘
```

---

## 1. Application shell & platforms

### 1.1 Desktop client (Windows)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Tauri 2 + React desktop app | ✅ Shipped | App installs, launches, updates via Tauri |
| Overlay window (Hummingbird-style) | ✅ Shipped | Always-on-top pill bar; expands for responses; global hotkeys |
| Dashboard window | ✅ Shipped | Secondary window for settings, chats, context memory |
| Auth gate window | ✅ Shipped | Sign-in gate; unlocks app after OAuth |
| Auto-update | ✅ Shipped | Updater plugin checks remote endpoint |
| Autostart on boot | ✅ Shipped | Toggle in settings |
| Content protection (stealth) | ✅ Shipped | Window hidden from screen capture where OS supports it |

### 1.2 Desktop client (macOS)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Tauri app runs on macOS | 🟡 Partial | Core app works; some stealth features macOS-specific |
| NSPanel / non-activating overlay | 🟡 Partial | Documented in ARCHITECTURE; verify on current branch |
| Screen context capture | 🔲 Planned | Accessibility API reader equivalent to Windows UIAutomation |
| System audio capture | ✅ Shipped | Core Audio path in `speaker/macos.rs` |

### 1.3 Mobile companion

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| iOS app | ⏸️ Deferred | Not in v1 desktop scope |
| Android app | ⏸️ Deferred | Not in v1 desktop scope |

### 1.4 System integration

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Global keyboard shortcuts | ✅ Shipped | Overlay toggle, focus input, dashboard, screenshot, audio, mic |
| Custom shortcut rebinding | ✅ Shipped | `/shortcuts` page + Rust validation |
| System tray / menu bar presence | 🔲 Planned | Quick pause capture, open dashboard, quit |
| Drag-to-move overlay | ✅ Shipped | `data-tauri-drag-region` handle |

---

## 2. UI modules (user-facing product surfaces)

### 2.1 Hummingbird overlay (primary surface)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Compact input bar | ✅ Shipped | Type question, Enter to send |
| Streaming response pane | ✅ Shipped | Markdown-rendered streamed tokens |
| Dynamic window height | ✅ Shipped | Collapsed pill → expanded on response |
| Image attachments (paste / file / screenshot) | ✅ Shipped | Up to 6 images per message |
| Keep-engaged conversation mode | ✅ Shipped | Toggle includes prior turns in prompt |
| Message history popover | ✅ Shipped | View thread in overlay |
| **Context indicator** (“watching Cursor · doc.md”) | ✅ Shipped | Slim strip below overlay pill; live updates from `context-captured` |
| **Source citations in responses** | 🟡 Partial | RAG still runs; citation cards hidden from chat UI |
| Quick actions: Insert / Copy / Open in Chat | 🟡 Partial | Copy exists; insert into other apps not built |

### 2.2 Chat module (dashboard)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Conversation list | ✅ Shipped | `/chats` with search and date grouping |
| Full conversation viewer | ✅ Shipped | `/chats/view/:id` |
| Streaming chat in dashboard | ✅ Shipped | Same AI pipeline as overlay |
| Export conversation as Markdown | ✅ Shipped | Download `.md` from list |
| Delete conversation | ✅ Shipped | With confirmation |
| Attach to overlay | 🟡 Partial | Cross-window attach via localStorage event |
| Model / role selector (no raw model IDs) | ✅ Shipped | Interview/meeting roles → model routing |
| **“Thinking / reading N sources” indicator** | ✅ Shipped | Overlay header + bubble show RAG search and source count |

### 2.3 Context Memory module

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Live capture feed | ✅ Shipped | `/context-memory` lists recent chunks |
| Filter by content type | ✅ Shipped | code, document, email, chat, meeting, etc. |
| Pause / resume watcher | ✅ Shipped | UI + `ctx_watcher_paused` localStorage flag |
| Clear all context data | ✅ Shipped | Wipes SQLite + stops watcher |
| Google Docs screen-reader nudge | ✅ Shipped | Banner when Docs canvas is inaccessible |
| Cursor / VS Code accessibility nudge | ✅ Shipped | Banner when editor text is too thin |
| **Per-app capture history timeline** | 🔲 Planned | Drill into one app’s captures over time |
| **User-defined excluded apps / domains** | 🔲 Planned | Settings UI + enforced in privacy filter |
| **Delete by time range** (1h / 24h / 7d / all) | 🔲 Planned | Matches Littlebird deletion scopes |

### 2.4 Meeting Notes module

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Dedicated Meeting Notes UI | 🔲 Planned | Live transcript pane + structured summary |
| Auto-detect meeting apps | 🔲 Planned | Zoom / Meet / Teams foreground + audio heuristic |
| Live scrolling transcript | 🟡 Partial | System audio → STT exists; no meeting-specific UI |
| Speaker diarization | 🔲 Planned | Labels per speaker in transcript |
| Structured output (summary, decisions, action items) | 🔲 Planned | LLM post-process on transcript |
| Link to calendar event | 🔲 Planned | Requires Calendar integration |
| Export to Notion / Docs / email | 🔲 Planned | Post-MVP |

### 2.5 Routines module (proactive digests)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Routine list + editor UI | 🔲 Planned | Schedule, prompt, source filters |
| Cron / scheduler (cloud) | 🔲 Planned | Fires per user timezone |
| Push digest to client | 🔲 Planned | Notification or in-app panel |
| Routine history | 🔲 Planned | Past outputs browsable |
| “Run now” button | 🔲 Planned | Manual trigger |

### 2.6 Settings & onboarding

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| General settings | ✅ Shipped | `/settings` |
| Screenshot settings | ✅ Shipped | `/screenshot` |
| Audio device selection | 🟡 Partial | Page exists; verify routed in sidebar |
| Response length / language | ✅ Shipped | `/responses` |
| Billing & plans | ✅ Shipped | `/billing` Starter / Plus / Pro |
| System prompts management | 🟡 Partial | Page exists; verify route in router |
| Onboarding (permissions + trust) | 🔲 Planned | Accessibility, mic, what we can/can’t see |
| Integration connections UI | 🔲 Planned | OAuth connect / revoke per service |
| Privacy: pause capture globally | 🟡 Partial | Context Memory pause; global toggle in settings |
| Theme + transparency | ✅ Shipped | Dark/light; overlay glass effect |

---

## 3. Local capture & processing engine

### 3.1 Screen observer

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Windows UIAutomation text read | ✅ Shipped | `screen_reader.rs` — no screenshots for text |
| Foreground window title + app name | ✅ Shipped | In every snapshot |
| Browser URL extraction | ✅ Shipped | Chrome, Edge, Firefox, Brave, etc. |
| VS Code / Cursor dedicated extraction | 🟡 Partial | view-line + TextPattern; needs a11y mode for full file |
| WinEvent on focus change | ✅ Shipped | Immediate capture on app switch |
| Periodic poll (same window) | ✅ Shipped | 2-second timer + stale re-emit |
| macOS Accessibility tree reader | 🔲 Planned | Parity with Windows |
| OCR fallback for canvas apps | ⏸️ Deferred | Google Docs / Figma; prefer a11y nudges first |

### 3.2 Privacy filter

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Block password managers & banking apps | ✅ Shipped | `privacy_filter.rs` blocklist |
| Block Torvi’s own windows | ✅ Shipped | Prevents circular capture |
| Skip incognito / private browsing | ✅ Shipped | Title heuristics |
| Redact credit cards, SSN, API keys, OTP | ✅ Shipped | Regex redaction |
| User blocklist (apps) | 🔲 Planned | Configurable in settings |
| User blocklist (domains) | 🔲 Planned | Configurable in settings |
| Pause when screen locked | 🔲 Planned | OS lock state detection |

### 3.3 Text extraction & cleaning

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Multi-strategy extraction (TextPattern, Document, tree walk) | ✅ Shipped | Ordered fallback chain |
| UI chrome stripping | ✅ Shipped | `clean_captured_text()` noise list |
| Content type classification | ✅ Shipped | email, code, document, chat, meeting, PM, generic |
| Window title parsing | ✅ Shipped | Human-readable titles per app |
| Language detection | 🔲 Planned | Tag chunks with `lang` for multilingual RAG |

### 3.4 Chunker

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Semantic splits by content type | ✅ Shipped | chat / email / code / document / generic |
| Sliding window for long generic text | ✅ Shipped | 600 chars, 100 overlap |
| parent_capture_id + chunk_index | ✅ Shipped | Sub-chunk lineage in SQLite |
| Min / max chunk size enforcement | ✅ Shipped | Drop tiny; split oversized |
| Deduplication by content hash | ✅ Shipped | SHA-256; skip identical captures |

### 3.5 Local storage

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| SQLite `context_chunks` table | ✅ Shipped | Rust sqlx writer + JS read path |
| WAL mode concurrent read/write | ✅ Shipped | `context_db.rs` |
| 24-hour rolling prune | ✅ Shipped | `pruneOldContext()` hourly |
| Chat history SQLite | ✅ Shipped | conversations + messages |
| System prompts SQLite | ✅ Shipped | CRUD + active prompt |
| **SQLCipher / encrypted local DB** | 🔲 Planned | AES-256 at rest on disk |
| **Upload queue for cloud sync** | 🟡 Partial | `memory_sync_state` tracks pending/synced/failed chunks |

### 3.6 Local embeddings (optional tier)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| On-device embedding model (e.g. MiniLM) | 🔲 Planned | Embed each chunk locally |
| Local vector search | 🔲 Planned | Semantic recall offline |
| Hybrid BM25 + vector ranking | 🔲 Planned | Better retrieval than keyword-only |

---

## 4. Audio capture & speech

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| System audio loopback (Windows WASAPI) | ✅ Shipped | `speaker/windows.rs` |
| System audio (macOS Core Audio) | ✅ Shipped | Process tap excluding self |
| System audio (Linux PulseAudio) | ✅ Shipped | Monitor source |
| Rust VAD engine | ✅ Shipped | Noise gate, speech/silence state machine |
| VAD configuration UI | ✅ Shipped | Sensitivity, silence duration, etc. |
| Continuous recording mode | ✅ Shipped | Manual start/stop |
| Microphone VAD + STT | ✅ Shipped | Auto-submit transcription to AI |
| AssemblyAI real-time streaming STT | ✅ Shipped | `streaming_stt.rs` WebSocket |
| Multiple batch STT providers | ✅ Shipped | Whisper, Groq, Deepgram, etc. |
| System audio quick actions | ✅ Shipped | Summarize, translate, action items |
| Context templates for audio | ✅ Shipped | Meeting assistant, interview helper, etc. |
| Audio visualizer | ✅ Shipped | Canvas frequency display |
| Meeting auto-start detection | 🔲 Planned | See §2.4 |
| Speaker diarization | 🔲 Planned | See §2.4 |
| On-device Whisper (privacy mode) | ⏸️ Deferred | Optional offline STT |

---

## 5. Screenshot capture (supplement to screen text)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Multi-monitor capture | ✅ Shipped | `capture.rs` + xcap |
| Region selection overlay | ✅ Shipped | Per-monitor transparent overlay |
| Attach screenshot to AI message | ✅ Shipped | Manual + shortcut triggered |
| Auto-capture on send | 🟡 Partial | Mode exists in settings; verify current default |
| Content protection on overlay windows | ✅ Shipped | Capture overlays stealth-safe |

---

## 6. AI inference & RAG

### 6.1 LLM

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Streaming SSE responses | ✅ Shipped | Rust + frontend async generator |
| OpenRouter + NVIDIA NIM routing | ✅ Shipped | `api.rs` model prefix routing |
| Custom cURL AI providers | ✅ Shipped | Dev/provider configuration |
| Response length injection | ✅ Shipped | Short / medium / auto |
| Response language injection | 🟡 Partial | Constants exist; verify wired to pipeline |
| Abort in-flight requests | ✅ Shipped | Per-request AbortController |
| Usage limit enforcement | ✅ Shipped | Plan limits before AI calls |
| Vision / image inputs | ✅ Shipped | Base64 image in provider templates |
| Locked system prefix (security) | ✅ Shipped | Rust-enforced instruction integrity |
| Prompt template system (config-driven) | 🔲 Planned | YAML/JSON templates per use case |
| Writing style learning | ⏸️ Deferred | From user’s captured writing |

### 6.2 RAG (retrieval-augmented generation)

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Inject screen context into system prompt | ✅ Shipped | `buildContextAwarePrompt()` |
| **Source citations in chat UI** | ✅ Shipped | `SourceCitations` + `ContextSourceCitation` on messages |
| BM25 keyword ranking over local chunks | ✅ Shipped | Recency bonus + min score filter |
| 24h retrieval window | ✅ Shipped | `getRecentContext()` |
| **Vector semantic search** | 🔲 Planned | pgvector or Pinecone |
| **Cross-encoder re-ranking** | ⏸️ Deferred | After vector search |
| **Citation metadata returned to UI** | 🔲 Planned | Chunk IDs → source cards in chat |
| Cloud-side RAG orchestration | ⏸️ Deferred | Local-first is fine for v1 |

### 6.3 System prompts

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Multiple saved prompts | ✅ Shipped | SQLite CRUD |
| Active prompt selection | ✅ Shipped | AppContext + localStorage |
| AI-assisted prompt generation | 🟡 Partial | Torvi API command if licensed |
| Sync prompts to cloud | 🟡 Partial | Appwrite sync; Supabase WIP |

---

## 7. Cloud backend & sync

### 7.1 Authentication

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Google OAuth (Appwrite) | ✅ Shipped | Default backend |
| Google OAuth (Supabase PKCE) | 🟡 Partial | Code complete; requires valid project URL + redirect URLs |
| Legacy JWT auth | ✅ Shipped | Landing page token path |
| Local OAuth callback server | ✅ Shipped | `auth.rs` TCP listener on random port |
| Dev auth bypass | ✅ Shipped | `VITE_SKIP_AUTH_CHECK=true` (dev only) |
| Session refresh + silent re-verify | ✅ Shipped | Gate fast-path + background check |

### 7.2 User data & billing

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| User profiles (plan, name, email) | ✅ Shipped | Appwrite; Supabase `profiles` schema ready |
| Usage counters (AI responses, listening seconds) | ✅ Shipped | Server-side writes via Rust `usage.rs` |
| Billing page + plan tiers | ✅ Shipped | Starter / Plus / Pro |
| Rate limit tamper protection | ✅ Shipped | Users cannot PATCH own usage |

### 7.3 Data sync

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Sync conversations metadata | 🟡 Partial | Appwrite modules; not Supabase production |
| Sync system prompts | 🟡 Partial | Appwrite |
| Sync user settings | 🟡 Partial | Appwrite |
| Sync screenshots to cloud storage | 🟡 Partial | Appwrite bucket |
| **Sync context chunks → `memory_items`** | 🟡 Partial | Opt-in batch upload + AES-GCM encryption + local queue |
| **Upload queue for cloud sync** | 🟡 Partial | `memory_sync_state` SQLite table + retry |
| **Supabase cutover** (`VITE_BACKEND_PROVIDER=supabase`) | 🟡 Partial | Abstraction layer done; migration in progress |
| Backend provider abstraction | ✅ Shipped | `src/lib/backend/` |

### 7.4 Cloud data stores (target)

| Store | Status | Purpose |
|-------|--------|---------|
| `profiles` | 🟡 Schema + partial client | User account |
| `usage` | 🟡 Schema + partial client | Plan limits |
| `settings` | 🟡 Schema + partial client | Preferences |
| `memory_items` | 🟡 Schema + dev test only | Long-term context / second brain |
| `memory_sources` | 🟡 Schema only | Provenance links per memory |
| Vector index | 🔲 Planned | Semantic search at scale |
| Transcript store | 🔲 Planned | Meeting audio + text |

---

## 8. Third-party integrations (additive, post core loop)

> Integrations are **optional enrichments**. Screen capture must deliver value with zero connectors connected.

### 8.1 Phase 1 integrations (highest value)

| Integration | Status | Data to ingest |
|-------------|--------|----------------|
| Google Calendar | 🔲 Planned | Events, attendees, descriptions |
| Gmail (read-only) | 🔲 Planned | Threads, subjects, bodies |
| Google Drive (read-only) | 🔲 Planned | Doc text where API allows |

### 8.2 Phase 2 integrations

| Integration | Status | Data to ingest |
|-------------|--------|----------------|
| Slack | 🔲 Planned | Channels user joined, DMs |
| Notion | 🔲 Planned | Pages, databases |
| Linear | 🔲 Planned | Issues, comments |
| GitHub | 🔲 Planned | PRs, issues, reviews |

### 8.3 Integration platform requirements

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| OAuth connect / revoke UI | 🔲 Planned | Per integration in settings |
| Token storage (encrypted) | 🔲 Planned | Vault or Supabase secrets — not plaintext |
| Delta sync workers | 🔲 Planned | Cursor-based; no full re-fetch |
| Canonical chunk format | 🔲 Planned | Same schema as screen captures |
| Revoke → delete integration-sourced data | 🔲 Planned | GDPR-style cleanup |
| Deep write actions (with confirmation) | ⏸️ Deferred | Create calendar event, send email, etc. |

---

## 9. Security, privacy & compliance

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| TLS 1.3 for all cloud traffic | ✅ Shipped | HTTPS clients |
| HTML sanitization in markdown | ✅ Shipped | rehype-sanitize |
| XSS / prompt injection mitigations | 🟡 Partial | Security audits documented |
| Content protection overlay | ✅ Shipped | Anti screen-recording |
| No capture of password fields | ✅ Shipped | UIAutomation skip |
| Signed app updates | 🟡 Partial | Updater pubkey must be configured |
| User data export | 🔲 Planned | Download all context + chats |
| Granular deletion (1h / 24h / 7d / all) | 🔲 Planned | User-initiated |
| Account deletion cascade | 🔲 Planned | Cloud + local wipe |
| SOC 2 / GDPR program | ⏸️ Deferred | Business/compliance track |
| Audit log of access/deletion | 🔲 Planned | Compliance-ready |

---

## 10. Observability & operations

| Feature | Status | Acceptance criteria |
|---------|--------|-------------------|
| Structured Rust logging | ✅ Shipped | tauri-plugin-log |
| Minimal product analytics | 🟡 Partial | PostHog events (limited) |
| Error tracking (Sentry) | 🔲 Planned | Client + Rust |
| Distributed tracing | ⏸️ Deferred | Post-scale |
| Cost / token usage dashboard | 🟡 Partial | Usage row on dashboard |

---

## 11. Priority roadmap (recommended build order)

### Phase A — Core loop must work reliably (now)

1. **Context capture quality** — Cursor/VS Code full text (a11y mode + view-line extraction)  
2. **Supabase auth production-ready** — valid project, redirect URLs, migration applied  
3. ~~**Source citations in chat**~~ — ✅ shipped  
4. ~~**Context indicator in overlay**~~ — ✅ shipped  
5. ~~**RAG status indicator**~~ — ✅ shipped (“Reading screen” → “N sources”)  

### Phase B — Cloud second brain

6. ~~**Upload local chunks → `memory_items`**~~ — 🟡 partial (opt-in sync, encryption, queue; needs Supabase URL)
7. **User exclusion lists** — apps + domains in settings  
8. **Granular data deletion** — time-scoped purge  
9. **Complete Supabase cutover** — retire Appwrite or dual-run with flag  

### Phase C — Differentiation

10. **Local or cloud embeddings + vector search** — replace/supplement BM25  
11. **Meeting Notes module** — detection + diarization + structured summary  
12. **macOS screen observer** — platform parity  

### Phase D — Expansion

13. **Routines** — scheduled proactive digests  
14. **First integration** — Google Calendar or Gmail  
15. **SQLCipher local DB** — encrypted at rest  
16. **System tray + global pause**  

---

## 12. Definition of done — “Torvi v1 second brain”

Torvi v1 is complete when a user can:

1. Install on **Windows**, sign in, and use the **overlay** without configuration.  
2. Work in **browser, IDE, and docs** while Torvi **captures meaningful text** (not just headings).  
3. Ask a question in the overlay and receive an answer **grounded in recent screen context**.  
4. See **which sources** were used (citations).  
5. **Pause, review, and delete** captured context from the Context Memory page.  
6. Have **account, usage, and settings** persist via **Supabase** (or chosen backend).  
7. Optionally use **system audio** for meeting-style assistance (transcript → AI).  

Everything in Phases C–D is **v1.1+**, not blocking v1.

---

## 13. Quick reference — shipped vs gap count

| Layer | Shipped | Partial | Planned |
|-------|---------|---------|---------|
| UI modules | 5 | 4 | 6 |
| Local capture | 12 | 3 | 8 |
| Audio | 10 | 1 | 3 |
| AI / RAG | 8 | 2 | 5 |
| Cloud / sync | 4 | 8 | 6 |
| Integrations | 0 | 0 | 15+ |
| Security | 5 | 3 | 5 |

---

## Related documents

- [`littlebird_architecture.md`](./littlebird_architecture.md) — reference architecture  
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Torvi implementation architecture (Context Memory v0.5+)  
- [`supabase-schema-plan.md`](./supabase-schema-plan.md) — cloud schema for `memory_items`  
- [`supabase-migration-report.md`](./supabase-migration-report.md) — Appwrite → Supabase migration status  
- [`README.md`](../README.md) — full shipped feature catalog (may include routes not in current router)

---

*Maintainers: update the **Status** column when features ship. Link PRs or issues in acceptance criteria when available.*
