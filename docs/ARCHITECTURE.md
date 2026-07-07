# Architecture of Desktop AI Assistant (Torvi)

# Progress Update v0.5 (May 2026)

**This section documents the Context Memory feature added in v0.5.**

## Context Memory — Screen-Aware RAG

Torvi now maintains a continuously updated local knowledge base of what the user is doing on screen, which is injected into AI prompts automatically (Retrieval-Augmented Generation).

### How it works

1. **Screen Reader** (`src-tauri/src/screen_reader.rs`) — reads visible text from the foreground window every 2 seconds using the Windows **UIAutomation COM API**. No screenshot is taken — only structured text is extracted (~50ms, natively skips password fields).

2. **Privacy Filter** (`src-tauri/src/privacy_filter.rs`) — applied to every capture before storage or emission:
   - `should_capture()` — drops the whole snapshot for sensitive apps (1Password, KeePass, banking sites, etc.)
   - `redact_sensitive()` — strips PII patterns: credit cards, SSNs, API keys (`sk-`, `ghp_`, `AIza`, `AKIA`…), and OTPs

3. **Context Watcher** (`src-tauri/src/app_context.rs`) — background Tokio task polling every 2 seconds:
   - Deduplicates by SHA-256 content hash (no repeated identical captures)
   - Emits `context-captured` Tauri event to the frontend
   - Writes directly to SQLite via `ContextDb` (bypasses `tauri-plugin-sql` IPC which silently dropped INSERTs)

4. **Context DB** (`src-tauri/src/context_db.rs`) — direct `sqlx` writer using WAL journal mode to coexist with the `tauri-plugin-sql` read pool:
   - Table: `context_chunks` (id, app_name, window_title, content_type, text_content, content_hash, captured_at, url, parent_capture_id, chunk_index)
   - Chunking strategy per content_type:
     - `chat` → split on speaker-turn boundaries
     - `email` → split on "From:" / reply markers
     - `code` → split on top-level declarations (fn/class/interface)
     - `document` → split on markdown headings or blank lines
     - `generic` → sliding window: 600-char with 100-char overlap

5. **Context Store** (`src/lib/database/context-store.ts`) — TypeScript read layer for the `context_chunks` table; used by the AI prompt builder for BM25-style retrieval.

6. **Context Memory Page** (`/context-memory`) — dashboard page for viewing captured context chunks, per-app history, and toggling the watcher on/off.

### Tauri commands added
| Command | Purpose |
|---------|---------|
| `start_context_watcher` | Start background polling (no-op if already running) |
| `stop_context_watcher` | Stop background polling |
| `read_active_window_context` | One-shot foreground window read |

### Tauri events emitted
| Event | Payload |
|-------|---------|
| `context-captured` | `AppContextSnapshot { app_name, window_title, text_content, content_type, content_hash, url, captured_at }` |

### Design notes
- Windows-only (UIAutomation is a Windows API). macOS/Linux return an error gracefully.
- The `ContextDb` sqlx pool uses WAL mode so it can write concurrently with the JS-side read pool.
- 24-hour rolling window is enforced on retrieval (not on storage) to keep the knowledge base fresh.

---

# Progress Update v0.4 (May 2026)

**This section summarizes the latest improvements as of May 2026.**

## Security: Server-Side Rate Limit Enforcement

A critical security vulnerability was identified and fixed: the `user_profiles` Appwrite collection had `Permission.write(Role.user(userId))`, meaning any user could PATCH their own `aiResponsesRemaining` and `listeningMinutesRemaining` values via the Appwrite REST API — effectively giving themselves unlimited usage.

**Fix implemented:**
- Created a new dedicated `user_usage` Appwrite collection, separate from `user_profiles`.
- Users have **read-only** access to their own `user_usage` document. All writes go exclusively through the Rust backend using `APPWRITE_API_SECRET` (server-side API key).
- New `src-tauri/src/usage.rs` module with three Tauri commands:
  - `initialize_user_usage(user_id, plan)` — idempotent doc creation with correct starting limits
  - `decrement_usage(user_id, usage_type, amount)` — atomic field decrement via REST PATCH
  - `push_local_usage(user_id, ai_remaining, listening_remaining)` — one-way ratchet: only writes if local shows more usage than remote (prevents forged increments)
- All `invoke("decrement_usage", ...)` calls happen from TypeScript via Tauri IPC — the API secret never leaves the Rust process.
- `user_profiles` no longer stores any usage fields; those columns have been removed.

## Plan Limits Rationalized

