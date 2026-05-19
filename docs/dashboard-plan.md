# Torvi AI — Dashboard Redesign Plan

**Reference:** LittleBird AI desktop app + ChatGPT architecture analysis  
**Goal:** Evolve the current stat-card dashboard into a living AI workspace hub

---

## 1. What LittleBird Gets Right (and What We Copy)

| LittleBird Pattern | What It Actually Does | Take for Torvi |
|---|---|---|
| Minimal chat-first hero | Reduces cognitive load, chat box IS the product entry | ✅ Keep chat prominent |
| Context status widget (bottom-left) | Persistent visual of what the AI is observing right now | ✅ Build this widget |
| "Recents" sidebar section | Dynamic list of last sessions, not static nav links | ✅ Replace static sidebar nav |
| Routines in sidebar | Named agents the user schedules — feel like "saved work" | 🔜 Phase 2 |
| Activity summaries as documents | Meeting notes and daily summaries stored as readable docs | ✅ Show in dashboard |
| Pause/Resume context at a glance | User always knows if AI is watching, one click to stop | ✅ Already added to Context Memory — bring to dashboard too |

### What LittleBird Does NOT Have That Torvi Can Own
- Inline code execution / developer workflows  
- Keyboard-shortcut overlay already built (Torvi has this via `shortcuts.rs`)  
- Visible context feed (our Context Memory page — LittleBird hides this completely)  
- Multi-model routing (OpenRouter + NVIDIA NIM already wired)

---

## 2. Current Dashboard Audit

**What exists today (`/dashboard`):**
- User account card (avatar, plan badge, sign-out)
- Usage bars (Listening Time, AI Responses)
- Stat cards: Total Conversations, Today Messages, Total Messages, Sessions

**Problems:**
1. No live context signal — user can't see if the AI is observing their screen
2. No entry point to recent chats from the dashboard
3. No "start working" CTA — just passive stats
4. Nothing that shows Torvi's unique value (context memory) above the fold
5. Dashboard doesn't update meaningfully; it's a dead stats page

---

## 3. Redesigned Dashboard Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  HEADER: "Good morning, Manish" + date + context status pill       │
├──────────────────────────────┬─────────────────────────────────────┤
│                              │                                     │
│  QUICK CHAT INPUT            │  CONTEXT SNAPSHOT (right panel)    │
│  "Ask anything about         │  What the AI is reading right now:  │
│   what you're working on…"   │  • App: chrome — ChatGPT            │
│                              │  • App: Code — screen_reader.rs     │
│  Suggested prompts based on  │  • 47 chunks captured today         │
│  what's on screen            │  [Pause] [View All →]               │
│                              │                                     │
├──────────────────────────────┴─────────────────────────────────────┤
│  RECENT ACTIVITY (horizontal scroll or 2-col grid)                 │
│  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────┐ │
│  │ 📄 Chat            │  │ 💻 Code             │  │ 🌐 Browser  │ │
│  │ "Torvi dashboard   │  │ screen_reader.rs    │  │ ajvc.com    │ │
│  │  architecture"     │  │ 14 min ago          │  │ 34 min ago  │ │
│  │ 2 min ago          │  │                     │  │             │ │
│  └────────────────────┘  └────────────────────┘  └──────────────┘ │
├────────────────────────────────────────────────────────────────────┤
│  USAGE STATS (compact row, not prominent cards)                    │
│  Conversations: 24  •  Messages today: 12  •  Context chunks: 89  │
│  Listening: 1h 12m / 3h  ████████░░░░  AI Responses: 34 / 100     │
└────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions
- **Right panel context snapshot**: Shows the last 3 captured apps in real time. Updates live via `context-captured` event. This is Torvi's visible differentiator — LittleBird hides this, we surface it.
- **Quick chat input on the dashboard**: Mirrors LittleBird's chat-first hero. The input here navigates to `/chats` with a pre-filled message.
- **Suggested prompts**: Generated dynamically from recent context chunks (e.g., if last chunk is from `screen_reader.rs`, suggest "Summarize what I changed in screen_reader.rs")
- **Recent Activity cards**: Pull from context_chunks + conversation history. One unified feed of "what you were working on."
- **Stats moved to a compact footer row**: They still exist but stop dominating the page.

