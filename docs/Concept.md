# Torvi — Architectural Concepts (Updated April 2026)

> A conceptual guide to the architectural patterns, design decisions, and system-level abstractions behind Torvi (formerly Torvi).
> No source code is reproduced — only patterns, flows, and rationale.

## Recent Architectural Changes (v0.3)
- **Three-window model**: Added Gate window (auth) alongside Overlay + Dashboard. Gate is created hidden; React controls visibility.
- **Lazy-loaded modules**: Appwrite SDK is dynamically imported to prevent startup crashes when not configured.
- **Deferred window show**: Windows start hidden (`visible: false`). Frontend calls `invoke("show_gate")` only when needed. Eliminates blank-screen flash on startup.
- **Dual auth pattern**: Appwrite OAuth (cloud) + Legacy JWT (self-hosted). Falls through gracefully with try/catch.
- **Model routing in Rust**: `get_ai_config(modelId)` routes to NVIDIA NIM or OpenRouter based on model ID prefix matching.
- **Interview mode** (planned): Speaker diarization + question detection for system audio during interviews.

---

## Table of Contents

1. [Overlay Window Implementation](#1-overlay-window-implementation)
2. [Real-Time Transcription Pipeline](#2-real-time-transcription-pipeline)
3. [LLM Request Pipeline](#3-llm-request-pipeline)
4. [Plugin & Tool Architecture](#4-plugin--tool-architecture)
5. [Event Handling System](#5-event-handling-system)
6. [Streaming AI Responses](#6-streaming-ai-responses)
7. [Desktop Permission Handling](#7-desktop-permission-handling)

---

## 1. Overlay Window Implementation

### Core Concept

Torvi's overlay is a **frameless, transparent, always-visible floating window** that hovers above all other applications. It behaves like a system-level HUD rather than a traditional application window — it never steals focus from the active app, it cannot be captured by screen recording software, and it dynamically resizes based on its content state.

### Architectural Pattern: Dual-Window with Role Separation

The application runs two completely independent windows from a single process:

```
┌─────────────────────────────────────────────────┐
│                  Tauri Process                   │
│                                                  │
│   ┌──────────────┐      ┌────────────────────┐   │
│   │ Overlay       │      │ Dashboard           │   │
│   │ (Main Window) │      │ (Secondary Window)  │   │
│   │               │      │                     │   │
│   │ • 600×54px    │      │ • 800–1200px wide   │   │
│   │ • Transparent │      │ • Standard chrome   │   │
│   │ • No chrome   │      │ • Full navigation   │   │
│   │ • Stealth     │      │ • Settings & history│   │
│   └──────────────┘      └────────────────────┘   │
│                                                  │
│   Shared: Rust backend, SQLite, IPC commands     │
└─────────────────────────────────────────────────┘
```

**The overlay window** is created at startup from a static configuration. It is defined as a slim horizontal bar at the top-center of the screen — no title bar, no resize handles, no shadow, no taskbar entry. The backend positions it programmatically on the primary monitor with a small vertical offset.

**The dashboard window** is created on-demand the first time the user opens it. It uses standard platform decorations (with hidden title bar on macOS for the traffic-light buttons). It can be toggled, and if closed, it is destroyed and recreated fresh on next open.

### The "Invisible Application" Pattern

The overlay achieves stealth through six layered mechanisms:

1. **Content Protection** — An OS-level flag that tells the compositor to exclude this window from screen capture. Screen recorders see a black rectangle.
2. **Non-Activating Panel (macOS)** — The window is promoted from a standard NSWindow to an NSPanel with a non-activating style mask. Clicking or typing in the overlay does not steal focus from the foreground application (e.g., Zoom, Google Meet).
3. **Float Level & Space Behavior** — The panel floats above normal windows, appears on all virtual desktops, and remains visible alongside fullscreen applications.
4. **Taskbar/Dock Hiding** — The window is excluded from the taskbar (Windows/Linux) and can optionally hide its dock icon (macOS activation policy switch).
5. **Title Attribute Stripping** — A DOM mutation observer continuously removes HTML `title` attributes to prevent tooltip leaks during screen sharing.
6. **Custom Cursor** — An optional invisible cursor mode hides the native cursor and renders a custom pointer icon via JavaScript, preventing cursor-position clues.

### Dynamic Height Expansion

The overlay uses a **spring-loaded height model**:

```
State: Idle           →   State: Responding       →   State: Idle
┌──────────────────┐      ┌──────────────────┐        ┌──────────────────┐
│ [input field]    │  54px │ [input field]    │  ~600px│ [input field]    │  54px
└──────────────────┘      │                  │        └──────────────────┘
                          │  AI response     │
                          │  (scrollable)    │
                          │                  │
                          └──────────────────┘
```

When the user sends a message, a popover opens below the input and the window height expands from 54px to ~600px via a Tauri IPC call that resizes the window. When the popover closes, the window snaps back to 54px. This gives the illusion of a search-bar that "unfolds" into a full interface, then disappears again.

### Window Entry Point Branching

The React entry point checks the current window's label at render time. If the label matches the screenshot overlay pattern, only the lightweight selection canvas component is rendered — no providers, no router, no state management. Otherwise, the full application tree (context providers, router, error boundary) is mounted. This ensures screenshot overlays are virtually zero-cost to create and destroy.

---

## 2. Real-Time Transcription Pipeline

### Core Concept

The transcription pipeline is a **five-stage, cross-boundary data flow** that begins with raw audio samples from the system speaker and ends with AI-generated text displayed in the overlay. It spans three execution environments: OS audio subsystem → Rust backend → JavaScript frontend.

### Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Stage 1: Hardware Capture                │
│                                                              │
│   OS Audio API (WASAPI / CoreAudio / PulseAudio)             │
│        ↓                                                     │
│   Platform-specific driver captures system speaker output    │
│        ↓                                                     │
│   Raw f32 mono samples → Lock-free ring buffer               │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                     Stage 2: Voice Activity Detection        │
│                                                              │
│   Fixed-size hop windows (1024 samples)                      │
│        ↓                                                     │
│   Noise gate (soft-knee compression below threshold)         │
│        ↓                                                     │
│   RMS energy + Peak amplitude calculation                    │
│        ↓                                                     │
│   Speech/Silence state machine with hysteresis               │
│        ↓                                                     │
│   Decisions: accumulate / emit / discard                     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                     Stage 3: Audio Encoding                  │
│                                                              │
│   Trailing silence trimmed                                   │
│        ↓                                                     │
│   Amplitude normalization (target RMS 0.1)                   │
│        ↓                                                     │
│   Float-to-i16 PCM conversion with clamping                  │
│        ↓                                                     │
│   WAV container encoding → base64 string                     │
│        ↓                                                     │
│   Emitted to frontend as Tauri event                         │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                     Stage 4: Speech-to-Text                  │
│                                                              │
│   Frontend receives base64 → decodes to Blob                 │
│        ↓                                                     │
│   Routes to STT provider (Torvi API or custom cURL)         │
│        ↓                                                     │
│   HTTP POST with audio payload (multipart/binary/base64)     │
│        ↓                                                     │
│   JSON response → extract text via responseContentPath       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                     Stage 5: AI Processing                   │
│                                                              │
│   Transcribed text auto-submitted to LLM pipeline            │
│        ↓                                                     │
│   Streaming response rendered in overlay                     │
│        ↓                                                     │
│   Conversation saved to SQLite (debounced)                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### The VAD State Machine

Voice Activity Detection is the intelligence layer between raw audio and transcription. It operates as a **three-state finite automaton** with configurable thresholds:

```
                    speech detected
        ┌──────────────────────────────────┐
        │                                  ▼
   ┌─────────┐                      ┌───────────┐
   │ SILENCE  │                      │  SPEECH   │
   │          │◄─────────────────────│           │
   └─────────┘   silence > N chunks  └───────────┘
        │                                  │
        │         speech < min             │         duration > max
        │         ┌───────┐                │         ┌───────┐
        │         ▼       │                │         ▼       │
        │    ┌─────────┐  │                │    ┌─────────┐  │
        └───►│ DISCARD │──┘                └───►│  EMIT   │──┘
             └─────────┘                        └─────────┘
```

Key design decisions:
- **Pre-speech buffering**: The system keeps the last ~12 chunks in a circular buffer. When speech starts, these chunks are prepended so the beginning of speech is never clipped.
- **Silence hysteresis**: Speech-to-silence requires ~45 consecutive silent chunks (~1 second) to prevent mid-sentence pauses from splitting an utterance.
- **Minimum duration filter**: Utterances shorter than ~7 chunks (~160ms) are discarded as noise.
- **Safety cap**: Any single utterance is force-emitted at 30 seconds to prevent unbounded memory growth.

### Dual VAD Systems

The application has two independent VAD implementations:

| Aspect | Rust Backend VAD | JavaScript Frontend VAD |
|--------|-----------------|------------------------|
| **Purpose** | System audio (speakers) | Microphone input |
| **Algorithm** | Custom RMS/peak state machine | Neural network (Silero VAD via ONNX) |
| **Library** | Hand-written Rust | `@ricky0123/vad-react` |
| **Trigger** | System audio shortcut | Audio recording button |
| **Processing** | Continuous stream | Real-time mic stream |

The Rust VAD is designed for efficiency on continuous loopback audio where false positives (keyboard clicks, system sounds) must be filtered. The JavaScript VAD uses a pre-trained neural model for higher accuracy on direct microphone input where the speaker is close and clear.

### The Ring Buffer Pattern

All three platform audio implementations use the same concurrency pattern: a **lock-free single-producer single-consumer ring buffer**. The audio capture thread (producer) writes raw samples at the hardware's native rate. The VAD processing task (consumer) reads samples at its own pace. If the consumer falls behind, the oldest unread samples are silently dropped — this prevents unbounded memory growth and ensures the system never blocks the audio driver. The ring buffer size (128KB) provides roughly 1.5 seconds of runway before overflow.

---

## 3. LLM Request Pipeline

### Core Concept

The LLM pipeline is a **provider-agnostic request builder** that accepts a user message, constructs a provider-specific HTTP request from a template, streams the response through an async generator, and renders the result incrementally. The same pipeline serves both the overlay and the dashboard.

### Two Execution Paths

```
                    ┌─────────────────────┐
                    │   User sends message │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  shouldUseTorviAPI? │
                    └──────────┬──────────┘
                       yes /       \ no
                          /         \
              ┌──────────▼──┐  ┌────▼──────────┐
              │  Path A:     │  │  Path B:       │
              │  Torvi API  │  │  Custom cURL   │
              │              │  │                │
              │  Rust backend│  │  Frontend JS   │
              │  SSE stream  │  │  fetch() + SSE │
              └──────────┬──┘  └────┬──────────┘
                         │          │
                    ┌────▼──────────▼────┐
                    │  Async Generator    │
                    │  yields text chunks │
                    └──────────┬─────────┘
                               │
                    ┌──────────▼──────────┐
                    │  React state update  │
                    │  per chunk → render  │
                    └─────────────────────┘
```

**Path A (Torvi API):** The frontend invokes a Tauri command. The Rust backend makes an HTTP request to Torvi's server, which returns routing configuration (target URL, auth token, model). The backend then makes a second request to the actual AI provider, reads the SSE byte stream, parses `data:` lines, and emits each content chunk as a Tauri event. The frontend listens for these events and yields them from an async generator.

**Path B (Custom cURL):** The frontend parses the user's cURL template into structured HTTP components (URL, headers, body). It performs recursive variable substitution — replacing `{{TEXT}}`, `{{API_KEY}}`, `{{MODEL}}`, `{{SYSTEM_PROMPT}}`, `{{IMAGE}}` — then issues a `fetch()` request directly. The response stream is read as SSE, each `data:` line is JSON-parsed, and a configurable JSONPath (`responseContentPath`) extracts the text delta.

### The Template Abstraction

The key architectural insight is that **all AI providers are represented as cURL templates with variable holes**. There is no provider-specific code — no OpenAI SDK, no Claude SDK. Instead, each provider is a data object:

```
Provider = {
  name: "OpenAI"
  curl: "curl https://api.openai.com/v1/chat/completions -H 'Authorization: Bearer {{API_KEY}}' -d '{\"model\": \"{{MODEL}}\", \"messages\": {{TEXT}}, \"stream\": true}'"
  responseContentPath: "choices.0.delta.content"
  streaming: true
}
```

At request time, the cURL string is parsed into structured HTTP components, variables are replaced with actual values, and the request is issued. This means:
- Adding a new AI provider requires zero code changes — just a new template
- Users can add their own providers through the same mechanism
- The streaming parser is universal — only the JSONPath to the content delta differs

### Message Construction

Messages are assembled differently depending on the target provider family:

| Provider Style | System Prompt | Messages Format | Image Format |
|---------------|---------------|-----------------|--------------|
| **OpenAI-compatible** | First message with `role: "system"` | `messages: [{ role, content }]` | `image_url: { url: "data:..." }` |
| **Claude** | Top-level `system` field | `messages: [{ role, content }]` | `source: { type: "base64", data: "..." }` |
| **Gemini** | Injected into first user turn | `contents: [{ role, parts }]` | `inline_data: { mime_type, data }` |

The message builder inspects the provider's endpoint URL to determine which format to use, then constructs the appropriate JSON structure. This is the one place where provider-specific logic lives.

### Request Lifecycle & Abort Handling

Each request is assigned a unique ID at creation time. An `AbortController` is created per request. If the user sends a new message before the previous response completes:

1. The old `AbortController.abort()` is called → HTTP stream terminates
2. The old async generator's next yield checks the abort signal and stops
3. The new request starts with a fresh ID
4. If a stale chunk arrives (mismatched request ID), it is silently dropped

This prevents race conditions where a slow response from an earlier prompt could contaminate the display of a newer response.

---

## 4. Plugin & Tool Architecture

### Core Concept

Torvi uses a **layered plugin architecture** where the Rust backend composes Tauri's official plugin ecosystem with custom-built modules, and the frontend extends AI/STT capabilities through a **template-driven provider system** that requires no code changes to add new integrations.

### Tauri Plugin Composition

The backend is assembled from 12+ independent Tauri plugins, each providing a specific OS-level capability:

```
┌─────────────────────────────────────────────────────┐
│                    Application                       │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐           │
│  │   SQL    │ │   HTTP   │ │  Updater  │           │
│  │ (SQLite) │ │ (reqwest)│ │ (Ed25519) │           │
│  └──────────┘ └──────────┘ └───────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐           │
│  │ Shortcut │ │ Keychain │ │   Shell   │           │
│  │ (Global) │ │ (Secure) │ │ (Opener)  │           │
│  └──────────┘ └──────────┘ └───────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐           │
│  │Autostart │ │ PostHog  │ │Machine UID│           │
│  │(LaunchAg)│ │(Analytics│ │(Device ID)│           │
│  └──────────┘ └──────────┘ └───────────┘           │
│  ┌──────────┐ ┌──────────┐                          │
│  │ NSPanel  │ │  macOS   │  ← Platform-conditional  │
│  │(macOS)   │ │  Perms   │                          │
│  └──────────┘ └──────────┘                          │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Custom Application Modules          │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌───────┐ │   │
│  │  │Speaker │ │Capture │ │Activate│ │  API  │ │   │
│  │  │(Audio) │ │(Screen)│ │(License│ │(Torvi│ │   │
│  │  │        │ │        │ │       )│ │      )│ │   │
│  │  └────────┘ └────────┘ └────────┘ └───────┘ │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  39 IPC Command Handlers registered via macro        │
└─────────────────────────────────────────────────────┘
```

Each plugin is registered in a builder chain during app initialization. The plugin system follows the **composition over inheritance** principle — plugins are independent units that don't know about each other. The application wires them together in the setup closure.

### Managed State Pattern

The Rust backend uses Tauri's **managed state** system — a dependency-injection-like pattern where typed state objects are registered at startup and retrieved by type in command handlers:

- **AudioState**: Active capture stream handle, stop signal
- **CaptureState**: Per-monitor screenshot data, overlay window references
- **WindowVisibility**: Atomic boolean tracking main window show/hide
- **RegisteredShortcuts**: HashMap mapping key combinations to action IDs
- **LicenseState**: Cached license validation result
- **MoveWindowState**: Per-direction atomic stop flags for keyboard movement

Command handlers declare which states they need as parameters. Tauri automatically provides the correct state instance. This decouples commands from global mutable state and makes each handler testable in isolation.

### Frontend Provider System — The "cURL as Plugin" Pattern

Rather than a traditional plugin interface with trait implementations or abstract classes, Torvi treats **cURL commands as portable, serializable plugin definitions**:

```
Traditional Plugin Architecture:
  class OpenAIProvider implements AIProvider {
    async complete(messages) { ... }
    async stream(messages) { ... }
  }

Torvi's Template Architecture:
  {
    name: "OpenAI",
    curl: "curl https://api.openai.com/... -d '{{TEXT}}'",
    responseContentPath: "choices.0.delta.content"
  }
```

This design choice has profound implications:
- **Zero-code extensibility**: Users add new AI providers by pasting a cURL command
- **Universal streaming parser**: One SSE parser handles all providers; only the JSONPath differs
- **Inspectable**: Users can see exactly what HTTP request will be made
- **Portable**: Provider configs can be shared as JSON between users
- **Validated at boundary**: cURL is validated on creation, not at request time

The same pattern applies to STT providers — a cURL template with `{{AUDIO}}` instead of `{{TEXT}}`.

### Variable Substitution Engine

The template system uses a recursive variable replacement engine:

1. **Extract**: Regex scans the cURL template for all `{{VARIABLE_NAME}}` patterns
2. **UI Generation**: Each discovered variable gets an input field in the settings UI
3. **Deep Replace**: At request time, a recursive function walks the entire parsed request object (headers, body, nested JSON) and replaces every occurrence of each variable with its bound value
4. **Special Variables**: `{{TEXT}}` and `{{IMAGE}}` are replaced by the message builder with provider-specific JSON structures rather than simple strings

This creates a lightweight, declarative plugin system where the "contract" between the app and a provider is just: "give me a cURL template with holes, and tell me where the response text lives."

---

## 5. Event Handling System

### Core Concept

Torvi uses a **multi-layer event architecture** that spans four distinct event systems, each serving a different communication boundary:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: OS-Level Events (Global Shortcuts)             │
│  ─ Keyboard hooks intercepted by OS before any app       │
│  ─ Routed through Tauri plugin to centralized Rust handler│
├─────────────────────────────────────────────────────────┤
│  Layer 2: Tauri IPC Events (Backend ↔ Frontend)          │
│  ─ Commands: frontend → backend (request/response)       │
│  ─ Events: backend → frontend (push notifications)       │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Browser Storage Events (Window ↔ Window)       │
│  ─ localStorage writes trigger StorageEvent in other tabs │
│  ─ Used for cross-window state synchronization           │
├─────────────────────────────────────────────────────────┤
│  Layer 4: DOM Events (Component ↔ Component)             │
│  ─ Standard React event handlers                         │
│  ─ MutationObserver for DOM surveillance                 │
│  ─ Keyboard events for UI navigation                     │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: Global Shortcut Dispatch

Global shortcuts are registered at the OS level and intercepted even when Torvi is not the focused application. The architecture follows a **centralized dispatcher pattern**:

1. All 7+ shortcuts are registered with the OS through the Tauri global-shortcut plugin
2. Every key press flows to a single Rust handler function
3. The handler looks up the pressed key combination in a `HashMap<String, String>` to find the associated action ID
4. A match statement routes to the appropriate handler based on action ID
5. Most actions emit a Tauri event to the frontend rather than acting directly

This centralized approach means:
- Shortcut-to-action mapping is data-driven (the HashMap is rebuilt when bindings change)
- Adding a new shortcut requires only a new entry in the routing table
- Conflict detection happens at registration time, not dispatch time

### Layer 2: Tauri IPC — Command vs Event

Torvi uses both Tauri communication patterns, each for its appropriate use case:

**Commands (synchronous request/response):**
- Frontend calls `invoke("command_name", { args })` → Rust handler executes → returns result
- Used for: window resize, license validation, screenshot capture, config reads
- 39 commands registered via the `generate_handler![]` macro

**Events (asynchronous push):**
- Rust calls `app_handle.emit("event-name", payload)` → all frontend listeners receive
- Frontend listens via `listen("event-name", callback)`
- Used for: streaming AI chunks, speech-detected audio, capture results, shortcut triggers

The pattern splits along a clear line: **commands for actions the frontend initiates**; **events for things the backend discovers independently** (audio detected, chunk received, shortcut pressed).

### Layer 3: Cross-Window Synchronization via StorageEvent

The overlay and dashboard windows share the same origin but run in separate WebView instances. They synchronize state through the **browser StorageEvent mechanism**:

```
Dashboard Window                    Overlay Window
┌─────────────────┐                ┌─────────────────┐
│ User changes     │                │                  │
│ AI provider      │                │                  │
│       │          │                │                  │
│       ▼          │                │                  │
│ localStorage.set │───StorageEvent──►│ storage listener │
│ ("selected_ai")  │                │       │          │
│                  │                │       ▼          │
│                  │                │ loadData()       │
│                  │                │ refreshes state  │
└─────────────────┘                └─────────────────┘
```

When either window writes to localStorage, the browser fires a `StorageEvent` in all other same-origin windows. The AppContext listens for this event, checks if the changed key is one it manages, and triggers a full state reload if so. This provides **near-instant synchronization** without any custom IPC, WebSocket, or shared memory.

### Layer 4: DOM-Level Event Patterns

Several features use DOM-native event mechanisms for specific purposes:

- **MutationObserver (Title Stripping)**: Continuously monitors `document.body` for elements gaining `title` attributes and removes them immediately. This is a security-through-DOM-surveillance pattern.
- **MutationObserver (Popover Detection)**: Watches for Radix popover wrapper elements appearing in the DOM to trigger window height changes.
- **Keyboard Events**: Arrow keys scroll the response area. Escape closes popovers. Specific modifier+key combos toggle features (Cmd+K for keep-engaged mode).
- **Paste Events**: The input field intercepts paste events to detect image data in the clipboard.

### Singleton Listener Pattern

React's StrictMode causes components to mount, unmount, and remount during development. This would double-register global event listeners. Torvi solves this with a **module-level singleton flag**:

A boolean variable at module scope (outside the component) tracks whether listeners have been registered. On mount, if the flag is false, listeners are registered and the flag is set true. The cleanup function does not unregister listeners. This ensures exactly one set of global listeners regardless of React lifecycle behavior.

---

## 6. Streaming AI Responses

### Core Concept

AI response streaming in Torvi follows the **async generator as data pipeline** pattern. The streaming engine converts an HTTP SSE (Server-Sent Events) byte stream into a JavaScript async generator that yields text chunks, which React consumes to update the UI incrementally.

### The SSE Protocol Abstraction

All supported AI providers use some variant of the SSE protocol for streaming:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" world"}}]}

data: [DONE]
```

The streaming parser implements a **line-based state machine**:

1. Read the response body as a text stream
2. Split on newlines, accumulate partial lines
3. For each complete line starting with `data: `:
   - If the payload is `[DONE]`, terminate the generator
   - Otherwise, JSON-parse the payload
   - Navigate the parsed object using the provider's `responseContentPath` (e.g., `choices.0.delta.content`)
   - Yield the extracted text string
4. Skip empty lines and non-data lines (comments, event types)

### Async Generator as Integration Point

The async generator is the **universal interface** between the transport layer and the UI:

```
                     Transport Layer
              ┌─────────────┬─────────────┐
              │ Path A:      │ Path B:      │
              │ Tauri Events │ fetch() SSE  │
              │ (Torvi API) │ (Custom cURL)│
              └──────┬───────┴──────┬───────┘
                     │              │
                     ▼              ▼
              ┌─────────────────────────┐
              │    async function*      │
              │    generateResponse()   │
              │                         │
              │    yield "Hello"        │
              │    yield " world"       │
              │    yield "!"            │
              └────────────┬────────────┘
                           │
                    for await (chunk)
                           │
                    ┌──────▼──────┐
                    │ React State │
                    │ response += │
                    │   chunk     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Markdown   │
                    │  Renderer   │
                    │  re-renders │
                    └─────────────┘
```

The consumer loop is identical for both transport paths:
1. Create the generator
2. `for await (const chunk of generator)`: append chunk to accumulated response string
3. React re-renders the Markdown component with the updated string
4. Auto-scroll fires on each state update
5. On generator completion, trigger save-to-SQLite

### Incremental Markdown Rendering

Rendering partial markdown is inherently challenging — at any point during streaming, the markdown could be in an incomplete state (unclosed code block, partial table, half-written link). Torvi handles this by:

1. **Full re-parse on each chunk**: The entire accumulated response is re-parsed by the markdown renderer on each update. This is safe because the parser is tolerant of incomplete constructs.
2. **Memoized syntax highlighting**: Code blocks use `React.memo` and `useMemo` to avoid re-highlighting already-rendered blocks. Only new or changed blocks trigger Shiki.
3. **Lazy Shiki loading**: The syntax highlighter loads asynchronously via React Suspense. During loading, code blocks render as plain `<pre>` text, then upgrade to highlighted versions seamlessly.

### Backpressure & Stale Response Prevention

Two mechanisms prevent the streaming system from producing incorrect output:

**Request ID Gating**: Each request gets a unique UUID. The consumer loop checks the current request ID on each iteration. If a new request has started (ID mismatch), the loop breaks without processing remaining chunks. This is cheaper than abort — stale events that arrive late are simply ignored.

**AbortController**: For the fetch-based path, `AbortController.abort()` terminates the HTTP connection immediately, closing the TCP socket. For the Tauri event path, a cancellation command tells the Rust backend to stop reading the upstream response and close its connection.

---

## 7. Desktop Permission Handling

### Core Concept

Torvi implements a **progressive permission model** that requests OS-level permissions only when needed, checks them before sensitive operations, and degrades gracefully when permissions are denied. The permission surface varies dramatically across platforms.

### Permission Matrix

```
┌────────────────────┬──────────┬──────────┬──────────┐
│ Permission         │  macOS   │ Windows  │  Linux   │
├────────────────────┼──────────┼──────────┼──────────┤
│ Microphone         │ Required │ Required │ Required │
│                    │ (OS dlg) │ (browser)│ (browser)│
├────────────────────┼──────────┼──────────┼──────────┤
│ Screen Recording   │ Required │ N/A      │ N/A      │
│                    │ (OS dlg) │          │          │
├────────────────────┼──────────┼──────────┼──────────┤
│ System Audio       │ Required │ Granted  │ Granted  │
│ (Loopback)         │ (OS dlg) │ (WASAPI) │ (Pulse)  │
├────────────────────┼──────────┼──────────┼──────────┤
│ Accessibility      │ Optional │ N/A      │ N/A      │
│ (for some capture) │ (OS dlg) │          │          │
├────────────────────┼──────────┼──────────┼──────────┤
│ Autostart          │ Implicit │ Implicit │ Implicit │
│                    │ (LaunchAg│ (Registry│ (Desktop)│
└────────────────────┴──────────┴──────────┴──────────┘
```

### macOS Permission Flow

macOS has the strictest permission model. The application handles it through a **check → request → poll → degrade** pattern:

```
Feature Requested (e.g., Screen Capture)
         │
         ▼
┌─────────────────┐     Already granted
│ Check Permission ├──────────────────────► Proceed
└────────┬────────┘
         │ Not granted
         ▼
┌─────────────────┐
│ Request Permission│ ← OS shows system dialog
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Granted
│ Poll (up to 20s) ├──────────────────────► Proceed
│ (1s intervals)   │
└────────┬────────┘
         │ Timeout / Denied
         ▼
┌─────────────────┐
│ Show Setup Guide │ ← "Open System Preferences"
│ Degrade Gracefully│
└─────────────────┘
```

The polling pattern exists because macOS permission dialogs are non-blocking — the app doesn't receive a callback when the user clicks "Allow." Instead, it must periodically re-check the permission status.

A dedicated `tauri-plugin-macos-permissions` handles the native permission API calls, abstracting the Objective-C runtime behind a Tauri command interface.

### Content Protection as Anti-Permission

Rather than requesting screen recording permission for its own UI, Torvi takes the opposite approach: it **opts out of being captured**. The `contentProtected` flag on both windows tells the OS compositor to exclude the window from any screen capture, recording, or streaming. This is not a permission request — it's a declaration that this window's content should never appear in screenshots or recordings.

### Secure Storage Architecture

License keys require special handling — they must not be accessible to browser JavaScript (which could be inspected via DevTools) or stored in plaintext localStorage. The solution is a **Rust-side file store with a strict key allowlist**:

```
Frontend (JavaScript)                 Backend (Rust)
┌─────────────────┐                  ┌─────────────────────┐
│ invoke("secure_  │ ──── IPC ─────► │ Validate key name   │
│   storage_save", │                  │ against allowlist    │
│   { key, value })│                  │         │            │
│                  │                  │         ▼            │
│                  │                  │ Read JSON file       │
│                  │                  │ Update field         │
│                  │                  │ Write JSON file      │
│                  │                  │ ──► secure_storage.json
│                  │   ◄── result ──  │     in app_data_dir  │
└─────────────────┘                  └─────────────────────┘
```

Only three key names are accepted: `torvi_license_key`, `torvi_instance_id`, `selected_torvi_model`. Any other key is rejected with an error. This prevents the IPC interface from being abused as a general-purpose key-value store.

### License Validation Flow

The license system uses a **machine-bound activation model**:

```
Activation:
  User enters key → POST { license_key, instance_name: UUID, machine_id: hardware_hash }
       → Server validates → Returns { activated: true }
       → Stores key + instance_id in secure storage

Validation (periodic):
  POST { license_key, instance_id, machine_id }
       → Server checks → Returns { is_active: true/false, last_validated_at }
       → Caches result in LicenseState managed state

Deactivation:
  POST { license_key, instance_id, machine_id }
       → Server deactivates instance → Removes from secure storage
```

The `machine_id` is a hardware-derived identifier from `tauri-plugin-machine-uid`, making the license bound to the physical machine. The `instance_name` is a random UUID generated at activation time, uniquely identifying this installation.

### Permission-Gated Feature Pattern

Premium features use a **context-driven gating pattern** rather than route-level guards:

```
function PremiumFeature() {
  const { hasActiveLicense } = useAppContext()

  if (!hasActiveLicense) {
    return <GetLicensePrompt />
  }

  return <ActualFeature />
}
```

This is a deliberate choice: non-licensed users can navigate to any page and see the feature exists, but interactive elements are replaced with license prompts. This serves as both access control and marketing — users see what they're missing. The gating is purely client-side (the backend doesn't enforce it), which is appropriate because the premium features control local UI behavior, not server-side resources.

---

## Cross-Cutting Patterns

### Pattern: Platform Trait Abstraction

The same Rust trait is implemented per-platform behind conditional compilation (`#[cfg(target_os)]`). This keeps the command handler platform-agnostic:

```
                ┌──────────────────────┐
                │  SpeakerInput trait   │
                │  + new()             │
                │  + stream() → Stream │
                └──────────┬───────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
   ┌────────▼───┐  ┌──────▼────┐  ┌──────▼────┐
   │ Windows    │  │ macOS     │  │ Linux     │
   │ (WASAPI)   │  │ (cidre)   │  │ (Pulse)   │
   └────────────┘  └───────────┘  └───────────┘
```

The command handler calls `SpeakerInput::new()` and gets the platform-appropriate implementation. It never imports platform-specific code directly.

### Pattern: Debounced Persistence

Multiple features use a **debounce pattern for write operations** — particularly conversation saves:

1. AI response chunks arrive at ~50ms intervals
2. Each chunk updates React state (for rendering)
3. A debounced save function waits 500ms after the last chunk
4. Only then does it write the full conversation to SQLite

This prevents hundreds of database writes during a single response stream while ensuring data is persisted shortly after streaming completes.

### Pattern: Stale Closure Prevention

React hooks that register external listeners (Tauri events, global shortcuts) face stale closure issues — the listener captures the state values from when it was created, not the current values. Torvi handles this with `useRef` containers:

- Mutable values are stored in refs
- Listeners read from refs (always current)
- State setters (stable references) are called from listeners
- This avoids the need to re-register listeners when state changes

### Pattern: Graceful Degradation

Features that depend on external systems (audio hardware, AI providers, screenshot capture) follow a **try → catch → degrade** pattern rather than crashing:

- Audio capture failure → UI shows error state, retry button
- AI provider timeout → Error message displayed, conversation preserved
- Screenshot permission denied → Instructions shown, feature disabled
- cURL parse failure → Provider silently filtered from the list
- Database write failure → Transaction rolled back, error toasted

No single feature failure can crash the application or corrupt persistent state.

---

*This conceptual guide was derived from architectural analysis of the full torvi-master codebase.*
