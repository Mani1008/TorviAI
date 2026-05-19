# Torvi Web Dashboard — Structure & Specification

> Reference document for rebuilding the desktop dashboard as a web app.
> Includes current desktop structure, data models, and competitor analysis (InterviewHelpAI).

---

## 1. Navigation (Sidebar)

The sidebar persists across all dashboard routes.

| Order | Route             | Icon              | Label           | Status   |
|-------|-------------------|-------------------|-----------------|----------|
| 1     | `/dashboard`      | LayoutDashboard   | Dashboard       | Done     |
| 2     | `/chats`          | MessageSquare     | Chats           | Done     |
| 3     | `/system-prompts` | FileText          | System Prompts  | Skeleton |
| 4     | `/shortcuts`      | Keyboard          | Shortcuts       | Done     |
| 5     | `/screenshot`     | Camera            | Screenshot      | Skeleton |
| 6     | `/audio`          | Mic               | Audio           | Skeleton |
| 7     | `/responses`      | SlidersHorizontal | Responses       | Done     |
| 8     | `/settings`       | Settings          | Settings        | Done     |

**Footer items** (below nav, sticky bottom):
- Usage Timer / Credits remaining
- User avatar + name (web only — not in desktop yet)
- Plan badge (Starter / Plus / Pro — web only)

---

## 2. Page-by-Page Breakdown

### 2.1 Dashboard (`/dashboard`)

**Desktop file:** `src/pages/dashboard/index.tsx`

#### Stat Cards (4-col grid on lg)

| Metric            | Source                        | Icon           | Sub-label          |
|-------------------|-------------------------------|----------------|--------------------|
| Conversations     | `getTotalConversationCount()` | MessageSquare  | "all time"         |
| Messages Today    | `getTodayMessageCount()`      | Activity       | "{total} total"    |
| Sessions          | `loadSessionCount()`          | Layers         | "lifetime opens"   |
| Active Provider   | `getModelById(loadSelectedModel())` | Bot      | "OpenRouter — {model}" |

#### Quick Tips (card below stats)
- Keyboard shortcuts reference (5 shortcuts)
- Provider switching hint

#### Missing — Add for Web Dashboard
- **Welcome banner** with user name + greeting (like InterviewHelpAI: "Welcome, Manish! 👋")
- **Download desktop app CTA** (link to desktop download page)
- **System Requirements card** (OS, RAM, Storage, Internet)
- **Quick Start Guide** — embedded intro video or step-by-step
- **Platform compatibility badges** (Zoom, Google Meet, Teams, LeetCode, HackerRank, CoderPad, Codility, HireVue)
- **Feature highlight cards** (grid of 6):
  - Listen to Interviewer — `Ctrl + Enter`
  - On-Screen Analysis — `Ctrl + Shift + Enter`
  - AI Chat Assistant — `Ctrl + Alt + Enter`
  - Multi-Screen Capture — `Ctrl + H`
  - Ultra Undetectable Mode — Toggle in App
  - 100% Private — Always On
- **Current plan badge** in header ("Plan: STARTER" / "Plan: PLUS" / "Plan: PRO")

---

### 2.2 Chats (`/chats`)

**Desktop file:** `src/pages/chats/index.tsx`

#### Data Source
- `getAllConversations()` → SQLite via `@tauri-apps/plugin-sql`
- Web equivalent: REST API `GET /api/conversations`

#### UI
- Empty state with CTA when no conversations
- Conversation list, each row:
  - Title (linked to `/chats/view/:conversationId`)
  - Last updated date
  - Delete button (trash icon)
- **Missing:** Search/filter, pagination (both marked TODO in desktop)

---

### 2.3 Chat View (`/chats/view/:conversationId`)

**Desktop file:** `src/pages/chats/view.tsx`

#### Data Source
- `getConversationById(id)` → conversation + all messages
- Web equivalent: REST API `GET /api/conversations/:id`

#### UI
- Back button (navigate -1)
- Empty state when conversation not found
- Message thread:
  - User messages — right-aligned, indigo gradient bg
  - Assistant messages — left-aligned, muted bg, Markdown rendered
  - Timestamps on each message

---

