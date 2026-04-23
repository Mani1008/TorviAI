# Torvi — Landing Page & Auth Integration Reference

> **Purpose of this document:** This file lives in the desktop app repo and serves as a complete reference for building the Torvi landing page + auth backend in a separate repository. When starting work on the landing page, read this first.

---

## 1. What is Torvi?

Torvi is a **privacy-first, lightweight (~10MB) AI assistant desktop application** — an open-source alternative to Cluely. It's an **invisible AI overlay** that sits at the top of the screen as a slim pill-shaped bar, designed to help users during meetings, interviews, and conversations without being visible to screen recording or screen-sharing software.

**Target users:** Professionals in meetings, job seekers in interviews, students, and anyone who needs real-time AI assistance discreetly.

**Tech Stack:** Tauri 2 (Rust backend) + React 19 + TypeScript + Tailwind CSS 4 + Vite 7.

**Platforms:** Windows, macOS, Linux.

**License Model:** GPL-3.0 open source, with a premium tier for advanced features.

---

## 2. How Torvi Works on Desktop

### Dual-Window Architecture

Torvi runs **two independent windows** from a single process:

1. **Pill Bar (Overlay)** — A 600×54px transparent, frameless, always-on-top bar at the top-center of the screen. No title bar, no resize handles, no taskbar entry. Invisible to screen recording. This is the main AI interface.

2. **Dashboard** — A full-sized secondary window (900×680px) with sidebar navigation for settings, chat history, and configuration. Opens on demand.

### The Pill Bar — Core Interface

| State | Height | What the user sees |
|-------|--------|--------------------|
| **Collapsed** | 54px | Text input + toolbar icons |
| **Expanded** | ~600px | Input + scrollable AI response below |

**Toolbar layout (left → right):**
- Grip dots (drag) → mic button → system audio → clear chat
- Center: text input field
- Send → camera (screenshot) → stop → glass intensity slider → session timer → settings gear

When the user sends a message, the pill bar smoothly expands from 54px → ~600px showing a live-streaming AI response. When done, it snaps back to 54px. Looks like a search bar that "unfolds" into a full AI chat, then disappears.

### Six-Layer Stealth System

