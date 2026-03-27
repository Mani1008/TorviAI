# Clean-Room Implementation Plan

> A complete blueprint for rebuilding the AI desktop overlay assistant from scratch.  
> No code is copied — only architectural decisions, module contracts, and implementation guidance.

---

## Table of Contents

1. [Project Architecture](#1-project-architecture)
2. [Recommended Tech Stack](#2-recommended-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [Module Breakdown](#4-module-breakdown)
5. [Implementation Phases](#5-implementation-phases)
6. [Estimated Complexity](#6-estimated-complexity)
7. [Key Technical Challenges](#7-key-technical-challenges)

---

## 1. Project Architecture

### High-Level System Design

The application is a **desktop AI assistant** with two primary interfaces: a slim, always-visible overlay bar and a full-sized dashboard window. It captures system audio, transcribes speech in real time, sends prompts to AI providers, and streams responses — all while remaining invisible to screen recorders.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Desktop Application                          │
│                                                                     │
│  ┌─────────────────────────────────┐  ┌──────────────────────────┐  │
│  │        Overlay Window           │  │     Dashboard Window     │  │
│  │  ┌───────────────────────────┐  │  │  ┌────────────────────┐  │  │
│  │  │ Text Input                │  │  │  │ Sidebar Navigation │  │  │
│  │  │ AI Response Popover       │  │  │  │ Conversation List  │  │  │
│  │  │ Audio Controls            │  │  │  │ Chat Viewer        │  │  │
│  │  │ Screenshot Controls       │  │  │  │ Settings Pages     │  │  │
│  │  │ File Attachments          │  │  │  │ Provider Config    │  │  │
│  │  └───────────────────────────┘  │  │  │ System Prompts     │  │  │
│  └─────────────────────────────────┘  │  └────────────────────┘  │  │
│                                       └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     Native Backend (Rust)                    │   │
│  │                                                              │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐    │    │
│  │  │ Window   │ │ Audio    │ │ Screen   │ │ AI/API        │    │    │
│  │  │ Manager  │ │ Capture  │ │ Capture  │ │ Gateway       │   │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────────┘   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │    │
│  │  │ Shortcut │ │ License  │ │ Database │ │ Secure        │   │    │
│  │  │ Handler  │ │ Manager  │ │ (SQLite) │ │ Storage       │   │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────────┘   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                   Platform Abstraction Layer                  │    │
│  │   Windows (WASAPI, Win32)  │  macOS (CoreAudio, NSPanel)     │    │
│  │   Linux (PulseAudio, X11/Wayland)                            │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Architectural Principles

| Principle | Application |
|-----------|-------------|
| **Dual-window isolation** | Two independent WebView windows from one process; overlay is minimal, dashboard is full-featured |
| **Backend as capability gateway** | Rust backend provides OS-level capabilities (audio, shortcuts, screenshots) that browsers cannot access |
| **Provider-agnostic AI layer** | All AI/STT providers represented as data templates, not code implementations |
| **Cross-window sync via storage events** | Windows share state through localStorage writes, not custom IPC |
| **Stealth-by-default** | Content protection, focus-stealing prevention, and UI camouflage enabled from initialization |
| **Progressive permission requests** | OS permissions requested just-in-time, never upfront; graceful degradation when denied |
| **Stream-first data flow** | AI responses, audio samples, and transcriptions all flow as streams, never batch |

### Communication Patterns

```
Frontend ──invoke()──► Backend        (Request/Response — for commands)
Frontend ◄──emit()─── Backend         (Push Events — for streams & notifications)
Window A ──localStorage──► Window B   (Cross-window sync — for shared state)
Backend  ──HTTP/SSE──► AI Provider    (External API — for AI completions)
OS ──────global key──► Backend        (System events — for shortcuts)
```

---

## 2. Recommended Tech Stack

### Desktop Framework

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| **Framework** | Tauri 2.x | Lightweight (no Electron bloat), Rust backend, native WebView, IPC, plugin ecosystem |
| **Backend** | Rust (stable) | Memory safety, async runtime, platform-specific FFI, no GC pauses during audio capture |
| **Frontend** | React 19+ | Hooks for state management, Suspense for lazy loading, mature ecosystem |
| **Bundler** | Vite 7+ | Sub-second HMR, ESM-native, Tauri integration via `@tauri-apps/cli` |
| **Language** | TypeScript 5.x (strict) | Type safety across the frontend; Rust provides backend safety |

### Frontend Libraries

| Category | Library | Purpose |
|----------|---------|---------|
| **Routing** | react-router v7 | 11+ routes, parameterized views, layout nesting |
| **UI Components** | Shadcn UI + Radix | Accessible primitives, composable, no runtime CSS overhead |
| **Styling** | Tailwind CSS v4 | Utility-first, OKLCH color space, CSS custom properties for theming |
| **Markdown** | react-markdown + remark/rehype plugins | GFM tables, math (KaTeX), syntax highlighting (Shiki), HTML sanitization |
| **Audio VAD** | @ricky0123/vad-react | Neural VAD (Silero ONNX model) for microphone input |
| **Charts** | Recharts | Usage dashboard line charts |
| **Icons** | Lucide React | Consistent icon set, tree-shakeable |
| **cURL Parsing** | @bany/curl-to-json | Parse user-provided cURL templates into structured HTTP requests |

### Backend (Rust) Crates

| Category | Crate | Purpose |
|----------|-------|---------|
| **HTTP Client** | reqwest | SSE streaming from AI providers, license API calls |
| **Async Runtime** | tokio | Async tasks for audio capture, SSE parsing, window movement |
| **JSON** | serde + serde_json | Serialize/deserialize all IPC payloads and API responses |
| **Audio (Windows)** | wasapi | WASAPI loopback capture of system speaker output |
| **Audio (macOS)** | cidre | Core Audio process tap for system audio |
| **Audio (Linux)** | libpulse-binding + libpulse-simple-binding | PulseAudio monitor source |
| **Ring Buffer** | ringbuf | Lock-free SPSC buffer between audio capture and VAD threads |
| **WAV Encoding** | hound | PCM → WAV container encoding for STT upload |
| **Screenshot** | xcap | Multi-monitor screen capture |
| **Image** | image + base64 | Crop, encode PNG, convert to base64 for IPC transfer |
| **UUID** | uuid | Conversation IDs, request IDs, instance IDs |

### Tauri Plugins

| Plugin | Purpose |
|--------|---------|
| tauri-plugin-sql | SQLite database access from frontend |
| tauri-plugin-http | HTTP requests bypassing CORS restrictions |
| tauri-plugin-global-shortcut | System-wide keyboard shortcut registration |
| tauri-plugin-updater | Signed auto-update mechanism |
| tauri-plugin-shell | Open URLs in default browser |
| tauri-plugin-autostart | Launch-on-boot registration |
| tauri-plugin-machine-uid | Hardware-derived machine identifier |
| tauri-nspanel (macOS) | Convert window to non-activating floating panel |
| tauri-plugin-posthog | Minimal analytics |

---

## 3. Folder Structure

```
project-root/
│
├── package.json                   # Frontend dependencies + scripts
├── vite.config.ts                 # Vite config with Tauri plugin
├── tsconfig.json                  # TypeScript config with path aliases
├── components.json                # Shadcn UI configuration
├── index.html                     # Single HTML entry point
│
├── src/                           # ── Frontend (TypeScript + React) ──
│   ├── main.tsx                   # Entry: window label branching
│   ├── global.css                 # Tailwind base, OKLCH tokens, transparency vars
│   ├── vite-env.d.ts              # Vite type declarations
│   │
│   ├── routes/
│   │   └── index.tsx              # All route definitions
│   │
│   ├── layouts/
│   │   ├── DashboardLayout.tsx    # Sidebar + outlet + drag region
│   │   ├── PageLayout.tsx         # Header + scroll area + promote card
│   │   └── ErrorLayout.tsx        # Error boundary fallback UI
│   │
│   ├── pages/
│   │   ├── app/                   # Overlay page + completion components
│   │   │   └── components/
│   │   │       ├── completion/    # Input, response popover, file attachments
│   │   │       └── speech/        # Audio visualizer, VAD controls, config
│   │   ├── chats/                 # Conversation list + viewer
│   │   ├── dashboard/             # Usage stats, license setup
│   │   ├── settings/              # General settings toggles
│   │   ├── shortcuts/             # Shortcut binding editor
│   │   ├── system-prompts/        # CRUD for system prompts
│   │   ├── responses/             # Response length/language settings
│   │   ├── audio/                 # Audio device selection
│   │   ├── screenshot/            # Screenshot mode configuration
│   │   └── dev/                   # Custom provider management (Dev Space)
│   │
│   ├── components/
│   │   ├── Sidebar.tsx            # Dashboard navigation bar
│   │   ├── DragButton.tsx         # Window drag handle
│   │   ├── CustomCursor.tsx       # Invisible cursor replacement
│   │   ├── Overlay.tsx            # Screenshot selection canvas
│   │   ├── Icons.tsx              # Custom SVG icons
│   │   ├── GetLicense.tsx         # License purchase CTA
│   │   ├── Promote.tsx            # Social promotion card
│   │   ├── Contribute.tsx         # Contribution CTA card
│   │   ├── Markdown/              # Markdown renderer + copy button
│   │   ├── Selection/             # Screenshot selection component
│   │   ├── TextInput/             # Overlay text input
│   │   ├── updater/               # Auto-update UI
│   │   └── ui/                    # Shadcn primitives (button, dialog, etc.)
│   │
│   ├── hooks/
│   │   ├── useCompletion.ts       # Overlay AI chat logic (~800 lines)
│   │   ├── useChatCompletion.ts   # Dashboard chat logic (~700 lines)
│   │   ├── useApp.ts              # App initialization, migration
│   │   ├── useSettings.ts         # Settings page state
│   │   ├── useHistory.ts          # Conversation list loading
│   │   ├── useSystemAudio.ts      # System audio pipeline (~700 lines)
│   │   ├── useSystemPrompts.ts    # System prompt CRUD
│   │   ├── useCustomProvider.ts   # Custom AI provider CRUD
│   │   ├── useCustomSttProviders.ts # Custom STT provider CRUD
│   │   ├── useGlobalShortcuts.ts  # Frontend shortcut event bridge
│   │   ├── useShortcuts.ts        # Shortcut binding editor
│   │   ├── useWindow.ts           # Window height/visibility control
│   │   ├── useVersion.ts          # App version from Tauri
│   │   └── useTitles.ts           # Title attribute stripping
│   │
│   ├── contexts/
│   │   ├── app.context.tsx        # Central state store (~600 lines)
│   │   └── theme.context.tsx      # Theme + transparency
│   │
│   ├── config/
│   │   ├── constants.ts           # localStorage keys, defaults
│   │   ├── ai-providers.constants.ts  # 10 built-in AI provider templates
│   │   ├── stt.constants.ts       # 9 built-in STT provider templates
│   │   └── shortcuts.ts           # Default shortcut bindings
│   │
│   ├── lib/
│   │   ├── utils.ts               # Tailwind merge, general helpers
│   │   ├── platform.ts            # OS detection utilities
│   │   ├── analytics.ts           # PostHog tracking wrapper
│   │   ├── curl-validator.ts      # cURL template validation
│   │   ├── version.ts             # Version comparison utility
│   │   ├── response-settings.constants.ts  # Length/language options
│   │   ├── platform-instructions.ts        # Context templates (8 presets)
│   │   ├── chat-constants.ts      # Chat-related constants
│   │   ├── database/
│   │   │   ├── config.ts          # SQLite singleton
│   │   │   ├── chat-history.action.ts  # Conversation/message SQL
│   │   │   └── system-prompt.action.ts # System prompt SQL
│   │   ├── functions/
│   │   │   ├── ai-response.function.ts  # Streaming engine (dual path)
│   │   │   ├── stt.function.ts    # Speech-to-text request
│   │   │   ├── common.function.ts # Template processing, variable replacement
│   │   │   └── pluely.api.ts      # Premium API routing decision
│   │   └── storage/
│   │       ├── helper.ts          # Safe localStorage get/set
│   │       ├── ai-providers.ts    # Custom AI provider storage
│   │       ├── stt-providers.ts   # Custom STT provider storage
│   │       ├── response-settings.storage.ts
│   │       └── shortcuts.storage.ts
│   │
│   └── types/
│       ├── completion.ts          # AI completion types
│       ├── provider.type.ts       # Provider shape definitions
│       ├── settings.ts            # Settings types
│       ├── shortcuts.ts           # Shortcut binding types
│       ├── context.type.ts        # AppContext shape
│       └── system-prompts.ts      # System prompt types
│
├── src-tauri/                     # ── Backend (Rust) ──
│   ├── Cargo.toml                 # Rust dependencies
│   ├── tauri.conf.json            # Window config, plugins, permissions
│   ├── build.rs                   # Build script
│   │
│   ├── capabilities/
│   │   ├── default.json           # Default permission grants
│   │   └── cross-platform.json    # Cross-platform capabilities
│   │
│   ├── src/
│   │   ├── main.rs                # Entry point (cfg for bundled/dev)
│   │   ├── lib.rs                 # Plugin registration, state init, setup, command registration
│   │   ├── window.rs              # Window create/toggle/resize/position
│   │   ├── shortcuts.rs           # Global shortcut registration + centralized handler
│   │   ├── capture.rs             # Multi-monitor screenshot + overlay windows
│   │   ├── activate.rs            # License activation/validation/deactivation
│   │   ├── api.rs                 # Premium API streaming, transcription, models
│   │   ├── db/
│   │   │   ├── mod.rs             # Migration loader
│   │   │   └── main.rs            # SQL operations
│   │   └── speaker/
│   │       ├── mod.rs             # SpeakerInput trait + SpeakerStream
│   │       ├── commands.rs        # VAD capture, encoding, continuous mode
│   │       ├── windows.rs         # WASAPI loopback implementation
│   │       ├── macos.rs           # Core Audio process tap
│   │       └── linux.rs           # PulseAudio monitor
│   │
│   └── icons/                     # App icons (all sizes)
│
└── images/                        # Static assets (logos, screenshots)
```

**Approximate file count:** ~90 source files (55 frontend + 15 backend + 20 config/asset)

---

## 4. Module Breakdown

### Module M1: Application Shell

**Responsibility:** Bootstrap the Tauri process, create windows, register plugins, initialize state.

| Sub-module | Description |
|------------|-------------|
| M1.1 Rust Bootstrap | Register 12+ plugins, 6 managed states, 39 IPC commands, run setup closure |
| M1.2 Window Manager | Create/toggle/resize/position for main and dashboard windows. Platform-specific chrome (NSPanel on macOS, standard on Windows/Linux) |
| M1.3 Frontend Entry | Window label branching — full app tree vs lightweight overlay component |
| M1.4 Routing | 11 routes with layout nesting (DashboardLayout, PageLayout) |
| M1.5 Error Boundaries | Wrap both windows with react-error-boundary for graceful crash recovery |

**Inputs:** OS launch event  
**Outputs:** Two windows rendered, IPC ready, shortcuts active  

---

### Module M2: Central State Management

**Responsibility:** Single source of truth for all application configuration, persisted to localStorage with cross-window sync.

| Sub-module | Description |
|------------|-------------|
| M2.1 AppContext | React Context holding all providers, settings, license state, device selections |
| M2.2 ThemeContext | Dark/light/system theme + transparency (opacity, backdrop-blur) |
| M2.3 localStorage Persistence | Safe get/set wrappers, ~15 keys, JSON serialization |
| M2.4 Cross-Window Sync | StorageEvent listener → full state reload on change from other window |
| M2.5 Provider Merge Logic | Combine built-in providers + user custom providers into unified lists |

**Inputs:** localStorage reads, StorageEvent pushes  
**Outputs:** Context values consumed by all components and hooks  

---

### Module M3: AI Completion Engine

**Responsibility:** Accept a user message, build provider-specific requests, stream responses, render incrementally.

| Sub-module | Description |
|------------|-------------|
| M3.1 Overlay Completion Hook | Full lifecycle: input → build messages → stream → render → save |
| M3.2 Dashboard Chat Hook | Same core logic, adapted for full-page chat view with message history |
| M3.3 Streaming Engine | Dual-path: Rust SSE (premium API) or frontend fetch SSE (custom cURL) |
| M3.4 Message Builder | Construct provider-specific message formats (OpenAI, Claude, Gemini styles) |
| M3.5 Variable Substitution | Recursive replacement of `{{VARIABLE}}` placeholders in request templates |
| M3.6 Abort Controller | Request ID gating to prevent stale responses from contaminating display |
| M3.7 Response Settings | Inject response length/language instructions into system prompt |

**Inputs:** User text, attached images, system prompt, provider template, variables  
**Outputs:** Streamed text chunks → accumulated markdown string → rendered response  

---

### Module M4: Provider Management

**Responsibility:** Define, store, validate, and select AI and STT providers.

| Sub-module | Description |
|------------|-------------|
| M4.1 Built-in AI Providers | 10 provider templates (cURL + responseContentPath) as static config |
| M4.2 Built-in STT Providers | 9 provider templates for speech-to-text services |
| M4.3 Custom Provider CRUD | Create/edit/delete user-defined providers with cURL templates |
| M4.4 cURL Validation | Parse with curl-to-json, check required variables, extract variable names |
| M4.5 Provider Selection | Active provider + variable bindings stored in localStorage |
| M4.6 Dev Space UI | Provider configuration page with template editing, variable fields, test |

**Inputs:** User cURL templates, variable values  
**Outputs:** Validated provider configs merged into allAiProviders / allSttProviders  

---

### Module M5: System Audio Pipeline

**Responsibility:** Capture system speaker output, detect speech, transcribe, and route to AI.

| Sub-module | Description |
|------------|-------------|
| M5.1 Platform Capture Trait | `SpeakerInput` trait with platform implementations (WASAPI, CoreAudio, PulseAudio) |
| M5.2 Ring Buffer | Lock-free SPSC buffer between capture thread and VAD processor |
| M5.3 VAD Engine | Hop-based analysis with noise gate, RMS/peak metrics, 3-state machine |
| M5.4 Audio Encoder | Trailing silence trim → normalize → i16 PCM → WAV → base64 |
| M5.5 Continuous Mode | No-VAD manual recording with progress events and max duration cap |
| M5.6 Frontend Pipeline | Event listeners → base64 decode → STT request → AI submission → display |
| M5.7 VAD Config UI | Sliders for sensitivity, silence duration, noise gate, max duration |
| M5.8 Quick Actions | Configurable one-click action buttons (translate, summarize, etc.) |
| M5.9 Context Templates | 8 preset instruction templates for common scenarios |
| M5.10 Audio Visualizer | Canvas-based frequency bar display from AnalyserNode FFT data |

**Inputs:** System speaker output (f32 samples), user configuration  
**Outputs:** Transcribed text → AI response → overlay display  

---

### Module M6: Microphone Speech-to-Text

**Responsibility:** Record microphone input with neural VAD, transcribe via STT provider.

| Sub-module | Description |
|------------|-------------|
| M6.1 Neural VAD | @ricky0123/vad-react with Silero ONNX model for speech detection |
| M6.2 Audio Encoding | Float32Array → WAV blob conversion |
| M6.3 STT Request | Route to Pluely API or custom cURL STT provider |
| M6.4 UI States | Visual indicators for listening/speaking/transcribing/idle |
| M6.5 Device Selection | Enumerate audio input devices, persist selection |

**Inputs:** Microphone audio stream  
**Outputs:** Transcribed text auto-submitted to AI completion  

---

### Module M7: Screenshot System

**Responsibility:** Capture multi-monitor screenshots with optional region selection.

| Sub-module | Description |
|------------|-------------|
| M7.1 Multi-Monitor Capture | Enumerate monitors, capture full screenshot of each |
| M7.2 Overlay Creation | One transparent fullscreen overlay window per monitor |
| M7.3 Selection Canvas | Click-and-drag region selection with DPI-aware coordinates |
| M7.4 Crop & Encode | Crop captured image to selection → PNG → base64 |
| M7.5 Auto/Manual Modes | Auto: screenshot + auto-prompt to AI. Manual: add to attachments |
| M7.6 Settings UI | Enable/disable, mode selection, auto-prompt configuration |

**Inputs:** Shortcut trigger + user selection region  
**Outputs:** base64 PNG image → added to conversation as attachment or auto-sent  

---

### Module M8: Global Shortcuts

**Responsibility:** Register system-wide keyboard shortcuts, dispatch to handlers.

| Sub-module | Description |
|------------|-------------|
| M8.1 Registration | Register 7 shortcut actions with OS via Tauri plugin |
| M8.2 Centralized Dispatcher | HashMap lookup (key combo → action ID) + match routing |
| M8.3 Frontend Event Bridge | Tauri event listeners → React callbacks (singleton pattern) |
| M8.4 Custom Bindings | UI for rebinding shortcuts with conflict detection |
| M8.5 Window Movement | Continuous 60fps movement via async task with atomic stop flag |

**Inputs:** Physical key presses (system-wide)  
**Outputs:** Window toggles, feature triggers, movement commands  

---

### Module M9: Conversation Persistence

**Responsibility:** Store and retrieve conversations, messages, and system prompts in SQLite.

| Sub-module | Description |
|------------|-------------|
| M9.1 Database Setup | Singleton connection, migration scripts (schema + indexes + triggers) |
| M9.2 Conversation CRUD | Create, list, search, delete conversations |
| M9.3 Message CRUD | Insert messages with role, content, timestamp, attached files |
| M9.4 System Prompt CRUD | Create, edit, delete, activate/deactivate prompts |
| M9.5 Markdown Export | Format conversation as .md and trigger download |
| M9.6 Migration | One-time localStorage → SQLite migration for upgrade path |

**Inputs:** Completed AI conversations, user-created prompts  
**Outputs:** Persisted data queryable by the chat list, viewer, and overlay  

---

### Module M10: Stealth System

**Responsibility:** Make the application invisible to screen recorders, observers, and casual inspection.

| Sub-module | Description |
|------------|-------------|
| M10.1 Content Protection | OS-level flag to exclude windows from screen capture |
| M10.2 NSPanel (macOS) | Convert to non-activating floating panel that doesn't steal focus |
| M10.3 Taskbar/Dock Hiding | Hide from taskbar (Win/Linux) or dock (macOS activation policy) |
| M10.4 Title Stripping | MutationObserver removing all HTML title attributes |
| M10.5 Custom Cursor | Optional invisible native cursor + JS-rendered pointer icon |
| M10.6 Dynamic Height | Window expands from bar to panel on response, collapses on close |

**Inputs:** User stealth preferences  
**Outputs:** Invisible-to-recorders, non-focus-stealing, tooltip-free window  

---

### Module M11: License & Monetization

**Responsibility:** Manage license activation, validation, premium gating, and checkout.

| Sub-module | Description |
|------------|-------------|
| M11.1 Activation Flow | POST license_key + machine_id → store in secure storage |
| M11.2 Validation | Periodic POST to check active status, cache result |
| M11.3 Deactivation | Remove instance from server, clear local storage |
| M11.4 Secure Storage | Rust-side JSON file with strict key allowlist |
| M11.5 Premium Gating | Context-based conditional rendering (feature → license prompt) |
| M11.6 Checkout | Request payment URL from server → open in browser |
| M11.7 License Masking | Display key as first4 + *** + last4 |

**Inputs:** User license key, machine UID  
**Outputs:** hasActiveLicense boolean → consumed by premium-gated components  

---

### Module M12: Auto-Update System

**Responsibility:** Check for updates, download, verify, install, relaunch.

| Sub-module | Description |
|------------|-------------|
| M12.1 Version Check | Poll update endpoint with target/arch/version |
| M12.2 Download | Stream update artifact with progress tracking |
| M12.3 Verification | Ed25519 signature validation against embedded public key |
| M12.4 Install & Relaunch | Passive install (Windows) + auto-relaunch after 2s |
| M12.5 UI | Popover with release notes, progress bar, state transitions |

**Inputs:** Current version, update endpoint  
**Outputs:** Updated binary installed, app relaunched  

---

### Module M13: UI Component Library

**Responsibility:** Reusable, accessible UI primitives and layout components.

| Sub-module | Description |
|------------|-------------|
| M13.1 Shadcn Primitives | 18+ components: button, dialog, dropdown, input, popover, scroll-area, select, slider, switch, textarea, tooltip, etc. |
| M13.2 Markdown Renderer | react-markdown with GFM, KaTeX math, Shiki syntax highlighting, rehype-sanitize |
| M13.3 Layouts | DashboardLayout (sidebar + content), PageLayout (header + scroll), ErrorLayout |
| M13.4 Sidebar | Navigation items, active state, count badges, footer links |
| M13.5 Theme System | Dark/light/system mode + transparency slider (OKLCH CSS variables) |

**Inputs:** Props, theme context  
**Outputs:** Rendered, accessible, themed UI components  

---

### Module M14: Analytics & Telemetry

**Responsibility:** Minimal, privacy-respecting usage tracking.

| Sub-module | Description |
|------------|-------------|
| M14.1 PostHog Integration | Plugin initialization with API key |
| M14.2 Event Tracking | Two events only: app_started, get_license |
| M14.3 Disabled Features | Session recording, pageview, pageleave — all off |

**Inputs:** App lifecycle events  
**Outputs:** Anonymous analytics to PostHog  

---

## 5. Implementation Phases

### Phase 1: Foundation (Weeks 1–3)

**Goal:** Bootable Tauri app with dual windows, routing, and basic UI.

```
Phase 1 Deliverables
├── Tauri project scaffold with Rust backend skeleton
├── Main window (transparent, no decorations, top-center)
├── Dashboard window (standard chrome, on-demand creation)
├── React + TypeScript + Vite frontend
├── Tailwind CSS + Shadcn UI initialization (10 base components)
├── React Router with 11 route definitions
├── DashboardLayout + PageLayout + ErrorLayout
├── Sidebar navigation with routing
├── ThemeContext (dark/light/system)
├── Basic AppContext shell (no persistence yet)
└── Window drag handles (data-tauri-drag-region)
```

**Modules touched:** M1, M2 (partial), M13 (partial)  
**Milestone test:** App launches with two windows. Clicking sidebar items navigates between pages. Theme toggle works.

---

### Phase 2: AI Core (Weeks 4–6)

**Goal:** Send a prompt to an AI provider and stream the response in the overlay.

```
Phase 2 Deliverables
├── Overlay text input component
├── Built-in AI provider constants (10 providers)
├── cURL template parser + variable extraction
├── Variable substitution engine (recursive deep replace)
├── Message builder (OpenAI, Claude, Gemini formats)
├── Frontend SSE streaming parser (fetch-based path)
├── Async generator → React state → Markdown render loop
├── react-markdown with remark-gfm + rehype-sanitize
├── Shiki syntax highlighting (lazy loaded via Suspense)
├── KaTeX math rendering
├── Code block copy button
├── AbortController + request ID stale prevention
├── Dynamic window height (expand on response, collapse on close)
├── Arrow key scrolling in response popover
└── Auto-scroll during streaming
```

**Modules touched:** M3, M4 (partial), M13 (Markdown)  
**Milestone test:** Type a prompt, receive a streamed AI response with rendered markdown, syntax highlighting, and math.

---

### Phase 3: Persistence & History (Weeks 7–8)

**Goal:** Save conversations to SQLite, browse and manage chat history.

```
Phase 3 Deliverables
├── SQLite database setup (singleton, migrations)
├── Conversations table + Messages table + System Prompts table
├── Indexes and auto-update triggers
├── Conversation CRUD from frontend
├── Message CRUD with role, content, timestamps, attached files
├── Chat list page (search, date groups, message count badges)
├── Chat viewer page (bubble layout, date separators)
├── System prompt CRUD page
├── Debounced conversation save during streaming
├── Markdown export (download as .md)
├── localStorage persistence for all AppContext state
├── Cross-window sync via StorageEvent
└── localStorage → SQLite one-time migration logic
```

**Modules touched:** M2 (complete), M9  
**Milestone test:** Conversations persist across app restarts. Chat list shows all conversations with search. System prompts can be created and selected.

---

### Phase 4: Desktop Integration (Weeks 9–11)

**Goal:** Global shortcuts, stealth features, and screenshot capture.

```
Phase 4 Deliverables
├── Global shortcut registration (7 actions)
├── Centralized Rust dispatcher (HashMap lookup → action routing)
├── Frontend event bridge (singleton pattern)
├── Custom shortcut binding UI with conflict detection
├── Content protection flag on both windows
├── macOS NSPanel conversion (non-activating, float level, all spaces)
├── Taskbar/dock hiding toggle
├── Title attribute stripping (MutationObserver)
├── Custom cursor (invisible mode with JS pointer)
├── Keyboard-driven window movement (60fps async task)
├── Multi-monitor screenshot capture
├── Screenshot selection overlay (per-monitor transparent windows)
├── DPI-aware crop + PNG encode + base64 transfer
├── Auto/manual screenshot modes
├── Screenshot settings page
└── Autostart registration
```

**Modules touched:** M7, M8, M10  
**Milestone test:** Alt+Space toggles overlay. Alt+C captures a screenshot region. Content cannot be seen in screen recordings. macOS: overlay doesn't steal focus.

---

### Phase 5: Audio Pipeline (Weeks 12–15)

**Goal:** System audio capture with VAD, transcription, and AI processing.

```
Phase 5 Deliverables
├── SpeakerInput trait + platform implementations
│   ├── Windows: WASAPI loopback capture
│   ├── macOS: Core Audio process tap (cidre)
│   └── Linux: PulseAudio monitor source
├── Lock-free ring buffer (ringbuf) between capture and VAD
├── VAD engine (noise gate, RMS/peak, 3-state machine, hysteresis)
├── Pre-speech buffering (~12 chunks)
├── Audio encoder (trim → normalize → i16 PCM → WAV → base64)
├── Continuous recording mode (no-VAD, manual stop)
├── Frontend system audio hook (event listeners, STT routing)
├── Audio visualizer (Canvas + AnalyserNode)
├── VAD configuration panel (sliders)
├── Quick action buttons (configurable)
├── Context templates (8 presets)
├── Microphone VAD (@ricky0123/vad-react)
├── STT function (multipart/binary/base64 upload modes)
├── Built-in STT providers (9 templates)
├── Custom STT provider CRUD
├── Audio device selection page
└── Platform permission checks (macOS)
```

**Modules touched:** M5, M6, M4 (STT)  
**Milestone test:** Alt+S starts capturing system audio. Speech is detected, transcribed, sent to AI, and response displayed. Microphone button records and transcribes voice input.

---

### Phase 6: Premium & Polish (Weeks 16–18)

**Goal:** License system, premium gating, auto-update, and final polish.

```
Phase 6 Deliverables
├── License activation API (POST with machine_id + instance UUID)
├── License validation API (periodic check)
├── License deactivation API
├── Secure storage (Rust-side JSON file with key allowlist)
├── Premium feature gating (context-driven conditional rendering)
├── Checkout URL generation → open in browser
├── License setup UI in dashboard
├── GetLicense CTA component
├── Promote + Contribute cards
├── Auto-update system (check → download → verify → install → relaunch)
├── Update UI (release notes, progress bar, state transitions)
├── Ed25519 signature verification
├── Premium API path (Rust-side SSE streaming)
│   ├── Fetch API config from server
│   ├── SSE stream parsing in Rust
│   ├── Emit chunks as Tauri events
│   └── Frontend async generator consuming events
├── Dashboard usage stats (recharts line chart)
├── PostHog analytics (2 events only)
├── Response length/language settings (premium)
├── Transparency slider (premium)
├── Keep-engaged mode (Cmd/Ctrl+K toggle)
├── File attachments (images, max 6, paste from clipboard)
├── Attach-to-overlay from dashboard
└── AI-assisted system prompt generation
```

**Modules touched:** M3 (Rust path), M11, M12, M14  
**Milestone test:** License activation/deactivation works. Premium features are gated. Auto-update checks and installs. Pluely API streaming works end-to-end.

---

### Phase Summary

| Phase | Duration | Modules | Key Deliverable |
|-------|----------|---------|----------------|
| 1. Foundation | 3 weeks | M1, M2, M13 | Dual-window app with routing and UI |
| 2. AI Core | 3 weeks | M3, M4, M13 | Streamed AI responses in overlay |
| 3. Persistence | 2 weeks | M2, M9 | SQLite conversations + cross-window sync |
| 4. Desktop | 3 weeks | M7, M8, M10 | Shortcuts, stealth, screenshots |
| 5. Audio | 4 weeks | M4, M5, M6 | System audio + microphone transcription |
| 6. Premium | 3 weeks | M3, M11, M12, M14 | License, premium API, auto-update |
| **Total** | **~18 weeks** | **14 modules** | **Complete application** |

---

## 6. Estimated Complexity

### Complexity Scale

| Level | Meaning |
|-------|---------|
| **Low** | Straightforward implementation: well-documented APIs, minimal platform-specific logic, <200 lines |
| **Medium** | Requires careful state management, async coordination, or non-trivial UI: 200–600 lines |
| **High** | Platform-specific FFI, streaming protocols, concurrency patterns, or complex state machines: 600–1000+ lines |
| **Very High** | Cross-boundary data flows spanning OS → Rust → JS, multi-platform implementations, real-time constraints |

### Module Complexity Matrix

| Module | Complexity | Rationale |
|--------|-----------|-----------|
| **M1: Application Shell** | Medium | Tauri plugin composition is boilerplate-heavy but well-documented. NSPanel requires macOS-specific knowledge. |
| **M2: Central State** | Medium | ~600 lines of context logic. The cross-window sync via StorageEvent is subtle but elegant. Provider merge logic needs care. |
| **M3: AI Completion Engine** | **Very High** | Two independent streaming paths. Provider-specific message formatting. Abort handling. Request ID gating. ~800+ lines per completion hook. The hardest frontend module. |
| **M4: Provider Management** | Medium | CRUD is standard. cURL parsing and recursive variable substitution add moderate complexity. |
| **M5: System Audio Pipeline** | **Very High** | The hardest module overall. Three platform implementations (each unique API). Real-time VAD state machine. Ring buffer concurrency. Audio normalization math. ~700+ lines frontend + ~500 lines Rust. |
| **M6: Microphone STT** | Medium | Neural VAD library does the heavy lifting. Main work is UI states and STT routing. |
| **M7: Screenshot System** | High | Multi-monitor geometry. DPI scaling across monitors. Per-monitor overlay windows. Coordinate transformations. |
| **M8: Global Shortcuts** | Medium | Plugin does registration. Centralized dispatcher is clean. Custom binding UI with conflict detection is moderate work. |
| **M9: Conversation Persistence** | Medium | Standard SQL CRUD. Migration system. The localStorage → SQLite migration requires one-time care. |
| **M10: Stealth System** | High | Each stealth mechanism is individually simple but the combination is complex. NSPanel requires macOS expertise. Title stripping MutationObserver is fragile. |
| **M11: License & Monetization** | Medium | HTTP API calls + secure storage. Premium gating is just conditional rendering. |
| **M12: Auto-Update** | Low | Tauri updater plugin handles most work. UI is a status-tracking popover. |
| **M13: UI Component Library** | Medium | 18+ Shadcn components (mostly generated). Markdown renderer with 5 plugins is the complex part. |
| **M14: Analytics** | Low | Two events, one plugin, zero custom logic. |

### Visual Complexity Map

```
        Low          Medium             High            Very High
         │              │                 │                │
   M12 ──┤              │                 │                │
   M14 ──┤              │                 │                │
         │    M1 ───────┤                 │                │
         │    M2 ───────┤                 │                │
         │    M4 ───────┤                 │                │
         │    M6 ───────┤                 │                │
         │    M8 ───────┤                 │                │
         │    M9 ───────┤                 │                │
         │   M11 ───────┤                 │                │
         │   M13 ───────┤                 │                │
         │              │     M7 ─────────┤                │
         │              │    M10 ─────────┤                │
         │              │                 │     M3 ────────┤
         │              │                 │     M5 ────────┤
```

### Lines of Code Estimates

| Category | Estimated LoC | Notes |
|----------|---------------|-------|
| Frontend TypeScript | ~10,000–12,000 | Hooks are the bulk (~3,000 alone); pages ~3,000; components ~2,500; lib ~2,000; config/types ~1,500 |
| Backend Rust | ~3,000–4,000 | Speaker module ~1,200; shortcuts ~500; capture ~400; window ~300; API ~400; activate ~300; lib ~500 |
| CSS | ~400–600 | Tailwind utilities + global.css OKLCH variables |
| SQL | ~100–150 | Two migration files |
| Config (JSON/TOML) | ~400–500 | tauri.conf.json, Cargo.toml, components.json, tsconfig |
| **Total** | **~14,000–17,500** | |

---

## 7. Key Technical Challenges

### Challenge 1: Cross-Platform Audio Loopback Capture

**Problem:** Capturing what the system speakers are playing (not microphone input) requires completely different OS APIs on each platform, none of which are well-documented.

**Why it's hard:**
- **Windows (WASAPI):** Must create a render client on the audio endpoint, request capture through loopback mode, handle COM initialization, process f32 samples in real-time. Buffer underflows / overflows must be handled silently.
- **macOS (Core Audio):** Requires creating a "process tap" that captures the audio mix from all processes. Must exclude the application's own process to avoid feedback loops. Sample rate may change dynamically.
- **Linux (PulseAudio):** Must connect to the `@DEFAULT_MONITOR@` source on the PulseAudio server. Moderately straightforward but requires PulseAudio development libraries to be installed.

**Mitigation strategy:**
1. Define a clean trait (`SpeakerInput`) that returns a `Stream<Item = f32>` — the same interface for all platforms
2. Implement each platform behind `#[cfg(target_os)]` — they share no code
3. Use a lock-free ring buffer as the bridge between the audio callback thread and the processing thread
4. Test on each platform independently; audio issues are not cross-platform debuggable

---

### Challenge 2: Real-Time VAD with Acceptable Latency

**Problem:** The VAD engine must detect speech start within ~50ms and speech end within ~1 second, while filtering out keyboard clicks, system sounds, and background noise — all without a neural model (which would be too expensive for continuous processing).

**Why it's hard:**
- The trade-off between sensitivity and false-positive rate is sharp. Short silence thresholds trigger too early (mid-sentence splits). Long thresholds add perceived latency.
- Background noise levels vary wildly between environments (quiet room vs. café vs. noisy office).
- The noise gate must use a soft-knee curve, not a hard threshold, or quiet speech at the beginning of an utterance gets clipped.
- Pre-speech buffering (keeping the last N chunks) is essential but requires circular buffer management.

**Mitigation strategy:**
1. Make all VAD parameters configurable with sensible defaults
2. Implement the three-state machine (SILENCE → SPEECH → EMIT/DISCARD) with hysteresis
3. Test with recorded audio samples spanning the noise/speech spectrum
4. Expose a "VAD sensitivity" slider to end users so they can tune for their environment

---

### Challenge 3: SSE Streaming with Provider Diversity

**Problem:** Each AI provider returns SSE-format streaming responses, but the exact format varies: different JSON structure, different content paths, different termination signals, different error formats.

**Why it's hard:**
- Some providers use `data: [DONE]` as termination. Others use `event: done`. Some just close the connection.
- Content lives at different JSONPaths: `choices.0.delta.content` (OpenAI), `delta.text` (Claude), `candidates.0.content.parts.0.text` (Gemini), `message.content` (Ollama).
- Some chunk lines may be split across TCP packets — a `data:` line might arrive as two partial reads.
- Error responses may arrive as regular JSON (not SSE), requiring format detection.

**Mitigation strategy:**
1. Use the `responseContentPath` abstraction — each provider declares where to find the text delta
2. Build a line-buffering SSE parser that handles partial lines across reads
3. Treat `data: [DONE]`, empty data, and connection close as equivalent termination signals
4. Wrap all JSON parsing in try-catch to handle format variations gracefully

---

### Challenge 4: macOS NSPanel Focus Semantics

**Problem:** On macOS, the overlay must float above all windows (including fullscreen apps) without stealing focus from the active application. Standard NSWindow cannot do this.

**Why it's hard:**
- Converting a Tauri-created NSWindow to an NSPanel requires Objective-C runtime manipulation at startup
- The panel must use `NSWindowStyleMaskNonActivatingPanel` — clicks on the overlay interact with the UI but the OS does not transfer focus
- `NSFloatWindowLevel` makes it float above normal windows
- `CanJoinAllSpaces + FullScreenAuxiliary` collection behavior makes it visible on all desktops and alongside fullscreen apps
- These APIs are not available on Windows/Linux, requiring platform-conditional code

**Mitigation strategy:**
1. Use the `tauri-nspanel` crate which wraps the Objective-C runtime calls
2. Conversion happens once during setup, not repeatedly
3. Guard with `#[cfg(target_os = "macos")]` — Windows/Linux skip this entirely (they use standard always-on-top)
4. Test extensively with fullscreen apps, Mission Control, and multiple desktops

---

### Challenge 5: Multi-Monitor DPI-Aware Screenshot Capture

**Problem:** Capturing a user-selected region of the screen across monitors with different DPI scaling requires coordinate math that accounts for logical vs. physical pixels.

**Why it's hard:**
- Each monitor may have a different `devicePixelRatio` (e.g., 1.0 on external, 2.0 on Retina)
- The overlay window reports coordinates in logical pixels, but the captured image is in physical pixels
- Multi-monitor layouts may have gaps, offsets, or non-rectangular arrangements
- Creating one transparent overlay window per monitor requires correct positioning at physical coordinates
- The selection rectangle (drawn in CSS) must map to the exact physical pixel region in the captured image

**Mitigation strategy:**
1. Capture full screenshots of all monitors at startup and store them indexed by monitor
2. Create overlay windows sized to each monitor's physical pixel dimensions, positioned at the monitor's origin
3. Multiply all selection coordinates by `window.devicePixelRatio` before sending to the crop function
4. Minimum selection size (10×10px) to prevent accidental single-click captures
5. Test with mixed-DPI setups (e.g., 4K main + 1080p secondary)

---

### Challenge 6: Streaming Markdown Rendering Performance

**Problem:** AI responses stream at ~50ms per chunk. Each chunk triggers a React re-render of the full markdown document. The markdown renderer must parse, sanitize, syntax-highlight, and layout the entire accumulated text each time.

**Why it's hard:**
- Full re-parse on each chunk is O(n) where n is the total response length
- Syntax highlighting (Shiki) is expensive — loading grammars, tokenizing, applying themes
- KaTeX rendering of math equations involves heavy DOM manipulation
- Long responses (5000+ characters) with multiple code blocks can cause visible frame drops

**Mitigation strategy:**
1. **Memoize code blocks**: Use `React.memo` + `useMemo` on the Shiki component — only re-highlight when the code content actually changes
2. **Lazy load Shiki**: Use React Suspense — show unstyled `<pre>` as fallback, upgrade to highlighted version asynchronously
3. **Avoid unnecessary re-renders**: The markdown renderer should receive the response string as a prop and use a shallow comparison (new string reference only when content changes)
4. **Limit re-render frequency**: If needed, batch state updates or use `requestAnimationFrame` to throttle renders to 60fps

---

### Challenge 7: Cross-Window State Consistency

**Problem:** Two independent WebView windows must share configuration state (selected provider, theme, system prompt) without a custom IPC mechanism or shared memory.

**Why it's hard:**
- Tauri's two windows are separate WebView processes — they don't share JavaScript runtime state
- Changes in the dashboard (e.g., selecting a new AI provider) must be reflected in the overlay immediately
- Race conditions are possible if both windows write to the same localStorage key simultaneously
- The StorageEvent only fires in **other** windows, not the one that made the write — so the writer must also update local state

**Mitigation strategy:**
1. Use `window.addEventListener('storage', handler)` in both windows to listen for cross-window changes
2. On StorageEvent, trigger a full `loadData()` that re-reads all configuration from localStorage
3. Each window's own writes go through state setters that update both React state AND localStorage
4. Accept that localStorage is last-write-wins — for user preferences this is acceptable since the user only operates one window at a time

---

### Challenge 8: Secure License Storage

**Problem:** License keys must be stored securely — not in localStorage (browser-accessible), not in plaintext files (user-editable), not in memory only (lost on restart).

**Why it's hard:**
- The WebView has DevTools access, so any JavaScript-accessible storage is readable
- Tauri doesn't provide encrypted storage out of the box
- The storage must survive app updates and restarts
- The IPC boundary between frontend and backend must not leak keys

**Mitigation strategy:**
1. Store license data in a Rust-side JSON file in the app data directory (not web-accessible)
2. Enforce a strict key allowlist — only `license_key`, `instance_id`, `selected_model` are accepted
3. The frontend never sees the raw key except when the user enters it — all validation calls go through Rust
4. Display only masked keys (first 4 + *** + last 4) in the UI
5. Bind licenses to `machine_id` (hardware fingerprint) to prevent key sharing

---

### Challenge Summary

| # | Challenge | Difficulty | Phase |
|---|-----------|-----------|-------|
| 1 | Cross-platform audio loopback | Very Hard | 5 |
| 2 | Real-time VAD tuning | Hard | 5 |
| 3 | Provider-diverse SSE parsing | Hard | 2 |
| 4 | macOS NSPanel focus semantics | Hard | 4 |
| 5 | Multi-monitor DPI screenshots | Hard | 4 |
| 6 | Streaming markdown performance | Medium | 2 |
| 7 | Cross-window state consistency | Medium | 3 |
| 8 | Secure license storage | Medium | 6 |

---

### Risk Mitigation Summary

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Audio capture fails on specific hardware | Medium | High | Test on 5+ devices per platform; add diagnostic events |
| AI provider changes API format | Medium | Low | Provider configs are data — update template, no code change |
| macOS permission denials block features | Medium | Medium | Progressive permission model with graceful degradation |
| DPI scaling bugs on mixed monitors | High | Medium | Use physical pixel coordinates throughout; test mixed setups |
| Shiki bundle size slows initial load | Low | Medium | Lazy load via Suspense; only load used language grammars |
| SQLite corruption on crash during write | Low | High | Wrap batch operations in transactions; WAL journal mode |
| Stale closure bugs in React event handlers | High | Medium | useRef pattern for all values accessed from listeners |

---

*This plan provides a complete blueprint for rebuilding the application from architectural first principles, without referencing or copying any existing source code.*