### 2.4 Settings (`/settings`)

**Desktop file:** `src/pages/settings/index.tsx`

#### Section 1: AI Model Selection
- Category filter pills: All, General, Vision, Fast, Reasoning, Coding
- Model grid — each card shows:
  - Name, description, model ID (monospace)
  - Context window (e.g., "131K ctx")
  - Tags: `FREE` (green), `NIM` (green), `RECOMMENDED` (indigo), `Vision` (icon)
  - Check icon when selected
- NVIDIA NIM callout (conditional — shown when NIM model selected):
  - "NVIDIA NIM API Key required"
  - Instructions to set `NVIDIA_API_KEY=nvapi-…` in `.env`
  - Link to build.nvidia.com

#### Section 2: System Prompt
- Textarea for default instruction
- Auto-saves on change

#### Web additions needed
- **API key management** — input field for NVIDIA/BYOK keys (stored server-side, not in `.env`)
- **Provider mode toggle** — "Managed (Torvi)" vs "Bring Your Own Key (BYOK)"

---

### 2.5 System Prompts (`/system-prompts`)

**Desktop file:** `src/pages/system-prompts/index.tsx`

**Status:** Skeleton — all TODO.

#### Planned (from desktop TODOs)
- List saved prompts from database
- Create / edit / delete prompts
- Pre-populated default templates