What makes Torvi special — it's invisible to screen capture:
1. **Content Protection** — OS-level flag excludes the window from screen recordings
2. **NSPanel (macOS)** — Non-activating floating panel (clicking Torvi doesn't steal focus from Zoom/Meet)
3. **Float Level** — Always on top, visible on all virtual desktops
4. **Taskbar/Dock Hidden** — No taskbar entry, no dock icon
5. **Title Attribute Stripping** — Prevents tooltip text leaking during screen share
6. **Custom Cursor** — Optional invisible cursor mode

---

## 3. Key Features & Functionality

### AI Chat
- **Provider-agnostic**: 10 built-in AI providers (OpenAI, Claude, Grok, Gemini, Mistral, Cohere, Groq, Perplexity, OpenRouter, Ollama local)
- Users can add **any AI provider** by pasting a cURL command — zero code changes
- **Streaming responses** with live Markdown rendering (syntax highlighting via Shiki, math via KaTeX)
- **Keep Engaged Mode** (Ctrl+K): Full conversation context in each request for multi-turn discussions
- **File attachments**: Up to 6 images via file picker, clipboard paste, or screenshot
- **Response length**: Short (1-2 sentences), Medium (2-4 sentences), or Auto
- **Response language**: 27+ languages configurable

### Screenshot / Screen Analysis
- Multi-monitor capture with click-and-drag region selection
- Two modes: **Auto** (screenshot + auto-prompt → AI vision) or **Manual** (screenshot as attachment)
- DPI-aware, works with all AI vision models (OpenAI, Claude, Gemini)

### Speech-to-Text
- **System Audio Capture**: Listens to computer audio (meetings, calls) via WASAPI/CoreAudio/PulseAudio → voice activity detection → auto-transcription → auto-submission to AI
- **Microphone Input**: Neural VAD for direct mic input
- 9 built-in STT providers + add custom via cURL
- VAD configuration: speech sensitivity, silence duration, noise gate, max recording duration

### Dashboard Pages
| Page | Purpose |
|------|---------|
| Dashboard | Overview stats, usage chart, quick actions |
| Chats | Conversation list with search, grouping, count badges |
| Chat Viewer | Full conversation view, continue chat, download as .md |
| Settings | AI/STT provider, API keys, always-on-top, autostart |
| Audio | Audio input/output device selection |
| Screenshot | Auto/manual mode, auto-prompt config |
| Responses | Length & language settings |
| System Prompts | CRUD templates (8 defaults + AI-assisted creation) |
| Shortcuts | Rebindable global shortcuts with conflict detection |

### Keyboard Shortcuts (system-wide)
| Action | Windows/Linux | macOS |
|--------|---------------|-------|
| Toggle Window | Alt+Space | Option+Space |
| Toggle Dashboard | Alt+D | Option+D |
| Focus Input | Alt+F | Option+F |
| Move Window | Alt+Arrow | Option+Arrow |
| System Audio | Alt+S | Option+S |
| Audio Recording | Alt+R | Option+R |
| Screenshot | Alt+C | Option+C |

---

## 4. Authentication — How It Works

### Why Auth Exists
The desktop app gates the pill bar behind authentication. Users must sign in before the AI overlay becomes available. This enables:
- User identification for the premium tier
- Usage tracking and billing
- License verification (free vs premium features)

### Auth Flow — Step by Step

```
┌─────────────────┐
│   User opens     │
│   Torvi app     │
└────────┬────────┘
         ▼
┌─────────────────┐    Token exists?     ┌─────────────────┐
│   Gate window    │────── YES ──────────▶│  Verify token    │
│   480×600px      │                      │  GET /api/auth/  │
│   "Checking..."  │                      │  verify           │
└────────┬────────┘                      └────────┬────────┘
         │ NO                                      │
         ▼                                    Valid? ─── YES ──▶ unlock_app
┌─────────────────┐                              │               (pill bar
│  Show "Get       │                              NO              appears)
│  Started" button │                              │
└────────┬────────┘                              ▼
         │ Click                          Show "Get Started"
         ▼
┌─────────────────┐
│  Rust starts     │
│  local HTTP      │
│  server on       │
│  random port     │
│  (e.g. 49521)    │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Open browser    │
│  to landing page │
│  /login?callback │
│  _port=49521     │
└────────┬────────┘
         ▼
┌─────────────────────────────────────────────┐
│  LANDING PAGE (this separate repo)           │
│                                              │
│  User signs in with Google / email+password  │
│  Backend creates session → generates token   │
│  Redirect browser to:                        │
│  http://127.0.0.1:49521/callback?token=JWT   │
└────────────────────┬────────────────────────┘
                     ▼
┌─────────────────┐
│  Desktop app's   │
│  local HTTP      │
│  server catches  │
│  the token       │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Rust emits      │
│  "oauth-callback │
│  -received"      │
│  event to all    │
│  windows         │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Frontend saves  │
│  token to        │
│  localStorage    │
│  key: torvi_    │
│  auth_token      │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Call verify     │
│  endpoint again  │
│  to confirm      │
└────────┬────────┘
         ▼
┌─────────────────┐
│  invoke("unlock_ │
│  app") — pill    │
│  bar appears,    │
│  gate hides      │
└─────────────────┘
```

### Subsequent Launches
On every app launch:
1. Gate window opens showing "Checking your session..."
2. Checks localStorage for `torvi_auth_token`
3. If token exists → calls `GET /api/auth/verify` with `Authorization: Bearer {token}`
4. If valid → gate auto-closes, pill bar appears immediately
5. If invalid/expired → gate shows "Get Started" button for re-authentication

---

## 5. What the Landing Page Needs to Provide

### Required Pages
| Route | Purpose |
|-------|---------|
| `/` | Marketing homepage — what is Torvi, features, pricing, download link |
| `/login` | Sign-in page (Google OAuth recommended, email/password optional) |
| `/signup` | Registration page (or combined with login) |
| `/dashboard` | User account management — billing, usage stats, plan details |
| `/pricing` | Pricing and plan comparison |

### Login Page Behavior
1. The desktop app opens: `https://yourapp.com/login?callback_port=PORT`
2. The `callback_port` query param tells the landing page where to redirect after auth
3. User signs in (Google OAuth / email+password / etc.)
4. On successful auth, generate a session token (JWT recommended)
5. **Redirect the browser to:** `http://127.0.0.1:{callback_port}/callback?token={JWT}`
6. The desktop app's local HTTP server catches this and closes the flow

**Example redirect:**
```
// After successful Google OAuth on your server:
const callbackPort = req.query.callback_port;
const token = generateJWT(user);
res.redirect(`http://127.0.0.1:${callbackPort}/callback?token=${token}`);
```

### Required API Endpoints

#### `GET /api/auth/verify`
The desktop app calls this on every launch to check if the stored token is still valid.

**Request:**
```
GET /api/auth/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Success Response (200):**
```json
{
  "valid": true,
  "user": {
    "id": "user_abc123",
    "name": "John Doe",
    "email": "john@example.com",
    "plan": "premium"
  }
}
```

**Failure Response (401):**
```json
{
  "valid": false
}
```

The `plan` field is important — the desktop app uses it to gate premium features (transparency slider, response length/language, screenshot region selection, Keep Engaged mode, etc.)

### Token Requirements
- **Format:** JWT or opaque session token — the desktop app doesn't decode it, just stores and sends it
- **Storage key:** `torvi_auth_token` in the webview's localStorage
- **Lifetime:** Recommended 30 days minimum (users shouldn't need to re-auth frequently)
- **The token should survive page/window reloads** — it's stored in localStorage, not cookies

---

## 6. App Flow — Before & After Authentication

### Before Authentication (First Launch)
```
App starts
  └─▶ Main pill bar window created (HIDDEN — invisible)
  └─▶ Gate window opens (480×600px, visible, with window decorations)
        └─▶ Shows "Welcome to Torvi" + sparkle icon
        └─▶ "Get Started — Sign In" button
        └─▶ User cannot access any AI features
        └─▶ Pill bar remains hidden until auth completes
```

### After Authentication (Subsequent Launches)
```
App starts
  └─▶ Main pill bar window created (HIDDEN)
  └─▶ Gate window opens → "Checking your session..."
  └─▶ Token verified successfully
  └─▶ Gate hides, pill bar appears at top-center of screen
  └─▶ User can:
        ├── Type questions → get AI responses
        ├── Press Alt+S → start system audio capture
        ├── Press Alt+C → take screenshot for AI analysis
        ├── Press Alt+D → open full dashboard
        ├── Press Alt+R → start mic recording
        └── Access all features based on their plan (free/premium)
```

### Token Expired / Invalid
```
App starts
  └─▶ Gate opens → "Checking your session..."
  └─▶ Token verification fails (401)
  └─▶ Gate shows "Get Started — Sign In" button
  └─▶ User must re-authenticate through browser
```

---

## 7. Desktop App Technical Details

### Windows Used at Runtime
| Label | Route | Size | Decorations | Transparent | Visible | Purpose |
|-------|-------|------|-------------|-------------|---------|---------|
| `main` | `/` | 600×44 | No | Yes | No (until auth) | AI pill bar overlay |
| `gate` | `/gate` | 480×600 | Yes | No | Yes (on launch) | Auth gate screen |
| `dashboard` | `/dashboard` | 900×680 | Yes | No | On demand | Settings & history |

### Tauri IPC Commands (Auth-Related)
| Command | Purpose |
|---------|---------|
| `start_oauth_callback_server` | Starts local HTTP server on random port, returns port number |
| `unlock_app` | Shows pill bar, hides gate |
| `open_gate` | Creates/shows the gate window |

### Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `oauth-callback-received` | Rust → Frontend | `{ token: string }` |

### Environment Variables (Desktop App `.env`)
```env
# Points to your landing page
VITE_APP_URL=https://torvi.com
VITE_API_BASE_URL=https://torvi.com/api

# Development bypass (skip token verification — returns fake dev user)
VITE_SKIP_AUTH_CHECK=true
```

### Token Storage
```
Key:   torvi_auth_token
Store: localStorage (webview)
Value: raw token string (JWT or opaque)
```

---

## 8. Premium Plan — Feature Gating

The `plan` field from `/api/auth/verify` response controls which features are available:

| Feature | Free | Premium |
|---------|------|---------|
| AI chat (custom providers) | ✅ | ✅ |
| Screenshot (full screen) | ✅ | ✅ |
| System prompts | ✅ | ✅ |
| Global shortcuts | ✅ | ✅ |
| Window dragging | ❌ | ✅ |
| Theme / transparency slider | ❌ | ✅ |
| Response length & language | ❌ | ✅ |
| Screenshot region selection | ❌ | ✅ |
| Dashboard chat (continue conversations) | ❌ | ✅ |
| Keep Engaged mode | ❌ | ✅ |
| Keyboard window movement | ❌ | ✅ |
| Custom context templates | ❌ | ✅ |
| Torvi API (hosted AI proxy) | ❌ | ✅ |
| Auto-scroll streaming | ❌ | ✅ |

The landing page's `/pricing` page should reflect these tiers. License keys are activated with machine ID → server validation → hardware-bound.

---

## 9. Landing Page Suggested Tech Stack

This is a suggestion — use whatever you prefer:

- **Framework:** Next.js 15 (App Router) or Astro
- **Auth:** NextAuth.js / Lucia / custom JWT
- **OAuth:** Google OAuth 2.0 (primary), optionally GitHub
- **Database:** PostgreSQL / Supabase / PlanetScale
- **Payments:** Stripe (for premium subscriptions)
- **Hosting:** Vercel / Railway / Fly.io

---

## 10. Quick Reference — The Exact URLs the Desktop App Opens

### Sign-In
```
Browser opens: {VITE_APP_URL}/login?callback_port={PORT}
Example:       https://torvi.com/login?callback_port=49521
```

### After Auth (Landing Page Redirects To)
```
http://127.0.0.1:{callback_port}/callback?token={JWT}
Example: http://127.0.0.1:49521/callback?token=eyJhbGciOiJIUzI1NiIs...
```

### Token Verification (Desktop App Calls)
```
GET {VITE_API_BASE_URL}/auth/verify
Authorization: Bearer {token}
Example: GET https://torvi.com/api/auth/verify
```

### Account Management (From Settings)
```
Browser opens: {VITE_APP_URL}/dashboard
Example:       https://torvi.com/dashboard
```

---

## 11. Development Mode

During development of the desktop app (no landing page backend yet), set in `.env`:
```
VITE_SKIP_AUTH_CHECK=true
```
This makes `verifyToken()` return a fake dev user immediately:
```json
{ "id": "dev", "name": "Dev User", "email": "dev@local", "plan": "dev" }
```
The gate auto-closes and the pill bar appears without any real backend.

---

## 12. Repo Locations

| Repo | Path / URL |
|------|-----------|
| Desktop App | `d:\MRR Projects\torvi-with Rust\ai-assistant` |
| Landing Page | *(separate repo — to be created)* |

The desktop app's identifier is `com.ai-assistant.app`. Dev server runs on `http://localhost:1420`.
