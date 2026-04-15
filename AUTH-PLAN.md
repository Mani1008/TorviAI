# Pluely — Comprehensive Auth & App Architecture Plan

> This document details how authentication works across the desktop app and landing page, modeled after analysis of Cluely, FinalRoundAI, and similar desktop AI assistants.

---

## 1. Competitor Analysis

### Cluely (cluely.com)
- **Type:** Desktop AI meeting assistant (undetectable overlay)
- **Tech:** Desktop app (likely Electron/Tauri), web dashboard
- **Auth flow:** User creates account on website → downloads desktop app → logs in with account credentials inside the desktop app (embedded login form)
- **Pricing:** Free Starter → Pro ($20/mo) → Pro+Undetectability ($75/mo)
- **Key observations:**
  - Has a direct `.exe` download link (`api.v2.cluely.com/desktop-download/win/latest.exe`)
  - Desktop app has embedded auth — user enters email/password directly
  - Subscription managed on the web (Stripe integration)
  - Feature gating: screen-share invisibility is premium-only ($75/mo tier)
  - SOC 2 certified, GDPR/CCPA compliant
  - Auto-updates built in
  - Both desktop and mobile apps

### FinalRoundAI (finalroundai.com)
- **Type:** Desktop AI interview copilot (stealth mode)
- **Tech:** Desktop "Stealth App" (native), web dashboard (Next.js)
- **Auth flow:** User signs up on website (free) → downloads desktop app → logs in with FinalRoundAI account → uploads resume + job description → launches copilot
- **Pricing:** Free Forever ($0) → Premium ($41.67/mo or $96/quarter or $168/year)
- **Key observations:**
  - Two separate products: web dashboard (mock interviews, reports) + desktop app (live copilot)
  - Account created on web first, then same credentials used in desktop
  - Desktop app likely has an embedded login webview
  - "Getting Started" = upload resume → add position → launch → view report
  - Multiple payment methods: Visa, UPI, Apple Pay, Google Pay
  - 3-day money-back guarantee
  - Works on multiple devices with same account

### Common Patterns Across Competitors

| Pattern | Cluely | FinalRoundAI | Pluely (Our Approach) |
|---------|--------|--------------|----------------------|
| Account creation | Website | Website | Website (landing page) |
| Desktop login | Embedded in app | Embedded in app | Browser redirect (safer) |
| Subscription management | Web dashboard | Web dashboard | Web dashboard |
| Free tier | Yes (limited) | Yes (limited) | Yes (limited) |
| Auth mechanism | Email/password | Email/password + OAuth | Google OAuth + email |
| Token storage | Local (encrypted) | Local | localStorage |
| Desktop app download | Direct from website | Direct from website | Direct from landing page |
| Feature gating | Server-side plan check | Server-side plan check | Server-side plan check |
| Auto-update | Yes | Yes | Yes (tauri-plugin-updater) |

### Why We Use Browser Redirect Instead of Embedded Login

Most competitors embed a login form directly in their desktop app. We chose browser redirect because:
1. **No password handling in the desktop app** — reduces attack surface
2. **"Sign in with Google" works natively** — OAuth redirects are designed for browsers
3. **Users trust their browser** — they can verify the URL, see the padlock, use password managers
4. **Simpler desktop code** — no webview auth state, no cookie management, no CSRF handling
5. **One auth implementation shared between web and desktop** — the landing page handles all auth

---

## 2. Our Auth Architecture