Previous plan limits were placeholders (`pro: (-1, -1)` which converted to 100,000 in Rust, exceeding Appwrite's column Max: 1000 constraint). New real limits:

| Plan | AI Responses | Listening Time |
|------|-------------|----------------|
| Starter | 30 | 30 min |
| Plus | 120 | 2 hours |
| Pro | 500 | 10 hours |

`PLAN_LIMITS` in `src/config/constants.ts` is now the single source of truth, used by both TypeScript (display, local enforcement) and mirrored in `usage.rs` (Appwrite writes).

## Listening Time Stored in Seconds

Appwrite previously stored `listeningMinutesRemaining` as integer minutes. This caused rounding errors — a 47-second listening session was either lost or rounded up to a full minute.

**Change:** The field is now `listeningSecondsRemaining`, storing raw seconds.

| | Before | After |
|---|---|---|
| Appwrite field | `listeningMinutesRemaining` | `listeningSecondsRemaining` |
| Init value (starter) | 30 min | 1,800 s |
| Init value (plus) | 120 min | 7,200 s |
| Init value (pro) | 600 min | 36,000 s |
| Decrement cadence | Every 60 s, −1 min | Every 1 s, −1 s |
| Partial session rounding | ≥10 s counted as 1 full min | Exact — 47 s = 47 s |
| Desktop display | Minutes (unchanged) | Still minutes (converted at render) |
| Startup sync conversion | `minutes × 60` → seconds | Direct 1:1, no conversion |

The desktop UI still shows minutes everywhere — the conversion is only at the display layer. Appwrite is the source of truth in seconds.

## Appwrite Sync Improvements

- `sync.ts` startup reconciliation no longer does minutes↔seconds conversion; it works directly in seconds end-to-end.
- `push_local_usage` ratchet logic simplified: compares `localRemaining` (seconds) directly against `remoteUsage.listeningSecondsRemaining`.
- `fetchRemoteUsage` in `sync-profiles.ts` returns `listeningSecondsRemaining` instead of `listeningMinutesRemaining`.
- The `aiRemaining` calculation no longer uses a magic `100_000` fallback; it properly uses `limits.aiResponses`.

---

# Progress Update v0.3 (April 2026)

**This section summarizes the state of Torvi as of April 2026.**

## Branding
- **Renamed**: Torvi → **Torvi** across all source files, window titles, system prompts, and UI text.
- Only these reference .md files retain historical "Torvi" references for context.

## Core Stack
- **Tauri 2 + React 19 + TypeScript 5.8**: Cross-platform desktop app with transparent overlay window.
- **Vite + Tailwind CSS v4**: Frontend build with `@tailwindcss/vite` plugin, OKLCH color tokens.
- **SQLite** (`@tauri-apps/plugin-sql`): Local persistence for conversations, messages, system prompts.
- **localStorage**: Settings, usage stats, auth tokens, model selection, response preferences.

## Windows & Navigation
- **Three-window architecture**: Overlay pill bar (main), Gate (auth), Dashboard (settings/history).
- **Gate window**: Created hidden on startup. React controls visibility — only shown when user sign-in is required. Auto-unlocks silently in dev mode (`VITE_SKIP_AUTH_CHECK=true`).
- **Dashboard window**: 900×680px, frameless, 13 routes (Dashboard, Chats, Chat View, System Prompts, Shortcuts, Screenshot, Audio, Responses, Billing, Settings).
- **Overlay pill bar**: 600×44px collapsed, 600×600px expanded. Always-on-top, `WS_EX_TOOLWINDOW` style (hidden from taskbar). Glassmorphism with adjustable alpha.

## Authentication
- **Dual auth flow**: Appwrite OAuth (Google) + Legacy JWT (landing page).
- **Appwrite SDK** (`appwrite` npm v24.2.0): Lazy-loaded to prevent gate crashes.
- **Rust OAuth callback server**: TCP listener on random port → browser redirect → Tauri event to frontend.
- **Dev bypass**: `VITE_SKIP_AUTH_CHECK=true` skips all auth and auto-unlocks the app.
- Gate React component calls `invoke("show_gate")` only when sign-in UI is needed.

## AI Model System
- **Multi-provider support**: OpenRouter (30+ models) + NVIDIA NIM (Gemma 4, Llama 4, Nemotron).
- **Model selection UI**: Role-based interview/meeting type selector (7 cards + specialisation pills). Model IDs are **never shown to the user** — selected automatically based on role.
- **Flow**: Settings UI → `applyInterviewRole(roleId, specId)` → `resolveModelForRole()` → `saveSelectedModel()` → localStorage → `loadSelectedModel()` → Rust `get_ai_config(modelId)` → API request.
- **Streaming**: SSE parsing with configurable response content paths per provider.

## Role → Model Mapping Rationale

Each interview/meeting role is mapped to the model best suited to its task characteristics:

| Role | Specialisation | Model | Rationale |
|---|---|---|---|
| Coding | DSA / Algorithms (default) | `deepseek/deepseek-chat-v3-0324` | Highest scores on HumanEval and LiveCodeBench; optimised for competitive programming |
| Coding | System Design / DevOps | `anthropic/claude-3.7-sonnet` | Best long-form structured reasoning for architecture trade-off analysis |
| Coding | AI / ML | `openai/o4-mini` | Math-heavy proofs and derivations; strong ML theory and algorithm questions |
| Behavioural | — | `anthropic/claude-3.7-sonnet` | Empathetic, STAR-format fluency; excellent at tone-matching and narrative structure |
| Consulting | Frameworks / Strategy (default) | `openai/gpt-4o` | Strong case frameworks, business logic, structured tables and concise reasoning |
| Consulting | Market Sizing | `openai/o4-mini` | Estimation problems require explicit step-by-step arithmetic reasoning |
| Data Analyst | SQL / Stats (default) | `openai/o4-mini` | SQL query planning, statistical test selection, A/B math |
| Data Analyst | BI / Reporting | `openai/gpt-4o` | Better at explaining business context, dashboard design, and stakeholder framing |
| Tech / Corporate Meeting | — | `google/gemini-pro-1.5` | Largest context window (1M tokens) — handles long transcripts, RFCs, and design docs |
| Sales Meeting | — | `anthropic/claude-3.5-haiku` | Fast, persuasive, conversational — lowest latency for live call coaching |
| General / Other | — | `openai/gpt-4o` | Well-rounded reliable fallback for unspecified use cases |

- Model IDs are defined in `src/config/interview-roles.constants.ts` → `ROLE_MODEL_MAP`.
- The only derivation point is `resolveModelForRole(roleId, specId)` — change models there.
- All role-based model IDs are whitelisted in `src-tauri/src/api.rs` `ALLOWED_MODELS`.

## Audio Pipeline
- **System audio**: WASAPI loopback capture → Rust VAD (RMS/peak state machine) → WAV encoding → base64 → Tauri event → STT.
- **Microphone**: Push-to-talk via WebSpeech API or AssemblyAI real-time streaming STT.
- **STT providers**: AssemblyAI (primary real-time), Groq Whisper (fallback).

## Screenshot
- **Manual-only mode**: Auto-capture removed. Full-screen capture via `xcap` crate → base64 PNG → AI vision model.

## System Prompts
- **Rich default prompt**: Structured Torvi system prompt with response formatting, persona, and capability instructions.
- **CRUD**: SQLite-backed system prompts with dashboard management UI.

## Appwrite Integration
- **7 module files**: client.ts, auth.ts, sync-profiles.ts, sync-conversations.ts, sync-prompts.ts, sync-settings.ts, sync.ts.
- **Two Appwrite collections for user data**:
  - `user_profiles` — profile info only (`name`, `email`, `plan`, `isActive`). User has read+write access.
  - `user_usage` — rate limit counters (`aiResponsesRemaining`, `listeningSecondsRemaining`). User has **read-only** access; all writes go through Rust with `APPWRITE_API_SECRET`.
- **Sync wired into**: useCompletion (AI response decrement), app.context (startup sync), app/index.tsx (listening seconds decrement), auth.ts (initialize usage on sign-in).
- **`usage.rs`**: New Rust module handling all server-side usage writes. Registered commands: `initialize_user_usage`, `decrement_usage`, `push_local_usage`.

## Usage & Billing
- **Plan limits** (stored in `src/config/constants.ts` as `PLAN_LIMITS`):
  - Starter: 30 AI responses / 1,800 s (30 min) listening
  - Plus: 120 AI responses / 7,200 s (2 hr) listening
  - Pro: 500 AI responses / 36,000 s (10 hr) listening
- **Billing page**: 3-tier pricing cards (Starter ₹0, Plus ₹800+, Pro ₹1,999) with GST calculation and adjustable listening/response add-ons.
- **Usage enforcement**: `checkAiResponseLimit()` guard before AI calls. Rate limits enforced server-side via `usage.rs` — users cannot forge writes.

## Response Settings
- **Response length**: Short (2-4 sentences), Medium (1-2 paragraphs), Auto.
- **Response language**: Removed from UI (was not wired to AI calls). Will be re-added as a functional feature later.

## Shortcuts
- **Global** (Rust-registered): `Ctrl+Shift+H` (toggle overlay), `Ctrl+Shift+I` (focus input).
- **In-app**: Screenshot, audio, mic, dashboard, clear chat, glass intensity, move window, escape.

## Known Limitations
- Only dark mode supported (by design).
- Google OAuth not configured in Appwrite Console.
- Response language selection not yet functional (removed from UI).

---

# Torvi — Complete Architecture Document

> **Generated from full codebase analysis. Renamed from Torvi.**  
> Use this as the blueprint for building your own app.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture Diagram](#3-high-level-architecture-diagram)
4. [Directory Structure](#4-directory-structure)
5. [Frontend Architecture (React/TypeScript)](#5-frontend-architecture)
   - 5.1 Entry Point & Rendering Modes
   - 5.2 Routing
   - 5.3 Layouts
   - 5.4 Pages
   - 5.5 Components
   - 5.6 Contexts (State Management)
   - 5.7 Hooks
   - 5.8 Functional Layer (lib/functions)
   - 5.9 Storage Layer (lib/storage)
   - 5.10 Database Layer (lib/database)
   - 5.11 Types
   - 5.12 Config & Constants
6. [Backend Architecture (Tauri/Rust)](#6-backend-architecture)
   - 6.1 Entry Points
   - 6.2 Core Modules
   - 6.3 Database & Migrations
   - 6.4 Platform-Specific Audio (Speaker)
   - 6.5 Tauri Plugins
   - 6.6 IPC Commands
   - 6.7 Events
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Database Schema](#8-database-schema)
9. [AI Provider System](#9-ai-provider-system)
10. [Speech-to-Text Provider System](#10-speech-to-text-provider-system)
11. [Feature Breakdown](#11-feature-breakdown)
12. [Security Model](#12-security-model)
13. [Build & Deployment](#13-build--deployment)
14. [Performance Optimizations](#14-performance-optimizations)
15. [Extensibility Points](#15-extensibility-points)
16. [How to Recreate This App](#16-how-to-recreate-this-app)
17. [Desktop Runtime Architecture](#17-desktop-runtime-architecture)
18. [AI Integration Layer](#18-ai-integration-layer)
19. [Audio Capture Pipeline](#19-audio-capture-pipeline)
20. [Overlay Window System](#20-overlay-window-system)
21. [Complete Event Flow Diagram](#21-complete-event-flow-diagram)
22. [Major Modules & Responsibilities](#22-major-modules--responsibilities)
23. [Third-Party Services Used](#23-third-party-services-used)

---

## 1. Project Overview

**Torvi** is a privacy-first, lightweight AI assistant desktop application (~10MB) built as an open-source alternative to Cluely. It works as a transparent overlay during meetings, interviews, and conversations — invisible to screen recording/sharing.

### Core Capabilities
| Feature | Description |
|---------|-------------|
| **AI Chat** | Stream responses from 10+ AI providers (OpenAI, Claude, Gemini, etc.) |
| **System Audio Capture** | Capture system/microphone audio with Voice Activity Detection (VAD) |
| **Speech-to-Text** | Real-time transcription via 10+ STT providers |
| **Screenshot Analysis** | Multi-monitor screenshot capture with AI vision analysis |
| **Transparent Overlay** | Invisible to screen shares, content-protected windows |
| **Custom Providers** | Add any AI/STT provider via curl commands |
| **Persistent History** | SQLite-backed chat history with full-text conversations |
| **Global Shortcuts** | 7 customizable system-wide keyboard shortcuts |
| **License System** | Premium Torvi API with secure license activation |
| **Cross-Platform** | Windows (WASAPI), macOS (Core Audio), Linux (PulseAudio) |

### Key Metrics
- **App Size**: ~10MB (vs 270MB for Cluely)
- **Version**: v0.5
- **License**: GPL-3.0
- **Platforms**: Windows, macOS, Linux

---

## 2. Tech Stack

### Frontend
| Technology | Purpose | Version |
|-----------|---------|---------|
| React | UI framework | 19.1.0 |
| TypeScript | Language | 5.8.3 |
| Vite | Build tool | 7.0.4 |
| React Router | Client-side routing | 7.9.5 |
| Tailwind CSS | Utility-first CSS | 4.1.12 |
| Radix UI | Headless component primitives | Various |
| Shadcn UI | Styled component library | New York variant |
| react-markdown | Markdown rendering | Latest |
| rehype-katex | Math equation rendering | Latest |
| shiki | Syntax highlighting | 3.12.2 |
| recharts | Chart components | 2.15.4 |
| lucide-react | Icon library | 0.539.0 |
| @ricky0123/vad-react | Voice Activity Detection | 0.0.30 |

### Backend (Rust)
| Technology | Purpose |
|-----------|---------|
| Tauri 2.x | Desktop application framework |
| tokio | Async runtime |
| reqwest | HTTP client (streaming) |
| serde / serde_json | Serialization |
| xcap | Screenshot capture |
| image | Image processing |
| cpal | Cross-platform audio |
| hound | WAV file writing |
| ringbuf | Lock-free audio ring buffer |
| uuid | Unique ID generation |
| base64 | Encoding |

### Platform-Specific Audio
| Platform | Crate | API |
|----------|-------|-----|
| Windows | wasapi | WASAPI |
| macOS | cidre | Core Audio |
| Linux | libpulse-binding | PulseAudio |

### Tauri Plugins
| Plugin | Purpose |
|--------|---------|
| tauri-plugin-sql | SQLite database |
| tauri-plugin-http | HTTP requests |
| tauri-plugin-global-shortcut | System-wide shortcuts |
| tauri-plugin-updater | Auto-updates |
| tauri-plugin-keychain | Secure credential storage |
| tauri-plugin-shell | Shell command execution |
| tauri-plugin-opener | Open URLs in browser |
| tauri-plugin-autostart | Launch on system boot |
| tauri-plugin-posthog | Analytics |
| tauri-plugin-machine-uid | Machine identification |
| tauri-plugin-macos-permissions | macOS permission requests |
| tauri-nspanel | macOS window panels |

---

## 3. High-Level Architecture Diagram

```
┌──────────────────────────── TORVI DESKTOP APP ────────────────────────────┐
│                                                                             │
│  ┌────────────────────── Frontend (React/TypeScript) ──────────────────┐   │
│  │                                                                      │   │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────────┐  ┌──────────────┐ │   │
│  │  │  Pages   │  │ Components│  │    Hooks       │  │   Contexts   │ │   │
│  │  │(11 routes│→ │(UI + feat)│← │(business logic)│← │(global state)│ │   │
│  │  └──────────┘  └───────────┘  └───────┬───────┘  └──────────────┘ │   │
│  │                                        │                            │   │
│  │  ┌────────────────────────────────────┼────────────────────────┐   │   │
│  │  │              Functional Layer       ↓                       │   │   │
│  │  │  ┌──────────────┐  ┌──────────┐  ┌────────────────────┐   │   │   │
│  │  │  │ AI Response   │  │   STT    │  │  Common Functions  │   │   │   │
│  │  │  │ (streaming)   │  │(transcr.)│  │ (templates, utils) │   │   │   │
│  │  │  └──────┬───────┘  └────┬─────┘  └────────────────────┘   │   │   │
│  │  └─────────┼───────────────┼──────────────────────────────────┘   │   │
│  │            │               │                                       │   │
│  │  ┌────────┼───────────────┼────────────────────────────────────┐  │   │
│  │  │        ↓               ↓       Persistence Layer            │  │   │
│  │  │  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐   │  │   │
│  │  │  │localStorage│ │  SQLite DB   │  │  Secure Storage    │   │  │   │
│  │  │  │(settings)  │ │(chat history)│  │  (license, keys)   │   │  │   │
│  │  │  └──────────┘  └──────────────┘  └────────────────────┘   │  │   │
│  │  └────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 │ Tauri IPC (invoke + events)           │
│  ┌──────────────────────────────┼───────────────────────────────────┐   │
│  │              Backend (Rust/Tauri)                                 │   │
│  │                              ↓                                    │   │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────┐│   │
│  │  │ api.rs   │ │capture.rs │ │window.rs │ │   shortcuts.rs    ││   │
│  │  │(AI,STT,  │ │(screenshot│ │(position,│ │(global keyboard   ││   │
│  │  │ license) │ │ overlay)  │ │ sizing)  │ │ bindings)         ││   │
│  │  └──────────┘ └───────────┘ └──────────┘ └────────────────────┘│   │
│  │  ┌──────────┐ ┌────────────────────────────────────────────────┐│   │
│  │  │usage.rs  │ │ speaker/ (platform-specific audio)            ││   │
│  │  │(license   │ │  ├─ windows.rs (WASAPI)                      ││   │
│  │  │ mgmt)     │ │  ├─ macos.rs   (Core Audio + cidre)          ││   │
│  │  └──────────┘ │  └─ linux.rs   (PulseAudio)                   ││   │
│  │               └────────────────────────────────────────────────┘│   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │ db/  (SQLite migrations + CRUD)                            │ │   │
│  │  │  ├─ main.rs (conversation/message operations)              │ │   │
│  │  │  └─ migrations/ (schema SQL files)                         │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│                     ┌──────────────────────┐                             │
│                     │  Native OS APIs      │                             │
│                     │ • Keyboard shortcuts │                             │
│                     │ • Audio capture      │                             │
│                     │ • Screen capture     │                             │
│                     │ • Window management  │                             │
│                     └──────────────────────┘                             │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌──────────────────── External Services ────────────────────┐
│  AI Providers: OpenAI, Claude, Gemini, Groq, Mistral...  │
│  STT Providers: Whisper, ElevenLabs, Deepgram, Google... │
│  Torvi API: License, Models, Chat, Transcription        │
│  PostHog: Analytics                                       │
└───────────────────────────────────────────────────────────┘
```

---

## 4. Directory Structure

```
torvi-master/
│
├── package.json              # NPM config, scripts, frontend dependencies
├── tsconfig.json             # TypeScript compiler options
├── vite.config.ts            # Vite build config (port 1420, HMR 1421)
├── components.json           # Shadcn UI config (New York style)
├── index.html                # HTML entry point
├── tailwind.config.*         # Tailwind CSS configuration
│
├── src/                      # ─── FRONTEND SOURCE ───
│   ├── main.tsx              # App entry: routing setup, provider wrapping
│   ├── global.css            # Global styles, CSS variables, themes
│   ├── vite-env.d.ts         # Vite type declarations
│   │
│   ├── routes/
│   │   └── index.tsx         # React Router route definitions (11 routes)
│   │
│   ├── pages/                # ─── Page-level components ───
│   │   ├── app/              # Main overlay window (AI chat interface)
│   │   ├── dashboard/        # Dashboard with overview stats
│   │   ├── chats/            # Chat history list + conversation viewer
│   │   ├── settings/         # Provider config, preferences
│   │   ├── audio/            # Audio input device selection
│   │   ├── screenshot/       # Screenshot settings
│   │   ├── responses/        # Response length/language settings
│   │   ├── system-prompts/   # System prompt management
│   │   ├── shortcuts/        # Global shortcut configuration
│   │   └── dev/              # Developer tools
│   │
│   ├── components/           # ─── Reusable components ───
│   │   ├── Sidebar.tsx       # Navigation sidebar
│   │   ├── Overlay.tsx       # Screenshot selection overlay (canvas)
│   │   ├── CustomCursor.tsx  # Custom cursor rendering
│   │   ├── DragButton.tsx    # Draggable window handle
│   │   ├── Icons.tsx         # SVG icon definitions
│   │   ├── Promote.tsx       # Promotional banner
│   │   ├── Contribute.tsx    # Contribution CTA
│   │   ├── GetLicense.tsx    # License activation UI
│   │   │
│   │   ├── Header/           # Page header (title + description + actions)
│   │   ├── Markdown/         # Rich markdown renderer + copy button
│   │   ├── TextInput/        # Enhanced text input with file support
│   │   ├── Selection/        # Multi-select dropdown
│   │   ├── Empty/            # Empty state component
│   │   ├── updater/          # Auto-update notification UI
│   │   │
│   │   └── ui/               # Shadcn/Radix primitive components
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── input.tsx
│   │       ├── scroll-area.tsx
│   │       ├── select.tsx
│   │       ├── slider.tsx
│   │       ├── switch.tsx
│   │       ├── tabs.tsx
│   │       ├── card.tsx
│   │       ├── badge.tsx
│   │       ├── popover.tsx
│   │       ├── command.tsx
│   │       ├── chart.tsx
│   │       └── ...
│   │
│   ├── contexts/             # ─── Global state ───
│   │   ├── app.context.tsx   # AppProvider: AI config, STT, providers, settings
│   │   └── theme.context.tsx # ThemeProvider: dark/light/system, transparency
│   │
│   ├── hooks/                # ─── Custom React hooks ───
│   │   ├── useApp.ts              # App initialization, migration, window events
│   │   ├── useCompletion.ts       # Main overlay chat logic (messages, files, AI)
│   │   ├── useChatCompletion.ts   # Focused chat page logic (SQLite-backed)
│   │   ├── useSystemAudio.ts      # System audio capture + VAD + transcription
│   │   ├── useGlobalShortcuts.ts  # Global keyboard shortcut registration
│   │   ├── useSettings.ts         # Provider/screenshot configuration
│   │   ├── useCustomProvider.ts   # Custom AI provider CRUD
│   │   ├── useCustomSttProviders.ts # Custom STT provider CRUD
│   │   ├── useShortcuts.ts        # Shortcut binding management
│   │   ├── useHistory.ts          # Conversation list + pagination
│   │   ├── useSystemPrompts.ts    # System prompt CRUD
│   │   ├── useTitles.ts           # Window title management
│   │   ├── useVersion.ts          # App version retrieval
│   │   ├── useWindow.ts           # Window size/position management
│   │   ├── useMenuItems.tsx       # Context menu builder
│   │   └── useCopyToClipboard.ts  # Clipboard operations
│   │
│   ├── lib/                  # ─── Utilities & business logic ───
│   │   ├── utils.ts               # General utilities (cn, classnames)
│   │   ├── platform.ts            # OS detection (Windows/macOS/Linux)
│   │   ├── platform-instructions.ts # Platform-specific UI text
│   │   ├── analytics.ts           # PostHog analytics wrapper
│   │   ├── version.ts             # Version utilities
│   │   ├── chat-constants.ts      # Chat timing/ID constants
│   │   ├── curl-validator.ts      # Curl command parsing/validation
│   │   ├── response-settings.constants.ts # Response length/language options
│   │   │
│   │   ├── functions/             # Core business functions
│   │   │   ├── ai-response.function.ts  # AI streaming (main fetch function)
│   │   │   ├── stt.function.ts          # Speech-to-text transcription
│   │   │   ├── torvi.api.ts            # Torvi premium API routing
│   │   │   └── common.function.ts       # Template processing, variable extraction
│   │   │
│   │   ├── database/              # SQLite operations (frontend wrappers)
│   │   │   ├── chat-history.ts    # Conversation/message CRUD
│   │   │   └── system-prompts.ts  # System prompt CRUD
│   │   │
│   │   └── storage/               # LocalStorage wrappers
│   │       ├── helper.ts          # Safe localStorage access
│   │       ├── ai-providers.ts    # Custom AI provider persistence
│   │       ├── stt-providers.ts   # Custom STT provider persistence
│   │       ├── response-settings.storage.ts # Response preferences
│   │       └── shortcuts.storage.ts  # Shortcut key bindings
│   │
│   ├── config/               # ─── Configuration constants ───
│   │   ├── constants.ts           # LocalStorage keys, defaults
│   │   ├── ai-providers.constants.ts  # Built-in AI provider definitions
│   │   ├── stt.constants.ts       # Built-in STT provider definitions
│   │   └── shortcuts.ts          # Default shortcut key bindings
│   │
│   ├── types/                # ─── TypeScript type definitions ───
│   │   ├── completion.ts          # Chat message types
│   │   ├── completion.hook.ts     # Hook return types
│   │   ├── context.type.ts        # Context interface
│   │   ├── provider.type.ts       # Provider types
│   │   ├── settings.ts            # Settings types
│   │   ├── settings.hook.ts       # Settings hook types
│   │   ├── shortcuts.ts           # Shortcut types
│   │   └── system-prompts.ts      # System prompt types
│   │
│   └── layouts/              # ─── Layout wrappers ───
│       ├── DashboardLayout.tsx    # Sidebar + main content area
│       ├── PageLayout.tsx         # Header + scroll content + promote banner
│       └── ErrorLayout.tsx        # Error boundary fallback
│
├── src-tauri/                # ─── BACKEND SOURCE (Rust) ───
│   ├── Cargo.toml            # Rust dependencies
│   ├── tauri.conf.json       # Tauri app config (window, plugins, updater)
│   ├── build.rs              # Build script
│   ├── info.plist            # macOS app permissions
│   │
│   ├── capabilities/         # Tauri capability permissions (per-window scoping)
│   │   ├── default.json      # Default permissions set
│   │   ├── main.json         # Pill bar overlay window capabilities
│   │   ├── dashboard.json    # Dashboard window capabilities
│   │   └── gate.json         # Auth gate window capabilities
│   │
│   └── src/
│       ├── main.rs             # Entry point → torvi_lib::run()
│       ├── lib.rs              # Tauri setup, plugins, state, invoke handler
│       ├── api.rs              # AI streaming, STT, license check, model fetch
│       ├── capture.rs          # Screenshot capture (multi-monitor, DPI-aware)
│       ├── shortcuts.rs        # Global shortcut management + action routing
│       ├── window.rs           # Window positioning, sizing, gate lifecycle
│       ├── auth.rs             # OAuth callback server, token helpers
│       ├── usage.rs            # Server-side rate limits (APPWRITE_API_SECRET)
│       ├── audio_capture.rs    # Audio capture helpers
│       ├── streaming_stt.rs    # Real-time streaming STT pipeline
│       ├── screen_reader.rs    # UIAutomation foreground window text reader (Windows)
│       ├── app_context.rs      # Background context watcher (polls every 2s, deduplicates)
│       ├── context_db.rs       # Direct sqlx writer for context_chunks (WAL mode)
│       ├── privacy_filter.rs   # PII redaction: CC#, SSN, API keys, OTPs
│       │
│       ├── migrations/         # SQLite schema SQL files
│       │   ├── 001_system_prompts.sql
│       │   └── 002_chat_history.sql
│       │
│       └── speaker/            # Platform-specific audio capture
│           ├── mod.rs        # Trait definitions, shared types
│           ├── commands.rs   # Tauri command handlers
│           ├── windows.rs    # Windows WASAPI implementation
│           ├── macos.rs      # macOS Core Audio implementation
│           └── linux.rs      # Linux PulseAudio implementation
│
└── images/                   # Static images / screenshots
```

---

## 5. Frontend Architecture

### 5.1 Entry Point & Rendering Modes

**File**: `src/main.tsx`

The app has **two rendering modes** based on the Tauri window label:

```
┌─────────────────────────────────────────────┐
│                  main.tsx                   │
│                                             │
│  Window label starts with                   │
│  "capture-overlay-*" ?                      │
│      │                                      │
│      ├─ YES → Render <Selection> overlay    │
│      │         (screenshot selection canvas)│
│      │                                      │
│      └─ NO → Render full app:               │
│                <ThemeProvider>              │
│                  <AppProvider>              │
│                    <RouterProvider>         │
│                  </AppProvider>             │
│                </ThemeProvider>             │
└─────────────────────────────────────────────┘
```

### 5.2 Routing

**File**: `src/routes/index.tsx`

```
/                               → App (main overlay window — AI chat)
/gate                           → Gate (auth sign-in window)
/dashboard                      → Dashboard (overview, stats, quick actions)
/chats                          → Chats (conversation list)
/chats/view/:conversationId     → Chat viewer (specific conversation)
/settings                       → AI/STT provider configuration
/shortcuts                      → Global shortcuts configuration
/screenshot                     → Screenshot mode settings
/responses                      → Response length/language settings
/billing                        → Plan & billing (3-tier pricing)
/context-memory                 → Context Memory (captured screen context viewer)
```

Layouts:
- **Root** `/` = App page (standalone overlay, no layout)
- **All other routes** = wrapped in `DashboardLayout` (sidebar + content)

### 5.3 Layouts

| Layout | File | Purpose |
|--------|------|---------|
| `DashboardLayout` | `layouts/DashboardLayout.tsx` | Sidebar navigation + main content area + error boundary |
| `PageLayout` | `layouts/PageLayout.tsx` | Page header (title, description) + scroll area + promote banner |
| `ErrorLayout` | `layouts/ErrorLayout.tsx` | Error boundary fallback with retry |

### 5.4 Pages

| Page | Route | Key Responsibilities |
|------|-------|---------------------|
| **App** | `/` | Main overlay: text input, AI chat, file attachments, screenshot, audio |
| **Gate** | `/gate` | Auth sign-in window (shown hidden; React controls visibility) |
| **Dashboard** | `/dashboard` | Overview stats, quick actions, activity chart |
| **Chats** | `/chats` | Conversation list with search, delete, view |
| **Chat Viewer** | `/chats/view/:conversationId` | Full conversation view with continue-chat |
| **Settings** | `/settings` | AI/STT provider selection, API key entry, custom providers |
| **Screenshot** | `/screenshot` | Auto/manual mode, screenshot prompt configuration |
| **Responses** | `/responses` | Response length (short/medium/auto), language selection |
| **Shortcuts** | `/shortcuts` | Global shortcut key binding editor |
| **Billing** | `/billing` | 3-tier pricing cards (Starter ₹0, Plus, Pro) with GST + add-ons |
| **Context Memory** | `/context-memory` | View captured screen context chunks; toggle watcher on/off |

### 5.5 Components

#### Component Hierarchy
```
DashboardLayout
├── Sidebar (navigation links, icons, active state)
├── PageLayout
│   ├── Header (title, description, right actions slot)
│   └── ScrollArea (page content)
└── ErrorBoundary → ErrorLayout

App (overlay window)
├── TextInput (message input + file attachments, up to 6)
├── Markdown (AI response renderer)
│   └── CopyButton (code block copy)
├── UsageTimer (remaining AI responses + listening time display)
├── Onboarding (first-run flow)
└── Toast notifications
```

#### Feature Components

| Component | Purpose |
|-----------|---------|
| `Sidebar` | Left navigation with route links, provider indicator, plan status |
| `Header` | Page header with title, description, optional right-side actions |
| `Markdown` | Rich markdown renderer with syntax highlighting (shiki), KaTeX math, copy buttons |
| `TextInput` | Enhanced input: text + file drop/paste (up to 6), keyboard shortcuts |
| `UsageTimer` | Real-time display of remaining AI responses and listening seconds |
| `Onboarding` | First-run onboarding flow |
| `Toast` | Toast notification system |
| `Tooltip` | Accessible tooltip wrapper |

#### UI Primitives (Shadcn/Radix)
All in `src/components/ui/`: Button, Dialog, Dropdown Menu, Input, Label, Popover, Scroll Area, Select, Slider, Switch, Tabs, Card, Badge, Command, Chart, Empty, Toast/Sonner.

### 5.6 Contexts (State Management)

#### AppContext (`contexts/app.context.tsx`)
Central application state — no Redux, no Zustand, just React Context + useState.

```typescript
interface IContextType {
  // AI Provider
  allAiProviders: TYPE_PROVIDER[];
  selectedAIProvider: { provider: string; variables: Record<string, string> };
  
  // STT Provider
  allSttProviders: TYPE_PROVIDER[];
  selectedSttProvider: { provider: string; variables: Record<string, string> };
  
  // Custom Providers
  customAIProviders: TYPE_PROVIDER[];
  customSttProviders: TYPE_PROVIDER[];
  
  // Settings
  systemPrompt: string;
  screenshotConfiguration: ScreenshotConfig;
  
  // Customization
  customizable: {
    appIcon: { isVisible: boolean };
    alwaysOnTop: { isEnabled: boolean };
    autostart: { isEnabled: boolean };
    cursor: { type: "invisible" | "default" | "auto" };
  };
  
  // License
  torviApiEnabled: boolean;
  hasActiveLicense: boolean;
  
  // Update methods for all of the above
  updateSelectedAIProvider(...): void;
  updateSystemPrompt(...): void;
  toggleTorviApi(...): void;
  // ... etc.
}
```

**Initialization Flow**:
1. Load from localStorage on mount
2. Merge built-in + custom providers
3. Validate current selection
4. Sync changes back to localStorage on update

#### ThemeContext (`contexts/theme.context.tsx`)
```typescript
interface ThemeContextType {
  theme: "light" | "dark" | "system";
  setTheme: (theme: string) => void;
  transparency: number;         // 0-100
  setTransparency: (value: number) => void;
}
```
- Persists to localStorage keys: `theme`, `transparency`
- Applies CSS class to `<html>` for dark/light mode
- Transparency controls window opacity (glass-morphism effect)

### 5.7 Hooks

| Hook | File | Category | Purpose |
|------|------|----------|---------|
| `useCompletion` | `useCompletion.ts` | **Core** | Main overlay: message state, file attachments, AI streaming, screenshot |
| `useSystemAudio` | `useSystemAudio.ts` | **Core** | System audio capture, VAD, transcription streaming, quick actions |
| `useElevenLabsSTT` | `useElevenLabsSTT.ts` | **Core** | ElevenLabs real-time STT integration |
| `useSpeechToText` | `useSpeechToText.ts` | **Core** | Generic STT hook wrapper |
| `useHistory` | `useHistory.ts` | **Data** | Conversation list, fetch, filter, pagination |
| `useWindow` | `useWindow.ts` | **UI** | Window height, dashboard toggle, window movement |
| `useToast` | `useToast.ts` | **UI** | Toast notification system |
| `useCopyToClipboard` | `useCopyToClipboard.ts` | **UI** | Clipboard copy with success state |

#### Key Hook: `useCompletion` (Main Overlay Logic)
```
User types message → attach files? → attach screenshot? →
  → build system prompt + history →
  → fetchTorviAIResponse() (streaming async generator) →
  → yield chunks → update message state →
  → stream complete → save to conversation
```

#### Key Hook: `useSystemAudio` (Audio Pipeline)
```
Shortcut triggered → start_system_audio_capture (Tauri) →
  → VAD detects speech → audio chunks collected →
  → WAV encoded → fetchSTT() (transcription) →
  → text received → auto-send to AI →
  → stream AI response → display in overlay →
  → quick actions available (follow-up, fact-check, recap)
```

### 5.8 Functional Layer (`lib/functions/`)

#### `ai-response.function.ts` — AI Response Streaming
```typescript
// Main function — async generator yielding text chunks
async function* fetchTorviAIResponse({
  messages,          // Chat history
  systemPrompt,      // System instructions
  selectedProvider,  // Provider config
  variables,         // API key, model, etc.
  images,            // Base64 images (screenshots)
  abortSignal,       // Cancellation support
}): AsyncGenerator<string>
```

**Flow**:
1. Check if should use Torvi API (license + enabled)
2. If Torvi API → invoke `chat_stream_response` Tauri command
3. If custom provider → build curl-based HTTP request
4. Poll for `chat_stream_chunk` events every 50ms
5. Yield text chunks as they arrive
6. Complete on `chat_stream_complete` event

#### `stt.function.ts` — Speech-to-Text
```typescript
async function fetchSTT({
  audioBlob,          // WAV audio data
  selectedProvider,   // STT provider config
  variables,          // API key, model
}): Promise<string>   // Transcribed text
```

**Flow**:
1. Check Torvi API availability
2. If Torvi API → `transcribe_audio` Tauri command
3. If custom → build FormData from curl template, replace variables
4. Parse response using `responseContentPath` (e.g., `results[0].alternatives[0].transcript`)

#### `common.function.ts` — Shared Utilities
```typescript
processUserMessageTemplate(curl, text, images)  // Replace {{TEXT}}, {{IMAGE}}
extractVariables(curl)              // Parse {{VARIABLE}} from curl strings
blobToBase64(blob)                  // File → base64 string
setByPath(obj, path, value)         // Deep property setter
getByPath(obj, path)                // Deep property getter
```

#### `torvi.api.ts` — Premium API Routing
```typescript
shouldUseTorviAPI(hasLicense, isEnabled)  // Check premium eligibility
// Routes requests to Torvi backend when eligible
```

### 5.9 Storage Layer (`lib/storage/`)

All use `localStorage` with safe wrappers:

| File | Stored Data | LocalStorage Key |
|------|-------------|-----------------|
| `helper.ts` | Safe localStorage wrapper | — |
| `ai-providers.ts` | Custom AI providers + selection | `curl_custom_ai_providers`, `curl_selected_ai_provider` |
| `auth.ts` | Auth token / user profile persistence | `torvi_auth_*` |
| `response-settings.storage.ts` | Response length + language | `response_settings` |
| `shortcuts.storage.ts` | Shortcut bindings | `shortcuts` |
| `usage.ts` | Session tracking (lifetime session counter) | `torvi_session_count` |
| `usage-stats.ts` | Local usage stats display data | `torvi_usage_stats` |

### 5.10 Database Layer (`lib/database/`)

Frontend wrappers calling SQLite via `tauri-plugin-sql`:

#### `chat-history.ts`
```typescript
createConversation(id, title)
getConversationById(id)          // Returns conversation + messages
getAllConversations()             // List all (ordered by updated_at DESC)
updateConversation(id, title)
deleteConversation(id)
deleteAllConversations()
addMessage(conversationId, message)
getMessagesByConversation(id)
migrateLocalStorageToSQLite()    // One-time migration helper
```

#### `system-prompts.ts`
```typescript
createSystemPrompt(name, prompt)
getAllSystemPrompts()
updateSystemPrompt(id, name, prompt)
deleteSystemPrompt(id)
```

#### `context-store.ts` (v0.5)
Frontend read layer for the `context_chunks` table written by Rust's `ContextDb`.
Used by the AI prompt builder for RAG retrieval (BM25-style keyword matching over the last 24h).

```typescript
getRecentContextChunks(limit: number): Promise<ContextChunk[]>
getContextByApp(appName: string): Promise<ContextChunk[]>
searchContext(query: string): Promise<ContextChunk[]>
clearOldChunks(olderThanSecs: number): Promise<void>
```

#### `screenshots.ts`
Stores screenshot metadata for the screenshot sync Appwrite module.

### 5.11 Types

```typescript
// Provider type (AI or STT)
interface TYPE_PROVIDER {
  id?: string;
  curl: string;              // Curl command template
  streaming?: boolean;       // Supports streaming
  responseContentPath?: string;  // JSONPath to response text
  isCustom?: boolean;        // User-defined vs built-in
}

// Chat types
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
}

interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// Message payload (for API calls)
interface Message {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

// Screenshot config
interface ScreenshotConfig {
  mode: "auto" | "manual";
  autoPrompt: string;
  enabled: boolean;
}

// Customization state
interface CustomizableState {
  appIcon: { isVisible: boolean };
  alwaysOnTop: { isEnabled: boolean };
  autostart: { isEnabled: boolean };
  cursor: { type: "invisible" | "default" | "auto" };
}

// Shortcut
interface Shortcut {
  id: string;
  label: string;
  key: string;
  description: string;
}
```

### 5.12 Config & Constants

#### `config/models.constants.ts`
AI model definitions used across the role-based model selector. Maps model IDs to display names, context windows, and capabilities.

#### `config/interview-roles.constants.ts`
Role → Model mapping (`ROLE_MODEL_MAP`). Each interview/meeting role maps to the best-fit model — see Role → Model Mapping table in Progress Update v0.3.

The 10 built-in AI providers (OpenAI, Claude, Grok, Gemini, Mistral, Cohere, Groq, Perplexity, OpenRouter, Ollama) and 9 STT providers are defined inline in the settings page and stored to localStorage via `ai-providers.ts`.

#### `config/shortcuts.ts`
7 default global shortcuts:
| Action | Default Key |
|--------|------------|
| Toggle Dashboard | Cmd/Ctrl+Shift+D |
| Toggle Window | Cmd/Ctrl+\\ |
| Focus Input | Cmd/Ctrl+Shift+I |
| Move Window | Cmd/Ctrl+Arrow Keys |
| System Audio | Cmd/Ctrl+Shift+M |
| Audio Recording | Cmd/Ctrl+Shift+A |
| Screenshot | Cmd/Ctrl+Shift+S |

#### `config/constants.ts`
All localStorage keys + default values.

#### `lib/chat-constants.ts`
```typescript
MESSAGE_ID_OFFSET = 1
CONVERSATION_SAVE_DEBOUNCE_MS = 500
CHUNK_POLL_INTERVAL_MS = 50
DOWNLOAD_SUCCESS_DISPLAY_MS = 1000
CONVERSATION_ID_RANDOM_LENGTH = 9
```

#### `lib/response-settings.constants.ts`
- **Lengths**: Short (2-4 sentences), Medium (1-2 paragraphs), Auto
- **Languages**: 15+ (English, Spanish, French, German, Chinese, Japanese, etc.)

---

## 6. Backend Architecture

### 6.1 Entry Points

**`main.rs`** — Minimal bootstrap:
```rust
fn main() {
    torvi_lib::run();
}
```

**`lib.rs`** — Full Tauri setup:
1. Initialize all plugins (SQL, HTTP, updater, keychain, etc.)
2. Create managed state (AudioState, CaptureState)
3. Setup main window with `setup_main_window()`
4. Register global shortcut handler
5. Register all invoke commands (25+ commands)

### 6.2 Core Modules

#### `api.rs` — Torvi API Integration
| Command | Purpose |
|---------|---------|
| `chat_stream_response()` | Stream AI completions via `/api/chat/stream` |
| `transcribe_audio()` | Transcribe audio via Torvi STT API |
| `fetch_models()` | Get available AI models |
| `check_license_status()` | Validate license |
| `get_activity()` | Get usage metrics |
| `create_system_prompt()` | Store system prompt via API |
| `get_stored_credentials()` | Read secure storage (license, instance ID) |
| `secure_storage_*` | CRUD for secure app data |

#### `usage.rs` — Server-Side Rate Limits (v0.4)
All Appwrite `user_usage` writes go through here using `APPWRITE_API_SECRET`. Users have read-only access and cannot forge counter increments.
| Command | Purpose |
|---------|---------|
| `initialize_user_usage()` | Idempotent doc creation with plan's starting limits |
| `decrement_usage()` | Atomic field decrement via REST PATCH |
| `push_local_usage()` | One-way ratchet: writes only if local shows more usage than remote |

#### `screen_reader.rs` — UIAutomation Screen Reader (v0.5)
Reads visible text from the foreground window via the Windows UIAutomation COM API.
- Returns `WindowContext { app_name, window_title, text_content, url, captured_at }`
- Windows-only; returns error on macOS/Linux
- Dispatched to a blocking thread pool so COM calls don't block the Tokio executor

| Command | Purpose |
|---------|---------|
| `read_active_window_context()` | One-shot foreground window text read |

#### `app_context.rs` — Context Watcher (v0.5)
Background Tokio task that polls `screen_reader` every 2 seconds.
- Applies `privacy_filter` → deduplicates by SHA-256 hash → emits `context-captured` event → writes to SQLite via `ContextDb`
- `AppContextState { running: Arc<AtomicBool> }` — managed Tauri state

| Command | Purpose |
|---------|---------|
| `start_context_watcher()` | Start background polling (no-op if already running) |
| `stop_context_watcher()` | Stop background polling |

#### `context_db.rs` — Direct SQLite Writer (v0.5)
Uses `sqlx` directly (bypasses `tauri-plugin-sql` IPC which silently dropped INSERTs).
WAL journal mode allows concurrent reads by the JS-side pool.
Writes to `context_chunks` table in the same `ai_assistant.db` file.

#### `privacy_filter.rs` — PII Redaction (v0.5)
Applied to every `WindowContext` before storage/emission:
- `should_capture()` — drops whole snapshot for sensitive apps (password managers, banking)
- `redact_sensitive()` — strips: credit card numbers, SSNs, API keys (`sk-`, `ghp_`, `AIza`, `AKIA`…), OTPs

#### `capture.rs` — Screenshot System
| Command | Purpose |
|---------|---------|
| `start_screen_capture()` | Capture all monitors → open overlay windows |
| `capture_to_base64()` | Convert captured image to base64 |
| `capture_selected_area()` | Crop selected region (x, y, w, h) |
| `close_overlay_window()` | Close overlay after selection |

Features:
- Multi-monitor support (iterates all screens)
- DPI/scale-factor aware cropping
- `CaptureState` holds captured frames in memory
- Each monitor gets its own overlay window

#### `shortcuts.rs` — Global Shortcuts
| Command | Purpose |
|---------|---------|
| `update_shortcuts()` | Update shortcut bindings from frontend config |
| `check_shortcuts_registered()` | Verify shortcuts initialized |
| `get_registered_shortcuts()` | Get current shortcut map |
| `validate_shortcut_key()` | Check key syntax validity |
| `set_license_status()` | Notify backend of license state |
| `set_app_icon_visibility()` | Show/hide system tray icon |
| `set_always_on_top()` | Toggle window always-on-top |
| `exit_app()` | Graceful shutdown |

Global handler routes shortcut events to frontend via `shortcut_triggered` event.

#### `window.rs` — Window Management & Gate Lifecycle
| Command | Purpose |
|---------|---------|
| `set_window_height()` | Dynamically adjust window height |
| `open_dashboard()` | Create/show dashboard window |
| `toggle_dashboard()` | Show/hide dashboard |
| `move_window()` | Move window (arrow key directions) |
| `unlock_app()` | Gate → show pill bar, hide gate (only callable from "gate" window) |
| `lock_app()` | Sign-out → hide pill bar, show gate (only from "dashboard"/"main") |
| `show_gate()` | Make gate visible for sign-in UI (only from "gate") |
| `create_gate_hidden()` | Create gate window hidden on startup |

### 6.3 Database & Migrations

**Migration 1**: `system-prompts.sql`
```sql
CREATE TABLE system_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_system_prompts_name ON system_prompts(name);
-- Trigger: auto-update updated_at on change
```

**Migration 2**: `chat-history.sql`
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  attached_files TEXT  -- JSON array of AttachedFile
);

-- 6 indexes for fast queries
-- 2 triggers for auto-updating conversation timestamps
```

### 6.4 Platform-Specific Audio (`speaker/`)

```
speaker/
├── mod.rs      → SpeakerInput trait, VadConfig, shared types
├── commands.rs → Tauri command handlers
├── windows.rs  → WASAPI implementation
├── macos.rs    → Core Audio + cidre tap
└── linux.rs    → PulseAudio simple API
```

#### Trait: `SpeakerInput`
```rust
trait SpeakerInput {
    fn new(device_name: Option<String>) -> Result<Self>;
    fn stream(&self) -> SpeakerStream;  // Stream<Item = Vec<f32>>
    fn sample_rate(&self) -> u32;
}
```

#### VadConfig
```rust
struct VadConfig {
    enabled: bool,
    hop_size: usize,
    sensitivity_rms: f32,
    peak_threshold: f32,
    silence_chunks: usize,
    min_speech_chunks: usize,
    pre_speech_chunks: usize,
    noise_gate_threshold: f32,
    max_recording_duration_secs: f32,
}
```

#### Audio Commands
| Command | Purpose |
|---------|---------|
| `start_system_audio_capture()` | Start streaming with optional VAD + device |
| `stop_system_audio_capture()` | Stop streaming |
| `manual_stop_continuous()` | Stop continuous mode |
| `check_system_audio_access()` | Check microphone permissions |
| `request_system_audio_access()` | Request permissions |
| `get_vad_config()` | Get VAD tuning params |
| `update_vad_config()` | Update VAD params |
| `get_capture_status()` | Check recording state |
| `get_audio_sample_rate()` | Get stream sample rate |

### 6.5 Tauri Plugins (registered in `lib.rs`)

```rust
.plugin(tauri_plugin_sql::Builder::new().build())
.plugin(tauri_plugin_http::init())
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
.plugin(tauri_plugin_keychain::init())
.plugin(tauri_plugin_shell::init())
.plugin(tauri_plugin_opener::init())
.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
.plugin(tauri_plugin_posthog::init(posthog_api_key, posthog_host))
.plugin(tauri_plugin_machine_uid::init())
// macOS only:
.plugin(tauri_plugin_macos_permissions::init())
.plugin(tauri_nspanel::init())
```

### 6.6 Complete IPC Commands

```rust
generate_handler![
    // Window
    set_window_height, open_dashboard, toggle_dashboard, move_window,
    // Screenshot
    capture_to_base64, start_screen_capture, capture_selected_area, close_overlay_window,
    // Shortcuts
    check_shortcuts_registered, get_registered_shortcuts, update_shortcuts,
    validate_shortcut_key, set_license_status, set_app_icon_visibility,
    set_always_on_top, exit_app,
    // License
    activate_license_api, deactivate_license_api, validate_license_api,
    mask_license_key_cmd, get_checkout_url,
    // Secure Storage
    secure_storage_get, secure_storage_set, secure_storage_delete,
    // API
    transcribe_audio, chat_stream_response, fetch_models,
    create_system_prompt, check_license_status, get_activity,
    // Usage (server-side rate limits via APPWRITE_API_SECRET)
    initialize_user_usage, decrement_usage, push_local_usage,
    // Audio
    start_system_audio_capture, stop_system_audio_capture, manual_stop_continuous,
    check_system_audio_access, request_system_audio_access,
    get_vad_config, update_vad_config, get_capture_status, get_audio_sample_rate,
]
```

### 6.7 Events (Backend → Frontend)

| Event | Emitted By | Payload |
|-------|-----------|---------|
| `chat_stream_chunk` | `api.rs` | `{ text: string }` — AI response chunk |
| `chat_stream_complete` | `api.rs` | `{}` — Streaming finished |
| `toggle-window-visibility` | `shortcuts.rs` | `{}` — Toggle overlay |
| `shortcut_triggered` | `shortcuts.rs` | `{ action: string }` — Shortcut action ID |
| Audio events | `speaker/commands.rs` | Audio samples, VAD state changes |

---

## 7. Data Flow Diagrams

### 7.1 AI Chat Flow
```
User types message
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│  useCompletion   │────►│ Attach files?    │
│  (or useChatComp)│     │ (up to 6)        │
└────────┬────────┘     └───────┬──────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐     ┌──────────────────┐
│ Attach screenshot│     │ Build messages   │
│ (auto or manual)│     │ array (history)  │
└────────┬────────┘     └───────┬──────────┘
         │                      │
         └──────────┬───────────┘
                    ▼
         ┌──────────────────┐
         │ shouldUseTorviAPI? │
         └────────┬─────────┘
            ┌─────┴─────┐
            ▼           ▼
     ┌──────────┐ ┌──────────────┐
     │Torvi API│ │Custom Provider│
     │(Tauri IPC)│ │(HTTP request)│
     └────┬─────┘ └──────┬───────┘
          │               │
          └───────┬───────┘
                  ▼
         ┌──────────────────┐
         │ Stream chunks    │
         │ (50ms polling)   │
         └────────┬─────────┘
                  ▼
         ┌──────────────────┐
         │ Render markdown  │
         │ + save to SQLite │
         │ (500ms debounce) │
         └──────────────────┘
```

### 7.2 System Audio Flow
```
User triggers shortcut (Cmd+Shift+M)
       │
       ▼
┌─────────────────────────┐
│ start_system_audio_capture │ (Tauri command)
│ Platform: WASAPI/CoreAudio/Pulse │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│ VAD monitors audio      │
│ (speech vs silence)     │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│ Speech detected →       │
│ Collect audio chunks    │
│ (ring buffer)           │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│ Silence detected →      │
│ Encode WAV              │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│ fetchSTT() →            │
│ Transcribe to text      │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│ Auto-send to AI →       │
│ Stream response         │
│ + display in overlay    │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│ Quick actions:          │
│ "What should I say?"    │
│ "Follow-up question"    │
│ "Fact check"            │
│ "Recap"                 │
└─────────────────────────┘
```

### 7.3 Screenshot Flow
```
┌────────────────────┐
│ Auto Mode          │     ┌────────────────────┐
│ (on message send)  │     │ Manual Mode         │
│ Screenshot auto-   │     │ (Cmd+Shift+S)       │
│ captured           │     │ Select region       │
└────────┬───────────┘     └─────────┬──────────┘
         │                           │
         │    ┌──────────────────┐   │
         └───►│ start_screen_    │◄──┘
              │ capture()        │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ Capture all      │
              │ monitors (xcap)  │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ Open overlay     │    (Manual only)
              │ windows per      │
              │ monitor          │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ User selects     │    (Manual only)
              │ region (canvas)  │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ capture_selected │
              │ _area() → crop   │
              │ → base64 encode  │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ Send to AI as    │
              │ image_url content│
              │ with screenshot  │
              │ system prompt    │
              └──────────────────┘
```

---

## 8. Database Schema

### Entity Relationship
```
┌────────────────────┐       ┌──────────────────────┐
│   conversations    │       │      messages         │
├────────────────────┤       ├──────────────────────┤
│ id TEXT PK         │──┐    │ id TEXT PK           │
│ title TEXT NOT NULL│  │    │ conversation_id TEXT  │──► FK
│ created_at INTEGER │  │    │ role TEXT CHECK(...)  │
│ updated_at INTEGER │  └───►│ content TEXT NOT NULL │
└────────────────────┘       │ timestamp INTEGER    │
                             │ attached_files TEXT   │ (JSON)
                             └──────────────────────┘

┌────────────────────┐
│  system_prompts    │
├────────────────────┤
│ id INTEGER PK AI   │
│ name TEXT NOT NULL  │
│ prompt TEXT NOT NULL│
│ created_at TEXT     │
│ updated_at TEXT     │
└────────────────────┘
```

### Indexes
```sql
-- Conversations
idx_conversations_updated_at (updated_at)

-- Messages
idx_messages_conversation_id (conversation_id)
idx_messages_timestamp (timestamp)
idx_messages_conversation_timestamp (conversation_id, timestamp)
idx_messages_role (role)
idx_messages_conversation_role (conversation_id, role, timestamp)

-- System Prompts
idx_system_prompts_name (name)
```

### Triggers
```sql
-- Auto-update conversation.updated_at on message INSERT
-- Auto-update conversation.updated_at on message UPDATE
-- Auto-update system_prompt.updated_at on UPDATE
```

---

## 9. AI Provider System

### Architecture
```
┌───────────────────────────────────────────────┐
│              Provider Registry                 │
│                                                │
│  Built-in Providers (ai-providers.constants)  │
│  ├── OpenAI    (streaming, chat completions)  │
│  ├── Claude    (streaming, messages API)      │
│  ├── Grok      (streaming, x.ai)             │
│  ├── Gemini    (streaming, OpenAI-compat)     │
│  ├── Mistral   (streaming)                    │
│  ├── Cohere    (streaming, v2 chat)           │
│  ├── Groq      (streaming, high-speed)        │
│  ├── Perplexity (streaming)                   │
│  ├── OpenRouter (streaming, multi-model)      │
│  └── Ollama    (streaming, local)             │
│                                                │
│  Custom Providers (user-defined via curl)      │
│  └── Any REST API accepting curl templates    │
│                                                │
│  Torvi Premium API (requires license)        │
│  └── Routes through Tauri backend             │
└───────────────────────────────────────────────┘
```

### Provider Definition Format
```typescript
{
  id: "openai",
  curl: `curl https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer {{API_KEY}}" \
    -H "Content-Type: application/json" \
    -d '{"model": "{{MODEL}}", "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": "{{TEXT}}"}], "stream": true}'`,
  responseContentPath: "choices[0].delta.content",
  streaming: true
}
```

### Variable System
Variables are extracted from curl templates using `{{VARIABLE}}` pattern:
- `{{API_KEY}}` — Provider API key (user-supplied)
- `{{MODEL}}` — Model name (user-selected)
- `{{SYSTEM_PROMPT}}` — System instructions (managed by app)
- `{{TEXT}}` — User message (replaced per-request)
- `{{IMAGE}}` — Base64 image data (for vision models)

---

## 10. Speech-to-Text Provider System

### Built-in Providers
| Provider | API Format | Response Path |
|----------|-----------|---------------|
| OpenAI Whisper | multipart/form-data | `text` |
| Groq Whisper | multipart/form-data | `text` |
| ElevenLabs | multipart/form-data | `text` |
| Google STT | JSON | `results[0].alternatives[0].transcript` |
| Deepgram | multipart | `results.channels[0].alternatives[0].transcript` |
| Azure STT | binary audio | `DisplayText` |
| Speechmatics | multipart | `results[0].alternatives[0].content` |
| Rev.ai | multipart | `monologues[0].elements[0].value` |
| IBM Watson | multipart | `results[0].alternatives[0].transcript` |

### Selection Priority
```
Has active license AND Torvi API enabled?
  → YES: Use Torvi built-in STT (transcribe_audio command)
  → NO:  Use selected custom/built-in STT provider
```

---

## 11. Feature Breakdown

### Feature Matrix

| Feature | Frontend | Backend | Storage |
|---------|----------|---------|---------|
| AI Chat | useCompletion, TextInput, Markdown | api.rs (streaming) | SQLite (messages) |
| Chat History | useHistory, useChatCompletion | db/ | SQLite (conversations) |
| System Audio | useSystemAudio, vad-react | speaker/ | WAV temp files |
| Screenshot | Overlay component | capture.rs | In-memory (CaptureState) |
| Custom Providers | useCustomProvider | — | localStorage |
| System Prompts | useSystemPrompts | db/ | SQLite |
| Global Shortcuts | useGlobalShortcuts | shortcuts.rs | localStorage |
| License/Usage | billing page, UsageTimer | usage.rs + Appwrite | Appwrite user_usage |
| Theming | ThemeContext | — | localStorage |
| Window Controls | useWindow, DragButton | window.rs | — |
| Auto-Update | updater component | tauri-plugin-updater | — |
| Analytics | analytics.ts | tauri-plugin-posthog | — |

### Use Case Workflows

**Meeting Assistant**:
1. Open overlay (transparent, always-on-top)
2. Start system audio capture
3. VAD auto-detects speech
4. Auto-transcribe → auto-send to AI
5. AI suggests responses in overlay
6. Invisible to other participants

**Interview Helper**:
1. Set system prompt (interview mode)
2. Start audio + screenshot capture
3. Questions transcribed in real-time
4. AI provides talking points
5. Content-protected from screen recording

**General AI Chat**:
1. Type message in overlay
2. Optionally attach files (up to 6) or screenshot
3. AI streams response with markdown
4. Save conversation automatically
5. Review history in dashboard

---

## 12. Security Model

| Concern | Implementation |
|---------|---------------|
| **API Keys** | Stored in localStorage (per-provider); Torvi keys in secure_storage.json |
| **License Keys** | Stored in app data directory (`secure_storage.json`), never in localStorage |
| **Instance ID** | UUID generated once via `uuid::Uuid::new_v4()`, stored securely |
| **Rate Limit Writes** | All writes to `user_usage` go through Rust (`usage.rs`) using `APPWRITE_API_SECRET`; users have read-only access and cannot forge increments |
| **Content Protection** | `contentProtected: true` — OS-level flag prevents window capture by screen recorders |
| **CSP** | Explicitly disabled (`"csp": null`) — security enforced via Tauri capability permissions instead |
| **XSS Prevention** | `rehype-sanitize` in Markdown renderer sanitizes all AI-generated HTML before rendering |
| **SQL Injection** | Prevented by `tauri-plugin-sql` using prepared statements; no raw SQL from frontend |
| **Input Validation** | Curl commands validated via `@bany/curl-to-json` parsing + required variable checks |
| **HTTPS Enforcement** | All 10 built-in AI provider curl templates use `https://` endpoints exclusively |
| **Cursor Stealth** | Configurable invisible cursor (`cursor: none` CSS) for screen-share safety |
| **Cascade Deletes** | `FOREIGN KEY ON DELETE CASCADE` ensures no orphaned messages in SQLite |

### Capabilities & Permission Scoping

Permissions are platform-scoped via JSON capability files:

**macOS** (`capabilities/default.json`):
```json
{
  "identifier": "default",
  "windows": ["main", "dashboard"],
  "platforms": ["macOS"],
  "permissions": [
    "core:default",
    "keychain:allow-get-item",
    "keychain:allow-save-item",
    "keychain:allow-remove-item",
    "global-shortcut:allow-*",
    "http:default",
    "macos-permissions:default"
  ]
}
```

**Windows/Linux** (`capabilities/cross-platform.json`):
```json
{
  "identifier": "cross-platform",
  "windows": ["main", "dashboard"],
  "platforms": ["windows", "linux"],
  "permissions": [
    "core:default",
    "keychain:default",
    "global-shortcut:allow-*",
    "sql:allow-execute",
    "http:default"
  ]
}
```

### Secure Storage

License keys and instance IDs stored in `{app_data_dir}/secure_storage.json`:
```rust
struct SecureStorage {
    license_key: Option<String>,
    instance_id: Option<String>,
    selected_torvi_model: Option<String>,
}
```
- **Read/Write**: Via `secure_storage_get()` / `secure_storage_save()` Tauri commands
- **Masking**: `mask_license_key_cmd()` shows only last 4 characters in UI
- **Machine binding**: License tied to `tauri-plugin-machine-uid` unique ID

### API Key Transmission

- Provider API keys passed via curl template variables (`{{API_KEY}}`) over HTTPS
- Each provider defines its own auth method (Bearer token, x-api-key header, Basic auth)
- Torvi premium: License key + instance ID sent via Rust `reqwest` to Torvi backend

---

## 13. Build & Deployment

### Build Pipeline

```
┌──────────────┐    ┌──────────────┐    ┌────────────────────┐
│  npm run dev │    │ npm run build│    │  npm run tauri build│
│  (Vite 1420) │    │ (tsc + vite) │    │ (Rust + bundle)    │
└──────────────┘    └──────────────┘    └────────────────────┘
     Dev only          Frontend            Production bundle
```

### NPM Scripts

```json
{
  "dev": "vite",                   // Vite dev server (port 1420)
  "build": "tsc && vite build",    // TypeScript compile + production bundle
  "preview": "vite preview",       // Preview built bundle
  "tauri": "tauri"                 // Tauri CLI passthrough
}
```

### Vite Configuration

```typescript
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 1420,              // Dev server port (Tauri-configured)
    strictPort: true,        // Fail if port unavailable
    hmr: {
      protocol: "ws",
      port: 1421,            // Hot Module Replacement port
    },
    watch: {
      ignored: ["**/src-tauri/**"],  // Don't watch Rust files
    },
  },
}));
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

### Rust Build Configuration

**Cargo.toml Features**:
- `tauri = { version = "2", features = ["macos-private-api"] }`
- `reqwest = { version = "0.12", features = ["json", "stream", "multipart"] }`
- `tokio = { version = "1.0", features = ["full"] }`
- `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`

**Build Script** (`build.rs`) loads `.env` variables at compile time:
```rust
fn main() {
    dotenv::dotenv().ok();
    // Bake into binary:
    // PAYMENT_ENDPOINT, API_ACCESS_KEY, APP_ENDPOINT, POSTHOG_API_KEY
    tauri_build::build()
}
```

### Bundle Configuration

```json
{
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png", "icons/128x128.png",
      "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"
    ],
    "resources": ["info.plist", "torvi.desktop"],
    "macOS": { "minimumSystemVersion": "10.13" }
  }
}
```

**Output Targets**: Windows (.msi + .exe), macOS (.dmg + .app), Linux (.deb + .rpm + .AppImage)

### Auto-Update System

```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://torvi.com/api/update"],
      "pubkey": "<minisign-public-key>",
      "windows": { "installMode": "passive" }
    }
  }
}
```

- Checks `torvi.com/api/update` on startup
- Compares `env!("CARGO_PKG_VERSION")` to latest
- Downloads artifact + verifies minisign signature
- Windows: Passive (silent) install
- macOS/Linux: User-triggered install

### Shadcn UI Configuration

```json
{
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/global.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  },
  "iconLibrary": "lucide"
}
```

---

## 14. Performance Optimizations

### Streaming Efficiency

| Optimization | Value | Location |
|-------------|-------|----------|
| **Chunk poll interval** | 50ms | `lib/chat-constants.ts` |
| **Save debounce** | 500ms | `lib/chat-constants.ts` |
| **Conversation ID length** | 9 random chars | `lib/chat-constants.ts` |
| **Download success display** | 1000ms | `lib/chat-constants.ts` |

The AI streaming async generator yields chunks in batches every 50ms — balancing UI responsiveness against CPU overhead. Conversation saves are debounced at 500ms to prevent excessive SQLite writes during streaming.

### React Rendering Optimizations

**useCallback** in `useCompletion`:
```typescript
const setInput = useCallback((value: string) => {
    setState((prev) => ({ ...prev, input: value }));
}, []);
```

**React.memo** on expensive Markdown components:
```typescript
const HighlightedPre = React.memo(({ children, language }) => {
    const resource = React.useMemo(
        () => createResource(shikiHighlight(children, language)),
        [children, language]
    );
    // ... render
});
```

**Suspense** for lazy code highlighting:
```typescript
<Suspense fallback={<pre>{children}</pre>}>
    <HighlightedPre language={language}>{code}</HighlightedPre>
</Suspense>
```
Shiki syntax highlighting loaded asynchronously — fallback renders unstyled code instantly, highlighted version replaces it once ready.

### AbortController for Cancellation

```typescript
const abortControllerRef = useRef<AbortController | null>(null);

const cancel = () => abortControllerRef.current?.abort();

const submit = async () => {
    abortControllerRef.current = new AbortController();
    yield* fetchAIResponse({ signal: abortControllerRef.current.signal });
};
```
Instant cancellation of in-flight AI requests — no wasted API tokens.

### Audio Performance

- **Ring buffer** (`ringbuf` crate): Lock-free zero-copy audio sample handoff between capture thread and processing thread
- **VAD filtering**: 9 tunable parameters prevent empty transcriptions and reduce API calls:
  ```rust
  VadConfig {
      hop_size: 1024,
      sensitivity_rms: 0.012,
      peak_threshold: 0.035,
      silence_chunks: 45,          // ~1.0s silence → stop
      min_speech_chunks: 7,        // ~0.16s min speech
      pre_speech_chunks: 12,       // ~0.27s pre-buffer
      noise_gate_threshold: 0.003,
      max_recording_duration_secs: 180,
  }
  ```
- **Native audio APIs** (no abstraction layer): WASAPI/CoreAudio/PulseAudio directly — no `cpal` streaming overhead for capture

### Database Performance

**6 indexes** on the messages table for fast queries:
```sql
idx_conversations_updated_at       -- Sort conversations by recency
idx_messages_conversation_id       -- Lookup messages by conversation
idx_messages_timestamp             -- Sort messages by time
idx_messages_conversation_timestamp -- Composite: conversation + time (most used)
idx_messages_role                  -- Filter by role
idx_messages_conversation_role     -- Composite: conversation + role + time
```

**2 triggers** auto-update `conversations.updated_at` on message INSERT/UPDATE — no application-level bookkeeping needed.

### Window & App Size

- **Dashboard lazy creation**: Window created on-demand (not at startup)
- **App size ~10MB**: Tauri binary (~8MB) + assets (~2MB) vs Electron ~270MB
- **Tauri IPC vs HTTP**: Local commands use native IPC bridge (~100x faster than localhost HTTP)

---

## 15. Extensibility Points

### Curl-Based Provider System

The foundation of Torvi's provider architecture — **any REST API can be added as a provider** without code changes:

```
┌─────────────────────────────────────────────────────────────┐
│                    Provider Flow                             │
│                                                              │
│  1. User pastes curl from API docs                          │
│  2. Replace values with {{VARIABLE}} placeholders           │
│  3. validateCurl() parses + checks syntax                   │
│  4. extractVariables() finds all {{...}} patterns           │
│  5. User fills in variable values (API key, model)          │
│  6. On request: replace variables → HTTP fetch → parse      │
│     response via responseContentPath (JSONPath)             │
└─────────────────────────────────────────────────────────────┘
```

### Supported Variable Placeholders

| Variable | Purpose | Used By |
|----------|---------|---------|
| `{{API_KEY}}` | Provider API key | AI + STT |
| `{{MODEL}}` | Model name | AI + STT |
| `{{SYSTEM_PROMPT}}` | System instructions | AI only |
| `{{TEXT}}` | User message | AI only |
| `{{IMAGE}}` | Base64 image data | AI (vision) |
| `{{AUDIO}}` | WAV audio file | STT only |
| `{{CUSTOM}}` | Any user-defined variable | Both |

### Adding a Custom AI Provider (No Code Changes)

```
1. Copy curl example from provider's API docs
2. Replace API key value with {{API_KEY}}
3. Replace model name with {{MODEL}}
4. Replace user message with {{TEXT}}
5. Set responseContentPath (e.g., "choices[0].delta.content")
6. Toggle streaming: true/false
7. Save in Settings → Custom Providers
```

### Curl Validation (`lib/curl-validator.ts`)

```typescript
export const validateCurl = (curl: string, requiredVariables: string[]) => {
    // 1. Must start with "curl"
    // 2. Parse with curl2Json() (syntax check)
    // 3. Check all required {{VARIABLE}} placeholders present
    // Returns: { isValid: boolean, message?: string }
};
```

### Custom Provider CRUD

Both AI and STT custom providers share the same pattern:
```typescript
addCustomProvider(provider)       // UUID generated, saved to localStorage
updateCustomProvider(id, updates) // Merge updates
removeCustomProvider(id)          // Delete by ID
getCustomProviders()              // Load all from localStorage
```

### All 10 Built-in AI Providers

| # | Provider | Endpoint | Auth | Response Path |
|---|----------|----------|------|---------------|
| 1 | **OpenAI** | `api.openai.com/v1/chat/completions` | Bearer | `choices[0].message.content` |
| 2 | **Claude** | `api.anthropic.com/v1/messages` | x-api-key | `content[0].text` |
| 3 | **Grok** | `api.x.ai/v1/chat/completions` | Bearer | `choices[0].message.content` |
| 4 | **Gemini** | `generativelanguage.googleapis.com/v1beta/openai/chat/completions` | Bearer | `choices[0].message.content` |
| 5 | **Mistral** | `api.mistral.ai/v1/chat/completions` | Bearer | `choices[0].message.content` |
| 6 | **Cohere** | `api.cohere.ai/v2/chat` | Bearer | `message.content[0].text` |
| 7 | **Groq** | `api.groq.com/openai/v1/chat/completions` | Bearer | `choices[0].message.content` |
| 8 | **Perplexity** | `api.perplexity.ai/chat/completions` | Bearer | `choices[0].message.content` |
| 9 | **OpenRouter** | `openrouter.ai/api/v1/chat/completions` | Bearer | `choices[0].message.content` |
| 10 | **Ollama** | `localhost:11434/v1/chat/completions` | Bearer | `choices[0].message.content` |

All support streaming (SSE), vision/image inputs via `{{IMAGE}}`, and the OpenAI-compatible chat completions format (except Claude and Cohere which have custom APIs).

### All 9 Built-in STT Providers

| # | Provider | Endpoint | Format | Response Path |
|---|----------|----------|--------|---------------|
| 1 | **OpenAI Whisper** | `api.openai.com/v1/audio/transcriptions` | multipart | `text` |
| 2 | **Groq Whisper** | `api.groq.com/openai/v1/audio/transcriptions` | multipart | `text` |
| 3 | **ElevenLabs** | `api.elevenlabs.io/v1/speech-to-text` | multipart | `text` |
| 4 | **Google STT** | `speech.googleapis.com/v1/speech:recognize` | JSON | `results[0].alternatives[0].transcript` |
| 5 | **Deepgram** | `api.deepgram.com/v1/listen` | binary | `results.channels[0].alternatives[0].transcript` |
| 6 | **Azure STT** | `{REGION}.stt.speech.microsoft.com/...` | binary | `DisplayText` |
| 7 | **Speechmatics** | `asr.api.speechmatics.com/v2/jobs` | multipart | `job.id` |
| 8 | **Rev.ai** | `api.rev.ai/speechtotext/v1/jobs` | multipart | `id` |
| 9 | **IBM Watson** | `api.us-south.speech-to-text.watson.cloud.ibm.com/v1/recognize` | binary | `results[0].alternatives[0].transcript` |

### Other Extension Points

- **System Prompts**: Add via dashboard UI, stored in SQLite, selected as active context
- **Shortcuts**: All 7 keybindings fully customizable with conflict detection
- **Themes**: CSS variable-based (OKLCH color space) — extend by adding new color tokens
- **Pages**: Add new React Router routes in `routes/index.tsx` with DashboardLayout
- **Tauri Commands**: Add new `#[tauri::command]` functions and register in `generate_handler![]`

---

## 16. How to Recreate This App

### Phase 1: Project Scaffolding

```bash
# Create Tauri + React + TypeScript project
npm create tauri-app@latest my-app -- --typescript --react
cd my-app

# Install core frontend dependencies
npm install react-router-dom@^7 react-markdown@^10 shiki@^3 recharts@^2
npm install rehype-katex rehype-raw rehype-sanitize remark-gfm remark-math
npm install @ricky0123/vad-react @bany/curl-to-json
npm install clsx cmdk moment class-variance-authority
npm install lucide-react react-error-boundary

# Install Tauri plugin frontends
npm install @tauri-apps/plugin-autostart @tauri-apps/plugin-global-shortcut
npm install @tauri-apps/plugin-http @tauri-apps/plugin-opener
npm install @tauri-apps/plugin-process @tauri-apps/plugin-sql
npm install @tauri-apps/plugin-updater

# Install Tailwind CSS 4
npm install tailwindcss@^4 @tailwindcss/vite

# Initialize Shadcn UI (New York style)
npx shadcn@latest init
# Select: New York style, neutral base, CSS variables
```

### Phase 2: Shadcn Components (18 total)

```bash
npx shadcn@latest add badge button card chart command dialog dropdown-menu
npx shadcn@latest add input label popover scroll-area select slider switch
npx shadcn@latest add tabs textarea
```

### Phase 3: Frontend Structure

```
src/
├── main.tsx                    # Dual render: overlay vs full app
├── global.css                  # OKLCH themes, cursor, scrollbar
├── routes/index.tsx            # 9 route definitions
│
├── pages/
│   ├── app/index.tsx           # Main overlay (AI chat)
│   ├── dashboard/index.tsx     # Stats + quick actions
│   ├── chats/index.tsx         # Conversation list
│   ├── chats/view/index.tsx    # Single conversation viewer
│   ├── settings/index.tsx      # Provider config
│   ├── audio/index.tsx         # Audio device selection
│   ├── screenshot/index.tsx    # Screenshot mode config
│   ├── responses/index.tsx     # Response length/language
│   ├── system-prompts/index.tsx# Prompt management
│   ├── shortcuts/index.tsx     # Keybinding editor
│   └── dev/index.tsx           # Developer tools
│
├── components/
│   ├── Sidebar.tsx             # Navigation
│   ├── Overlay.tsx             # Screenshot selection canvas
│   ├── CustomCursor.tsx        # Configurable cursor
│   ├── DragButton.tsx          # Draggable window handle
│   ├── Header/index.tsx        # Page header
│   ├── Markdown/index.tsx      # Rich renderer + Shiki + KaTeX
│   ├── TextInput/index.tsx     # Enhanced input + file support
│   ├── Selection/index.tsx     # Screenshot selection UI
│   ├── Empty/index.tsx         # Empty state display
│   └── ui/                     # 18 Shadcn primitives
│
├── contexts/
│   ├── app.context.tsx         # Global state (providers, license, settings)
│   └── theme.context.tsx       # Light/dark/system + transparency
│
├── hooks/                      # 15 custom hooks
│   ├── useCompletion.ts        # Overlay chat (streaming, files, screenshot)
│   ├── useChatCompletion.ts    # Dashboard chat (SQLite-backed, auto-save)
│   ├── useSystemAudio.ts       # System audio capture + VAD + transcription
│   ├── useGlobalShortcuts.ts   # 7 system-wide shortcuts
│   ├── useSettings.ts          # Provider variable management
│   ├── useCustomProvider.ts    # Custom AI provider CRUD
│   ├── useCustomSttProviders.ts# Custom STT provider CRUD
│   ├── useHistory.ts           # Conversation list + pagination
│   ├── useSystemPrompts.ts     # System prompt CRUD
│   ├── useShortcuts.ts         # Shortcut binding editor
│   ├── useWindow.ts            # Window size/position
│   ├── useTitles.ts            # Window title sync
│   ├── useVersion.ts           # App version
│   ├── useMenuItems.tsx        # Context menu builder
│   └── useCopyToClipboard.ts   # Clipboard operations
│
├── lib/
│   ├── functions/
│   │   ├── ai-response.function.ts  # Async generator streaming
│   │   ├── stt.function.ts          # STT transcription
│   │   ├── torvi.api.ts            # Premium API routing
│   │   └── common.function.ts       # Template processing
│   ├── database/
│   │   ├── chat-history.ts          # Conversation/message CRUD
│   │   └── system-prompts.ts        # System prompt CRUD
│   ├── storage/
│   │   ├── helper.ts                # Safe localStorage wrapper
│   │   ├── ai-providers.ts          # Custom AI provider persistence
│   │   ├── stt-providers.ts         # Custom STT provider persistence
│   │   ├── response-settings.storage.ts
│   │   └── shortcuts.storage.ts
│   ├── utils.ts, platform.ts, curl-validator.ts, analytics.ts
│   ├── chat-constants.ts, response-settings.constants.ts
│   └── version.ts, platform-instructions.ts
│
├── config/
│   ├── ai-providers.constants.ts    # 10 AI provider curl templates
│   ├── stt.constants.ts             # 9 STT provider definitions
│   ├── shortcuts.ts                 # 7 default keybindings
│   └── constants.ts                 # localStorage keys + defaults
│
├── types/                           # 8 type definition files
└── layouts/
    ├── DashboardLayout.tsx          # Sidebar + content
    ├── PageLayout.tsx               # Header + scroll area
    └── ErrorLayout.tsx              # Error boundary
```

### Phase 4: Rust Backend Structure

```
src-tauri/
├── Cargo.toml                 # Dependencies (see below)
├── tauri.conf.json            # Window, plugins, updater, bundle
├── build.rs                   # Load .env variables
├── capabilities/
│   ├── default.json           # macOS permissions
│   └── cross-platform.json    # Windows/Linux permissions
│
└── src/
    ├── main.rs                # Entry: torvi_lib::run()
    ├── lib.rs                 # Plugin init, state, 30+ command handlers
    ├── api.rs                 # AI streaming, STT, models, license check
    ├── usage.rs               # Server-side rate limits (APPWRITE_API_SECRET)
    ├── capture.rs             # Multi-monitor screenshot + overlay
    ├── window.rs              # Position, size, dashboard creation
    ├── shortcuts.rs           # Global shortcut management
    │
    ├── db/
    │   ├── main.rs            # SQL operations (conversations, messages)
    │   └── migrations/
    │       ├── chat-history.sql
    │       └── system-prompts.sql
    │
    └── speaker/
        ├── mod.rs             # SpeakerInput trait, VadConfig
        ├── commands.rs        # Tauri command handlers
        ├── windows.rs         # WASAPI implementation
        ├── macos.rs           # Core Audio (cidre)
        └── linux.rs           # PulseAudio
```

### Phase 5: Rust Dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tokio = { version = "1.0", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream", "multipart"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
cpal = "0.15.3"
hound = "3.5.1"
ringbuf = "0.4.8"
xcap = "0.0.12"
image = "0.25.6"
uuid = { version = "1.0", features = ["v4"] }
base64 = "0.22"
futures-util = "0.3"
anyhow = "1.0"
tracing = "0.1"
once_cell = "1.19.0"

# Tauri plugins
tauri-plugin-http = "2.5.2"
tauri-plugin-updater = "2.9.0"
tauri-plugin-global-shortcut = "2"
tauri-plugin-keychain = "2.0"
tauri-plugin-shell = "2.3.1"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-posthog = "0.2.4"
tauri-plugin-machine-uid = "0.1.2"
tauri-plugin-autostart = "2.5.0"

[target.'cfg(target_os = "macos")'.dependencies]
cidre = "0.11.3"
tauri-nspanel = { git = "https://github.com/ahkohd/tauri-nspanel", branch = "v2" }
tauri-plugin-macos-permissions = "2"

[target.'cfg(target_os = "windows")'.dependencies]
wasapi = "0.19.0"

[target.'cfg(target_os = "linux")'.dependencies]
libpulse-binding = "2.30.1"
libpulse-simple-binding = "2.29.0"

[build-dependencies]
tauri-build = "2"
dotenv = "0.15"
```

### Phase 6: Database Migrations

**Migration 1 — System Prompts** (`system-prompts.sql`):
```sql
CREATE TABLE system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_system_prompts_name ON system_prompts(name);

CREATE TRIGGER update_system_prompts_updated_at
AFTER UPDATE ON system_prompts
FOR EACH ROW BEGIN
    UPDATE system_prompts SET updated_at = datetime('now') WHERE id = OLD.id;
END;
```

**Migration 2 — Chat History** (`chat-history.sql`):
```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    attached_files TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- 6 indexes for fast queries
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_conversation_timestamp ON messages(conversation_id, timestamp ASC);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_conversation_role ON messages(conversation_id, role, timestamp ASC);

-- 2 triggers for auto-updating timestamps
CREATE TRIGGER update_conversation_timestamp_on_message_insert
AFTER INSERT ON messages FOR EACH ROW BEGIN
    UPDATE conversations SET updated_at = NEW.timestamp WHERE id = NEW.conversation_id;
END;

CREATE TRIGGER update_conversation_timestamp_on_message_update
AFTER UPDATE ON messages FOR EACH ROW BEGIN
    UPDATE conversations SET updated_at = NEW.timestamp WHERE id = NEW.conversation_id;
END;
```

### Phase 7: Key Implementation Order

1. **Window setup** — Transparent, borderless, always-on-top overlay in `tauri.conf.json`
2. **Routing** — React Router with DashboardLayout wrapper
3. **AppContext** — Provider state, settings, license state
4. **Provider system** — Curl template parsing + variable extraction
5. **AI streaming** — Async generator + 50ms chunk polling
6. **Chat persistence** — SQLite via tauri-plugin-sql
7. **Global shortcuts** — tauri-plugin-global-shortcut with Rust handler
8. **Audio capture** — Platform-specific speaker module + VAD
9. **Screenshot** — xcap capture + overlay selection + DPI-aware cropping
10. **License** — Secure storage + machine UID binding
11. **Auto-update** — tauri-plugin-updater with minisign verification
12. **Analytics** — PostHog integration

---

> **End of Architecture Document**
> Generated from complete codebase analysis of torvi-master v0.1.8
| **Window Protection** | `contentProtected: true` in Tauri config |
| **Screen Share Safety** | Transparent overlay invisible to screen shares |
| **Cursor Stealth** | Configurable invisible/default/auto cursor |
| **HTTPS Only** | All external API calls over HTTPS |
| **Input Validation** | Curl commands validated before use |
| **CORS** | Tauri HTTP plugin handles cross-origin requests |
| **Auto-Update** | Ed25519 signature verification for updates |

---

## 13. Build & Deployment

### Build Commands
```bash
# Development
npm run dev        # Vite dev server (port 1420)
npm run tauri dev  # Full Tauri development mode

# Production
npm run build      # Frontend: TypeScript + Vite build
npm run tauri build # Full app build (frontend + Rust)
```

### Build Output
| Platform | Format |
|----------|--------|
| Windows | .msi, .exe (NSIS) |
| macOS | .dmg, .app |
| Linux | .deb, .rpm, .AppImage |

### Auto-Update Configuration
```json
{
  "updater": {
    "active": true,
    "endpoints": ["https://torvi.com/api/update"],
    "pubkey": "ed25519 public key",
    "windows": { "installMode": "passive" }
  }
}
```

### Tauri Window Configuration
```json
{
  "windows": [{
    "label": "main",
    "title": "Torvi",
    "width": 400,
    "height": 600,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "contentProtected": true,
    "visible": false,
    "skipTaskbar": true
  }]
}
```

---

## 14. Performance Optimizations

| Optimization | Implementation |
|-------------|---------------|
| **Debounced Saves** | Conversations saved with 500ms debounce |
| **Streaming AI** | Responses streamed in real-time (50ms chunk polling) |
| **VAD Filtering** | Only processes audio when speech detected |
| **SQLite Indexes** | 6 composite indexes on chat tables |
| **Auto-Triggers** | Database triggers for timestamp updates |
| **Lock-Free Buffers** | Ring buffers for audio (ringbuf crate) |
| **Abort Controllers** | Cancel in-flight AI requests instantly |
| **Native Audio APIs** | WASAPI/CoreAudio/PulseAudio (no audio abstraction overhead) |
| **Tauri IPC** | Native bridge (faster than HTTP/WebSocket) |
| **Lazy Window Creation** | Dashboard window created only when needed |
| **Small Bundle** | ~10MB total (Tauri vs Electron) |

---

## 15. Extensibility Points

| Extension | How To |
|-----------|--------|
| **Add AI Provider** | Define curl template + responseContentPath in ai-providers.constants.ts |
| **Add STT Provider** | Define curl + response path in stt.constants.ts |
| **Custom Provider (User)** | Settings → paste curl → auto-variable extraction |
| **New Page/Route** | Add to routes/index.tsx, create page in pages/, use PageLayout |
| **New Hook** | Create in hooks/, export from hooks/index.ts |
| **New Tauri Command** | Define in Rust module, add to generate_handler! in lib.rs |
| **New Database Table** | Add SQL migration in src-tauri/src/db/migrations/ |
| **System Prompt Templates** | Add to default prompts array or create via UI |
| **Custom Shortcuts** | Add action ID to shortcuts config, handle in useGlobalShortcuts |
| **Theming** | Modify CSS variables in global.css (OkLCh color model) |

---

## 16. How to Recreate This App

### Phase 1: Foundation
1. **Initialize Tauri + React project**
   - `npm create tauri-app` with React + TypeScript template
   - Configure Vite (port 1420), TypeScript paths (`@/` alias)
   - Install Tailwind CSS + Shadcn UI

2. **Setup Rust backend**
   - Add Tauri plugins: sql, http, global-shortcut, updater, keychain, shell, opener, autostart
   - Create module structure: api.rs, window.rs, shortcuts.rs, capture.rs, usage.rs, screen_reader.rs, app_context.rs
   - Setup SQLite with migration system

3. **Setup frontend structure**
   - Create directories: pages, components, hooks, contexts, lib, config, types, layouts, routes
   - Create type definitions first (provider, message, conversation, settings)
   - Build routing (React Router 7)

### Phase 2: Core Features
4. **State Management**
   - Build AppContext (providers, settings, license state)
   - Build ThemeContext (dark/light/system, transparency)
   - Create localStorage storage layer with safe wrappers

5. **AI Chat Engine**
   - Implement provider configuration system (curl templates + variable extraction)
   - Build `fetchAIResponse()` async generator with streaming
   - Create `useCompletion` hook for overlay chat
   - Build `useChatCompletion` hook for persistent chats
   - Implement Markdown renderer with syntax highlighting

6. **Database Layer**
   - Write SQLite migrations (conversations, messages, system_prompts)
   - Create frontend CRUD wrappers
   - Implement auto-save with debouncing

### Phase 3: Advanced Features
7. **Screenshot System**
   - Implement multi-monitor capture (xcap crate)
   - Build overlay window with canvas selection
   - DPI-aware cropping
   - Auto/manual screenshot modes

8. **Audio System**
   - Implement platform-specific audio capture (WASAPI/CoreAudio/PulseAudio)
   - Build VAD configuration
   - Create STT provider system with curl templates
   - Wire `useSystemAudio` hook: capture → VAD → transcribe → AI response

9. **Global Shortcuts**
   - Register system-wide shortcuts (tauri-plugin-global-shortcut)
   - Build shortcut management UI with conflict detection
   - Wire to features: toggle, screenshot, audio, movement

### Phase 4: Polish & Distribution
10. **Window Management**
    - Transparent, always-on-top, content-protected window
    - Dynamic height adjustment
    - Dashboard window (separate webview)
    - Drag-to-move support

11. **License System**
    - Secure storage for license keys (app data directory)
    - Activation/deactivation/validation flow
    - Premium API routing

12. **Build & Deploy**
    - Configure Tauri updater with Ed25519 signing
    - Setup CI/CD for multi-platform builds
    - Configure auto-update endpoint
    - Analytics integration (PostHog)

---

*This architecture document was generated from a complete analysis of the torvi-master codebase. Use it as the blueprint for building your own AI assistant desktop application.*

---

## 17. Desktop Runtime Architecture

### 17.1 Tauri Process Model

Torvi runs as a **multi-process** desktop application powered by Tauri 2.x:

```
┌──────────────────────────────────────────────────────────────┐
│                      Operating System                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Rust Core Process (main)                  │  │
│  │                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ Tauri Runtime │  │ Plugin Host  │  │  Managed   │  │  │
│  │  │  (lib.rs)    │  │  (12 plugins)│  │   State    │  │  │
│  │  └──────┬───────┘  └──────────────┘  │ AudioState │  │  │
│  │         │                             │ CaptureState│  │  │
│  │         │ IPC Bridge (invoke/emit)    │ Shortcuts  │  │  │
│  │         │                             │ License    │  │  │
│  │  ┌──────┴────────────────────────┐   │ Visibility │  │  │
│  │  │      WebView Process(es)      │   └────────────┘  │  │
│  │  │                               │                    │  │
│  │  │  ┌─────────┐  ┌───────────┐  │                    │  │
│  │  │  │  Main   │  │ Dashboard │  │  ┌────────────┐   │  │
│  │  │  │ Window  │  │  Window   │  │  │  Overlay   │   │  │
│  │  │  │ (600×54)│  │(1200×800) │  │  │ Window(s)  │   │  │
│  │  │  │ overlay │  │ full app  │  │  │ per-monitor│   │  │
│  │  │  └─────────┘  └───────────┘  │  └────────────┘   │  │
│  │  └───────────────────────────────┘                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │     SQLite      │  │   Secure     │  │  localStorage  │  │
│  │   torvi.db     │  │   Storage    │  │  (WebView)     │  │
│  │  (3 tables)     │  │  .json file  │  │  (~15 keys)    │  │
│  └─────────────────┘  └──────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 17.2 Startup Sequence

```
main.rs → torvi_lib::run()
    │
    ├─► Initialize 12+ Tauri plugins
    │     ├── SQL (preload torvi.db, run migrations)
    │     ├── HTTP, Updater, Keychain, Shell, Opener
    │     ├── PostHog (analytics, session recording disabled)
    │     ├── Machine UID
    │     ├── Global Shortcut (custom handler)
    │     ├── Autostart (macOS LaunchAgent)
    │     └── macOS-only: NSPanel, macOS-permissions
    │
    ├─► Register 5 managed states
    │     ├── AudioState (stream task, VAD config, capture flag)
    │     ├── CaptureState (captured monitors HashMap, overlay flag)
    │     ├── WindowVisibility (is_hidden: Mutex<bool>)
    │     ├── RegisteredShortcuts (action_id → key HashMap)
    │     ├── LicenseState (AtomicBool)
    │     └── MoveWindowState (direction → task HashMap)
    │
    ├─► setup() closure
    │     ├── setup_main_window() → position top-center, 54px offset
    │     ├── macOS: Convert to NSPanel (non-activating, float level 4)
    │     ├── Create dashboard window (lazy, /chats URL)
    │     └── Initialize shortcut handler routing
    │
    └─► Register 39 IPC command handlers via generate_handler![]
```

### 17.3 Window Lifecycle

**Main Window** (always exists):
- Created by Tauri from `tauri.conf.json` at launch
- Size: 600×54 logical pixels (compact search-bar form factor)
- Properties: `transparent`, `no decorations`, `skip taskbar`, `content protected`, `accept first mouse`, `no shadow`
- macOS: Converted to NSPanel → `NSFloatWindowLevel` (level 4), `NonActivatingPanel`, `CanJoinAllSpaces + FullScreenAuxiliary`
- Positioned top-center of primary monitor with 54px vertical offset
- Height dynamically adjusted via `set_window_height()` (width stays 600)

**Dashboard Window** (lazy-created):
- Created on-demand by `open_dashboard()` or `toggle_dashboard()`
- URL: `/chats` (React Router handles routing within)
- macOS: 1200×800, overlay title bar, hidden title, traffic lights at (14, 18)
- Windows/Linux: 800×600, standard decorations
- Properties: `content protected`, `centered`, `min size 800×600`
- Toggle cycle: visible → hide | hidden → show + focus | doesn't exist → create

**Overlay Windows** (ephemeral, per-monitor):
- Created by `start_screen_capture()` during screenshot flow
- One per monitor: `capture-overlay-{index}`
- Properties: `transparent`, `always on top`, `no decorations`, `skip taskbar`, `not resizable`, `not closable`, `accept first mouse`
- Size: Full monitor dimensions (converted from physical via scale_factor)
- Destroyed by `close_overlay_window()` after selection or cancel

### 17.4 IPC Bridge Architecture

```
Frontend (React)                    Backend (Rust)
─────────────────                   ──────────────
invoke("command", args)  ────►  #[tauri::command] fn command()
                                        │
                                        ▼
                                   Return Result<T>
                                        │
Promise<T> resolves     ◄────   serialized via serde

emit("event", payload)   ◄────   app.emit("event", payload)
        │
        ▼
listen("event", callback)        // Frontend registers handlers
```

**39 registered IPC commands** across 6 modules:
| Module | Commands | Count |
|--------|----------|-------|
| `window` | set_window_height, open_dashboard, toggle_dashboard, move_window | 4 |
| `capture` | capture_to_base64, start_screen_capture, capture_selected_area, close_overlay_window | 4 |
| `shortcuts` | check/get/update/validate shortcuts, set_license_status, set_app_icon_visibility, set_always_on_top, exit_app | 8 |
| `activate` | activate/deactivate/validate license, mask_key, checkout_url, secure_storage CRUD | 8 |
| `api` | chat_stream_response, transcribe_audio, fetch_models, create_system_prompt, check_license_status, get_activity | 6 |
| `speaker` | start/stop capture, manual_stop, check/request access, get/update VAD, get_capture_status, get_sample_rate | 9 |

### 17.5 State Management Architecture

```
┌───────────────────────────────────────────────────────────┐
│                     Frontend State                         │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              AppContext (React Context)               │  │
│  │  ├── AI Providers (built-in + custom)               │  │
│  │  ├── STT Providers (built-in + custom)              │  │
│  │  ├── Selected provider + variables                  │  │
│  │  ├── System prompt, screenshot config               │  │
│  │  ├── Customizable state (icon, always-on-top, etc.) │  │
│  │  ├── License state (active, Torvi API enabled)     │  │
│  │  └── Audio device selection                         │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │ write-through                    │
│                         ▼                                  │
│  ┌───────────────────────────────────────────┐            │
│  │          localStorage (~15 keys)           │            │
│  │  ├── curl_custom_ai_providers             │            │
│  │  ├── curl_selected_ai_provider            │            │
│  │  ├── curl_custom_speech_providers         │            │
│  │  ├── curl_selected_stt_provider           │            │
│  │  ├── response_settings                    │            │
│  │  ├── shortcuts                            │            │
│  │  ├── theme / transparency                 │            │
│  │  ├── vad_config                           │            │
│  │  └── system_audio_quick_actions           │            │
│  └───────────────────────────────────────────┘            │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              ThemeContext (React Context)             │  │
│  │  ├── theme: "light" | "dark" | "system"             │  │
│  │  └── transparency: 0-100 (glass morphism)           │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│                     Backend State                          │
│                                                            │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │    Managed States    │  │    Persistent Storage     │  │
│  │  (in-memory, Mutex)  │  │                           │  │
│  │                      │  │  SQLite: torvi.db        │  │
│  │  AudioState          │  │  ├── conversations        │  │
│  │  ├── stream_task     │  │  ├── messages             │  │
│  │  ├── vad_config      │  │  └── system_prompts       │  │
│  │  └── is_capturing    │  │                           │  │
│  │                      │  │  JSON: secure_storage.json│  │
│  │  CaptureState        │  │  ├── license_key          │  │
│  │  ├── monitors map    │  │  ├── instance_id          │  │
│  │  └── overlay_active  │  │  └── selected_model       │  │
│  │                      │  │                           │  │
│  │  RegisteredShortcuts │  └──────────────────────────┘  │
│  │  LicenseState        │                                 │
│  │  WindowVisibility    │                                 │
│  │  MoveWindowState     │                                 │
│  └──────────────────────┘                                 │
└───────────────────────────────────────────────────────────┘
```

**Cross-window sync**: `StorageEvent` listener on localStorage — when one window writes, others call `loadData()` to refresh.

---

## 18. AI Integration Layer

### 18.1 End-to-End AI Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPLETE AI REQUEST LIFECYCLE                     │
│                                                                     │
│  ┌──────────┐    ┌───────────┐    ┌──────────────┐                │
│  │ User     │───►│ Collect   │───►│ Build        │                │
│  │ types    │    │ context   │    │ messages[]   │                │
│  │ message  │    │           │    │              │                │
│  └──────────┘    │ • history │    │ system_prompt│                │
│                  │ • files   │    │ + history    │                │
│                  │ • screenshot│   │ + user msg  │                │
│                  │ • system  │    │ + images     │                │
│                  │   prompt  │    └──────┬───────┘                │
│                  └───────────┘           │                         │
│                                         ▼                         │
│                          ┌──────────────────────────┐             │
│                          │  shouldUseTorviAPI()?    │             │
│                          │  license + enabled check  │             │
│                          └──────────┬───────────────┘             │
│                              ┌──────┴──────┐                      │
│                              ▼             ▼                      │
│                    ┌──────────────┐ ┌─────────────────┐           │
│                    │ TORVI API   │ │ CUSTOM PROVIDER  │           │
│                    │ (Premium)    │ │ (Curl-based)     │           │
│                    │              │ │                   │           │
│                    │ invoke()     │ │ Build HTTP req    │           │
│                    │ → Rust       │ │ from curl template│           │
│                    │ → reqwest    │ │ Replace variables │           │
│                    │ → SSE parse  │ │ {{API_KEY}}       │           │
│                    │ → emit       │ │ {{MODEL}}         │           │
│                    │   chunks     │ │ {{TEXT}}           │           │
│                    └──────┬───────┘ │ {{IMAGE}}         │           │
│                           │         │ {{SYSTEM_PROMPT}} │           │
│                           │         └────────┬──────────┘           │
│                           └──────────┬───────┘                      │
│                                      ▼                              │
│                          ┌──────────────────────┐                   │
│                          │ STREAMING PROTOCOL    │                   │
│                          │ SSE: data: {json}     │                   │
│                          │ Terminator: [DONE]    │                   │
│                          │ Poll: 50ms interval   │                   │
│                          └──────────┬───────────┘                   │
│                                     ▼                               │
│                          ┌──────────────────────┐                   │
│                          │ FRONTEND RENDERING    │                   │
│                          │ • Chunk → setState    │                   │
│                          │ • Markdown render     │                   │
│                          │ • Code: Shiki syntax  │                   │
│                          │ • Math: KaTeX         │                   │
│                          │ • Sanitize: rehype    │                   │
│                          └──────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 18.2 Provider Abstraction

All 10 built-in AI providers + unlimited custom providers share one unified interface — the **curl template system**:

```
┌────────────────────────────────────────────────────────────────┐
│                    PROVIDER ABSTRACTION                        │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │              TYPE_PROVIDER Interface                  │    │
│   │                                                      │    │
│   │   id: string            // Unique provider name      │    │
│   │   curl: string          // Curl command template     │    │
│   │   streaming: boolean    // SSE streaming support     │    │
│   │   responseContentPath:  // JSONPath to response text │    │
│   │     string              //   e.g. choices[0].delta.. │    │
│   │   isCustom?: boolean    // User-defined flag         │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                │
│   Variable Extraction: regex {{([A-Z_]+)}} on curl string     │
│   Template Processing:                                         │
│     1. Parse curl → extract URL, headers, body                │
│     2. Replace {{VAR}} with user-provided values              │
│     3. Special: {{TEXT}} → user message content               │
│     4. Special: {{IMAGE}} → base64 image data inline          │
│     5. Special: {{SYSTEM_PROMPT}} → system instructions       │
│     6. HTTP fetch with constructed request                     │
│     7. Parse response via responseContentPath (deep getter)   │
│                                                                │
│   Provider Selection Flow:                                     │
│     Built-in providers (AI_PROVIDERS[])                        │
│       + Custom providers (localStorage)                        │
│       = allAiProviders[] (merged in AppContext)                │
│       → User selects one → variables filled in settings       │
│       → On request: resolve template → HTTP call              │
└────────────────────────────────────────────────────────────────┘
```

### 18.3 Torvi Premium API Streaming (Rust Backend)

When user has an active license and Torvi API is enabled, requests route through the Rust backend:

```
Frontend invoke("chat_stream_response")
    │
    ▼
Rust api.rs:
    │
    ├── 1. get_stored_credentials()
    │      → Read license_key, instance_id from secure_storage.json
    │
    ├── 2. fetch_api_response_config()
    │      → GET {APP_ENDPOINT}/api/response
    │      → Returns: url, user_token, model, body (extra params), error rules
    │
    ├── 3. Build OpenAI-compatible request
    │      → messages[]: {system, history[], user + images}
    │      → Merge extra body fields from API config
    │      → POST to config.url with Bearer user_token, stream: true
    │
    ├── 4. SSE Parsing Loop
    │      → Read bytes_stream() chunks
    │      → Buffer incomplete lines
    │      → Parse "data: {json}" → extract choices[0].delta.content
    │      → Emit "chat_stream_chunk" event per delta
    │      → Stop on "data: [DONE]"
    │      → Collect usage metrics
    │
    ├── 5. Emit "chat_stream_complete" with full response
    │
    └── 6. Background: report user_activity() + handle errors
```

### 18.4 Message Construction

```typescript
// Messages array sent to AI provider
[
  { role: "system",    content: systemPrompt },              // System instructions
  { role: "user",      content: "earlier question" },        // History entry
  { role: "assistant", content: "earlier answer" },          // History entry
  { role: "user",      content: [                            // Current message
      { type: "text",      text: "Describe this image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
    ]
  }
]
```

### 18.5 Transcription (STT) Integration

```
Audio Blob (WAV)
    │
    ├── shouldUseTorviAPI()?
    │     ├── YES: invoke("transcribe_audio")
    │     │         → Rust: multipart POST with primary + fallback URL
    │     │         → Parse: tries JSON fields text/transcription/result
    │     │
    │     └── NO: Build HTTP from STT curl template
    │              → Replace {{API_KEY}}, {{MODEL}}, {{AUDIO}}
    │              → Parse response via responseContentPath
    │
    └── Returns: plain text transcription string
```

### 18.6 Error Handling & Cancellation

- **AbortController**: Each request gets a unique `requestId`; stale responses silently dropped
- **Cancel**: `abortControllerRef.current.abort()` — instant cancellation, no wasted API tokens
- **API errors**: Rust backend uses configurable `map_api_error_message()` with rules from API config
- **Error reporting**: Background `report_api_error()` to `{APP_ENDPOINT}/api/error`
- **Fallback transcription**: Primary STT fails → automatic retry with `fallback_url` + `fallback_token`

---

## 19. Audio Capture Pipeline

### 19.1 Complete Hardware-to-AI Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                   AUDIO CAPTURE PIPELINE                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 1: Hardware Audio Capture (Platform-Specific)     │   │
│  │                                                          │   │
│  │  Windows: WASAPI (loopback capture from output device)   │   │
│  │  macOS:   Core Audio via cidre (screen audio tap)        │   │
│  │  Linux:   PulseAudio simple API (monitor source)         │   │
│  │                                                          │   │
│  │  Common trait: SpeakerInput                              │   │
│  │    new_with_device(device_id) → Result<Self>             │   │
│  │    stream() → SpeakerStream (futures Stream<Item=f32>)   │   │
│  │    sample_rate: 8000-96000 Hz                            │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                            │ f32 audio samples                   │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 2: VAD Processing (commands.rs)                   │   │
│  │                                                          │   │
│  │  Process in hop_size chunks (default: 1024 samples):     │   │
│  │                                                          │   │
│  │  ┌─────────────┐   ┌──────────────┐   ┌──────────┐     │   │
│  │  │ Noise Gate  │──►│ RMS + Peak   │──►│ Speech   │     │   │
│  │  │ Soft-knee   │   │ Calculation  │   │ Decision │     │   │
│  │  │ compression │   │              │   │          │     │   │
│  │  │ below 0.003 │   │ rms > 0.012  │   │ Speech:  │     │   │
│  │  └─────────────┘   │ peak > 0.035 │   │  collect │     │   │
│  │                     └──────────────┘   │ Silence: │     │   │
│  │                                        │  count++ │     │   │
│  │  Pre-speech buffer: 12 chunks (~0.27s pre-roll)   │     │   │
│  │  Silence threshold: 45 chunks (~1.0s) → end       │     │   │
│  │  Min speech: 7 chunks (~0.16s) → else discard     │     │   │
│  │  Max duration: 30s safety cap → force emit        │     │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                            │ speech segment (Vec<f32>)           │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 3: Audio Encoding                                 │   │
│  │                                                          │   │
│  │  1. Trim trailing silence (keep ~0.15s)                  │   │
│  │  2. Normalize audio (target RMS 0.1)                     │   │
│  │  3. Clamp to [-1.0, 1.0] → convert to i16               │   │
│  │  4. Encode: 1ch, 16-bit, Int → WAV via hound            │   │
│  │  5. Base64 encode → emit "speech-detected" event         │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                            │ base64 WAV string                   │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 4: Speech-to-Text (Frontend useSystemAudio)       │   │
│  │                                                          │   │
│  │  Listen for "speech-detected" event                      │   │
│  │  → Decode base64 → Blob                                 │   │
│  │  → fetchSTT() with 30s timeout (Promise.race)           │   │
│  │  → Returns: plain text transcription                     │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                            │ transcribed text                    │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 5: AI Processing (processWithAI)                  │   │
│  │                                                          │   │
│  │  → Auto-send transcription to AI provider                │   │
│  │  → Stream response via fetchAIResponse()                 │   │
│  │  → Render in overlay as markdown                         │   │
│  │  → Debounced save to SQLite conversation                 │   │
│  │                                                          │   │
│  │  Quick Actions (configurable):                           │   │
│  │  ├── "What should I say?"                                │   │
│  │  ├── "Follow-up question"                                │   │
│  │  ├── "Fact check"                                        │   │
│  │  └── "Recap"                                             │   │
│  │  → User clicks → text sent directly to AI as user input  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 19.2 VAD Algorithm Detail

```
For each chunk of hop_size (1024) samples:

1. NOISE GATE (soft-knee compression):
   if abs(sample) < noise_gate_threshold (0.003):
       sample = sample * (abs(sample) / threshold)^(1/3)

2. COMPUTE METRICS:
   rms  = sqrt(mean(samples²))
   peak = max(abs(samples))

3. SPEECH DECISION:
   is_speech = (rms > sensitivity_rms) OR (peak > peak_threshold)
              = (rms > 0.012) OR (peak > 0.035)

4. STATE MACHINE:
   ┌──────────────┐   speech detected     ┌──────────────┐
   │   SILENCE    │──────────────────────►│   SPEECH     │
   │              │                        │              │
   │ (idle state) │   silence > 45 chunks  │ collecting   │
   │              │◄──────────────────────│ samples      │
   └──────────────┘   if chunks >= 7:     └──────────────┘
                       → emit wav                │
                       if chunks < 7:            │ 30s cap
                       → discard                 ▼
                                          Force emit WAV

5. PRE-SPEECH BUFFER:
   Last 12 chunks always kept in circular buffer
   → Prepended to speech when speech starts
   → Ensures no word beginnings are clipped
```

### 19.3 Continuous Mode (Non-VAD)

```
User triggers continuous recording
    │
    ├── Accumulate ALL audio samples
    ├── Emit "recording-progress" every second
    ├── Stop conditions:
    │     ├── User calls manualStopAndSend() → process + send
    │     ├── User calls ignoreContinuousRecording() → discard
    │     ├── Max duration (180s) reached → auto-process
    │     └── Max samples reached → auto-process
    │
    └── On stop: noise gate → normalize → WAV → STT → AI
```

### 19.4 Platform Implementations

| Platform | Crate | Capture Method | Special Notes |
|----------|-------|----------------|---------------|
| **Windows** | `wasapi` | WASAPI loopback | Captures system output (speakers) |
| **macOS** | `cidre` | Core Audio screen tap | Requires macOS permissions plugin |
| **Linux** | `libpulse-binding` + `libpulse-simple-binding` | PulseAudio monitor | Captures default sink monitor |

All three implement the `SpeakerInput` trait, producing `SpeakerStream` that yields `f32` audio samples. The `ringbuf` crate provides a lock-free ring buffer for zero-copy handoff between the audio capture thread and the processing thread.

---

## 20. Overlay Window System

### 20.1 Dual Render Architecture

```
main.tsx — Entry Point Decision Tree
    │
    ├── getCurrentWindow().label
    │
    ├── label.startsWith("capture-overlay-") ?
    │     │
    │     YES → Minimal render:
    │     │     ReactDOM.render(<Overlay monitorIndex={N} />)
    │     │     • No React Context providers
    │     │     • No React Router
    │     │     • Just a fullscreen canvas component
    │     │
    │     NO → Full app render:
    │           ReactDOM.render(
    │             <ThemeProvider>
    │               <AppProvider>
    │                 <AppRoutes />
    │               </AppProvider>
    │             </ThemeProvider>
    │           )
    │           • Full context stack
    │           • React Router with 9 routes
    │           • Layout system
    │
    └── Window label determines entire React tree shape
```

### 20.2 Screenshot Capture Flow

```
┌──────────────────────────────────────────────────────────────┐
│                   SCREENSHOT FLOW                             │
│                                                              │
│  TRIGGER                                                     │
│  ├── Auto mode: user sends message → auto-capture            │
│  └── Manual mode: Cmd+Shift+S shortcut                       │
│                                                              │
│  STEP 1: Capture All Monitors (Rust capture.rs)              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ xcap::Monitor::all() → capture full image per monitor │   │
│  │ Store in CaptureState.captured_monitors HashMap       │   │
│  │ Key: monitor index, Value: RgbaImage                  │   │
│  └──────────────────────────────┬───────────────────────┘   │
│                                 │                            │
│  STEP 2: Create Overlay Windows (per monitor)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ For each monitor:                                     │   │
│  │   → Destroy existing capture-overlay-{idx} if any     │   │
│  │   → WebviewWindow::builder("capture-overlay-{idx}")   │   │
│  │     URL: index.html (triggers Overlay component)      │   │
│  │     Size: monitor dimensions / scale_factor           │   │
│  │     Position: monitor logical position                │   │
│  │     transparent, always_on_top, no decorations        │   │
│  │   → 100ms sleep → show window                         │   │
│  │ Focus primary monitor's overlay                       │   │
│  └──────────────────────────────┬───────────────────────┘   │
│                                 │                            │
│  STEP 3: User Selection (React Overlay.tsx)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Fullscreen fixed overlay:                             │   │
│  │   Background: rgba(15,23,42,0.35) + blur(2px)        │   │
│  │   Custom cursor: hidden native, rendered <MousePointer2> │
│  │                                                       │   │
│  │ Mouse interaction:                                    │   │
│  │   mouseDown → record start (x,y)                     │   │
│  │   mouseMove → draw selection rectangle (dual-border)  │   │
│  │   mouseUp  → if area ≥ 10×10px: complete selection    │   │
│  │              else: treat as click, cancel             │   │
│  │                                                       │   │
│  │ ESC key: triple-registered (document + body + window) │   │
│  │   → invoke("close_overlay_window")                    │   │
│  │                                                       │   │
│  │ DPI handling:                                         │   │
│  │   coords × window.devicePixelRatio before sending     │   │
│  └──────────────────────────────┬───────────────────────┘   │
│                                 │                            │
│  STEP 4: Crop & Encode (Rust capture.rs)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ invoke("capture_selected_area", { coords, monitorIdx })│  │
│  │   → Retrieve stored RgbaImage for that monitor        │   │
│  │   → image::GenericImageView::view(x, y, w, h)        │   │
│  │   → Encode to PNG → base64                            │   │
│  │   → Emit "captured-selection" event with base64       │   │
│  │   → Destroy all overlay windows                       │   │
│  │   → Clear CaptureState                                │   │
│  └──────────────────────────────┬───────────────────────┘   │
│                                 │                            │
│  STEP 5: Send to AI                                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Frontend receives "captured-selection" event          │   │
│  │   Auto mode: auto-submit with screenshot prompt       │   │
│  │   Manual mode: add as attached file for user to compose│  │
│  │                                                       │   │
│  │ Image sent as:                                        │   │
│  │   { type: "image_url",                                │   │
│  │     image_url: { url: "data:image/png;base64,..." } } │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 20.3 Main Overlay (AI Chat Interface)

The main window (600×54px) serves as the primary interaction surface:

```
┌─────────────────────────────────────────────────────┐
│ Main Overlay Window (600×54 initial)                │
│                                                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ TextInput Component                           │  │
│ │  [Drag Handle] [Input Field ... ] [Actions]   │  │
│ │       ↕                              ↕        │  │
│ │  DragButton     file attach, mic, screenshot  │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ On AI response (height grows dynamically):          │
│                                                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ Markdown Response Area                        │  │
│ │  Streaming text with:                         │  │
│ │  • GitHub-flavored markdown                   │  │
│ │  • Syntax-highlighted code (Shiki, lazy)      │  │
│ │  • Math equations (KaTeX)                     │  │
│ │  • Sanitize: rehype    │
│ │  • Copy button per code block                 │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ Properties:                                         │
│  • Transparent background (glass morphism)          │
│  • No title bar, no decorations                     │
│  • Always on top (configurable)                     │
│  • Content protected (invisible to screen capture)  │
│  • Invisible cursor mode available                  │
│  • Movable via keyboard shortcuts (12px/16ms ~60fps)│
│  • macOS NSPanel: non-activating floating panel     │
└─────────────────────────────────────────────────────┘
```

---

## 21. Complete Event Flow Diagram

### 21.1 All Events (Backend → Frontend)

```
┌───────────────────────────────────────────────────────────────────────┐
│                     BACKEND → FRONTEND EVENTS                         │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  AI STREAMING (api.rs)                                          │ │
│  │  ├── chat_stream_chunk    → { text: string }  (per SSE delta)  │ │
│  │  └── chat_stream_complete → { response: string } (final)       │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  AUDIO CAPTURE (speaker/commands.rs)                            │ │
│  │  ├── capture-started              → { sample_rate: u32 }       │ │
│  │  ├── speech-start                 → ()                         │ │
│  │  ├── speech-detected              → base64 WAV string          │ │
│  │  ├── speech-discarded             → reason string              │ │
│  │  ├── audio-encoding-error         → error string               │ │
│  │  ├── capture-stopped              → ()                         │ │
│  │  ├── continuous-recording-start   → max_duration               │ │
│  │  ├── continuous-recording-stopped → ()                         │ │
│  │  └── recording-progress           → seconds: u64              │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  SCREENSHOT (capture.rs)                                        │ │
│  │  ├── captured-selection   → base64 PNG string                  │ │
│  │  └── capture-closed       → ()                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  SHORTCUTS (shortcuts.rs)                                       │ │
│  │  ├── toggle-window-visibility → ()  (Windows only)             │ │
│  │  ├── focus-text-input         → ()                             │ │
│  │  ├── start-audio-recording    → ()                             │ │
│  │  ├── trigger-screenshot       → ()                             │ │
│  │  ├── toggle-system-audio      → ()                             │ │
│  │  ├── custom-shortcut-triggered→ { action: string }             │ │
│  │  └── shortcut-registration-error → { message: string }        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### 21.2 Frontend Internal Events (Window ↔ Window)

```
┌───────────────────────────────────────────────────────────────────────┐
│                    FRONTEND WINDOW EVENTS                             │
│                                                                       │
│  Dashboard Window → Main Window:                                      │
│  ├── conversationSelected  → conversation data (load in overlay)     │
│  ├── newConversation       → () (reset overlay state)                │
│  └── conversationDeleted   → conversation_id (clear if active)       │
│                                                                       │
│  Main Window → Dashboard Window:                                      │
│  └── StorageEvent (localStorage) → triggers loadData() refresh       │
│                                                                       │
│  Frontend DOM Events:                                                 │
│  └── shortcutRegistrationError (CustomEvent) → show error toast      │
└───────────────────────────────────────────────────────────────────────┘
```

### 21.3 Shortcut Event Routing

```
Physical key press
    │
    ▼
OS captures global shortcut
    │
    ▼
Tauri global_shortcut handler (lib.rs setup)
    │
    ├── Lookup action_id from RegisteredShortcuts HashMap
    │
    ├── On Pressed:
    │     ├── move_window_* prefix?
    │     │     YES → start_move_window(direction, 12px step, 16ms interval)
    │     │     NO  → handle_shortcut_action()
    │     │              │
    │     │              ├── "toggle_dashboard"     → show/hide/create dashboard
    │     │              ├── "toggle_window"        → platform-specific show/hide
    │     │              │     Windows: emit "toggle-window-visibility"
    │     │              │     macOS:   NSPanel orderFront/orderOut
    │     │              ├── "focus_input"          → show + emit "focus-text-input"
    │     │              ├── "audio_recording"      → show + emit "start-audio-recording"
    │     │              ├── "screenshot"           → emit "trigger-screenshot"
    │     │              ├── "system_audio"         → show + emit "toggle-system-audio"
    │     │              └── other                  → emit "custom-shortcut-triggered"
    │     │
    │
    └── On Released:
          └── move_window_* prefix? → stop_move_window(direction)
```

### 21.4 Complete Request Lifecycle Events

```
User types message and presses Enter
    │
    ▼─── invoke("set_window_height") ←── dynamic resize
    │
    ├── [Optional] Auto-screenshot trigger
    │     ├── invoke("start_screen_capture") → creates overlay windows
    │     ├── User selects region → invoke("capture_selected_area")
    │     ├── ← event: "captured-selection" (base64 PNG)
    │     └── invoke("close_overlay_window") → cleanup
    │
    ├── shouldUseTorviAPI()?
    │     YES → invoke("chat_stream_response")
    │     │      ├── ← event: "chat_stream_chunk" × N (streaming)
    │     │      └── ← event: "chat_stream_complete" (done)
    │     │
    │     NO → Direct HTTP fetch from frontend
    │            └── Async generator yields chunks
    │
    ├── Each chunk → setState → re-render Markdown
    │
    ├── invoke("set_window_height") ←── grows as content streams
    │
    └── 500ms debounce → SQLite save via invoke (tauri-plugin-sql)
```

---

## 22. Major Modules & Responsibilities

### 22.1 Rust Backend Module Map

```
┌─────────────────────────────────────────────────────────────────┐
│                     RUST MODULE MAP                              │
│                                                                  │
│  main.rs ─── Entry point (calls lib::run())                     │
│                                                                  │
│  lib.rs ──── Application bootstrap                              │
│  │  ├── 12 plugin registrations                                 │
│  │  ├── 6 managed states                                        │
│  │  ├── setup() → window init, NSPanel, shortcuts               │
│  │  ├── 39 IPC command registrations                            │
│  │  └── get_app_version() command                               │
│  │                                                               │
│  ├── api.rs ─── AI & API integration                            │
│  │  ├── chat_stream_response() — SSE streaming to frontend      │
│  │  ├── transcribe_audio() — multipart STT with fallback        │
│  │  ├── fetch_models() — available model list                   │
│  │  ├── create_system_prompt() — server-side prompt storage     │
│  │  ├── check_license_status() — credential existence check     │
│  │  ├── get_activity() — usage metrics                          │
│  │  └── Internal: fetch_api_response_config(), user_activity(), │
│  │       report_api_error(), get_stored_credentials()           │
│  │                                                               │
│  ├── usage.rs ─── Server-side rate limits (Appwrite)             │
│  │  ├── check_and_increment_usage() — per-request rate limiting  │
│  │  ├── get_usage_stats() — fetch current usage for UI          │
│  │  └── Uses APPWRITE_API_SECRET (server-side only, not client) │
│  │                                                               │
│  ├── capture.rs ─── Screenshot system                           │
│  │  ├── start_screen_capture() — multi-monitor capture + overlay│
│  │  ├── capture_to_base64() — single image encoding             │
│  │  ├── capture_selected_area() — DPI-aware crop + encode       │
│  │  └── close_overlay_window() — cleanup all overlays           │
│  │                                                               │
│  ├── window.rs ─── Window management                            │
│  │  ├── setup_main_window() — position top-center               │
│  │  ├── set_window_height() — dynamic 600×N resize              │
│  │  ├── open_dashboard() / toggle_dashboard() — 2nd window      │
│  │  ├── move_window() — directional movement                    │
│  │  └── create_dashboard_window() — platform-specific config    │
│  │                                                               │
│  ├── shortcuts.rs ─── Global shortcut management                │
│  │  ├── update_shortcuts() — register/unregister all bindings   │
│  │  ├── handle_shortcut_action() — route to appropriate handler │
│  │  ├── start/stop_move_window() — 60fps window movement        │
│  │  ├── set_always_on_top() / set_app_icon_visibility()         │
│  │  └── exit_app() — graceful shutdown                          │
│  │                                                               │
│  ├── db/ ─── Database layer                                     │
│  │  ├── main.rs → migrations() function                         │
│  │  └── migrations/                                              │
│  │       ├── chat-history.sql (conversations + messages + 6idx) │
│  │       └── system-prompts.sql (system_prompts + 1idx)         │
│  │                                                               │
│  └── speaker/ ─── Platform audio capture                        │
│     ├── mod.rs      → SpeakerInput trait, VadConfig, shared types
│     ├── commands.rs → Tauri command handlers
│     ├── windows.rs  → WASAPI implementation
│     ├── macos.rs    → Core Audio + cidre tap
│     └── linux.rs    → PulseAudio
```

### 22.2 Frontend Module Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND MODULE MAP                           │
│                                                                  │
│  main.tsx ── Entry point + window label routing                 │
│                                                                  │
│  contexts/ ── Global state management                           │
│  ├── app.context.tsx — All provider/license/settings state      │
│   Owns: provider merging, localStorage sync,                 │
│         cross-window StorageEvent, license validation         │
│  └── theme.context.tsx — Theme + transparency                   │
│      Owns: CSS class toggling, glass morphism control            │
│                                                                  │
│  hooks/ ── Business logic (15 hooks)                            │
│  ├── CORE HOOKS                                                  │
│  │  ├── useApp — Init shortcuts, migration, audio, titles       │
│  │  ├── useCompletion — Overlay chat: streaming, files, save    │
│  │  ├── useChatCompletion — Dashboard chat: auto-save, history  │
│  │  ├── useSystemAudio — Capture → VAD → STT → AI pipeline     │
│  │  └── useGlobalShortcuts — 7 system-wide shortcuts            │
│  ├── CONFIG HOOKS                                                │
│  │  ├── useSettings — Provider variable management              │
│  │  ├── useCustomProvider — Custom AI provider CRUD             │
│  │  ├── useCustomSttProviders — Custom STT provider CRUD        │
│  │  └── useShortcuts — Binding editor + conflict detection      │
│  ├── DATA HOOKS                                                  │
│  │  ├── useHistory — Conversation list + pagination             │
│  │  └── useSystemPrompts — System prompt CRUD                   │
│  └── UI HOOKS                                                    │
│     ├── useTitles — Window title sync via Tauri                 │
│     ├── useVersion — App version from Tauri                     │
│     ├── useWindow — Height, dashboard toggle, window movement          │
│     ├── useMenuItems — Context menu builder                     │
│     └── useCopyToClipboard — Clipboard + success state          │
│                                                                  │
│  lib/functions/ ── Core business logic (pure functions)          │
│  ├── ai-response.function.ts — Async generator streaming engine │
│  ├── stt.function.ts — STT transcription orchestration          │
│  ├── torvi.api.ts — Premium API routing decision               │
│  └── common.function.ts — Template processing, base64, paths   │
│                                                                  │
│  lib/database/ ── SQLite wrappers (via tauri-plugin-sql)        │
│  ├── chat-history.ts — Conversation/message CRUD + migration    │
│  └── system-prompts.ts — System prompt CRUD                     │
│                                                                  │
│  lib/storage/ ── localStorage persistence                       │
│  ├── helper.ts — Safe get/set/remove wrappers                   │
│  ├── ai-providers.ts — Custom AI provider persistence           │
│  ├── stt-providers.ts — Custom STT provider persistence         │
│  ├── response-settings.storage.ts — Length + language            │
│  └── shortcuts.storage.ts — Shortcut key bindings              │
│                                                                  │
│  lib/ ── Utilities                                               │
│  ├── utils.ts — cn() for class merging                          │
│  ├── platform.ts — OS detection helpers                         │
│  ├── curl-validator.ts — Curl syntax + variable validation      │
│  ├── analytics.ts — PostHog tracking helpers                    │
│  ├── chat-constants.ts — Timing constants (poll, debounce)      │
│  ├── response-settings.constants.ts — Length + language options  │
│  ├── version.ts — Version utilities                             │
│  └── platform-instructions.ts — OS-specific shortcut labels     │
│                                                                  │
│  config/ ── Static configuration                                │
│  ├── ai-providers.constants.ts — 10 AI provider curl templates  │
│  ├── stt.constants.ts — 9 STT provider definitions              │
│  ├── shortcuts.ts — 7 default keybindings                       │
│  └── constants.ts — All localStorage keys + defaults            │
│                                                                  │
│  pages/ ── Route page components (9 pages)                      │
│  ├── app/index.tsx — Main overlay (AI chat)                     │
│  ├── dashboard/index.tsx — Stats + quick actions                │
│  ├── chats/index.tsx — Conversation list                        │
│  ├── chats/view/index.tsx — Single conversation viewer          │
│  ├── settings/index.tsx — Provider configuration                │
│  ├── audio/index.tsx — Audio device selection                   │
│  ├── screenshot/index.tsx — Screenshot mode config              │
│  ├── responses/index.tsx — Response length/language             │
│  ├── system-prompts/index.tsx — Prompt management               │
│  ├── shortcuts/index.tsx — Keybinding editor                    │
│  └── dev/index.tsx — Developer tools                            │
│                                                                  │
│  components/ ── UI components                                   │
│  ├── Overlay.tsx — Fullscreen screenshot selection canvas        │
│  ├── Sidebar.tsx — Dashboard navigation                         │
│  ├── CustomCursor.tsx — Configurable invisible/default/auto     │
│  ├── DragButton.tsx — Window drag handle                        │
│  ├── Header/index.tsx — Page header                             │
│  ├── Markdown/index.tsx — Rich renderer (Shiki + KaTeX)         │
│  ├── Markdown/copy-button.tsx — Code block copy                 │
│  ├── TextInput/index.tsx — Enhanced input + file support        │
│  ├── Selection/index.tsx — Screenshot selection UI              │
│  ├── Empty/index.tsx — Empty state display                      │
│  └── ui/ — 18 Shadcn primitive components                      │
│                                                                  │
│  layouts/ ── Layout wrappers                                    │
│  ├── DashboardLayout.tsx — Sidebar + content                    │
│  ├── PageLayout.tsx — Header + scroll area                      │
│  └── ErrorLayout.tsx — Error boundary                           │
│                                                                  │
│  types/ ── TypeScript type definitions (8 files)                │
│  └── completion.ts, provider.type.ts, settings.ts, etc.         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 23. Third-Party Services Used

### 23.1 External APIs (User-Configured)

| Service | Purpose | Protocol | Auth Method |
|---------|---------|----------|-------------|
| **OpenAI API** | AI chat + Whisper STT | HTTPS REST + SSE | Bearer token |
| **Anthropic API** | Claude AI chat | HTTPS REST + SSE | x-api-key header |
| **Google Cloud** | Gemini AI + Speech-to-Text | HTTPS REST + SSE | Bearer token |
| **xAI API** | Grok AI chat | HTTPS REST + SSE | Bearer token |
| **Mistral API** | Mistral AI chat | HTTPS REST + SSE | Bearer token |
| **Cohere API** | Cohere AI chat (v2) | HTTPS REST + SSE | Bearer token |
| **Groq API** | Groq AI + Whisper STT | HTTPS REST + SSE | Bearer token |
| **Perplexity API** | Perplexity AI chat | HTTPS REST + SSE | Bearer token |
| **OpenRouter API** | Multi-model routing | HTTPS REST + SSE | Bearer token |
| **Ollama** | Local AI inference | HTTP localhost:11434 | Bearer token |
| **ElevenLabs API** | Speech-to-Text | HTTPS REST | xi-api-key header |
| **Deepgram API** | Speech-to-Text | HTTPS REST | Bearer token |
| **Azure Speech** | Speech-to-Text | HTTPS REST | Ocp-Apim-Subscription-Key |
| **Speechmatics API** | Speech-to-Text | HTTPS REST | Bearer token |
| **Rev.ai API** | Speech-to-Text | HTTPS REST | Bearer token |
| **IBM Watson** | Speech-to-Text | HTTPS REST | Basic auth |

### 23.2 Torvi Backend Services (Premium)

| Endpoint | Purpose | Used In |
|----------|---------|---------|
| `{APP_ENDPOINT}/api/response` | Get AI routing config (URL, token, model, extra params) | api.rs |
| `{APP_ENDPOINT}/api/activity` | Report usage metrics | api.rs |
| `{APP_ENDPOINT}/api/error` | Report API errors | api.rs |
| `{APP_ENDPOINT}/api/models` | Fetch available model list | api.rs |
| `{APP_ENDPOINT}/api/prompt` | Store system prompts server-side | api.rs |
| `{PAYMENT_ENDPOINT}/activate` | License activation + machine binding | api.rs     |
| `{PAYMENT_ENDPOINT}/validate` | License validity check | api.rs     |
| `{PAYMENT_ENDPOINT}/deactivate` | License deactivation | api.rs     |
| `{PAYMENT_ENDPOINT}/checkout` | Get payment page URL | api.rs     |
| `torvi.com/api/update` | Auto-update check (latest version + artifacts) | tauri.conf.json |

### 23.3 Third-Party Libraries (Frontend)

| Library | Version | Purpose |
|---------|---------|---------|
| **React** | 19.1.0 | UI framework |
| **React Router** | 7.9.5 | Client-side routing (11 routes) |
| **react-markdown** | 10.x | Markdown → React rendering |
| **remark-gfm** | — | GitHub Flavored Markdown tables, strikethrough |
| **remark-math** | — | Math equation parsing |
| **rehype-katex** | — | LaTeX → KaTeX rendering |
| **rehype-raw** | — | Raw HTML in markdown |
| **rehype-sanitize** | — | XSS prevention in AI-generated content |
| **Shiki** | 3.x | Syntax highlighting (lazy-loaded via Suspense) |
| **Tailwind CSS** | 4.1.12 | Utility-first CSS (OKLCH theme) |
| **Shadcn UI** | — | 18 component primitives (New York style) |
| **Lucide React** | — | Icon library |
| **cmdk** | — | Command palette component |
| **Recharts** | 2.x | Dashboard analytics charts |
| **moment** | — | Date/time formatting |
| **clsx** + **class-variance-authority** | — | Conditional CSS class merging |
| **@bany/curl-to-json** | — | Curl command parsing + validation |
| **@ricky0123/vad-react** | — | Voice Activity Detection (React integration) |
| **react-error-boundary** | — | Error boundary wrapper |

### 23.4 Third-Party Libraries (Rust Backend)

| Crate | Version | Purpose |
|-------|---------|---------|
| **tauri** | 2.x | Desktop app framework (IPC, windows, plugins) |
| **tokio** | 1.0 | Async runtime (full features) |
| **reqwest** | 0.12 | HTTP client (JSON, streaming, multipart) |
| **serde** / **serde_json** | 1.x | Serialization/deserialization |
| **xcap** | 0.0.12 | Cross-platform screen capture |
| **image** | 0.25.6 | Image manipulation (crop, encode PNG) |
| **hound** | 3.5.1 | WAV audio file encoding |
| **ringbuf** | 0.4.8 | Lock-free audio ring buffer |
| **uuid** | 1.0 | UUID v4 generation (instance IDs) |
| **base64** | 0.22 | Base64 encoding/decoding |
| **futures-util** | 0.3 | Stream + async utilities |
| **anyhow** | 1.0 | Error handling |
| **tracing** | 0.1 | Structured logging |
| **once_cell** | 1.19.0 | Lazy static initialization |
| **dotenv** | — | Environment variable loading at compile time |

### 23.5 Platform-Specific Crates

| Crate | Platform | Purpose |
|-------|----------|---------|
| **wasapi** | Windows | WASAPI loopback audio capture |
| **cidre** | macOS | Core Audio screen audio tap |
| **libpulse-binding** | Linux | PulseAudio bindings |
| **libpulse-simple-binding** | Linux | PulseAudio simple API |
| **cocoa** / **objc** | macOS | NSPanel native API access |

### 23.6 Tauri Plugins

| Plugin | Purpose |
|--------|---------|
| **tauri-plugin-sql** | SQLite database (migrations, prepared statements) |
| **tauri-plugin-http** | HTTP requests from frontend |
| **tauri-plugin-updater** | Auto-update with Ed25519 signature verification |
| **tauri-plugin-global-shortcut** | System-wide keyboard shortcuts |
| **tauri-plugin-keychain** | OS keychain access |
| **tauri-plugin-shell** | Shell command execution + URL opening |
| **tauri-plugin-opener** | File/URL opening |
| **tauri-plugin-autostart** | Launch at system startup |
| **tauri-plugin-posthog** | Analytics |
| **tauri-plugin-machine-uid** | Unique machine identifier |
| **tauri-plugin-macos-permissions** | macOS permission requests (audio, screen) |
| **tauri-nspanel** | macOS NSPanel (non-activating floating window) |

### 23.7 Analytics & Monitoring

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **PostHog** | Product analytics, feature usage tracking | API key baked at compile time; session recording disabled, pageview/pageleave tracking disabled |

---

*This architecture document was generated from a complete analysis of the torvi-master codebase. Use it as the blueprint for building your own AI assistant desktop application.*
