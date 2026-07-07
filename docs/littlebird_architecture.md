# Littlebird AI Desktop App — Full Architecture Reference

> **Document scope:** This reference covers the complete architecture of an AI-powered desktop assistant modelled on Littlebird (littlebird.ai). It is structured as a deep-dive across five layers: UI, Local Capture Engine, Cloud Backend, AI Inference, and Third-Party Integrations. Each section includes component design, data flows, technology choices, and engineering decisions relevant for design and development.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [UI Layer](#2-ui-layer)
3. [Local Capture Engine](#3-local-capture-engine)
4. [Cloud Backend](#4-cloud-backend)
5. [AI Inference Layer](#5-ai-inference-layer)
6. [Third-Party Integrations](#6-third-party-integrations)
7. [Security, Privacy & Compliance](#7-security-privacy--compliance)
8. [Cross-Cutting Concerns](#8-cross-cutting-concerns)
9. [Technology Stack Summary](#9-technology-stack-summary)

---

## 1. System Overview

Littlebird is a **context-aware AI desktop assistant**. Its core architectural innovation is passive, continuous observation of what the user is doing — without screen recording or manual copy-paste — combined with cloud-based semantic memory and LLM-powered generation.

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     USER DEVICES                         │
│              Mac · Windows · iOS · Android               │
└──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌────────────────────┐      ┌─────────────────────────┐
│    Desktop Client  │      │    Mobile Companion App  │
│  (Electron/Swift)  │      │  (React Native / Swift) │
└────────────────────┘      └─────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│           LOCAL CAPTURE & PROCESSING ENGINE              │
│  Screen Observer · Audio Capture · Privacy Filter        │
│  Text Extractor · Chunker · Local Embeddings · Cache     │
└──────────────────────────────────────────────────────────┘
         │  Encrypted TLS 1.3 Upload (batched)
         ▼
┌──────────────────────────────────────────────────────────┐
│                 CLOUD BACKEND (AWS)                      │
│  API Gateway · Auth · Context Ingestion · Vector Search  │
│  RAG Query Engine · Routine Scheduler · User Profile     │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│                  AI INFERENCE LAYER                      │
│       LLM (GPT-4o / Claude) · ASR (Whisper)             │
│       Prompt Builder · Embedding Models                  │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│          THIRD-PARTY INTEGRATIONS (90+)                  │
│  Google Workspace · Notion · Linear · Slack · CRM tools  │
└──────────────────────────────────────────────────────────┘
```

### Core Design Principles

- **Zero-setup context capture:** The app works immediately on install — no integrations, no manual tagging.
- **Privacy by design:** The app cannot see minimized apps, private browser windows, or password fields.
- **Hybrid local + cloud:** Sensitive preprocessing happens on-device; heavy AI inference runs in the cloud.
- **User-controlled data:** Users can pause capture or delete all data (entire history or rolling windows like "last hour").
- **Additive integrations:** Third-party connectors enrich context but are never required.

---

## 2. UI Layer

The UI layer is the user-facing shell of the desktop application. It surfaces four primary product modules, each targeting a distinct use case.

### 2.1 Application Shell

The app ships as a **system tray / menu bar application** — always running in the background, low friction to invoke.

**Technology choices:**
- **macOS:** Electron (cross-platform) or native SwiftUI/AppKit. Native preferred for performance and OS API access (Accessibility API, audio capture, system events).
- **Windows:** Electron or Tauri (Rust-backed). Windows beta status suggests Electron for faster cross-platform shipping.
- **Mobile:** React Native or SwiftUI (iOS) / Jetpack Compose (Android) for the companion app.

**Shell responsibilities:**
- System tray icon + menu (quick access, pause capture, open main window)
- Global hotkey registration (Hummingbird overlay trigger)
- Window lifecycle management (main window, overlay window, onboarding)
- Auto-update mechanism (Squirrel / Sparkle)
- Local settings persistence (user preferences, integration credentials, capture rules)

---

### 2.2 Chat Module

The Chat module is the primary interaction surface — an AI chat interface grounded in the user's captured context.

**What it does:**
- Accepts natural language queries
- Streams AI responses (token-by-token via SSE or WebSocket)
- Cites sources (e.g., "From your Monday standup · Slack #launch-prep · roadmap.gdoc")
- Supports content generation (emails, docs, summaries, reports)
- Maintains session history (previous conversations accessible)

**UI component breakdown:**

```
ChatWindow
├── ConversationList        (sidebar: past sessions, search)
├── MessageThread           (scrollable message history)
│   ├── UserMessage
│   ├── AssistantMessage
│   │   ├── StreamingText   (live token rendering)
│   │   ├── SourceCitations (linked source cards)
│   │   └── CopyActions     (copy, export, insert)
│   └── ThinkingIndicator   (reading N sources…)
├── InputBar
│   ├── PromptTextArea      (multiline, expand on type)
│   ├── AttachmentButton    (manual file attach)
│   └── SendButton
└── ModelSelector           (optional: choose underlying LLM)
```

**Key engineering considerations:**
- Streaming response rendering: Use a chunked SSE consumer that appends tokens to a live string buffer and re-renders efficiently (avoid full re-render on each token).
- Source citation rendering: Each cited source is a clickable card that deep-links to the original app/document.
- Context awareness indicator: Show the user what sources were consulted per response (trust signal).
- Input history: Up-arrow to recall previous prompts (similar to terminal history).

---

### 2.3 Meeting Notes Module

The Meeting Notes module detects active meetings, transcribes audio in real time, and produces structured summaries.

**What it does:**
- Auto-detects when a meeting starts (Zoom, Google Meet, Teams, Webex window becomes active + audio detected)
- Transcribes speech to text in real time (speaker-diarized)
- Generates structured output: summary, key decisions, action items, open questions
- Links meeting notes to calendar events (if Google Calendar / Outlook integrated)
- Allows manual correction and annotation

**UI component breakdown:**

```
MeetingNotesWindow
├── ActiveMeetingBanner     (live "Recording" indicator, stop button)
├── LiveTranscriptPane      (real-time scrolling text, speaker labels)
├── NotesSummaryPane        (AI-generated structured notes)
│   ├── MeetingSummary
│   ├── DecisionsList
│   ├── ActionItemsList     (assignee, due date parsed from transcript)
│   └── OpenQuestionsList
├── MeetingHistory          (past meetings, searchable)
└── ExportActions           (copy, send to Notion/Docs, email)
```

**Key engineering considerations:**
- Speaker diarization: The ASR model must separate speakers. Whisper large-v3 supports diarization; commercial APIs (Deepgram, AssemblyAI) offer it natively.
- Real-time vs. batch transcription: Real-time transcription (streaming ASR) requires WebSocket connection to ASR service. Alternatively, buffer 10-30 second audio chunks and send sequentially.
- Meeting detection heuristic: Check if a known conferencing app (Zoom, Meet, Teams) is the foreground window AND system audio input is active.
- Privacy: Allow users to exclude specific apps from audio capture.

---

### 2.4 Routines Module

Routines are scheduled, proactive AI digests — summaries and insights delivered on the user's schedule.

**What it does:**
- User defines a routine: "Every morning at 8:30 AM, give me a summary of what I worked on yesterday and what's on my calendar today."
- The backend job executes on schedule, retrieves relevant context, generates the digest, and pushes it to the client.
- Delivered as a notification or opens automatically in the Routines panel.

**UI component breakdown:**

```
RoutinesWindow
├── RoutinesList            (all configured routines)
├── RoutineCard
│   ├── Title + Schedule
│   ├── LastRunOutput       (the AI-generated digest)
│   ├── RunNowButton
│   └── EditButton
├── RoutineEditor
│   ├── SchedulePicker      (time, frequency, days)
│   ├── PromptEditor        (what should this routine summarize?)
│   └── SourceSelector      (which apps/topics to include)
└── RoutineHistory          (past outputs)
```

---

### 2.5 Hummingbird Overlay

Hummingbird is a keyboard-triggered floating overlay that appears on top of whatever the user is working on, enabling in-context AI assistance without switching windows.

**What it does:**
- Triggered by a global hotkey (e.g., `Cmd+Shift+Space`)
- Renders as a floating, translucent window (always on top, system-level overlay)
- Has access to the current foreground window content (what Littlebird can already see)
- User asks a question; answer appears inline in the overlay
- Dismissed by pressing Escape or clicking away

**UI component breakdown:**

```
HummingbirdOverlay          (always-on-top, translucent window)
├── MiniInputBar            (focused on open, placeholder: "Ask Littlebird…")
├── MiniResponsePane        (compact streaming response)
├── ContextIndicator        (shows what app's context is loaded)
└── QuickActions            (Insert, Copy, Open in Chat)
```

**Key engineering considerations:**
- On macOS: Use `NSPanel` with `NSWindowLevel.floating` and `NSVisualEffectView` for translucency. Register a global hotkey via `NSEvent.addGlobalMonitorForEvents`.
- On Windows: Use a transparent layered window (`WS_EX_LAYERED`, `WS_EX_TOPMOST`). Register the hotkey via `RegisterHotKey` Win32 API.
- The overlay must capture the current window's context snapshot at the moment it's invoked (not rely on the background capture queue), so there's no latency between "open" and "context available."

---

### 2.6 Onboarding & Settings

**Onboarding flow:**
1. Install → request accessibility permissions (macOS Accessibility API) and microphone permission
2. Show what Littlebird can/cannot see (trust-building)
3. Optional: connect integrations
4. First context collection begins immediately

**Settings panels:**
- Privacy: Pause capture toggle, excluded apps list, excluded browser domains, data deletion controls
- Integrations: OAuth connection management for all 90+ services
- Hummingbird: Hotkey configuration, overlay appearance
- Routines: Create/edit/delete scheduled digests
- Account: Subscription, billing, export data, delete account

---

## 3. Local Capture Engine

The local capture engine is the most technically complex and architecturally distinctive component of the system. It runs as a background process on the user's machine and continuously observes, filters, and preprocesses context.

### 3.1 Screen Observer

The screen observer reads the content of the user's active window in real time — **not** via screenshot/OCR, but via the OS accessibility APIs that expose the UI element tree as structured text.

**macOS — Accessibility API:**
```swift
// Get the frontmost application
let systemWideElement = AXUIElementCreateSystemWide()
var focusedApp: CFTypeRef?
AXUIElementCopyAttributeValue(systemWideElement, kAXFocusedApplicationAttribute, &focusedApp)

// Traverse the accessibility tree
func extractText(from element: AXUIElement) -> String {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
    // Recursively traverse children...
}
```

**Windows — UIAutomation:**
```csharp
var automation = new CUIAutomation();
var desktop = automation.GetRootElement();
var condition = automation.CreatePropertyCondition(
    UIA_PropertyIds.UIA_IsContentElementPropertyId, true);
// Walk the automation tree and extract ValuePattern / TextPattern
```

**What the screen observer captures:**
- Active window title and application name
- All visible text content (document body, emails, Slack messages, browser content)
- URL of the active browser tab (for context labeling)
- Timestamps and app metadata

**What it intentionally does NOT capture:**
- Minimized or background windows
- Private/Incognito browser tabs (flagged by the browser's accessibility metadata)
- Password fields (accessibility API marks these as `isPasswordField: true`)
- User-excluded apps (configurable allowlist/blocklist)

**Polling strategy:**
The observer uses a combination of event-driven and polling approaches:
- OS focus change events trigger immediate captures (user switched apps or windows)
- A periodic timer (every 3–5 seconds) captures the active window for slowly-changing content (reading a document)
- Diff detection: if the extracted text is >90% similar to the last capture, skip storing it (deduplication)

---

### 3.2 Audio Capture & Meeting Detection

The audio subsystem captures system audio and microphone input during meetings.

**Meeting detection heuristic:**
```
if (foreground_app in KNOWN_MEETING_APPS) AND (mic_input_level > threshold):
    start_meeting_capture()

KNOWN_MEETING_APPS = ["zoom.us", "Google Meet", "Microsoft Teams", 
                       "Webex", "Slack", "Discord", "Around"]
```

**Audio pipeline:**
```
Mic + System Audio
       │
       ▼
   Audio Mixer (combines streams)
       │
       ▼
   VAD (Voice Activity Detection)   ← suppress silence, reduce data
       │
       ▼
   Audio Chunker (10–30s segments)
       │
       ▼
   Compressed audio buffer (Opus/FLAC)
       │
       ├──► Local ASR (lightweight, for real-time display)
       │
       └──► Upload queue (for cloud ASR with diarization)
```

**Technology:**
- macOS: CoreAudio `AVAudioEngine` for capture, `AVAudioSession` for routing
- Windows: WASAPI (Windows Audio Session API) for system audio capture
- VAD: WebRTC VAD (open-source, runs locally) or Silero VAD

---

### 3.3 Privacy Filter

The privacy filter sits between the raw capture and any storage or processing pipeline. It is a rule-based + heuristic system.

**Filter rules:**
```
BLOCK if:
  - element.isPasswordField == true
  - window.isPrivateBrowsing == true
  - app in user.excludedApps
  - domain in user.excludedDomains
  - capture is paused (user toggled)
  - screen is locked

REDACT if:
  - text matches credit_card_regex
  - text matches SSN_regex
  - text matches email_password_pattern
```

**Implementation note:** The privacy filter runs before text extraction — meaning raw UI element data is never stored or transmitted for filtered content. This is a hard guarantee in the architecture.

---

### 3.4 Text Extraction & Preprocessing

Once the privacy filter passes content, the text extraction pipeline processes it.

**Pipeline stages:**

1. **Raw extraction:** Pull text strings from UI element tree or DOM
2. **Cleaning:** Strip HTML tags, normalize whitespace, remove boilerplate (nav menus, footers, UI chrome)
3. **Language detection:** Identify language for multilingual support
4. **Metadata tagging:** Attach app name, window title, URL, timestamp, content type (email / document / chat / browser)
5. **Content classification:** Classify the content type (email thread, Slack message, Google Doc paragraph, Jira ticket, etc.)

---

### 3.5 Chunker

The chunker segments extracted text into semantically meaningful units for storage and retrieval.

**Chunking strategy:**
- **Semantic chunking** (preferred): Split on natural boundaries — paragraphs, sentences, message boundaries in chat apps
- **Sliding window fallback:** For long documents with no clear boundaries, use 512-token chunks with 128-token overlap
- **Special-case parsers:** Email thread → split by message; Slack channel → split by message; Google Doc → split by heading section

**Why chunking matters:** The chunk is the unit of retrieval in RAG. Too large = noisy, irrelevant context injected into prompts. Too small = missing the surrounding context needed to understand a statement.

**Metadata attached to each chunk:**
```json
{
  "chunk_id": "uuid",
  "user_id": "uuid",
  "content": "The launch date was moved to May 12...",
  "source_app": "Slack",
  "source_context": "#launch-prep",
  "timestamp": "2026-05-05T11:04:00Z",
  "content_type": "chat_message",
  "url": null,
  "language": "en",
  "embedding_model": "text-embedding-3-small"
}
```

---

### 3.6 Local Embedding Model

A lightweight embedding model runs on-device to generate vector representations of chunks before upload. This serves two purposes:

1. **Local semantic search:** Fast, offline recall without hitting the cloud
2. **Bandwidth efficiency:** Embeddings can be uploaded alongside chunks, avoiding a second round-trip to the cloud embedding API

**Technology options:**
- `all-MiniLM-L6-v2` (384 dimensions, 22MB, very fast on CPU)
- `nomic-embed-text` (768 dimensions, runs via llama.cpp)
- Apple Neural Engine acceleration on M-series Macs via Core ML conversion

---

### 3.7 Local Cache & Upload Queue

Before upload, chunks and embeddings are held in a local encrypted store.

**Technology:** SQLite with SQLCipher (AES-256 encryption at rest on disk)

**Schema (simplified):**
```sql
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding BLOB,            -- serialized float32 array
  metadata JSON,
  captured_at DATETIME,
  uploaded_at DATETIME,      -- NULL if pending upload
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE upload_queue (
  chunk_id TEXT REFERENCES chunks(id),
  retry_count INTEGER DEFAULT 0,
  next_retry_at DATETIME
);
```

**Upload strategy:**
- Batch upload every 30 seconds (configurable)
- Exponential backoff on failure (offline resilience)
- Compress payload (gzip) before transmission
- Background thread, never blocks UI

---

## 4. Cloud Backend

The cloud backend is a set of microservices hosted on AWS. It handles context ingestion, semantic search, query orchestration, and routine delivery.

### 4.1 Infrastructure Overview

```
                         ┌─────────────────┐
                         │   API Gateway    │
                         │  (AWS API GW /   │
                         │   Kong / Nginx)  │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │ Context Ingestion│ │  Query Engine    │ │ Routine Scheduler│
   │    Service       │ │   (RAG Service)  │ │    Service       │
   └──────────────────┘ └──────────────────┘ └──────────────────┘
              │                   │                   │
              ▼                   ▼                   │
   ┌──────────────────┐ ┌──────────────────┐          │
   │  Context Store   │ │   Vector DB      │          │
   │  (PostgreSQL /   │ │ (Pinecone /      │          ▼
   │   DynamoDB)      │ │  pgvector)       │  ┌──────────────────┐
   └──────────────────┘ └──────────────────┘  │  Job Queue       │
                                              │  (SQS / BullMQ)  │
   ┌──────────────────┐ ┌──────────────────┐  └──────────────────┘
   │  User Profile DB │ │ Transcript Store │
   │  (PostgreSQL)    │ │  (S3 + RDS)      │
   └──────────────────┘ └──────────────────┘
```

---

### 4.2 API Gateway & Auth Service

The API gateway is the single entry point for all client traffic.

**Responsibilities:**
- TLS termination
- JWT validation (access tokens issued at login)
- Rate limiting (per user, per endpoint)
- Request routing to downstream microservices
- WebSocket upgrade handling (for streaming responses)

**Auth flow:**
```
Client → POST /auth/login (email + password OR OAuth SSO)
       ← { access_token (15min), refresh_token (30 days) }

Client → GET /api/chat (Authorization: Bearer <access_token>)
       → API Gateway validates JWT
       → Routes to RAG Query Engine
```

**Technology:** AWS API Gateway + Lambda authorizer, or self-hosted Kong/Nginx on ECS.

---

### 4.3 Context Ingestion Service

Receives batched chunks from desktop clients, deduplicates, enriches, and stores them.

**Ingestion pipeline:**
```
POST /ingest (batch of chunks + embeddings)
       │
       ▼
1. Authenticate user (JWT)
2. Validate payload schema
3. Deduplication check (hash of content against recent chunks for this user)
4. Enrich metadata (server-side timestamp normalization, timezone handling)
5. Store chunk in Context Store (PostgreSQL)
6. Store embedding in Vector DB (Pinecone / pgvector)
7. Update upload_queue status → mark as uploaded
8. Trigger re-indexing if needed
```

**Deduplication strategy:**
- Content hash (`SHA-256(content + source_app + timestamp_bucket)`) stored in a Redis set per user
- `timestamp_bucket` = rounded to nearest 5 minutes (prevents duplicate captures of slowly-changing content)
- TTL on Redis dedup keys: 7 days

---

### 4.4 Vector Search Service

Enables semantic retrieval: "find chunks most relevant to this query."

**Architecture:**
```
Query text
    │
    ▼
Embedding API (cloud) → query vector (1536 dims for OpenAI)
    │
    ▼
Vector DB query (Pinecone / pgvector ANN index)
    │  filter: user_id = X, timestamp > (now - window)
    ▼
Top-K similar chunks (default K=20, re-ranked to K=5)
    │
    ▼
Fetch full chunk content from Context Store (by chunk_id)
    │
    ▼
Return ranked chunk list to Query Engine
```

**Vector DB options:**

| Option | Pros | Cons |
|--------|------|------|
| Pinecone | Managed, fast, scales easily | External vendor, cost |
| pgvector (PostgreSQL ext.) | Same DB as context store, simpler infra | Slower ANN at scale |
| Weaviate | Open source, rich filtering | Self-managed infra |
| Qdrant | Fast, open source, Rust-based | Newer ecosystem |

**Recommended:** pgvector for early stage (simpler), migrate to Pinecone or Qdrant at scale.

**Re-ranking:** After ANN retrieval, a cross-encoder re-ranker (e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2`) scores each chunk against the query more precisely. This improves precision significantly at low additional cost.

---

### 4.5 Query Engine (RAG Orchestration)

The query engine is the brain of the chat feature. It orchestrates retrieval, prompt assembly, and LLM invocation.

**Full RAG pipeline:**
```
User query: "What did we decide about the launch date?"
    │
    ▼
1. QUERY ANALYSIS
   - Intent classification (recall / generate / search)
   - Entity extraction ("launch date")
   - Time range inference ("recent" → last 30 days)
   - Source hints (if user mentions "the Slack thread" → filter by source_app=Slack)

2. RETRIEVAL
   - Generate query embedding
   - Vector search → top 20 candidate chunks
   - Metadata filter (user_id, time range, source app)
   - Re-rank → top 5 chunks
   - Fetch full chunk content

3. PROMPT ASSEMBLY
   System prompt:
     "You are Littlebird, a personal AI assistant. Answer using only the 
      provided context. Cite sources by name. Be concise."

   Context block:
     [Source: Slack #launch-prep, 2026-05-05 11:04]
     "Priya flagged the date slip. The new target is May 12."

     [Source: roadmap.gdoc, page 2]
     "Target launch: May 5, 2026"

   User query: "What did we decide about the launch date?"

4. LLM INVOCATION
   - Stream response tokens back to client via SSE
   - Parse source references from response for citation cards

5. RESPONSE POST-PROCESSING
   - Extract cited sources → build citation metadata
   - Log conversation turn to session store
   - Update user activity signals (for personalization)
```

---

### 4.6 Routine Scheduler Service

The routine scheduler executes user-defined scheduled digests.

**Architecture:**
```
User creates Routine → stored in Routine Config DB (PostgreSQL)
    │
    ▼
Cron job runner (AWS EventBridge + Lambda / BullMQ worker)
    │  fires at scheduled time per user timezone
    ▼
Routine Job:
  1. Fetch routine config (prompt, sources, time window)
  2. Retrieve recent context (last 24h / last week)
  3. Build prompt: "Summarize what I worked on today and highlight key decisions."
  4. LLM generation
  5. Push result to client (WebSocket push / APNs notification / FCM)
  6. Store output in Routine History
```

**Scaling consideration:** With millions of users, naive per-user cron jobs don't scale. Use a priority queue (AWS SQS + worker pool) where jobs are enqueued based on the next-fire-time of each routine, rather than one cron thread per user.

---

### 4.7 User Profile Service

Stores and manages user preferences, learned writing style, and personalization signals.

**User profile schema:**
```json
{
  "user_id": "uuid",
  "name": "Jane Doe",
  "email": "jane@company.com",
  "plan": "pro",
  "capture_settings": {
    "excluded_apps": ["1Password", "Keychain"],
    "excluded_domains": ["bank.com"],
    "capture_paused": false
  },
  "writing_style": {
    "tone": "professional",
    "verbosity": "concise",
    "preferred_format": "bullet_points",
    "learned_examples": ["...email samples..."]
  },
  "integrations": [
    { "provider": "google", "scopes": ["calendar", "gmail"], "token_ref": "vault://..." }
  ],
  "timezone": "America/New_York",
  "created_at": "2026-01-15T00:00:00Z"
}
```

**Writing style learning:** Over time, the system builds a style profile by analyzing the user's own written output (captured from their emails, Slack messages, documents). This is used to make generated content "sound like the user."

---

### 4.8 Data Stores Summary

| Store | Technology | What It Holds |
|-------|-----------|---------------|
| Context Store | PostgreSQL (RDS) | Raw text chunks + metadata |
| Vector DB | pgvector / Pinecone | Embeddings (float32 arrays) |
| Transcript Store | S3 (audio) + RDS (text) | Meeting audio, transcripts, summaries |
| User Profile DB | PostgreSQL (RDS) | User prefs, style, integration tokens |
| Session Store | Redis (ElastiCache) | Active chat sessions, dedup keys |
| Routine Config DB | PostgreSQL (RDS) | Routine definitions + history |
| Audit Log | S3 + Athena | Immutable access/deletion logs (compliance) |

---

## 5. AI Inference Layer

### 5.1 Large Language Model (LLM)

The LLM is the generative engine behind Chat, Meeting Notes summaries, and Routine digests.

**Model selection considerations:**

| Model | Strengths | Weaknesses |
|-------|-----------|------------|
| GPT-4o (OpenAI) | Best general quality, fast, multimodal | External vendor dependency, cost |
| Claude 3.5 Sonnet | Excellent instruction following, long context | External vendor |
| Gemini 1.5 Pro | Very long context (1M tokens), Google ecosystem | Newer |
| Llama 3.1 70B (self-hosted) | No data leaves your infra | Significant GPU infra cost |

**Recommended approach:** Abstract behind an LLM provider interface. Start with OpenAI GPT-4o or Claude. Add the ability to swap models per use case (e.g., faster/cheaper model for routine digests, best model for complex chat queries).

**LLM provider abstraction:**
```typescript
interface LLMProvider {
  chat(messages: Message[], options: ChatOptions): AsyncGenerator<string>;
  embed(texts: string[]): Promise<number[][]>;
}

class OpenAIProvider implements LLMProvider { ... }
class AnthropicProvider implements LLMProvider { ... }
class LocalLlamaProvider implements LLMProvider { ... }
```

---

### 5.2 Streaming Response Architecture

All chat responses are streamed token-by-token for responsiveness.

**Flow:**
```
Client                    Backend (Query Engine)               OpenAI API
  │                               │                               │
  │── POST /chat/message ────────►│                               │
  │                               │── POST /v1/chat (stream:true)►│
  │                               │◄── token stream ──────────────│
  │◄── SSE event stream ──────────│                               │
  │  data: {"token": "The"}       │                               │
  │  data: {"token": " launch"}   │                               │
  │  data: {"token": " date"}     │                               │
  │  data: {"citations": [...]}   │                               │
  │  data: [DONE]                 │                               │
```

**Client-side rendering:** Buffer incoming tokens in state, append to the displayed string on each event. Avoid re-rendering the entire message on each token — use a virtualized approach or direct DOM mutation for performance.

---

### 5.3 ASR (Automatic Speech Recognition) Service

The ASR service converts meeting audio to text, with speaker labels.

**Architecture options:**

**Option A — Cloud ASR (recommended for quality):**
```
Audio chunk (30s, Opus) → HTTPS POST → Deepgram / AssemblyAI API
                                    ← Transcript JSON (speaker labels, timestamps)
```

**Option B — Self-hosted Whisper:**
```
Audio chunk → GPU inference server (Whisper large-v3)
           ← Transcript JSON
```

**Option C — On-device Whisper (for privacy-first):**
```
Audio chunk → whisper.cpp (runs locally on CPU/ANE)
           ← Transcript JSON (no data leaves device)
```

**Recommended:** Use Deepgram or AssemblyAI for high-quality diarized transcription. Offer on-device whisper.cpp as a privacy-first option in Settings.

**ASR output processing:**
```
Raw transcript (with timestamps + speaker IDs)
    │
    ▼
Speaker normalization (Speaker 1, Speaker 2 → "You" / "Others" or named)
    │
    ▼
Punctuation restoration (if not provided by ASR)
    │
    ▼
Chunk into semantic units (by speaker turn or time window)
    │
    ▼
Store in Transcript Store + send to Context Ingestion
    │
    ▼
Trigger meeting summary generation (LLM call)
```

---

### 5.4 Embedding Models

Embeddings convert text into vector representations that enable semantic search.

**Two-tier embedding strategy:**

| Tier | Model | Where | Purpose |
|------|-------|-------|---------|
| Local (fast) | `all-MiniLM-L6-v2` (384d) | On-device | Initial embedding of chunks, local search |
| Cloud (quality) | `text-embedding-3-small` (1536d) | OpenAI API | High-quality cloud search index |

**Embedding pipeline:**
```
Chunk text
    │
    ├──► Local model → 384d embedding → stored locally
    │
    └──► (async) Cloud API → 1536d embedding → stored in Pinecone/pgvector
```

The local embedding allows the app to answer simple recall queries instantly (offline-capable) while the cloud embedding powers high-quality semantic search when connected.

---

### 5.5 Prompt Engineering Architecture

Prompt construction is a critical component. It must be maintained as configuration, not hardcoded strings.

**Prompt template system:**

```yaml
# prompts/chat_rag.yaml
system: |
  You are Littlebird, a personal AI assistant. You have access to context 
  from the user's screen, meetings, and connected apps. 
  
  Rules:
  - Answer using only the provided context unless the user asks a general question
  - Cite each source by name (e.g., "In your Slack #launch-prep...")
  - Match the user's communication style: {user_style_summary}
  - If context is insufficient, say so and suggest where to look
  - Be concise. Prefer bullet points for lists.

context_template: |
  [Source: {source_app} - {source_context}, {timestamp}]
  {content}

user_template: |
  {user_query}
```

**Context window management:**
- GPT-4o has a 128K context window. For most queries, injected context (5 chunks × ~500 tokens) is well within limits.
- For large context scenarios (summarize a long meeting), use map-reduce: summarize chunks individually, then combine summaries.

---

## 6. Third-Party Integrations

Integrations extend Littlebird's context beyond what's visible on-screen. All integrations are optional and use OAuth 2.0 for authorization.

### 6.1 Integration Architecture

**OAuth flow (Google example):**
```
User clicks "Connect Google" in Settings
    │
    ▼
Desktop client opens system browser to:
  https://accounts.google.com/o/oauth2/auth?
    client_id=...&
    redirect_uri=littlebird://oauth/callback&
    scope=gmail.readonly+calendar.readonly&
    response_type=code
    │
    ▼ (user approves)
Browser redirects to: littlebird://oauth/callback?code=AUTH_CODE
    │
    ▼
Desktop client catches deep link, sends code to backend:
  POST /integrations/google/exchange { code: AUTH_CODE }
    │
    ▼
Backend exchanges code for tokens, stores in Vault (encrypted)
    │
    ▼
Integration is active — background sync begins
```

**Integration token storage:**
- Access tokens and refresh tokens are stored in **HashiCorp Vault** or **AWS Secrets Manager** — never in the application database in plaintext.
- Tokens are referenced by a vault path (`vault://users/{user_id}/integrations/google`).

---

### 6.2 Integration Sync Architecture

Each integration has a **sync worker** that periodically fetches new data and feeds it into the Context Ingestion pipeline.

**Sync worker pattern:**
```
Cron trigger (every 5-15 mins per integration)
    │
    ▼
Fetch new items since last_sync_cursor
  (e.g., Gmail: messages after last_message_id)
  (e.g., Google Calendar: events modified after last_sync_token)
    │
    ▼
Transform to canonical chunk format (same schema as screen capture chunks)
    │
    ▼
POST /ingest (same pipeline as screen-captured content)
    │
    ▼
Update last_sync_cursor in DB
```

**Delta sync is critical:** Never re-fetch all data on every sync. Use cursor-based or timestamp-based pagination from each API.

---

### 6.3 Integration Categories & Key APIs

**Productivity & Docs:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| Google Drive | Drive API v3 | Document content, comments, revision metadata |
| Notion | Notion API | Page content, database entries, comments |
| Confluence (Atlassian) | Confluence REST API | Pages, spaces, comments |
| Craft | Craft API | Notes, documents |

**Email & Calendar:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| Gmail | Gmail API | Message threads, labels, sender/recipient |
| Google Calendar | Calendar API v3 | Events, attendees, descriptions |
| Outlook | Microsoft Graph API | Mail, calendar, contacts |
| Apple Calendar | EventKit (local, macOS) | Events (no API needed — local sync) |

**Project Management:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| Linear | Linear GraphQL API | Issues, projects, comments, cycles |
| Jira | Jira REST API v3 | Issues, sprints, comments, status changes |
| Asana | Asana API | Tasks, projects, comments |
| ClickUp | ClickUp API v2 | Tasks, docs, comments |
| monday.com | monday.com API | Board items, updates |

**Communication:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| Slack | Slack Web API | Messages from accessible channels (user's DMs + joined channels) |
| Discord | Discord API | Messages from servers the user is in |

**CRM & Sales:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| Intercom | Intercom API | Conversations, contacts |
| Outreach | Outreach API | Sequences, prospects, activities |
| Close | Close API | Leads, calls, emails |

**Developer Tools:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| GitHub | GitHub REST/GraphQL API | PRs, issues, comments, code reviews |
| Axiom | Axiom API | Log data, queries |
| PlanetScale | PlanetScale API | Schema, query history |

**Finance:**
| Integration | API | Key data fetched |
|-------------|-----|-----------------|
| Stripe | Stripe API | Transactions, subscription events |
| Mercury | Mercury API | Account balances, transactions |
| Ramp | Ramp API | Expense reports, transactions |

---

### 6.4 Integration Data Privacy

- Integrations only fetch data the user has explicitly authorized via OAuth scopes.
- Requested scopes are minimal and read-only wherever possible (e.g., `gmail.readonly`, not `gmail.modify`).
- Users can revoke any integration at any time, which triggers token deletion from Vault and deletion of integration-sourced chunks from the Context Store.
- Integration data is subject to the same retention and deletion controls as screen-captured data.

---

### 6.5 Deep Actions via Integrations

Some integrations (calendar, task managers) enable **write actions** — not just context reading but doing things on the user's behalf.

**Examples:**
- "Schedule a 30-minute meeting with Priya tomorrow at 10am" → Google Calendar `events.insert`
- "Create a Linear issue for the bug I just saw in Slack" → Linear `issueCreate` mutation
- "Send that email I just drafted" → Gmail `messages.send`

**Write action safety architecture:**
- All write actions require explicit user confirmation (a confirmation dialog before execution).
- Write operations are logged in an audit trail.
- Actions are never taken proactively — only in response to explicit user instruction.
- Scope separation: read scopes are requested at setup; write scopes are requested on-demand with explanation of why.

---

## 7. Security, Privacy & Compliance

### 7.1 Encryption

| Layer | Encryption |
|-------|-----------|
| Data in transit (client ↔ cloud) | TLS 1.3 |
| Data at rest (cloud DBs) | AES-256 (AWS RDS encryption, S3 SSE) |
| Data at rest (local SQLite cache) | SQLCipher (AES-256) |
| Integration tokens | HashiCorp Vault / AWS Secrets Manager |
| User credentials | bcrypt (password hashing), TOTP (2FA) |

### 7.2 Access Control

- **Row-level security (RLS)** in PostgreSQL: every query is automatically scoped to `WHERE user_id = current_user_id()`.
- **IAM roles** for service-to-service authentication on AWS (no hardcoded credentials).
- **Least-privilege principle:** Each microservice has only the IAM permissions it needs.

### 7.3 Compliance

| Standard | Status | Key requirements |
|----------|--------|-----------------|
| SOC 2 Type II | Certified | Annual third-party audit of security controls |
| GDPR | Compliant | Right to deletion, data portability, DPA agreements with sub-processors |
| CCPA | Compliant | User opt-out of data sale (N/A — data not sold), right to deletion |
| HIPAA | Badge shown | BAA required with any PHI-handling customers; additional controls |
| CCSK | Badge shown | Cloud security knowledge standard |

### 7.4 Data Retention & Deletion

**User-initiated deletion options:**
- Delete last 1 hour of context
- Delete last 24 hours
- Delete last 7 days
- Delete all data
- Delete account (cascades to all data)

**Deletion implementation:**
```
POST /user/data/delete { scope: "last_24h" | "all" }
    │
    ▼
1. Mark chunks as deleted in Context Store (soft delete + hard delete async)
2. Delete embeddings from Vector DB (by chunk_id)
3. Delete from Transcript Store
4. Clear Redis session/dedup cache for user
5. Revoke integration tokens if "delete all"
6. Write to Audit Log (deletion event, scope, timestamp)
```

Hard deletion (physical removal from storage) completes within 30 days per GDPR requirements.

---

## 8. Cross-Cutting Concerns

### 8.1 Observability

**Logging:** Structured JSON logs to CloudWatch / Datadog. Every request logs: `user_id` (hashed), `endpoint`, `latency_ms`, `status_code`, `model_used`, `tokens_used`.

**Metrics:** Track per endpoint: P50/P95/P99 latency, error rate, LLM token consumption, context chunks retrieved per query.

**Tracing:** Distributed tracing (AWS X-Ray or OpenTelemetry) across microservices to trace a query end-to-end from API gateway through RAG to LLM response.

**Alerting:** PagerDuty alerts on: error rate > 1%, P99 latency > 5s, LLM API failure rate > 0.5%, context ingestion backlog > 10K pending.

### 8.2 Cost Management

The main cost drivers for this product:
- **LLM API calls:** Charge per token. Optimize prompt size; cache responses for identical queries.
- **Embedding API calls:** Batch embed chunks (1 API call per batch of 100 chunks, not per chunk).
- **Vector DB:** Cost scales with number of vectors. Prune old low-value chunks (e.g., chunks older than 6 months with zero retrieval hits).
- **ASR:** Cost per minute of audio. Use VAD aggressively to skip silence.
- **Storage:** S3 for audio is cheap; RDS for structured data is the higher cost.

### 8.3 Offline Behavior

The app should be useful even without internet connectivity:
- Local SQLite cache enables local semantic search over recently captured context (using local embeddings).
- Hummingbird overlay can answer simple recall questions locally.
- Chat degrades gracefully: "I'm offline, but I found these relevant items from your local history."
- Meeting transcription falls back to on-device whisper.cpp.

---

## 9. Technology Stack Summary

### Desktop Client
| Concern | Technology |
|---------|-----------|
| macOS framework | Electron or SwiftUI/AppKit |
| Windows framework | Electron or Tauri (Rust) |
| Mobile | React Native (iOS + Android) |
| Screen observation | macOS Accessibility API, Windows UIAutomation |
| Audio capture | CoreAudio (macOS), WASAPI (Windows) |
| Local DB | SQLite + SQLCipher |
| Local embedding | all-MiniLM-L6-v2 (via ONNX Runtime) |
| Local ASR | whisper.cpp (optional privacy mode) |
| Auto-update | Sparkle (macOS), Squirrel (Windows/Electron) |

### Cloud Backend
| Concern | Technology |
|---------|-----------|
| API Gateway | AWS API Gateway or Kong |
| Auth | JWT + OAuth 2.0 (Auth0 / Cognito) |
| Backend services | Node.js (TypeScript) or Python (FastAPI) |
| Job queue | AWS SQS + Lambda workers or BullMQ (Redis) |
| Primary DB | PostgreSQL (AWS RDS) |
| Vector DB | pgvector or Pinecone |
| Cache / session | Redis (AWS ElastiCache) |
| Object storage | AWS S3 |
| Secret management | AWS Secrets Manager or HashiCorp Vault |
| Container runtime | AWS ECS (Fargate) or EKS |

### AI Inference
| Concern | Technology |
|---------|-----------|
| LLM (primary) | OpenAI GPT-4o or Anthropic Claude |
| LLM abstraction | LiteLLM or custom provider interface |
| Cloud embedding | OpenAI text-embedding-3-small |
| Local embedding | all-MiniLM-L6-v2 (ONNX) |
| ASR (cloud) | Deepgram or AssemblyAI |
| ASR (on-device) | whisper.cpp |
| Re-ranker | cross-encoder/ms-marco-MiniLM-L-6-v2 |

### Observability
| Concern | Technology |
|---------|-----------|
| Logging | Datadog or AWS CloudWatch |
| Tracing | OpenTelemetry + AWS X-Ray |
| Error tracking | Sentry |
| Analytics | PostHog or Mixpanel |
| Alerting | PagerDuty |

---

*This document covers the architecture as of May 2026, modelled on the publicly available feature set and product behaviour of Littlebird (littlebird.ai). Implementation details are inferred from industry best practices for this class of AI-powered desktop product.*