### The Three Actors

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  DESKTOP APP     │     │  LANDING PAGE    │     │  SYSTEM BROWSER  │
│  (Tauri/Rust)    │     │  (Separate Repo) │     │  (Chrome/Edge)   │
│                  │     │                  │     │                  │
│  • Gate window   │     │  • /login        │     │  • User signs in │
│  • Pill bar      │     │  • /signup       │     │  • OAuth consent │
│  • Dashboard     │     │  • /dashboard    │     │  • Redirect back │
│  • Local HTTP    │     │  • /api/auth/*   │     │                  │
│    callback      │     │  • /pricing      │     │                  │
│    server        │     │  • /download     │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### Auth Flow — Detailed Sequence

```
FIRST LAUNCH:
═══════════════════════════════════════════════════════════════════

1. App starts
   ├─ Rust: creates main window (HIDDEN, 600×44, transparent)
   ├─ Rust: creates gate window (VISIBLE, 480×600, decorations)
   └─ React: main.tsx loads → router matches /gate

2. Gate component mounts
   ├─ useEffect: checks localStorage for "pluely_auth_token"
   ├─ Token found?  → calls GET /api/auth/verify
   │   ├─ Valid   → invoke("unlock_app") → pill bar shows, gate hides
   │   └─ Invalid → show "Get Started" button
   └─ No token? → show "Get Started" button

3. User clicks "Get Started"
   ├─ Frontend: invoke("start_oauth_callback_server")
   │   └─ Rust: binds TCP listener on 127.0.0.1:0 → returns random port
   ├─ Frontend: openUrl("{LANDING_PAGE}/login?callback_port={PORT}")
   └─ Gate UI: shows "Waiting for browser..." with spinner

4. In the system browser (user's Chrome/Edge/etc.)
   ├─ Landing page /login renders
   ├─ User signs in (Google OAuth / email+password)
   ├─ Backend creates session → generates JWT
   └─ Backend redirects: http://127.0.0.1:{PORT}/callback?token={JWT}

5. Desktop app's local HTTP server catches the callback
   ├─ Rust: parses token from query string
   ├─ Rust: emits "oauth-callback-received" event to all windows
   ├─ Rust: responds with "Signed in successfully" HTML page
   └─ Browser: shows "You can close this tab" message

6. Gate component receives the event
   ├─ saveAuthToken(token) → localStorage.setItem("pluely_auth_token", token)
   ├─ verifyToken() → GET /api/auth/verify → { valid, user: { plan } }
   ├─ invoke("unlock_app")
   │   ├─ Rust: shows main window (pill bar)
   │   └─ Rust: hides gate window
   └─ User is now authenticated → can use all features

═══════════════════════════════════════════════════════════════════

SUBSEQUENT LAUNCHES:
═══════════════════════════════════════════════════════════════════

1. App starts → gate opens → "Checking your session..."
2. Token found in localStorage → verify with API
3. Valid → unlock_app immediately (< 1 second)
4. Invalid/expired → show "Get Started" button

═══════════════════════════════════════════════════════════════════

TOKEN REFRESH (future):
═══════════════════════════════════════════════════════════════════

1. Pill bar makes API call → gets 401
2. Frontend detects expired token
3. invoke("open_gate") → gate window appears
4. User re-authenticates through browser
5. New token saved → pill bar reappears
```

---

## 3. Desktop App — Window Architecture

### Runtime Windows

| Window | Label | Route | Size | Transparent | Decorations | Visible | Skip Taskbar |
|--------|-------|-------|------|-------------|-------------|---------|--------------|
| Pill Bar | `main` | `/` | 600×44 | Yes | No | No (until auth) | Yes |
| Gate | `gate` | `/gate` | 480×600 | No | Yes | Yes (on launch) | No |
| Dashboard | `dashboard` | `/dashboard` | 900×680 | No | Yes | On demand | Yes |

### Tauri Configuration Checklist

- [x] `tauri.conf.json` → main window visible=false (pill bar hidden until auth)
- [x] `capabilities/default.json` → windows array includes `"gate"` alongside `"main"` and `"dashboard"`
- [x] `lib.rs` → gate auto-opens in `.setup()`
- [x] `window.rs` → `unlock_app`, `open_gate` commands
- [x] `auth.rs` → `start_oauth_callback_server` command

### IPC Commands (Auth-Related)

| Command | Module | Purpose |
|---------|--------|---------|
| `start_oauth_callback_server` | `auth.rs` | Starts loopback HTTP server, returns port |
| `unlock_app` | `window.rs` | Shows pill bar, hides gate |
| `open_gate` | `window.rs` | Creates/shows gate window |

### Events

| Event | Direction | Payload | Listeners |
|-------|-----------|---------|-----------|
| `oauth-callback-received` | Rust → Frontend | `{ token: string }` | Gate, Main, Dashboard |

---

## 4. Frontend Architecture (Auth Layer)

### Files

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | Token CRUD + verifyToken() |
| `src/pages/gate/index.tsx` | Gate UI component |
| `src/config/constants.ts` | STORAGE_KEYS.AUTH_TOKEN, APP_URL, API_BASE_URL |
| `src/routes/index.tsx` | /gate route registration |

### Token Lifecycle

```
saveAuthToken(token)   → localStorage.setItem("pluely_auth_token", token)
getAuthToken()         → localStorage.getItem("pluely_auth_token")
clearAuthToken()       → localStorage.removeItem("pluely_auth_token")
verifyToken()          → fetch GET /api/auth/verify with Bearer header
                         → returns { id, name, email, plan } or null
```

### Development Bypass

In `.env`:
```
VITE_SKIP_AUTH_CHECK=true
```
When set, `verifyToken()` returns a fake user immediately:
```json
{ "id": "dev", "name": "Dev User", "email": "dev@local", "plan": "dev" }
```
This bypasses the entire auth flow — gate auto-closes, pill bar appears.

**IMPORTANT:** Remove or set to `false` before production build.

---

## 5. Landing Page — Required Implementation

### Tech Stack (Recommended)
- **Framework:** Next.js 15 (App Router) or Nuxt 4
- **Auth:** NextAuth.js v5 / Lucia / custom JWT
- **OAuth Provider:** Google OAuth 2.0 (primary)
- **Database:** PostgreSQL (Supabase recommended for speed)
- **Payments:** Stripe (subscriptions)
- **Hosting:** Vercel

### Required Pages

| Route | Purpose | Priority |
|-------|---------|----------|
| `/` | Marketing homepage | P0 |
| `/login` | Sign-in (Google OAuth + email/password) | P0 |
| `/signup` | Registration (or combined with /login) | P0 |
| `/download` | Desktop app download links | P0 |
| `/pricing` | Plan comparison + subscribe buttons | P1 |
| `/dashboard` | User account, billing, usage stats | P1 |
| `/getting-started` | Onboarding walkthrough | P2 |

### Required API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/verify` | GET | Verify token, return user + plan |
| `/api/auth/login` | POST | Email/password login → JWT |
| `/api/auth/register` | POST | Create account → JWT |
| `/api/auth/google` | GET | Google OAuth initiation |
| `/api/auth/google/callback` | GET | Google OAuth callback |

### Critical Endpoint: `/api/auth/verify`

**Request:**
```http
GET /api/auth/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Success (200):**
```json
{
  "valid": true,
  "user": {
    "id": "user_abc123",
    "name": "John Doe",
    "email": "john@example.com",
    "plan": "free"
  }
}
```

**Failure (401):**
```json
{ "valid": false }
```

### Login Redirect Behavior

The desktop app opens:
```
{APP_URL}/login?callback_port=49521
```

After successful auth, the landing page MUST redirect to:
```
http://127.0.0.1:49521/callback?token={JWT}
```

**Server-side pseudocode:**
```js
// After successful Google OAuth
app.get("/api/auth/google/callback", async (req, res) => {
  const user = await authenticateWithGoogle(req.query.code);
  const jwt  = generateJWT({ id: user.id, email: user.email, plan: user.plan });

  const callbackPort = req.session.callbackPort; // saved from /login query param
  if (callbackPort) {
    // Desktop app — redirect to local callback server
    res.redirect(`http://127.0.0.1:${callbackPort}/callback?token=${jwt}`);
  } else {
    // Web browser — set cookie and redirect to dashboard
    res.cookie("token", jwt, { httpOnly: true, secure: true });
    res.redirect("/dashboard");
  }
});
```

---

## 6. Pricing & Feature Gating

### Plan Structure (Modeled After Competitors)

| | Free | Pro | Pro + Stealth |
|---|---|---|---|
| **Price** | $0/forever | $15/mo | $49/mo |
| AI chat (custom providers) | ✅ | ✅ | ✅ |
| Basic screenshot | ✅ | ✅ | ✅ |
| System prompts | ✅ | ✅ | ✅ |
| Global shortcuts | ✅ | ✅ | ✅ |
| AI messages/day | 20 | Unlimited | Unlimited |
| Keep Engaged mode | ❌ | ✅ | ✅ |
| Response length/language | ❌ | ✅ | ✅ |
| Screenshot region select | ❌ | ✅ | ✅ |
| Dashboard chat history | ❌ | ✅ | ✅ |
| Transparency/theme slider | ❌ | ✅ | ✅ |
| Window dragging | ❌ | ✅ | ✅ |
| Pluely hosted AI API | ❌ | ❌ | ✅ |
| Content protection (stealth) | ❌ | ❌ | ✅ |
| Auto-scroll streaming | ❌ | ❌ | ✅ |

### How Gating Works in Desktop App

```tsx
// The verifyToken response includes `plan`
const user = await verifyToken();
// user = { id, name, email, plan: "free" | "pro" | "stealth" }

// In React components, check the plan:
if (user.plan === "free") {
  // Show upgrade prompt
} else {
  // Show premium feature
}
```

The plan is checked client-side for UI gating, but server-side for actual API access (e.g., message limits enforced on the Pluely API backend).

---

## 7. Security Considerations

### Token Security
- JWT signed with HS256 (server secret) — desktop app never decodes it, just stores + sends
- Stored in `localStorage` (same origin per window) — NOT in cookies (no CSRF risk)
- 30-day expiry recommended — balance between UX and security
- The local callback server only accepts ONE connection then closes — no replay
- Only binds to 127.0.0.1 (loopback) — not accessible from other machines

### Callback Server Security
- Random port on each sign-in attempt — unpredictable
- Only parses the first HTTP request — ignores subsequent connections
- Validates token is non-empty before emitting event
- Returns a static HTML page — no dynamic content injection risk
- Connection is from browser on same machine only

### Desktop App Security
- No passwords stored locally — only opaque JWT
- No third-party auth SDK embedded (no Appwrite, no Firebase)
- API keys for AI providers stored in Rust-side `.env` (not in webview localStorage)
- Content protection flag prevents screen recording of the overlay

---

## 8. Implementation Status & What's Left

### ✅ Completed (Desktop App)

| Component | File | Status |
|-----------|------|--------|
| Auth constants | `src/config/constants.ts` | ✅ AUTH_TOKEN, APP_URL, API_BASE_URL |
| Token utilities | `src/lib/auth.ts` | ✅ get/save/clear/verify |
| Gate UI | `src/pages/gate/index.tsx` | ✅ Full component with states |
| Gate route | `src/routes/index.tsx` | ✅ /gate route registered |
| Gate export | `src/pages/index.ts` | ✅ Barrel export added |
| OAuth callback server | `src-tauri/src/auth.rs` | ✅ Generic token-based |
| Window commands | `src-tauri/src/window.rs` | ✅ unlock_app, open_gate |
| Startup flow | `src-tauri/src/lib.rs` | ✅ Gate auto-opens, commands registered |
| Capabilities | `capabilities/default.json` | ✅ "gate" window added |
| CSS fix | `src/global.css` | ✅ Dark bg (not transparent) |
| Pill bar transparency | `src/pages/app/index.tsx` | ✅ useTransparentWindow hook |
| Dev bypass | `.env` | ✅ VITE_SKIP_AUTH_CHECK=true |
| Cross-repo docs | `landingpage.md` | ✅ Full integration reference |

### ⏳ Not Started (Landing Page — Separate Repo)

| Component | Priority | Notes |
|-----------|----------|-------|
| Next.js project setup | P0 | App Router, Tailwind |
| Database schema (users, plans) | P0 | PostgreSQL/Supabase |
| Google OAuth integration | P0 | NextAuth.js or custom |
| `/api/auth/verify` endpoint | P0 | Desktop app calls this |
| `/login` page with callback_port handling | P0 | Redirect flow |
| `/` marketing homepage | P0 | SEO, conversion |
| `/download` page | P0 | Desktop app links |
| `/pricing` page | P1 | Stripe integration |
| `/dashboard` user account page | P1 | Billing, usage |
| Email/password auth (optional) | P2 | In addition to Google |

### ⏳ Not Started (Desktop App — Future)

| Component | Priority | Notes |
|-----------|----------|-------|
| Plan-based feature gating | P1 | Check `user.plan` in components |
| Token refresh flow | P1 | Re-open gate on 401 |
| Settings → "Account" button | P2 | Opens landing page /dashboard |
| Logout button | P2 | clearAuthToken + open_gate |
| Auto-update integration | P3 | tauri-plugin-updater already in Cargo.toml |

---

## 9. Environment Variables Reference

### Desktop App `.env`
```env
# Rust backend (not exposed to frontend)
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
GROQ_API_KEY=your_key
ASSEMBLYAI_API_KEY=your_key

# Frontend (VITE_ prefix = exposed to React)
VITE_APP_URL=https://pluely.com           # Landing page URL
VITE_API_BASE_URL=https://pluely.com/api  # API base URL
VITE_SKIP_AUTH_CHECK=false                 # true = dev bypass
```

### Landing Page `.env`
```env
# Database
DATABASE_URL=postgresql://...

# Auth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=your-256-bit-secret

# Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
NEXT_PUBLIC_APP_URL=https://pluely.com
```

---

## 10. Testing Checklist

### Desktop App (with VITE_SKIP_AUTH_CHECK=true)
- [ ] Gate window appears on launch (dark BG, "Welcome to Pluely" text)
- [ ] Token auto-verified → pill bar appears within 1 second
- [ ] Gate window hides after unlock
- [ ] Pill bar is functional (can type, send messages)
- [ ] Keyboard shortcuts work (Ctrl+Shift+H toggles pill bar)

### Desktop App (with real backend, VITE_SKIP_AUTH_CHECK=false)
- [ ] Gate window shows "Checking your session..." on launch
- [ ] No token → shows "Get Started" button
- [ ] Click "Get Started" → browser opens to login page
- [ ] Sign in on web → browser redirects to localhost callback
- [ ] Gate shows "Authenticated — opening app..."
- [ ] Pill bar appears, gate hides
- [ ] Close and reopen app → token verified → pill bar appears immediately
- [ ] Expired token → gate shows "Get Started" again

### Landing Page
- [ ] /login renders with Google sign-in button
- [ ] /login?callback_port=12345 saves port in session
- [ ] Google OAuth completes → redirects to 127.0.0.1:{port}/callback?token=JWT
- [ ] /api/auth/verify returns user object for valid token
- [ ] /api/auth/verify returns 401 for invalid/expired token
- [ ] /pricing shows plans with Stripe checkout links