#### Database Table (already defined)
```sql
CREATE TABLE system_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### CRUD Functions (already exist in `src/lib/database/system-prompts.ts`)
- `createSystemPrompt(name, prompt)`
- `getAllSystemPrompts()`
- `updateSystemPrompt(id, name, prompt)`
- `deleteSystemPrompt(id)`

---

### 2.6 Shortcuts (`/shortcuts`)

**Desktop file:** `src/pages/shortcuts/index.tsx`

| ID              | Label          | Key                | Description                          |
|-----------------|----------------|--------------------|--------------------------------------|
| toggle-window   | Toggle Window  | Ctrl+Shift+H       | Show/hide the overlay                |
| focus-input     | Focus Input    | Ctrl+Shift+I       | Show overlay & focus input           |
| toggle-dashboard| Toggle Dashboard| Ctrl+Shift+D      | Open or close dashboard              |
| screenshot      | Screenshot     | Ctrl+Shift+S       | Capture screen for AI analysis       |
| system-audio    | System Audio   | Ctrl+Shift+A       | Start/stop system audio capture      |
| microphone      | Microphone     | Ctrl+Shift+M       | Toggle microphone                    |
| clear-chat      | Clear Chat     | Ctrl+Shift+X       | Clear current conversation           |
| glass-decrease  | Glass −        | Ctrl+[              | Decrease transparency                |
| glass-increase  | Glass +        | Ctrl+]              | Increase transparency                |
| move-window     | Move Window    | Ctrl+Arrow Keys     | Reposition overlay by 20px           |
| close-panel     | Close Panel    | Escape              | Clear & collapse panel               |

**Desktop TODOs:**
- Shortcut key binding editor with conflict detection
- Register/unregister via Tauri IPC

**Web note:** Shortcuts don't apply in web — this page is reference-only for desktop users.

---

### 2.7 Screenshot (`/screenshot`)

**Desktop file:** `src/pages/screenshot/index.tsx`

**Status:** Skeleton.

Displays:
- Mode: `auto` or `manual`
- Enabled: boolean

**Desktop TODOs:**
- Auto/manual mode toggle
- Screenshot prompt editor (customize the AI prompt sent with screenshots)
- Enable/disable toggle

---

### 2.8 Audio (`/audio`)

**Desktop file:** `src/pages/audio/index.tsx`

**Status:** Skeleton.

**Desktop TODOs:**
- List available audio input devices
- Audio level visualization
- VAD sensitivity configuration

---

### 2.9 Responses (`/responses`)

**Desktop file:** `src/pages/responses/index.tsx`

#### Section 1: Response Length (radio buttons)
| ID     | Label   | Description                        |
|--------|---------|------------------------------------|
| short  | Short   | 2-4 sentences                      |
| medium | Medium  | 1-2 paragraphs                     |
| auto   | Auto    | AI decides the appropriate length  |

#### Section 2: Response Language (pill grid, 15 options)
English, Spanish, French, German, Italian, Portuguese, Dutch, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Polish

---

## 3. Web-Only Pages (Not in Desktop)

These pages exist only on the web dashboard (inspired by InterviewHelpAI analysis):

### 3.1 CVs / Resumes (`/resumes`)

**Purpose:** Upload or create resumes to personalize AI responses during interviews.

#### Features
- Upload PDF resume
- Create resume manually (form)
- List uploaded resumes with edit/delete
- Notice: "New resume saved — open desktop app, hover avatar, click Refresh"
- Resume data is sent as additional context to AI during interviews

#### Data Model
```ts
interface Resume {
  id: string;
  name: string;         // "Software Engineer Resume"
  type: "pdf" | "manual";
  content: string;      // extracted text or manual input
  createdAt: Date;
  updatedAt: Date;
}
```

---

### 3.2 Billing (`/billing`)

**Purpose:** Plan selection, credits, payment management.

#### Pricing Tiers (reference from InterviewHelpAI, adapt for Torvi)

| Plan    | Price          | Listening       | AI Responses     | Daily Limit      | Extras                    |
|---------|----------------|-----------------|------------------|------------------|---------------------------|
| Starter | ₹0 / Free     | 30 min          | 30               | Limited          | —                         |
| Plus    | ₹800 one-time  | 2 hr (adj.)     | 120 (adj.)       | No limit/day     | Credits valid 2 months    |
| Pro     | ₹1,999/month   | Unlimited       | Unlimited        | Unlimited/day    | Cancel anytime            |

#### UI Sections
- Current plan badge + "Upgrade" CTA
- Three pricing cards (Starter, Plus, Pro)
  - Plus has adjustable listening hours and AI response counts (+/- controls)
  - Pro highlights "Most Popular"
  - Pro has Monthly/Quarterly/Annual toggle (save up to 40%)
- Feature checklist on each card
- "Contact support" link at bottom

#### Data Model
```ts
interface UserBillingInfo {
  plan: "starter" | "plus" | "pro";
  listeningMinutesRemaining: number;
  aiResponsesRemaining: number;
  creditsExpiresAt: Date | null;    // Plus plan
  subscriptionExpiresAt: Date | null; // Pro plan
  isActive: boolean;
}
```

---

### 3.3 Account / Profile (`/account`)

**Purpose:** User profile management.

#### Sections
- Display name, email, avatar
- Change password
- Connected accounts (Google, GitHub)
- Delete account
- Export data

---

### 3.4 All Commands (`/commands`)

**Purpose:** Searchable reference of all AI commands and interview modes.

**Inspired by:** InterviewHelpAI's "All Commands" sidebar item.

#### Suggested Command Categories
| Category          | Commands                                           |
|-------------------|----------------------------------------------------|
| Interview         | Listen & Respond, Screen Analysis, Follow-up       |
| Coding            | Solve Problem, Explain Code, Debug, Optimize       |
| General           | Summarize, Translate, Rewrite, Ask Anything        |
| Resume-Aware      | Tailor Answer, STAR Response, Behavioral Answer     |

---

## 4. Data Models (Full Reference)

### 4.1 Conversations & Messages

```ts
interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
}

interface AttachedFile {
  id: string;
  name: string;
  type: string;
  base64: string;
}
```

### 4.2 System Prompts

```ts
interface SystemPrompt {
  id: number;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}
```

### 4.3 AI Model Selection

```ts
interface ModelOption {
  id: string;
  name: string;
  description: string;
  category: "general" | "coding" | "reasoning" | "fast" | "vision";
  contextWindow: number;
  supportsVision: boolean;
  isFree: boolean;
  recommended?: boolean;
  providerTag?: "nvidia";
}
```

### 4.4 Response Settings

```ts
interface ResponseSettings {
  length: "short" | "medium" | "auto";
  language: string; // one of 15 supported languages
}
```

### 4.5 App Customization (Desktop-only)

```ts
interface CustomizableState {
  appIcon: { isVisible: boolean };
  alwaysOnTop: { isEnabled: boolean };
  autostart: { isEnabled: boolean };
  cursor: { type: "invisible" | "default" | "auto" };
}

