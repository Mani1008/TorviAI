# Pending Features & Fixes

> Last updated: May 14, 2026  
> Priority: 🔴 Blocker (can't ship) → 🟡 Important (before broad release) → 🟢 Nice to have

---

## Phase 1 — Blockers (can't ship without these)

### 1. Fix missing `.env` keys
**Files:** `.env`, `src-tauri/src/usage.rs`, `src/lib/appwrite/client.ts`

Missing or placeholder values that silently break features in production:

| Key | Current value | What breaks |
|-----|--------------|-------------|
| `APPWRITE_API_SECRET` | Not in `.env` | Rust-side usage writes (`record_usage`, `initialize_user_usage`) fail silently |
| `VITE_APPWRITE_COLLECTION_USER_USAGE` | Not in `.env` | Usage counter collection not linked in Appwrite |
| `VITE_APP_URL` | `http://localhost:3000` | OAuth redirect breaks in production |
| `VITE_API_BASE_URL` | `http://localhost:3000/api` | Legacy JWT auth verification breaks in production |
| `GROQ_API_KEY` | `"your_groq_api_key_here"` | Groq STT fallback is broken |

**Fix:** Set all values to real production credentials before building.

---

### 2. Wire "Upgrade" button to a payment gateway
**File:** `src/pages/billing/index.tsx`

The billing page renders correctly (3-tier pricing, adjustable Plus add-ons, GST calculation) but the "Upgrade to Plus" and "Upgrade to Pro" buttons do nothing — no `onClick` handler, no payment gateway integrated.

**Fix options (pick one):**
- Redirect to a hosted checkout page: `openUrl("https://yourdomain.com/checkout?plan=plus")`
- Integrate Razorpay SDK directly in the Tauri WebView
- Integrate Stripe Payment Links

---

### 3. Server-side usage enforcement
**Files:** `src/lib/storage/usage-stats.ts`, `src-tauri/src/usage.rs`

`checkAiResponseLimit()` in `usage-stats.ts` reads from `localStorage` only. The code itself has a `HIGH-02 NOTE` comment explicitly flagging this:

> *"This check is client-side only and can be bypassed by a technically sophisticated user. Authoritative enforcement must be implemented server-side before this feature is monetised."*

Until `APPWRITE_API_SECRET` + `VITE_APPWRITE_COLLECTION_USER_USAGE` are set and the Rust `record_usage` / `initialize_user_usage` commands are connected, any user can clear localStorage and bypass all limits.

**Fix:** Set the missing `.env` keys (item 1 above) — the Rust usage pipeline already exists in `usage.rs`, it just needs credentials.

---

## Phase 2 — Important before broad release

### 4. System Prompts CRUD page
**File:** `src/pages/system-prompts/index.tsx`

Currently renders an empty state only. Three TODOs in the file:
- List existing prompts from SQLite
- Create / edit / delete prompts
- Pre-populate with default templates

The SQLite schema (`system_prompts` table) and `initSystemPromptsTable()` already exist. Only the UI is missing.

---

### 5. Shortcuts binding editor
**File:** `src/pages/shortcuts/index.tsx`

Currently read-only — displays the default shortcuts list but users cannot change any binding. Two TODOs in the file:
- Shortcut key binding editor with conflict detection
- Register/unregister via Tauri IPC

The Rust shortcut handler (`src-tauri/src/shortcuts.rs`) and `RegisteredShortcuts` managed state already exist.

---

### 6. Enable content protection
**File:** `src-tauri/tauri.conf.json`

```json
"contentProtected": false   ← should be true
```

Content protection is currently disabled, meaning any screen-capture tool can record the overlay window. Was supposed to be enabled per the feature list.

**Fix:** Change to `"contentProtected": true` in `tauri.conf.json`.

---

### 7. Production build end-to-end test
**Command:** `cargo tauri build`

A full production build has not been verified with the real env vars. Needs to confirm:
- Auth flow (Appwrite OAuth redirect → callback → unlock_app)
- Context watcher starts correctly in the `main` window only
- AI calls reach the production API (not localhost)
- Usage counters increment in Appwrite

---

## Phase 3 — Nice to have before marketing

### 8. Context indicator in pill bar
**File:** `src/pages/app/index.tsx`

Show which app is currently being read by the context watcher in the pill-bar window. Already designed in `docs/context-memory.md`:

```ts
listen("context-captured", e => setActiveContext(e.payload.app_name))
```

Small badge/label below or beside the input — `"Reading: VS Code"`, `"Reading: Chrome"`.

---

### 9. Audio page — VAD config UI
**File:** `src/pages/audio/index.tsx`

Currently a complete placeholder. The `useSystemAudio` hook already exposes `vadConfig` / `setVadConfig` with all parameters (`sensitivity_rms`, `peak_threshold`, `silence_chunks`, etc.). Only the UI needs to be built.

---

### 10. Conversation history pagination
**File:** `src/hooks/useHistory.ts`

Two TODOs: pagination and search/filter. Currently loads all conversation rows at once. Becomes a performance problem as history grows.

---

### 11. Context memory — proactive suggestions
**File:** `src/pages/app/index.tsx`

When the user switches to a new app, proactively offer a relevant action chip:
- Switched to Figma → *"Describe this design?"*
- Switched to a `.test.ts` file → *"Run me through these tests?"*
- Switched to a meeting → *"Take notes for this meeting?"*

Triggered by comparing `app_name` in consecutive `context-captured` events.

---

### 12. System prompt auto-switching based on context
**File:** `src/hooks/useCompletion.ts`

Use the most recent context chunk's `content_type` to swap the active system prompt before the AI call:
- `content_type = "code"` → coding assistant prompt
- `content_type = "meeting"` → meeting note-taking prompt
- `content_type = "email"` → email drafting prompt

`getRecentContext(1, 5)` already exists; just needs a `content_type → systemPromptId` mapping.

---

## Summary Table

| # | Feature | Priority | Estimated effort |
|---|---------|----------|-----------------|
| 1 | Fix missing `.env` keys | 🔴 Blocker | 30 min |
| 2 | Payment gateway on Upgrade button | 🔴 Blocker | 2–4 hrs |
| 3 | Server-side usage enforcement | 🔴 Blocker | Solved by #1 |
| 4 | System Prompts CRUD page | 🟡 Important | 3–4 hrs |
| 5 | Shortcuts binding editor | 🟡 Important | 3–4 hrs |
| 6 | Enable `contentProtected: true` | 🟡 Important | 5 min |
| 7 | Production build E2E test | 🟡 Important | 2 hrs |
| 8 | Context indicator in pill bar | 🟢 Nice to have | 1 hr |
| 9 | Audio / VAD config UI | 🟢 Nice to have | 3 hrs |
| 10 | History pagination | 🟢 Nice to have | 2 hrs |
| 11 | Proactive context suggestions | 🟢 Nice to have | 3–4 hrs |
| 12 | Auto system prompt switching | 🟢 Nice to have | 2 hrs |