---

## 4. Component Architecture

### New Components to Build

```
src/pages/dashboard/
  index.tsx                  ← replace current stat-card page
  components/
    GreetingHeader.tsx        ← "Good morning, Manish" + date + context pill
    QuickChatInput.tsx        ← input that navigates to chat with prefill
    ContextSnapshot.tsx       ← live right-panel showing recent 3 captures
    RecentActivityFeed.tsx    ← merged cards from chats + context chunks
    SuggestedPrompts.tsx      ← 3 prompts generated from recent context
    UsageRow.tsx              ← compact stat row replacing big cards
```

### Data Sources Per Component

| Component | Data Source |
|---|---|
| `GreetingHeader` | `loadUserProfile()`, `Date.now()`, `invoke("get_watcher_status")` (new) |
| `QuickChatInput` | Navigates to `/chats` with React Router state |
| `ContextSnapshot` | `listen("context-captured")` + `getRecentContext(3, 60)` |
| `RecentActivityFeed` | `getRecentContext(6, 24*60)` + `getConversations()` merged by timestamp |
| `SuggestedPrompts` | `getRecentContext(2, 30)` → extract app + title → fill prompt templates |
| `UsageRow` | Same as current: `loadUsageStats()` + SQLite counts |

### New Rust Command Needed

```rust
// src-tauri/src/app_context.rs
#[tauri::command]
pub fn get_watcher_status(state: tauri::State<AppContextState>) -> &'static str {
    if state.running.load(Ordering::Relaxed) { "running" } else { "stopped" }
}
```

---

## 5. Suggested Prompts Generation Logic

This is the key intelligence feature. When the user lands on the dashboard, we look at the last 2 context chunks and fill prompt templates:

```typescript
const PROMPT_TEMPLATES: Record<string, (title: string) => string> = {
  code:               (title) => `Explain what I was doing in ${title}`,
  document:           (title) => `Summarize the document I was reading: ${title}`,
  email:              (title) => `Draft a reply to the email about: ${title}`,
  chat:               (title) => `What were the key points from my chat about ${title}?`,
  meeting:            (title) => `Generate action items from my meeting: ${title}`,
  project_management: (title) => `What's the status of ${title}?`,
  generic:            (title) => `What was I working on in ${title}?`,
};
```

These render as clickable pill buttons. Clicking one fills the QuickChatInput and focuses it.

---

## 6. Context Snapshot Panel (Right Side)

This is Torvi's most unique visible differentiator. LittleBird only shows a dot (green/grey). We show **what** the AI is actually observing:

```
┌─────────────────────────────────────┐
│ 🟢 Context Active                    │
│                                     │
│ NOW WATCHING                         │
│ ┌─────────────────────────────────┐ │
│ │ 💻 code  •  VS Code             │ │
│ │ screen_reader.rs                │ │
│ │ 2s ago                          │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🌐 generic  •  chrome           │ │
│ │ ajvc.com — Apply Here           │ │
│ │ 4 min ago                       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ 89 chunks captured today            │
│ [Pause Watching]  [View All →]      │
└─────────────────────────────────────┘
```

This panel updates in real time via the `context-captured` Tauri event. It answers the question "Is Torvi watching me right now and what does it see?" without the user needing to navigate away to Context Memory.

---

## 7. Recent Activity Feed

Merge two data sources into a single timeline:

```typescript
type ActivityItem =
  | { type: "chat";    id: string; title: string;  timestamp: number }
  | { type: "context"; id: string; app: string; window_title: string; content_type: string; timestamp: number }

