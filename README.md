# Torvi — Complete Feature Reference

> Every feature implemented in this repository, grouped by category.  
> Each entry documents where it is implemented, which files are involved, what libraries are used, and how the logic works.

---

## Table of Contents

1. [Core Features](#1-core-features)
   - 1.1 Dual-Window Desktop Application
   - 1.2 Routing System
   - 1.3 Application State Management
   - 1.4 Theme System & Transparency
   - 1.5 SQLite Database Persistence
   - 1.6 localStorage Persistence Layer
   - 1.7 localStorage → SQLite Migration
   - 1.8 Cross-Window State Synchronization
   - 1.9 Error Boundary System
2. [AI Features](#2-ai-features)
   - 2.1 Overlay AI Chat (Main Completion)
   - 2.2 Dashboard Chat (Full Conversation View)
   - 2.3 AI Response Streaming Engine
   - 2.4 Built-in AI Providers (10)
   - 2.5 Custom AI Provider Management
   - 2.6 Torvi Premium API (Hosted Backend)
   - 2.7 Response Length Configuration
   - 2.8 Response Language Configuration
   - 2.9 System Prompts
   - 2.10 Conversation History & Management
   - 2.11 Message History Popover (Overlay)
   - 2.12 Keep Engaged Mode (Conversation Continuity)
   - 2.13 File Attachments (Images)
   - 2.14 AI-Assisted System Prompt Generation
3. [Desktop Features](#3-desktop-features)
   - 3.1 Transparent Overlay Window
   - 3.2 Dashboard Window
   - 3.3 Window Movement via Keyboard
   - 3.4 Dynamic Window Height
   - 3.5 Always-on-Top Toggle
   - 3.6 Autostart on System Boot
   - 3.7 App Icon Stealth Mode
   - 3.8 Content Protection (Anti-Screen-Capture)
   - 3.9 Custom Cursor (Invisible Mode)
   - 3.10 Drag-to-Move Window
   - 3.11 Title Attribute Stripping (Stealth)
   - 3.12 Global Keyboard Shortcuts (7 Actions)
   - 3.13 Custom Shortcut Bindings
   - 3.14 Screenshot Capture (Multi-Monitor)
   - 3.15 Screenshot Selection Overlay
   - 3.16 Screenshot Auto/Manual Modes
   - 3.17 Auto-Update System
   - 3.18 macOS NSPanel Integration
   - 3.19 Platform-Specific Audio Capture
4. [UI Features](#4-ui-features)
   - 4.1 Markdown Rendering (Rich Display)
   - 4.2 Syntax Highlighting (Shiki)
   - 4.3 Math Equation Rendering (KaTeX)
   - 4.4 Code Block Copy Button
   - 4.5 Shadcn UI Component Library (18+ Components)
   - 4.6 Dashboard Sidebar Navigation
   - 4.7 Layout System (Dashboard, Page, Error)
   - 4.8 Audio Visualizer (Canvas)
   - 4.9 Streaming Auto-Scroll
   - 4.10 Arrow Key Response Scrolling
   - 4.11 Paste Image from Clipboard
   - 4.12 Search & Filter (Conversations, Prompts)
   - 4.13 Empty State Displays
   - 4.14 Promote & Contribute Cards
5. [System Features](#5-system-features)
   - 5.1 Speech-to-Text (Microphone VAD)
   - 5.2 Built-in STT Providers (9)
   - 5.3 Custom STT Provider Management
   - 5.4 System Audio Capture Pipeline
   - 5.5 Voice Activity Detection (VAD) — Rust Engine
   - 5.6 VAD Configuration Panel
   - 5.7 Continuous Audio Recording Mode
   - 5.8 Quick Actions (System Audio)
   - 5.9 Context Templates (System Audio)
   - 5.10 Audio Device Selection
   - 5.11 License Management & Activation
   - 5.12 Premium Feature Gating
   - 5.13 Secure Storage (License Keys)
   - 5.14 PostHog Analytics
   - 5.15 Platform Permission Checks
   - 5.16 cURL Validation Engine
   - 5.17 HTML Sanitization (XSS Prevention)
   - 5.18 Signed Update Verification
   - 5.19 Markdown Export (Conversations)

---

## 1. Core Features

### 1.1 Dual-Window Desktop Application

**Implemented in:** Entry point + Tauri bootstrap + window management  
**Files involved:**
- `src/main.tsx` — Window label detection, conditional React tree rendering
- `src-tauri/src/lib.rs` — Plugin registration, managed states, setup closure
- `src-tauri/src/window.rs` — Window creation, positioning, toggle
- `src-tauri/tauri.conf.json` — Main window definition

**Libraries:** Tauri v2, React 19.1.0, ReactDOM

**How it works:**  
The entry point `main.tsx` reads the current window label from `window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label`. If the label starts with `capture-overlay-`, it renders only the lightweight `<Overlay>` screenshot selection component (no Context providers, no Router). Otherwise, it renders the full application tree: `<ThemeProvider>` → `<AppProvider>` → `<AppRoutes>`.

The Rust backend (`lib.rs`) bootstraps the application in a single `run()` function:
1. Initializes 12+ Tauri plugins (SQL, HTTP, updater, keychain, shell, opener, autostart, PostHog, machine-uid, global-shortcut, plus macOS-only NSPanel and permissions)
2. Registers 6 managed states: `AudioState`, `CaptureState`, `WindowVisibility`, `RegisteredShortcuts`, `LicenseState`, `MoveWindowState`
3. Runs `setup()` closure: positions main window top-center (54px Y offset), converts to NSPanel on macOS, creates dashboard window, initializes shortcut handler
4. Registers 39 IPC command handlers via `generate_handler![]`

The main window is defined in `tauri.conf.json` as 600×54px, no decorations, transparent, skip taskbar, content-protected. The dashboard window is created programmatically by `create_dashboard_window()` with platform-specific sizing (macOS: 1200×800 with hidden title bar; Windows/Linux: 800×600 with standard decorations).

---

### 1.2 Routing System

**Implemented in:** Route definitions + layout wrappers  
**Files involved:**
- `src/routes/index.tsx` — All route definitions
- `src/layouts/DashboardLayout.tsx` — Sidebar + content wrapper
- `src/layouts/PageLayout.tsx` — Header + scroll area wrapper
- `src/layouts/ErrorLayout.tsx` — Error boundary fallback

**Libraries:** react-router-dom v7.9.5

**How it works:**  
11 routes are defined using React Router's declarative API:

| Path | Page | Layout |
|------|------|--------|
| `/` | App (overlay) | Standalone |
| `/dashboard` | Dashboard (stats) | DashboardLayout |
| `/chats` | Conversation list | DashboardLayout |
| `/chats/view/:conversationId` | Conversation viewer | DashboardLayout |
| `/system-prompts` | Prompt management | DashboardLayout |
| `/shortcuts` | Shortcut settings | DashboardLayout |
| `/screenshot` | Screenshot settings | DashboardLayout |
| `/settings` | General settings | DashboardLayout |
| `/audio` | Audio device settings | DashboardLayout |
| `/responses` | Response configuration | DashboardLayout |
| `/dev-space` | Provider configuration | DashboardLayout |

All dashboard routes are wrapped in `<DashboardLayout>` which provides the sidebar navigation and a `data-tauri-drag-region` at the top for window dragging. The overlay route (`/`) is standalone with no layout wrapper.

---

### 1.3 Application State Management

**Implemented in:** React Context with localStorage persistence  
**Files involved:**
- `src/contexts/app.context.tsx` — Central state provider (~600 lines)
- `src/config/ai-providers.constants.ts` — Built-in AI provider definitions
- `src/config/stt.constants.ts` — Built-in STT provider definitions
- `src/config/constants.ts` — All localStorage keys and defaults

**Libraries:** React Context API

**How it works:**  
`AppContext` is the central state store managing:
- **AI Providers**: Merges built-in providers (`AI_PROVIDERS[]`) with custom providers from localStorage into `allAiProviders[]`. Selected provider stored as `{ provider: string, variables: Record<string, string> }`.
- **STT Providers**: Same merge pattern — `SPEECH_TO_TEXT_PROVIDERS[]` + custom → `allSttProviders[]`
- **System Prompt**: Active prompt text, loaded from SQLite system_prompts table
- **Screenshot Configuration**: `{ enabled, mode: 'auto'|'manual', autoPrompt }`
- **Customizable State**: `{ appIcon.isVisible, alwaysOnTop.isEnabled, autostart.isEnabled, cursor.type }`
- **License State**: `hasActiveLicense` (boolean), `torviApiEnabled` (boolean)
- **Audio Devices**: Selected input/output device IDs

On mount, `loadData()` reads all state from localStorage. Each setter writes through to localStorage via `useEffect`. cURL templates are validated on load using `curl2Json()` — invalid templates are filtered out. Variables are extracted using `{{VARIABLE}}` regex pattern.

---

### 1.4 Theme System & Transparency

**Implemented in:** React Context + CSS custom properties  
**Files involved:**
- `src/contexts/theme.context.tsx` — Theme state + persistence
- `src/global.css` — OKLCH color variables, dark/light tokens

**Libraries:** React Context API

**How it works:**  
Three theme modes: `light`, `dark`, `system`. The system mode uses `window.matchMedia('(prefers-color-scheme: dark)')` with an `addEventListener('change')` listener for real-time OS theme changes. Theme is applied by setting the `dark` class on the `<html>` element.

**Window transparency** is a separate concern: a 0–100 slider controlling CSS variables `--opacity` and `--backdrop-blur`. These are applied to the overlay card background, creating a glass-morphism effect. Both theme and transparency are persisted to localStorage and are premium-gated features (require active license).

---

### 1.5 SQLite Database Persistence

**Implemented in:** Tauri SQL plugin + frontend wrapper functions  
**Files involved:**
- `src/lib/database/config.ts` — Singleton DB instance
- `src/lib/database/chat-history.action.ts` — Conversation/message CRUD
- `src/lib/database/system-prompt.action.ts` — System prompt CRUD
- `src-tauri/src/db/mod.rs` — Migration loading
- `src-tauri/src/db/main.rs` — SQL operations

**Libraries:** `tauri-plugin-sql` (frontend), SQLite (backend)

**How it works:**  
Database singleton is created via `Database.load('sqlite:torvi.db')`. Two migration files run at startup:
1. **v1 — system_prompts**: `system_prompts` table with id, name, prompt, created_at, updated_at columns. Index on name. Trigger to auto-update `updated_at`.
2. **v2 — chat-history**: `conversations` table (id TEXT PK, title, created_at, updated_at) + `messages` table (id INTEGER PK, conversation_id FK, role CHECK('user'|'assistant'|'system'), content, timestamp, attached_files TEXT). 6 indexes for fast queries. 2 triggers to auto-update conversation timestamps on message INSERT/UPDATE.

Frontend CRUD functions use prepared statements via the plugin's `execute()` and `select()` methods. Transaction safety uses manual `BEGIN/COMMIT/ROLLBACK` for batch operations.

---

### 1.6 localStorage Persistence Layer

**Implemented in:** Storage wrapper functions  
**Files involved:**
- `src/lib/storage/helper.ts` — Safe get/set/remove wrappers
- `src/lib/storage/ai-providers.ts` — Custom AI provider storage
- `src/lib/storage/stt-providers.ts` — Custom STT provider storage
- `src/lib/storage/response-settings.storage.ts` — Response settings
- `src/lib/storage/shortcuts.storage.ts` — Shortcut bindings
- `src/config/constants.ts` — All key names and defaults

**Libraries:** Web Storage API (localStorage)

**How it works:**  
~15 localStorage keys store user preferences and custom configurations. The `helper.ts` provides safe wrappers that handle JSON parse/stringify with fallback defaults. Key data stored:
- `curl_custom_ai_providers` — Array of custom AI provider objects
- `curl_selected_ai_provider` — Currently selected AI provider + variables
- `curl_custom_speech_providers` — Array of custom STT provider objects
- `curl_selected_stt_provider` — Currently selected STT provider + variables
- `response_settings` — Response length + language preferences
- `shortcuts` — Custom shortcut bindings
- `theme` / `transparency` — Theme preferences
- `vad_config` — Voice Activity Detection parameters
- `system_audio_quick_actions` — Custom quick action buttons

---

### 1.7 localStorage → SQLite Migration

**Implemented in:** Migration helper in chat-history database module  
**Files involved:**
- `src/lib/database/chat-history.action.ts` — `migrateLocalStorageToSQLite()` function
- `src/hooks/useApp.ts` — Checks migration flag and triggers migration

**Libraries:** `tauri-plugin-sql`, Web Storage API

**How it works:**  
On app initialization, `useApp.ts` checks the `chat_history_migrated_to_sqlite` localStorage flag. If not set:
1. Reads all conversation data from localStorage
2. Inserts conversations and messages into SQLite tables
3. Sets the migration flag to prevent re-running
This is a one-time migration for users upgrading from the localStorage-only era.

---

### 1.8 Cross-Window State Synchronization

**Implemented in:** StorageEvent listener in AppContext  
**Files involved:**
- `src/contexts/app.context.tsx` — `storage` event listener

**Libraries:** Web Storage API (StorageEvent)

**How it works:**  
The `AppContext` registers a `window.addEventListener('storage', ...)` listener. When any window writes to localStorage, all other windows receive a `StorageEvent`. The handler checks if the changed key matches any known configuration key and calls `loadData()` to refresh the entire state. This enables real-time sync between the overlay window and dashboard window without any IPC overhead.

---

### 1.9 Error Boundary System

**Implemented in:** Error boundary wrappers around both windows  
**Files involved:**
- `src/main.tsx` — Error boundary wrapping full app tree
- `src/layouts/ErrorLayout.tsx` — Two variant error displays

**Libraries:** `react-error-boundary`

**How it works:**  
The `<ErrorBoundary>` component wraps the full React tree. On unhandled errors:
- **Overlay mode**: Shows compact error with a reload button + drag button (to still allow window movement)
- **Dashboard mode**: Shows full-page error with Torvi branding, error message, and reload button

---

## 2. AI Features

### 2.1 Overlay AI Chat (Main Completion)

**Implemented in:** Custom hook + overlay page components  
**Files involved:**
- `src/hooks/useCompletion.ts` — Core chat logic (~800+ lines)
- `src/pages/app/index.tsx` — Overlay page
- `src/pages/app/components/completion/index.tsx` — Completion UI
- `src/pages/app/components/completion/Input.tsx` — Text input component

**Libraries:** React, Tauri invoke, AbortController

**How it works:**  
1. User types a message in the input field and presses Enter
2. Hook builds a messages array: system prompt + conversation history + user message + attached images
3. Calls `fetchAIResponse()` which routes to either Torvi API or custom cURL provider
4. Streams response via async generator → updates `response` state in real-time → popover opens showing streamed markdown
5. On completion, saves the conversation to SQLite with a 500ms debounce

**Sub-features:**
- **Abort Control**: Each request gets a unique `requestId`. `cancel()` calls `AbortController.abort()`. Stale responses (mismatched requestId) are silently dropped — no wasted API tokens.
- **Auto-scroll**: ScrollArea ref auto-scrolls to bottom on new content.
- **Window Resize**: Window expands from 54px → 600px when popover opens, collapses back when closed, via `set_window_height` Tauri command.
- **New Conversation**: Generates UUID, resets all state, focuses input.

---

### 2.2 Dashboard Chat (Full Conversation View)

**Implemented in:** Custom hook + chat page components  
**Files involved:**
- `src/hooks/useChatCompletion.ts` — Dashboard chat logic (~700+ lines)
- `src/pages/chats/index.tsx` — Conversation list
- `src/pages/chats/view/index.tsx` — Single conversation viewer

**Libraries:** React, Tauri invoke, react-router-dom

**How it works:**  
1. Loads conversation from SQLite by `conversationId` route param
2. User types in textarea at bottom → sends via Enter or Send button
3. Same AI response pipeline as overlay (shared `fetchAIResponse`)
4. Messages displayed in chat-bubble format: user messages right-aligned, AI messages left-aligned, with role avatars
5. Date separators between messages on different days

**Sub-features:**
- File attachments in chat view with dedicated `ChatFiles` component
- Audio recording in chat with `AudioRecorder` component
- Screenshot capture in chat with `ChatScreenshot` component
- "Attach to Overlay" — sends conversation to overlay window for quick access
- Download conversation as markdown `.md` file
- Delete conversation with confirmation dialog
- Premium-gated: input disabled without active license; shows license prompt

---

### 2.3 AI Response Streaming Engine

**Implemented in:** Async generator function with dual execution paths  
**Files involved:**
- `src/lib/functions/ai-response.function.ts` — Core streaming engine
- `src/lib/functions/common.function.ts` — Template processing, variable replacement
- `src-tauri/src/api.rs` — Rust-side SSE streaming for Torvi API

**Libraries:** Tauri invoke/listen, `@bany/curl-to-json`

**How it works:**  
Two execution paths:

**Path A — Torvi Premium API:**
1. Frontend calls `chat_stream_response` Tauri command
2. Rust fetches API config from `{APP_ENDPOINT}/api/response` (returns URL, token, model, extra body params)
3. Rust builds OpenAI-compatible request with messages array, POSTs with `stream: true`
4. Rust parses SSE `bytes_stream()` — buffers incomplete lines, extracts `data: {json}` lines, stops on `data: [DONE]`
5. Emits `chat_stream_chunk` event per content delta
6. Frontend polls at 50ms intervals via `listen()`, yields chunks from async generator
7. Emits `chat_stream_complete` with full response text

**Path B — Custom cURL Provider:**
1. Parses cURL template via `curl2Json()` → extracts URL, headers, body
2. Replaces variables: `{{API_KEY}}`, `{{MODEL}}`, `{{TEXT}}`, `{{IMAGE}}`, `{{SYSTEM_PROMPT}}`
3. `deepVariableReplacer()` recursively replaces variables in nested JSON objects
4. Issues HTTP fetch with constructed request
5. For streaming providers: reads SSE response, parses `data:` lines, extracts content via `responseContentPath` (e.g., `choices.0.delta.content`)
6. Yields text chunks as they arrive

**Dynamic message building** constructs provider-specific formats: OpenAI-style `messages[]`, Claude-style with separate `system`, or Gemini-style with `contents[]`. Images injected as `image_url` (OpenAI), `source.data` (Claude), or `inline_data` (Gemini).

---

### 2.4 Built-in AI Providers (10)

**Implemented in:** Static configuration constants  
**Files involved:**
- `src/config/ai-providers.constants.ts` — All 10 provider definitions

**Libraries:** None (pure configuration)

**How it works:**  
Each provider is defined with: `name`, `curl` (full cURL template with `{{VARIABLE}}` placeholders), `responseContentPath` (JSONPath to streamed text), and `streaming: true`. Providers:

| # | Provider | Endpoint | Response Path |
|---|----------|----------|---------------|
| 1 | **OpenAI** | `api.openai.com/v1/chat/completions` | `choices.0.delta.content` |
| 2 | **Claude** | `api.anthropic.com/v1/messages` | `delta.text` |
| 3 | **Grok** | `api.x.ai/v1/chat/completions` | `choices.0.delta.content` |
| 4 | **Gemini** | `generativelanguage.googleapis.com` | `candidates.0.content.parts.0.text` |
| 5 | **Mistral** | `api.mistral.ai/v1/chat/completions` | `choices.0.delta.content` |
| 6 | **Cohere** | `api.cohere.com/v2/chat` | `delta.message.content.text` |
| 7 | **Groq** | `api.groq.com/openai/v1/chat/completions` | `choices.0.delta.content` |
| 8 | **Perplexity** | `api.perplexity.ai/chat/completions` | `choices.0.delta.content` |
| 9 | **OpenRouter** | `openrouter.ai/api/v1/chat/completions` | `choices.0.delta.content` |
| 10 | **Ollama** | `localhost:11434/api/chat` | `message.content` |

All support SSE streaming and vision/image inputs via `{{IMAGE}}` variable.

---

### 2.5 Custom AI Provider Management

**Implemented in:** Custom hook + storage + dev space UI  
**Files involved:**
- `src/hooks/useCustomProvider.ts` — CRUD logic
- `src/lib/storage/ai-providers.ts` — localStorage persistence
- `src/lib/curl-validator.ts` — cURL validation
- `src/pages/dev/` — Provider configuration UI

**Libraries:** `@bany/curl-to-json`, localStorage

**How it works:**  
Full CRUD for user-defined AI providers:
1. **Create**: User provides name + cURL template + optional `responseContentPath` + streaming toggle
2. **Validate**: cURL must start with `curl`, must be parseable by `curl2Json()`, must contain `{{TEXT}}` variable
3. **Extract Variables**: Regex `{{([A-Z_]+)}}` finds all placeholders → UI shows fields for each
4. **Store**: Saved to localStorage with unique ID (`provider_` + timestamp + random)
5. **Merge**: On load, custom providers appended to built-in providers in `allAiProviders[]`

Users can edit, delete, or duplicate providers. Auto-fill templates are available from built-in providers.

---

### 2.6 Torvi Premium API (Hosted Backend)

**Implemented in:** Rust API module + frontend routing logic  
**Files involved:**
- `src-tauri/src/api.rs` — Streaming, transcription, models, activity
- `src/lib/functions/torvi.api.ts` — `shouldUseTorviAPI()` routing decision
- `src/pages/dashboard/` — Usage dashboard

**Libraries:** `reqwest` (Rust), `serde_json`

**How it works:**  
When user has an active license and Torvi API is enabled (`shouldUseTorviAPI()` returns true), requests route through the Rust backend:
- `fetch_api_response_config` → GET to Torvi server with license/machine headers → returns AI routing config
- `chat_stream_response` → SSE streaming with OpenAI-compatible format through Torvi's proxy
- `transcribe_audio` → POST audio with primary + fallback endpoints
- `fetch_models` → GET available model list
- `get_activity` → GET usage statistics → displayed in dashboard as line chart (recharts)

Error reporting: background `report_api_error()` to `{APP_ENDPOINT}/api/error`.

---

### 2.7 Response Length Configuration

**Implemented in:** Response settings constants + system prompt injection  
**Files involved:**
- `src/lib/response-settings.constants.ts` — Length options
- `src/lib/storage/response-settings.storage.ts` — Persistence
- `src/pages/responses/` — Settings UI
- `src/lib/functions/ai-response.function.ts` — Injection into system prompt

**Libraries:** localStorage

**How it works:**  
Three options: **Short** ("1-2 sentences"), **Medium** ("2-4 sentences, clear structure"), **Auto** (no constraint). The selected length is injected as an additional instruction appended to the system prompt at request time. Premium-gated feature.

---

### 2.8 Response Language Configuration

**Implemented in:** Language constants + system prompt injection  
**Files involved:**
- `src/lib/response-settings.constants.ts` — 27+ languages with flag emojis
- `src/lib/storage/response-settings.storage.ts` — Persistence
- `src/pages/responses/` — Settings UI

**Libraries:** localStorage

**How it works:**  
27+ languages available: English, Spanish, French, German, Japanese, Korean, Chinese, Arabic, Hindi, Portuguese, Russian, Italian, Dutch, Turkish, Polish, Swedish, Thai, Vietnamese, Indonesian, Greek, Czech, Romanian, Hungarian, Finnish, Danish, Norwegian, Hebrew. When a non-default language is selected, the instruction `"IMPORTANT: You MUST respond in {language}"` is appended to the system prompt. Premium-gated feature.

---

### 2.9 System Prompts

**Implemented in:** Custom hook + SQLite CRUD + management UI  
**Files involved:**
- `src/hooks/useSystemPrompts.ts` — CRUD operations
- `src/lib/database/system-prompt.action.ts` — SQLite queries
- `src/pages/system-prompts/index.tsx` — Management page

**Libraries:** `tauri-plugin-sql` (SQLite)

**How it works:**  
Full CRUD on the `system_prompts` SQLite table:
- **Create**: Name + prompt text. Auto-selects the newly created prompt as active.
- **Edit**: Update name and/or prompt content.
- **Delete**: Confirmation dialog before removal.
- **Select/Activate**: Click a prompt card to set as active. Active prompt shown with green checkmark. Stored in AppContext and synced to localStorage.
- **Search**: Filter prompts by name or content (case-insensitive).

Default system prompt: *"You are a helpful assistant. Help the user with their query or question to the best of your ability."*

---

### 2.10 Conversation History & Management

**Implemented in:** Custom hook + SQLite queries + chat list page  
**Files involved:**
- `src/hooks/useHistory.ts` — Conversation list loading, search
- `src/lib/database/chat-history.action.ts` — SQLite CRUD
- `src/pages/chats/index.tsx` — Conversation list UI

**Libraries:** `tauri-plugin-sql`, `moment`

**How it works:**  
Lists all conversations from SQLite ordered by `updated_at DESC`, grouped by date (e.g., "Mon, Jun 9"). Each entry shows title, message count badge, and timestamp (HH:MM AM/PM). Actions per conversation:
- **View**: Navigate to `/chats/view/:id`
- **Delete**: Confirmation dialog → removes from SQLite
- **Download**: Export entire conversation as `.md` markdown file
- **Attach to Overlay**: Sets `localStorage` key → overlay reads via `storage` event and loads the conversation

---

### 2.11 Message History Popover (Overlay)

**Implemented in:** Overlay completion component  
**Files involved:**
- `src/pages/app/components/completion/MessageHistory.tsx` — Popover UI

**Libraries:** Radix Popover (via Shadcn)

**How it works:**  
Button in the overlay showing message count. Opens a popover with the full conversation in reverse chronological order. Each message shows role (You/AI), timestamp, and markdown-rendered content. "New Chat" button resets the conversation state.

---

### 2.12 Keep Engaged Mode (Conversation Continuity)

**Implemented in:** Completion hook state toggle  
**Files involved:**
- `src/hooks/useCompletion.ts` — `keepEngaged` state + Cmd/Ctrl+K toggle

**Libraries:** React

**How it works:**  
Toggle via Cmd/Ctrl+K keyboard shortcut. When **on**, the full conversation history is included in each AI request, maintaining context across messages. When **off**, each prompt is standalone (no history sent). When engaged, conversation history is displayed in the overlay in reverse chronological order with user/AI markers.

---

### 2.13 File Attachments (Images)

**Implemented in:** Completion hook + file UI component  
**Files involved:**
- `src/hooks/useCompletion.ts` — Attachment state, file processing
- `src/pages/app/components/completion/Files.tsx` — File display grid

**Libraries:** FileReader API

**How it works:**  
Max 6 image attachments (`MAX_FILES`). Three input methods:
1. **File picker**: `<input type="file" accept="image/*">` opens native file dialog
2. **Paste from clipboard**: `onPaste` handler reads clipboard for image data, converts to base64
3. **Screenshot capture**: Captured image added as attachment

Images are converted to base64 via FileReader and stored as `AttachedFile` objects `{ id, name, type, base64, size }`. Display uses an adaptive grid (1 column for ≤2 images, 2 columns for 3+). Each image has a preview, file name, size overlay, and individual remove button.

---

### 2.14 AI-Assisted System Prompt Generation

**Implemented in:** System prompts page + Torvi API  
**Files involved:**
- `src/pages/system-prompts/index.tsx` — Generate button
- `src-tauri/src/api.rs` — `create_system_prompt` command

**Libraries:** Tauri invoke, `reqwest`

**How it works:**  
User clicks "Generate" → sends a description to `{APP_ENDPOINT}/api/prompt` via the `create_system_prompt` Tauri command → Torvi server uses AI to generate a complete system prompt → returned to frontend → auto-fills the prompt text field.

---

## 3. Desktop Features

### 3.1 Transparent Overlay Window

**Implemented in:** Tauri window configuration + CSS  
**Files involved:**
- `src-tauri/tauri.conf.json` — Main window definition
- `src-tauri/src/window.rs` — `setup_main_window()` positioning
- `src/global.css` — Transparency CSS variables

**Libraries:** Tauri v2

**How it works:**  
Main window configured as: 600×54px, `decorations: false`, `transparent: true`, `skipTaskbar: true`, `contentProtected: true`, `shadow: false`, `focus: false`, `acceptFirstMouse: true`. Positioned at top-center of primary monitor with 54px vertical offset via `position_window_top_center()`. CSS supports variable transparency via `--opacity` and `--backdrop-blur` properties for glass-morphism effect.

---

### 3.2 Dashboard Window

**Implemented in:** Programmatic window creation  
**Files involved:**
- `src-tauri/src/window.rs` — `create_dashboard_window()`, `open_dashboard()`, `toggle_dashboard()`

**Libraries:** Tauri v2 window API

**How it works:**  
Created on-demand (not at startup) via `open_dashboard()`. Platform-specific configuration:
- **macOS**: 1200×800, overlay title bar style, hidden title, traffic lights at (14, 18)
- **Windows/Linux**: 800×600, standard decorations
- Both: `contentProtected: true`, centered, min size 800×600, URL `/chats`

Toggle cycle: visible → hide | hidden → show + focus | doesn't exist → create.

---

### 3.3 Window Movement via Keyboard

**Implemented in:** Shortcut handler + async movement loop  
**Files involved:**
- `src-tauri/src/shortcuts.rs` — `start_move_window()`, `stop_move_window()`

**Libraries:** `tauri-plugin-global-shortcut`, `tokio`

**How it works:**  
When move shortcut is pressed, spawns an async task that moves the window by 12 physical pixels every 16ms (~60fps). Uses `AtomicBool` stop flag per direction. On key release, `stop_move_window()` sets the flag. Each of the 4 directions (up/down/left/right) has its own sub-shortcut and task. Premium-gated: won't start if license is inactive.

---

### 3.4 Dynamic Window Height

**Implemented in:** Tauri command + frontend hook  
**Files involved:**
- `src-tauri/src/window.rs` — `set_window_height()`
- `src/hooks/useWindow.ts` — Height management

**Libraries:** Tauri v2

**How it works:**  
Width is fixed at 600 logical pixels. Height is dynamically adjusted via `set_window_height()` which calls `window.set_size(LogicalSize::new(600.0, height))`. The overlay starts at 54px (just the input). When AI response popover opens, it expands to ~600px. When popover closes, it shrinks back. A `MutationObserver` watches for `[data-radix-popper-content-wrapper]` elements to detect popover state changes.

---

### 3.5 Always-on-Top Toggle

**Implemented in:** Settings page + Tauri command  
**Files involved:**
- `src/pages/settings/` — Toggle switch UI
- `src-tauri/src/shortcuts.rs` — `set_always_on_top()` command
- `src/contexts/app.context.tsx` — State persistence

**Libraries:** Tauri v2

**How it works:**  
Toggle switch calls `invoke("set_always_on_top", { enabled })`. The Rust handler calls `window.set_always_on_top(enabled)` on the main window. State persisted to localStorage via the customizable state in AppContext.

---

### 3.6 Autostart on System Boot

**Implemented in:** Settings page + Tauri autostart plugin  
**Files involved:**
- `src/pages/settings/` — Toggle switch UI
- `src-tauri/src/lib.rs` — Plugin registration

**Libraries:** `tauri-plugin-autostart`

**How it works:**  
Toggle switch calls `enable()` or `disable()` from the autostart plugin. On macOS, uses `LaunchAgent`. Persisted to localStorage via customizable state.

---

### 3.7 App Icon Stealth Mode

**Implemented in:** Settings page + Tauri command  
**Files involved:**
- `src/pages/settings/` — Toggle switch UI
- `src-tauri/src/shortcuts.rs` — `set_app_icon_visibility()`

**Libraries:** Tauri v2

**How it works:**  
Toggle to hide/show the app icon from dock/taskbar. Implementation is platform-specific:
- **macOS**: `set_activation_policy(Regular)` (visible) or `set_activation_policy(Accessory)` (hidden)
- **Windows/Linux**: `set_skip_taskbar(!visible)`

When hidden, the app is completely invisible in the task switcher — maximum discretion for meeting/interview scenarios.

---

### 3.8 Content Protection (Anti-Screen-Capture)

**Implemented in:** Tauri window configuration  
**Files involved:**
- `src-tauri/tauri.conf.json` — `contentProtected: true`
- `src-tauri/src/window.rs` — Also applied to dashboard window

**Libraries:** Tauri v2 (OS-level flag)

**How it works:**  
Both main and dashboard windows have `contentProtected: true`. This is an OS-level flag that prevents screen recording and screen sharing applications from capturing the window content. The window appears as a black rectangle in recordings. This is the core stealth feature for meeting/interview use cases.

---

### 3.9 Custom Cursor (Invisible Mode)

**Implemented in:** React component + CSS  
**Files involved:**
- `src/components/CustomCursor.tsx` — Custom cursor rendering
- `src/global.css` — `--cursor-type` CSS variable
- `src/contexts/app.context.tsx` — Cursor type state

**Libraries:** React, Lucide React (`MousePointer2` icon)

**How it works:**  
Three cursor types: **Invisible**, **Default**, **Auto**. When set to "Invisible":
1. Native cursor hidden via CSS `cursor: none` (applied via `--cursor-type` CSS variable)
2. A `<MousePointer2>` Lucide icon is rendered at the mouse position using `requestAnimationFrame` loop
3. Position tracked via `mousemove` listener, applied with `transform: translate3d()` for smooth GPU-accelerated rendering
4. Hides on `mouseLeave` and `window.blur`
5. Disabled on Linux (not supported)
6. Dashboard window always uses "Default" cursor regardless of setting

---

### 3.10 Drag-to-Move Window

**Implemented in:** Drag button component  
**Files involved:**
- `src/components/DragButton.tsx` — Drag handle with `data-tauri-drag-region`
- `src/layouts/DashboardLayout.tsx` — Dashboard drag region

**Libraries:** Tauri v2 (native drag handling)

**How it works:**  
The overlay window has a `<DragButton>` component that renders a handle icon with `data-tauri-drag-region` attribute. This Tauri-recognized attribute enables native OS window dragging when the user clicks and drags on it. The dashboard layout has a similar drag region at the top. Premium-gated on the overlay window.

---

### 3.11 Title Attribute Stripping (Stealth)

**Implemented in:** MutationObserver in app hook  
**Files involved:**
- `src/hooks/useTitles.ts` — DOM observer

**Libraries:** MutationObserver API

**How it works:**  
Uses `MutationObserver` on `document.body` to detect all elements with `title` attributes and removes them immediately. This prevents tooltip leaks that could reveal the app's purpose during screen sharing — part of the stealth mode.

---

### 3.12 Global Keyboard Shortcuts (7 Actions)

**Implemented in:** Tauri global shortcut plugin + Rust handler + frontend bridge  
**Files involved:**
- `src-tauri/src/shortcuts.rs` — Registration, routing, handler
- `src-tauri/src/lib.rs` — Plugin setup with centralized handler
- `src/hooks/useGlobalShortcuts.ts` — Frontend event bridge
- `src/config/shortcuts.ts` — Default bindings
- `src/lib/storage/shortcuts.storage.ts` — Custom binding persistence

**Libraries:** `tauri-plugin-global-shortcut`

**How it works:**  
7 system-wide shortcuts with platform-specific defaults:

| Action | Windows/Linux | macOS |
|--------|---------------|-------|
| Toggle Dashboard | Alt+D | Option+D |
| Toggle Window | Alt+Space | Option+Space |
| Focus Input | Alt+F | Option+F |
| Move Window | Alt+Arrow | Option+Arrow |
| System Audio | Alt+S | Option+S |
| Audio Recording | Alt+R | Option+R |
| Screenshot | Alt+C | Option+C |

The Rust handler is a centralized function that:
1. Looks up `action_id` from `RegisteredShortcuts` HashMap by matching the pressed shortcut
2. Routes to appropriate handler based on action:
   - `toggle_dashboard` → show/hide/create dashboard window
   - `toggle_window` → platform-specific show/hide (Windows: emit event; macOS: NSPanel orderFront/orderOut)
   - `focus_input` → show window + emit `focus-text-input` event
   - `audio_recording` → show window + emit `start-audio-recording` event
   - `screenshot` → emit `trigger-screenshot` event (300ms debounce)
   - `system_audio` → show window + emit `toggle-system-audio` event
   - `move_window_*` → continuous movement at ~60fps

Frontend `useGlobalShortcuts.ts` uses a global singleton pattern to prevent duplicate listeners in React StrictMode. Registers Tauri event listeners for each shortcut event and routes to the appropriate callback.

---

### 3.13 Custom Shortcut Bindings

**Implemented in:** Settings page + validation  
**Files involved:**
- `src/pages/shortcuts/` — Visual shortcut editor
- `src/hooks/useShortcuts.ts` — Binding editor logic, conflict detection
- `src-tauri/src/shortcuts.rs` — `validate_shortcut_key()`, `update_shortcuts()`

**Libraries:** `tauri-plugin-global-shortcut`

**How it works:**  
Users can rebind all 7 shortcuts via the shortcuts settings page. Key recording captures the physical key combination. Validation rules:
- Must include at least one modifier (Alt/Option/Ctrl/Cmd/Shift)
- Must include a letter, number, or function key
- No two shortcuts can share the same key combination (conflict detection)

On save, all existing shortcuts are unregistered, new bindings are registered. Registration failures emit `shortcut-registration-error` events shown as user-facing toasts.

---

### 3.14 Screenshot Capture (Multi-Monitor)

**Implemented in:** Rust capture module  
**Files involved:**
- `src-tauri/src/capture.rs` — Multi-monitor capture, overlay window creation, crop, encode

**Libraries:** `xcap` 0.0.12, `image` 0.25.6, `base64`

**How it works:**  
1. `start_screen_capture()` calls `xcap::Monitor::all()` to enumerate all monitors
2. Captures a full screenshot of every monitor, stores in `CaptureState.captured_monitors` HashMap (key: index, value: RgbaImage)
3. Creates one transparent overlay window per monitor (`capture-overlay-{index}`) with proper DPI scaling
4. Each overlay window gets: transparent background, always-on-top, no decorations, skip taskbar, accept first mouse
5. After user selects a region, `capture_selected_area()` crops the stored full image using the DPI-adjusted coordinates
6. Encodes cropped region to PNG → base64 → emits `captured-selection` event
7. `close_overlay_window()` destroys all overlay windows and clears state

---

### 3.15 Screenshot Selection Overlay

**Implemented in:** React Overlay component  
**Files involved:**
- `src/components/Overlay.tsx` — Fullscreen canvas selection UI
- `src/main.tsx` — Conditional rendering for overlay windows

**Libraries:** React, Lucide React

**How it works:**  
Fullscreen `position: fixed` overlay with `rgba(15,23,42,0.35)` background + `blur(2px)` backdrop filter. Mouse interaction:
1. `mouseDown` → record start coordinates, show selection rectangle
2. `mouseMove` → update rectangle dimensions in real-time
3. `mouseUp` → if selection ≥ 10×10px: invoke `capture_selected_area` with DPI-scaled coordinates; else: treat as click, cancel

DPI handling: coordinates multiplied by `window.devicePixelRatio` before sending to Rust. ESC key cancellation is triple-registered (document, body, window) for reliability. Custom crosshair cursor displayed. Cancel button in top-right corner. Instruction banner: "Click and drag to select area · Press ESC to cancel".

---

### 3.16 Screenshot Auto/Manual Modes

**Implemented in:** Screenshot settings page + completion hook  
**Files involved:**
- `src/pages/screenshot/` — Settings UI
- `src/hooks/useCompletion.ts` — Mode-specific handling

**Libraries:** React

**How it works:**  
Two processing modes configured in settings:
- **Auto Mode**: When user sends a message, screenshot is automatically captured and submitted to AI with the configured `autoPrompt`. Single screenshot at a time.
- **Manual Mode**: Screenshot is captured and added to the attached files list. User can capture multiple screenshots, then submit with a custom prompt.

macOS requires screen recording permission (checked before capture). 300ms debounce prevents double-capture on rapid shortcut presses.

---

### 3.17 Auto-Update System

**Implemented in:** Updater component + Tauri updater plugin  
**Files involved:**
- `src/components/updater/index.tsx` — Updater UI
- `src-tauri/tauri.conf.json` — Update endpoint + public key

**Libraries:** `tauri-plugin-updater`, `tauri-plugin-process`

**How it works:**  
On component mount, checks `https://torvi.com/api/update/{target}/{arch}/{current_version}` for updates. If one is found:
1. Shows popover with version info + release notes (rendered as markdown)
2. "Download & Install" button initiates download
3. Progress tracking shows downloaded bytes, content length, percentage
4. States cycle: checking → available → downloading → installing → ready
5. Auto-relaunches after 2s post-install via `relaunch()`

Updates are signed with Ed25519 public key embedded in `tauri.conf.json`. Windows uses passive (silent) install mode. Prevents popover close during active download/install. Error state shows "Try Again" button.

---

### 3.18 macOS NSPanel Integration

**Implemented in:** Setup closure + plugin  
**Files involved:**
- `src-tauri/src/lib.rs` — NSPanel initialization in `setup()`

**Libraries:** `tauri-nspanel` (macOS only)

**How it works:**  
During setup, the main window is converted to an NSPanel with:
- `NSFloatWindowLevel` (level 4) — floats above normal windows
- `NSWindowStyleMaskNonActivatingPanel` — clicking the window doesn't steal focus from other apps
- `CanJoinAllSpaces + FullScreenAuxiliary` collection behavior — visible on all virtual desktops and alongside fullscreen apps

This is critical for the meeting assistant use case: the overlay stays visible during video calls without stealing focus from the conferencing app.

---

### 3.19 Platform-Specific Audio Capture

**Implemented in:** Rust speaker module with platform implementations  
**Files involved:**
- `src-tauri/src/speaker/mod.rs` — `SpeakerInput` trait, stream abstraction
- `src-tauri/src/speaker/windows.rs` — WASAPI loopback implementation
- `src-tauri/src/speaker/macos.rs` — Core Audio via cidre
- `src-tauri/src/speaker/linux.rs` — PulseAudio simple API

**Libraries:**
- Windows: `wasapi` 0.19
- macOS: `cidre` 0.11.3
- Linux: `libpulse-simple-binding` + `libpulse-binding`
- All: `ringbuf` 0.4.8 (lock-free ring buffer)

**How it works:**  
All platforms implement the `SpeakerInput` trait:

| Platform | Capture Method | Details |
|----------|---------------|---------|
| **Windows** | WASAPI loopback | Captures system output (speakers). Creates render client → capture stream → f32 mono. 128KB ring buffer with overflow handling (drops old data). |
| **macOS** | Core Audio process tap | `TapDesc::with_mono_global_tap_excluding_processes` — captures all system audio except own process. Ring buffer via `ringbuf`. Dynamic sample rate adaptation via Core Audio listener. |
| **Linux** | PulseAudio monitor | Connects to `@DEFAULT_MONITOR@` source. 44.1kHz f32 mono, 4096 frame buffer. |

Each produces a `SpeakerStream` implementing `futures_util::Stream<Item = f32>` for uniform downstream processing.

---

## 4. UI Features

### 4.1 Markdown Rendering (Rich Display)

**Implemented in:** Custom Markdown component  
**Files involved:**
- `src/components/Markdown/index.tsx` — Rich markdown renderer

**Libraries:** `react-markdown`, `remark-gfm`, `remark-math`, `rehype-raw`, `rehype-sanitize`, `rehype-katex`

**How it works:**  
AI responses are rendered as rich markdown with:
- **GitHub Flavored Markdown** (GFM): tables, strikethrough, task lists via `remark-gfm`
- **Math equations**: Display (`\[...\]`) and inline (`\(...\)`) via `remark-math` + `rehype-katex`
- **Raw HTML**: Allowed but sanitized via `rehype-raw` + `rehype-sanitize`
- **Links**: All links open in external browser via Tauri's `openUrl`
- **Custom component overrides**: Headings, lists, tables, blockquotes, links, and code blocks all use custom-styled components

---

### 4.2 Syntax Highlighting (Shiki)

**Implemented in:** Markdown code block renderer  
**Files involved:**
- `src/components/Markdown/index.tsx` — `HighlightedPre` component

**Libraries:** `shiki` v3

**How it works:**  
Code blocks are syntax-highlighted using Shiki with dual themes: `github-light` (light mode) and `github-dark` (dark mode). Loading is **lazy** via React Suspense — the fallback renders unstyled `<pre>` code instantly, and the highlighted version replaces it once Shiki finishes loading. `React.memo` and `React.useMemo` are used on the highlight component for performance (prevents re-highlighting on parent re-renders).

---

### 4.3 Math Equation Rendering (KaTeX)

**Implemented in:** Markdown renderer plugins  
**Files involved:**
- `src/components/Markdown/index.tsx` — rehype-katex plugin

**Libraries:** `remark-math`, `rehype-katex`

**How it works:**  
`remark-math` parses `$...$` (inline) and `$$...$$` / `\[...\]` (display) math syntax from markdown. `rehype-katex` converts the parsed AST nodes into KaTeX-rendered HTML. This enables AI responses to include mathematical formulas with proper rendering.

---

### 4.4 Code Block Copy Button

**Implemented in:** Copy button component  
**Files involved:**
- `src/components/Markdown/copy-button.tsx` — Copy button with animation

**Libraries:** Clipboard API

**How it works:**  
Appears on hover over code blocks. Clicking copies the code content to clipboard via `navigator.clipboard.writeText()`. Shows a 2-second success animation: the copy icon swaps to a checkmark icon, then reverts. Uses `useCopyToClipboard` hook that manages the copied/not-copied state transition.

---

### 4.5 Shadcn UI Component Library (18+ Components)

**Implemented in:** UI component directory  
**Files involved:**
- `src/components/ui/` — All primitive components
- `components.json` — Shadcn configuration

**Libraries:** Radix UI primitives, Tailwind CSS 4.1.12, `class-variance-authority`, `tailwind-merge`, `clsx`

**How it works:**  
18+ components initialized via `npx shadcn@latest add`: badge, button, card, chart, command, dialog, dropdown-menu, empty, input, label, popover, scroll-area, select, slider, switch, textarea, tooltip, and more. Configured with:
- **Style**: new-york variant
- **Base color**: neutral (OKLCH color space)
- **CSS variables**: enabled for theming
- **Icon library**: Lucide React

---

### 4.6 Dashboard Sidebar Navigation

**Implemented in:** Sidebar component + menu items hook  
**Files involved:**
- `src/components/Sidebar.tsx` — Sidebar UI
- `src/hooks/useMenuItems.tsx` — Menu item definitions

**Libraries:** React Router, Lucide React

**How it works:**  
256px wide sidebar with:
- Torvi logo + version number (loaded via `getVersion()` Tauri command)
- 9 navigation items with icons and active state highlighting (rounded background on active route)
- Item count badges (e.g., number of system prompts, conversations)
- Footer row: X (Twitter), GitHub links (open via `openUrl`)
- Footer items: Contact Support (licensed users, opens `mailto:`), Report Bug (GitHub issues), Quit (`exit()` Tauri command)

---

### 4.7 Layout System (Dashboard, Page, Error)

**Implemented in:** Three layout wrappers  
**Files involved:**
- `src/layouts/DashboardLayout.tsx` — Sidebar + content
- `src/layouts/PageLayout.tsx` — Header + scroll area
- `src/layouts/ErrorLayout.tsx` — Error boundary fallback

**Libraries:** React Router (`<Outlet>`), Radix ScrollArea

**How it works:**
- **DashboardLayout**: Renders `<Sidebar>` (256px) + main content area with `<Outlet>`. Includes a `data-tauri-drag-region` at the top for window dragging. Wrapped in `<ErrorBoundary>`.
- **PageLayout**: Header (title + description + optional right slot + optional back button) + `<ScrollArea>` for scrollable content. Includes `<Promote>` card for non-licensed users.
- **ErrorLayout**: Two variants — compact (overlay, shows reload + drag button) and full-page (centered error with Torvi branding + reload button).

---

### 4.8 Audio Visualizer (Canvas)

**Implemented in:** Canvas-based frequency display  
**Files involved:**
- `src/pages/app/components/speech/audio-visualizer.tsx` — Visualizer component

**Libraries:** Web Audio API (AudioContext, AnalyserNode)

**How it works:**  
Creates `AudioContext` → `AnalyserNode` (FFT size 512, smoothing 0.8) → `MediaStreamSource` from system audio stream. Draws vertical bars centered vertically on a canvas element, mirrored above/below the center line. Bar color intensity maps to frequency amplitude (darker → brighter). Uses `requestAnimationFrame` for 60fps rendering. Handles window resize events with DPI scaling (`devicePixelRatio`).

---

### 4.9 Streaming Auto-Scroll

**Implemented in:** Completion hook + scroll area ref  
**Files involved:**
- `src/hooks/useCompletion.ts` — Auto-scroll on new content
- `src/lib/storage/response-settings.storage.ts` — Toggle persistence

**Libraries:** React (useRef, useEffect)

**How it works:**  
When AI is streaming a response, the ScrollArea automatically scrolls to the bottom on each new chunk. This is controlled by a configurable toggle in response settings. Uses a `scrollAreaRef` that calls `scrollTo({ top: scrollHeight })` within a `useEffect` that watches the `response` state. Premium-gated feature.

---

### 4.10 Arrow Key Response Scrolling

**Implemented in:** Keyboard event handler in completion  
**Files involved:**
- `src/hooks/useCompletion.ts` — Arrow key handler

**Libraries:** React

**How it works:**  
When the AI response popover is open, Up and Down arrow keys scroll the response area by 40px per press. This provides a keyboard-only way to read long responses without touching the mouse — essential for the stealth overlay use case.

---

### 4.11 Paste Image from Clipboard

**Implemented in:** Completion hook paste handler  
**Files involved:**
- `src/hooks/useCompletion.ts` — `onPaste` handler

**Libraries:** Clipboard API, FileReader API

**How it works:**  
The text input's `onPaste` handler checks for `clipboardData.items` with `type.startsWith('image/')`. If found, reads the image via `FileReader.readAsDataURL()`, converts to base64, and adds to the `attachedFiles` array as an `AttachedFile` object. This enables quickly pasting screenshots from the system clipboard.

---

### 4.12 Search & Filter (Conversations, Prompts)

**Implemented in:** History and system prompts hooks  
**Files involved:**
- `src/hooks/useHistory.ts` — Conversation search
- `src/hooks/useSystemPrompts.ts` — Prompt search

**Libraries:** React (useState, useMemo)

**How it works:**  
Both conversation list and system prompts support client-side search:
- **Conversations**: Filters by title (case-insensitive substring match)
- **System Prompts**: Filters by name or prompt content (case-insensitive)

Search input is debounce-free (instant filtering) since it operates on already-loaded in-memory data.

---

### 4.13 Empty State Displays

**Implemented in:** Empty component  
**Files involved:**
- `src/components/Empty/index.tsx` — Reusable empty state
- `src/components/ui/empty.tsx` — Shadcn empty primitive

**Libraries:** Lucide React

**How it works:**  
Shows a centered illustration (variable icon), title, and description text when lists have no items. Used for: empty conversation list, no search results, no system prompts, and loading states (with spinner variant).

---

### 4.14 Promote & Contribute Cards

**Implemented in:** Marketing components  
**Files involved:**
- `src/components/Promote.tsx` — License promotion card
- `src/components/Contribute.tsx` — Contribution CTA card

**Libraries:** React, localStorage

**How it works:**
- **Promote Card**: Shown for non-licensed users on dashboard pages. Message: "Share Torvi on social, hit 5K impressions, get $5–$10 coupon." Dismissible (stored in localStorage with `promoteDismissed` key).
- **Contribute Card**: Shown in Dev Space. Message: "Fix a critical issue, earn lifetime Dev Pro license ($120 value)." Links to `torvi.com/contribute`.

---

## 5. System Features

### 5.1 Speech-to-Text (Microphone VAD)

**Implemented in:** VAD React component + STT function  
**Files involved:**
- `src/pages/app/components/completion/AutoSpeechVad.tsx` — VAD hook integration
- `src/pages/app/components/completion/Audio.tsx` — Audio button UI
- `src/lib/functions/stt.function.ts` — Transcription function

**Libraries:** `@ricky0123/vad-react` (Voice Activity Detection)

**How it works:**  
Uses `useMicVAD` hook with `userSpeakingThreshold: 0.6`. Auto-starts listening when enabled. When speech ends:
1. Converts Float32Array audio to WAV blob via `floatArrayToWav(audio, 16000, 'wav')`
2. Sends to selected STT provider (Torvi API or custom)
3. On successful transcription, auto-submits text to AI completion

Visual states: transcribing (spinning green loader), user speaking (spinning loader), listening (pulsing mic-off icon), idle (mic icon). Respects user's selected input device.

---

### 5.2 Built-in STT Providers (9)

**Implemented in:** Static configuration constants  
**Files involved:**
- `src/config/stt.constants.ts` — All 9 provider definitions

**Libraries:** None (pure configuration)

**How it works:**  
Each provider defined with: name, cURL template, responseContentPath, `streaming: false`:

| # | Provider | Response Path |
|---|----------|---------------|
| 1 | **OpenAI Whisper** | `text` |
| 2 | **Groq Whisper** | `text` |
| 3 | **ElevenLabs** | `text` |
| 4 | **Google Cloud STT** | `results.0.alternatives.0.transcript` |
| 5 | **Deepgram** | `results.channels.0.alternatives.0.transcript` |
| 6 | **Azure Speech** | `DisplayText` |
| 7 | **Speechmatics** | `job.id` |
| 8 | **Rev.ai** | `id` |
| 9 | **IBM Watson** | `results.0.alternatives.0.transcript` |

Three upload modes supported: multipart form-data (default), binary body (Deepgram-style), JSON base64 (Google-style).

---

### 5.3 Custom STT Provider Management

**Implemented in:** Custom hook + storage  
**Files involved:**
- `src/hooks/useCustomSttProviders.ts` — CRUD logic
- `src/lib/storage/stt-providers.ts` — localStorage persistence

**Libraries:** `@bany/curl-to-json`, localStorage

**How it works:**  
Same CRUD pattern as custom AI providers. Additional validation: cURL must contain `{{AUDIO}}` variable. Always `streaming: false`. Users provide name, cURL template, and responseContentPath. Stored in localStorage and merged with built-in providers.

---

### 5.4 System Audio Capture Pipeline

**Implemented in:** Custom hook + Rust audio commands  
**Files involved:**
- `src/hooks/useSystemAudio.ts` — Frontend pipeline (~700+ lines)
- `src/pages/app/components/speech/index.tsx` — System audio UI
- `src-tauri/src/speaker/commands.rs` — Rust capture + VAD + encoding

**Libraries:** Tauri invoke/listen, `hound` (WAV), platform audio crates

**How it works:**  
Complete 5-layer pipeline:

1. **Hardware Capture**: Platform-specific audio capture (WASAPI/CoreAudio/PulseAudio) → `SpeakerStream` yielding f32 samples
2. **VAD Processing**: Hop-based analysis (1024 samples) with noise gate, RMS/peak calculation, speech detection, pre-speech buffering
3. **Audio Encoding**: Trailing silence trim → normalize (target RMS 0.1) → clamp → i16 PCM → WAV encode via `hound` → base64
4. **Speech-to-Text**: Frontend receives `speech-detected` event → decode base64 → Blob → `fetchSTT()` with 30s timeout
5. **AI Processing**: Transcription auto-sent to AI → stream response → display in overlay → debounced save to SQLite

Events emitted from backend: `capture-started`, `speech-start`, `speech-detected`, `speech-discarded`, `audio-encoding-error`, `capture-stopped`, `continuous-recording-start`, `continuous-recording-stopped`, `recording-progress`.

---

### 5.5 Voice Activity Detection (VAD) — Rust Engine

**Implemented in:** Rust VAD algorithm in speaker commands  
**Files involved:**
- `src-tauri/src/speaker/commands.rs` — `run_vad_capture()` function

**Libraries:** Rust standard library (math operations)

**How it works:**  
Processes stream in fixed `hop_size` chunks (default: 1024 samples):

1. **Noise Gate**: Soft-knee compression — samples below `noise_gate_threshold` (0.003) are compressed: `sample × (|sample| / threshold)^(1/3)`
2. **Compute Metrics**: `rms = sqrt(mean(samples²))`, `peak = max(|samples|)`
3. **Speech Decision**: `is_speech = (rms > 0.012) OR (peak > 0.035)`
4. **State Machine**:
   - SILENCE → SPEECH: When speech detected, include pre-speech buffer (12 chunks ≈ 0.27s pre-roll)
   - SPEECH → SILENCE: After 45 consecutive silent chunks (≈ 1.0s), if speech ≥ 7 chunks (≈ 0.16s): encode and emit; else: discard
5. **Safety Cap**: Force-emit at 30s max per utterance

---

### 5.6 VAD Configuration Panel

**Implemented in:** Settings component + backend config  
**Files involved:**
- `src/pages/app/components/speech/VadConfigPanel.tsx` — Config UI
- `src-tauri/src/speaker/commands.rs` — `get_vad_config()`, `update_vad_config()`

**Libraries:** Radix Slider (via Shadcn)

**How it works:**  
User-configurable parameters via slider controls:
- **VAD Enable/Disable**: Toggle between auto-detection and continuous mode
- **Speech Sensitivity (RMS)**: Slider 1.0–10.0 (lower = more sensitive)
- **Silence Duration**: Controls chunks × hop_size / sample_rate = seconds before processing
- **Noise Gate Threshold**: 0–5.0 for background noise reduction
- **Max Recording Duration**: 1–3 minutes for continuous mode
- Reset to defaults button

Config stored in localStorage (`vad_config`) and passed to Rust on each capture start.

---

### 5.7 Continuous Audio Recording Mode

**Implemented in:** Speaker commands + frontend hook  
**Files involved:**
- `src-tauri/src/speaker/commands.rs` — `run_continuous_capture()`
- `src/hooks/useSystemAudio.ts` — Continuous mode UI flow

**Libraries:** `tokio`, `hound`

**How it works:**  
When VAD is disabled, the system operates in manual continuous mode:
1. User clicks "Start Recording" → Tauri `start_system_audio_capture` with VAD disabled
2. All audio samples accumulated continuously
3. `recording-progress` event emitted every second with elapsed time
4. Stop conditions:
   - User clicks "Stop & Send" → `manual_stop_continuous` → process + transcribe + send to AI
   - User clicks "Ignore" → `stop_system_audio_capture` → discard audio
   - Max duration reached (180s) → auto-process
5. On stop: noise gate → normalize → WAV encode → emit `speech-detected`

---

### 5.8 Quick Actions (System Audio)

**Implemented in:** System audio hook + speech UI  
**Files involved:**
- `src/hooks/useSystemAudio.ts` — Quick action logic
- `src/pages/app/components/speech/index.tsx` — Quick action buttons

**Libraries:** React, localStorage

**How it works:**  
Configurable action buttons displayed during/after system audio transcription. Defaults: "Translate to English", "Summarize", "Key Takeaways", "Action Items", "Explain This". Clicking a quick action sends the action text directly to AI as if it were user input. CRUD operations: `addQuickAction`, `removeQuickAction`, `saveQuickActions`. Stored in `localStorage(STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS)`.

---

### 5.9 Context Templates (System Audio)

**Implemented in:** Platform-specific instructions + UI  
**Files involved:**
- `src/lib/platform-instructions.ts` — 8 context templates

**Libraries:** None (pure text)

**How it works:**  
8 pre-built context templates for system audio scenarios:
1. Real-time Translator
2. Meeting Assistant
3. Interview Assistant
4. Technical Interview Helper
5. Presentation Coach
6. Learning Assistant
7. Customer Call Helper
8. General Assistant

Users can select a template or write a custom context. The context is used as the system prompt during system audio conversations.

---

### 5.10 Audio Device Selection

**Implemented in:** Audio settings page  
**Files involved:**
- `src/pages/audio/` — Audio device selection UI
- `src/contexts/app.context.tsx` — Device state

**Libraries:** Web Audio API (`navigator.mediaDevices.enumerateDevices()`)

**How it works:**  
After requesting microphone permission, enumerates all `audioinput` and `audiooutput` devices. Lists them in select dropdowns. Restores previously saved device from localStorage or falls back to system default. Refresh button to re-enumerate when devices change. Success notification on device change (3s timeout).

---

### 5.11 License Management & Activation

**Implemented in:** Rust activate module + frontend UI  
**Files involved:**
- `src-tauri/src/activate.rs` — License API calls, secure storage
- `src/pages/dashboard/` — License setup UI
- `src/components/GetLicense.tsx` — Purchase CTA

**Libraries:** `reqwest`, `tauri-plugin-machine-uid`, `uuid`

**How it works:**  
- **Activation**: User enters license key → `activate_license_api` → POST to payment endpoint with `{ license_key, instance_name (UUID v4), machine_id }` → stores key + instance ID in secure storage
- **Validation**: `validate_license_api` → POST with stored credentials → returns `{ is_active, last_validated_at }`
- **Deactivation**: `deactivate_license_api` → POST → removes from secure storage
- **Checkout**: `get_checkout_url` → POST to Torvi server → returns payment URL → opens in browser
- **Masking**: `mask_license_key_cmd()` shows first 4 + `***` + last 4 chars

---

### 5.12 Premium Feature Gating

**Implemented in:** Context-based conditional rendering  
**Files involved:**
- `src/contexts/app.context.tsx` — `hasActiveLicense` state
- Various pages — Conditional UI rendering

**Libraries:** React

**How it works:**  
Features gated behind `hasActiveLicense`:
- Window dragging on overlay
- Theme customization + transparency slider
- Response settings (length, language, auto-scroll)
- Selection screenshot mode (manual region select)
- Dashboard chat input (typing new messages)
- Move window via keyboard shortcut
- Custom context templates

Non-licensed users see `<GetLicense>` button with explanatory text. `<Promote>` card shown on dashboard pages for promotion.

---

### 5.13 Secure Storage (License Keys)

**Implemented in:** Rust secure storage module  
**Files involved:**
- `src-tauri/src/activate.rs` — `secure_storage_save/get/remove` commands

**Libraries:** `serde_json`, `std::fs`

**How it works:**  
License keys and instance IDs are stored in `{app_data_dir}/secure_storage.json` (NOT in localStorage). Schema: `SecureStorage { license_key, instance_id, selected_torvi_model }` — all `Option<String>`. Strict key allowlist: only `torvi_license_key`, `torvi_instance_id`, `selected_torvi_model` are accepted; unknown keys are rejected. Batch operations: `save(items: Vec<StorageItem>)`, `get()`, `remove(keys: Vec<String>)`.

---

### 5.14 PostHog Analytics

**Implemented in:** Analytics wrapper + Tauri plugin  
**Files involved:**
- `src/lib/analytics.ts` — Frontend tracking helpers
- `src-tauri/src/lib.rs` — Plugin registration with API key

**Libraries:** `tauri-plugin-posthog`

**How it works:**  
PostHog initialized with API key baked at compile time. Session recording, pageview, and pageleave tracking are all disabled. Two tracked events:
- `app_started` — fired on app initialization
- `get_license` — fired when user clicks "Get License"

Minimal telemetry focused on product adoption metrics only.

---

### 5.15 Platform Permission Checks

**Implemented in:** Audio module + macOS permissions plugin  
**Files involved:**
- `src-tauri/src/speaker/commands.rs` — `check_system_audio_access()`, `request_system_audio_access()`
- `src-tauri/src/lib.rs` — `tauri-plugin-macos-permissions`

**Libraries:** `tauri-plugin-macos-permissions` (macOS)

**How it works:**  
Before capturing system audio or screenshots on macOS, the app checks for required OS permissions. If not granted:
1. Request permission via OS dialog
2. Poll for grant status (up to 20 attempts at 1-second intervals)
3. Show "Setup Required" flow with instructions if not granted

On Windows/Linux, permissions are generally not required for audio loopback capture.

---

### 5.16 cURL Validation Engine

**Implemented in:** Validation utility  
**Files involved:**
- `src/lib/curl-validator.ts` — Validation logic

**Libraries:** `@bany/curl-to-json`

**How it works:**  
Validates user-provided cURL commands for custom providers:
1. Must start with `curl` keyword
2. Must be parseable by `curl2Json()` (valid syntax)
3. Must contain all required variable placeholders (`{{TEXT}}` for AI, `{{AUDIO}}` for STT)
4. Extracts all `{{VARIABLE}}` patterns for UI variable field generation

Returns `{ isValid: boolean, message?: string }`. Used both on provider creation and on load (invalid providers filtered out silently).

---

### 5.17 HTML Sanitization (XSS Prevention)

**Implemented in:** Markdown renderer plugin chain  
**Files involved:**
- `src/components/Markdown/index.tsx` — `rehype-sanitize` plugin

**Libraries:** `rehype-sanitize`

**How it works:**  
All AI-generated markdown content passes through `rehype-sanitize` before rendering. This strips potentially dangerous HTML elements and attributes (script tags, event handlers, etc.), preventing XSS attacks from malicious AI responses or injected content.

---

### 5.18 Signed Update Verification

**Implemented in:** Tauri updater configuration  
**Files involved:**
- `src-tauri/tauri.conf.json` — Public key for Ed25519 verification

**Libraries:** `tauri-plugin-updater`

**How it works:**  
The updater checks `torvi.com/api/update/{target}/{arch}/{version}` for new versions. Downloaded update artifacts are verified against an Ed25519 public key embedded in `tauri.conf.json`. This ensures updates haven't been tampered with during transit. Windows uses passive (silent) install mode.

---

### 5.19 Markdown Export (Conversations)

**Implemented in:** Chat history UI  
**Files involved:**
- `src/pages/chats/index.tsx` — Download button
- `src/lib/database/chat-history.action.ts` — Data retrieval

**Libraries:** Blob API, URL.createObjectURL

**How it works:**  
Each conversation in the chat list has a "Download" action that:
1. Retrieves the full conversation with all messages from SQLite
2. Formats as markdown: title header, then each message with role prefix (`**You:**` / `**AI:**`), separated by blank lines
3. Creates a Blob with `text/markdown` MIME type
4. Triggers download via temporary `<a>` element with `URL.createObjectURL`

---

*This feature reference was generated from a complete analysis of every source file in the torvi-master codebase.*