interface ScreenshotConfig {
  mode: "auto" | "manual";
  autoPrompt: string;
  enabled: boolean;
}
```

### 4.6 User Auth (Web)

```ts
interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  plan: "starter" | "plus" | "pro";
  createdAt: Date;
}

interface AuthToken {
  token: string;       // JWT
  expiresAt: number;   // Unix timestamp
}
```

---

## 5. Storage Key Map

These localStorage keys are used on the desktop. The web app should migrate these to a server-side user profile:

| Key                          | Desktop Storage | Web Equivalent              |
|------------------------------|----------------|-----------------------------|
| `system_prompt`              | localStorage   | User profile → DB           |
| `screenshot_config`          | localStorage   | User profile → DB           |
| `customizable`               | localStorage   | User profile → DB           |
| `selected_model`             | localStorage   | User profile → DB           |
| `selected_ai_provider`       | localStorage   | User profile → DB           |
| `response_settings`          | localStorage   | User profile → DB           |
| `shortcuts`                  | localStorage   | User profile → DB           |
| `provider_mode`              | localStorage   | User profile → DB           |
| `byok_config`                | localStorage   | User profile → DB (encrypted)|
| `onboarded`                  | localStorage   | User profile → DB           |
| `session_count`              | localStorage   | Server analytics             |
| `auth_token`                 | localStorage   | httpOnly cookie (secure)     |

---

## 6. API Endpoints Needed (Web Backend)

Desktop uses SQLite + localStorage. The web dashboard needs REST (or tRPC) endpoints:

### Auth
| Method | Endpoint                | Description            |
|--------|-------------------------|------------------------|
| POST   | `/api/auth/login`       | Email/password or OAuth|
| POST   | `/api/auth/register`    | Create account         |
| POST   | `/api/auth/logout`      | Invalidate session     |
| GET    | `/api/auth/me`          | Current user profile   |

### Conversations
| Method | Endpoint                          | Description               |
|--------|-----------------------------------|---------------------------|
| GET    | `/api/conversations`              | List all (paginated)      |
| GET    | `/api/conversations/:id`          | Get with messages         |
| DELETE | `/api/conversations/:id`          | Delete conversation       |
| GET    | `/api/stats`                      | Dashboard stats           |

### Settings
| Method | Endpoint                          | Description               |
|--------|-----------------------------------|---------------------------|
| GET    | `/api/settings`                   | All user settings         |
| PATCH  | `/api/settings`                   | Update settings           |
| GET    | `/api/settings/model`             | Selected model            |
| PUT    | `/api/settings/model`             | Change model              |

### System Prompts
| Method | Endpoint                          | Description               |
|--------|-----------------------------------|---------------------------|
| GET    | `/api/system-prompts`             | List all                  |
| POST   | `/api/system-prompts`             | Create                    |
| PUT    | `/api/system-prompts/:id`         | Update                    |
| DELETE | `/api/system-prompts/:id`         | Delete                    |

### Resumes (Web-only)
| Method | Endpoint                          | Description               |
|--------|-----------------------------------|---------------------------|
| GET    | `/api/resumes`                    | List resumes              |
| POST   | `/api/resumes`                    | Upload/create resume      |
| PUT    | `/api/resumes/:id`                | Update resume             |
| DELETE | `/api/resumes/:id`                | Delete resume             |

### Billing (Web-only)
| Method | Endpoint                          | Description               |
|--------|-----------------------------------|---------------------------|
| GET    | `/api/billing`                    | Current plan & usage      |
| POST   | `/api/billing/checkout`           | Initiate payment          |
| POST   | `/api/billing/webhook`            | Payment provider callback |

---

## 7. Competitor Feature Comparison (InterviewHelpAI)

Features observed from the provided screenshots:

| Feature                       | InterviewHelpAI | Torvi Desktop | Torvi Web (Planned) |
|-------------------------------|:-:|:-:|:-:|
| Welcome banner with name      | ✅ | ❌ | ✅ |
| Download desktop app CTA      | ✅ | N/A | ✅ |
| System requirements card      | ✅ | N/A | ✅ |
| Quick start video guide       | ✅ | ❌ | ✅ |
| Platform badges (Zoom etc.)   | ✅ | ❌ | ✅ |
| Feature highlight cards       | ✅ | ❌ | ✅ |
| All Commands reference        | ✅ | ❌ | ✅ |
| CVs / Resumes management      | ✅ | ❌ | ✅ |
| Resume PDF upload              | ✅ | ❌ | ✅ |
| Manual resume creator          | ✅ | ❌ | ✅ |
| Billing page with plans       | ✅ | ❌ | ✅ |
| Adjustable credit packs       | ✅ | ❌ | ✅ |
| Free tier (Starter)           | ✅ | ✅ | ✅ |
| Plan badge in header          | ✅ | ❌ | ✅ |
| Upgrade CTA in header         | ✅ | ❌ | ✅ |
| User avatar + name sidebar    | ✅ | ❌ | ✅ |
| Email support link            | ✅ | ❌ | ✅ |
| Download App dropdown         | ✅ | N/A | ✅ |
| Mac version coming soon       | ✅ | ❌ | ✅ |
| Detection leaderboard         | ✅ | ❌ | Optional |
| Listen to interviewer          | ✅ | ✅ | N/A |
| On-screen analysis             | ✅ | ✅ | N/A |
| AI chat assistant              | ✅ | ✅ | N/A |
| Multi-screen capture           | ✅ | ❌ | N/A |
| Ultra undetectable mode        | ✅ | Partial | N/A |
| 100% private (content-protected)| ✅ | ✅ | N/A |

---

## 8. Web Dashboard Sidebar (Final)

Based on desktop + competitor analysis, the web sidebar should be:

```
┌─────────────────────────┐
│  🔵 Torvi              │  ← Logo
├─────────────────────────┤
│  🏠 Home                │  ← Welcome + Download + Guide
│  📋 All Commands        │  ← Command reference
│  📄 CVs / Resumes       │  ← Resume management
│  💳 Billing             │  ← Plans & credits
├─────────────────────────┤
│  ── Desktop Settings ── │  ← Section divider
│  📊 Dashboard           │  ← Stats (synced from desktop)
│  💬 Chats               │  ← Conversation history
│  📝 System Prompts      │  ← Prompt templates
│  ⚙️ Settings            │  ← Model, language, length
├─────────────────────────┤
│  ⬇ Download App         │  ← Dropdown: Windows / Mac
│  ✉ Email Support        │  ← Dropdown or mailto
│  🟢 Manish Kumar    ▾   │  ← Avatar + name + logout
└─────────────────────────┘
```

---

## 9. Onboarding Flow

**Desktop file:** `src/components/Onboarding/index.tsx`

4 steps shown as a modal on first launch:

| Step     | Content                                              |
|----------|------------------------------------------------------|
| Welcome  | Feature list: AI overlay, voice, screenshots, privacy|
| Shortcuts| 6 key shortcuts with descriptions                    |
| Provider | AI model introduction + selection                    |
| Done     | Success + "Go to Dashboard" CTA                      |

**Web equivalent:** Could be a similar wizard or a guided tour overlay.

---

## 10. Key Differences: Desktop vs Web

| Aspect            | Desktop (Tauri)                  | Web App                         |
|-------------------|----------------------------------|---------------------------------|
| Data storage      | SQLite + localStorage            | PostgreSQL + REST API           |
| Auth              | Local HTTP callback + JWT        | Standard OAuth / email+password |
| AI calls          | Rust backend → HTTP fetch         | Server-side proxy → AI API     |
| API keys          | `.env` file (Rust reads)          | Server-side env / secrets      |
| Shortcuts         | Tauri global shortcuts            | N/A (desktop-only feature)     |
| Window management | Tauri window APIs                 | N/A                            |
| Screenshot        | `xcap` crate → base64 PNG         | N/A (desktop-only feature)     |
| System audio      | WASAPI → WebSocket STT            | N/A (desktop-only feature)     |
| Billing           | N/A (via web)                     | Stripe/Razorpay integration    |
| Resumes           | N/A (via web)                     | Upload + parse + store         |