// Sort by timestamp DESC, take top 6
```

Render as horizontal scrollable cards (like LittleBird's "Recents" in the sidebar but bigger and more visual). Each card:
- Chat: shows conversation title, last message preview, navigates to `/chats/view/:id`
- Context: shows app icon + window title + type badge, navigates to `/context-memory` filtered to that item

---

## 8. Implementation Phases

### Phase 1 — Dashboard Rebuild (Immediate)
Build the new dashboard layout with all components using existing data sources. No new backend needed except `get_watcher_status` command.

**Files to change:**
- `src/pages/dashboard/index.tsx` — full rewrite
- `src/pages/dashboard/components/` — all new components (6 files)
- `src-tauri/src/app_context.rs` — add `get_watcher_status` command
- `src-tauri/src/lib.rs` — register new command

**Estimated scope:** ~500 lines of new TypeScript, ~15 lines of Rust

### Phase 2 — Sidebar Rebuild (Next)
Replace the static `navItems` array in `Sidebar.tsx` with a dynamic sidebar that includes:
- **Recent Chats** (last 5, loaded from SQLite)
- **Projects** (static for now, dynamic later)
- Context status indicator in sidebar footer (not just in Context Memory page)

### Phase 3 — Routines (Future)
Scheduled AI agents. Schema:
```typescript
interface Routine {
  id: string;
  name: string;          // "Daily Briefing"
  prompt: string;        // "Summarize everything I worked on today"
  schedule: string;      // cron: "0 9 * * 1-5"
  contextWindow: number; // minutes of context to include
  enabled: boolean;
}
```
Store in SQLite. Rust side runs a cron-style scheduler (`tokio::time::sleep_until`). Emit result as Tauri event → save as conversation.

### Phase 4 — Universal Search (Future)
Hybrid search across:
- Conversation history (BM25 keyword — SQLite FTS5)
- Context chunks (keyword + recency)
- Future: embeddings via local model

---

## 9. UI/UX Principles (from LittleBird analysis)

| Principle | Implementation |
|---|---|
| **Calm, ambient** | No large header stat cards. Data presented in compact rows and small badges |
| **Context-first** | Context snapshot is above the fold on the right — it's the first signal the user sees |
| **Low friction** | Chat input is on the dashboard — zero clicks to start working |
| **Keyboard-first** | Dashboard chat input auto-focuses on mount. Shortcuts already exist |
| **Living page** | Everything updates in real time via Tauri events (no manual refresh) |

---

## 10. What Makes Torvi's Dashboard Better Than LittleBird's

| Feature | LittleBird | Torvi (after rebuild) |
|---|---|---|
| Context visibility | Hidden (just a dot) | **Visible — shows exactly which apps + text** |
| Chat entry | Full-screen hero | Dashboard + full-screen chat |
| Recent activity | Sidebar list of chat titles | **Visual cards merging chats + screen context** |
| Context control | Sidebar bottom widget | Dashboard + Context Memory dedicated page |
| Suggested prompts | None visible | **Generated from your actual screen activity** |
| Stats | None | Usage bars (listening time, AI responses) |

---

## 11. Mockup — Dashboard After Rebuild

```
Dashboard                                              May 11, 2026 · 7:14 PM
────────────────────────────────────────────────────────────────────────────────
Good evening, Manish                              🟢 Context active · 89 chunks

┌─── Ask anything ────────────────────────────┐  ┌── Now Watching ───────────┐
│                                             │  │ 💻 code · VS Code        │
│  What were the key changes I made to        │  │ screen_reader.rs · 2s    │
│  screen_reader.rs today?                    │  │                           │
│                                     Send →  │  │ 🌐 generic · chrome      │
└─────────────────────────────────────────────┘  │ ajvc.com · 4m            │
                                                  │                           │
Suggested: [Explain screen_reader.rs changes]     │ 📄 document · Code       │
           [Summarize ajvc.com application]        │ dashboard-plan.md · 8m   │
           [What was I working on?]                │                           │
                                                  │ [Pause]  [View All →]    │
─── Recent Activity ─────────────────────────────┴───────────────────────────
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌────────────┐
│ 💬 Chat          │ │ 💻 Code          │ │ 🌐 Browser       │ │ 💬 Chat   │
│ Torvi dashboard  │ │ screen_reader.rs │ │ ajvc.com         │ │ Context   │
│ architecture     │ │ VS Code          │ │ Apply Here       │ │ memory    │
│ 2m ago           │ │ 14m ago          │ │ 34m ago          │ │ 1h ago    │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └────────────┘

─── Usage ───────────────────────────────────────────────────────────────────
Conversations: 24   Messages today: 12   Context chunks: 89
Listening  1h 12m / 3h   ████████░░░░   AI Responses  34 / 100  ██████░░░░░░
```
