# Torvi → YC-Aligned Company Brain Plan

**File:** `docs/YC-alignedApp01.md`  
**Purpose:** Single source of truth for repositioning Torvi from a personal AI second brain / overlay into a YC-credible **Company Brain** product.  
**Primary RFS:** [Company Brain — Tom Blomfield (YC RFS)](https://www.ycombinator.com/rfs#company-brain)  
**Related:** [`Company-Brain.md`](./Company-Brain.md), [`desktop-app-features-roadmap.md`](./desktop-app-features-roadmap.md), [`Integration-plan.md`](./Integration-plan.md)  
**Last updated:** July 2026

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [What YC’s Company Brain RFS actually requires](#2-what-ycs-company-brain-rfs-actually-requires)
3. [Current Torvi vs target](#3-current-torvi-vs-target)
4. [What YC looks for (selection reality)](#4-what-yc-looks-for-selection-reality)
5. [Latest YC trends & Fall 2026 RFS adjacency](#5-latest-yc-trends--fall-2026-rfs-adjacency)
6. [Research: competitive landscape](#6-research-competitive-landscape)
7. [Unique differentiation (must protect)](#7-unique-differentiation-must-protect)
8. [Vertical strategy](#8-vertical-strategy)
9. [Product architecture shift](#9-product-architecture-shift)
10. [Must-have features & capabilities](#10-must-have-features--capabilities)
11. [90-day execution plan](#11-90-day-execution-plan)
12. [Prioritized engineering backlog](#12-prioritized-engineering-backlog)
13. [YC application narrative (copy)](#13-yc-application-narrative-copy)
14. [Success metrics for interview readiness](#14-success-metrics-for-interview-readiness)
15. [What to stop building](#15-what-to-stop-building)
16. [Risks & honest constraints](#16-risks--honest-constraints)

---

## 1. Executive summary

YC’s Company Brain thesis:

> The blocker to AI automation is no longer models — it is **domain knowledge**. Companies need a system that pulls fragmented know-how, **structures** it, **keeps it current**, and turns it into an **executable skills file** for AI. Not search. Not a chatbot over docs. A **living map of how the company works**.

Torvi today is a strong **personal context-aware desktop AI** (screen capture → local memory → chat). That is a foundation, not the RFS product.

**YC-aligned north star for Torvi:**

> Torvi is the company brain that learns how work **actually happens** on employee machines (live screen + connectors), compiles that into versioned **skills**, and lets AI **execute** those skills with human approval — the missing layer between raw company data and reliable automation.

**Wedge (first 6–12 months):** B2B SaaS support / CX ops teams (refunds, pricing exceptions, escalations).

**Hard truth:** A demo of personal chat memory will not get Torvi selected. Alignment requires **vertical buyer + skills/agents + real usage**.

---

## 2. What YC’s Company Brain RFS actually requires

Source: [ycombinator.com/rfs#company-brain](https://www.ycombinator.com/rfs#company-brain)

| RFS requirement | Not enough (Torvi today / common apps) | Enough (YC-shaped) |
|-----------------|----------------------------------------|--------------------|
| Pull fragmented knowledge | Screen dumps, chat logs only | Slack + email + tickets + **live desktop work** |
| Structure it | Raw chunks + BM25 | Entities: Policy, Process, Decision, Runbook |
| Keep it current | Short rolling window only | Continuous update + staleness + conflict flags |
| Executable skills file | “Answer from context” | Versioned YAML/JSON skills agents can run |
| Agents do work | Chat reply | Refund / exception / runbook step **with approval** |
| Living map | Search box | How refunds, pricing exceptions, incidents are handled |

**Blomfield’s explicit rejection of wrong products:**

- Company-wide search ≠ Company Brain  
- Chatbot over documents ≠ Company Brain  
- Target: *how refunds get handled, how pricing exceptions are decided, how engineers respond to incidents*

---

## 3. Current Torvi vs target

```
Personal AI          Context-aware AI         Team knowledge         Company Brain
assistant      →     (Torvi today)       →    shared brain      →    skills + agents
                            ↑
                     You are here
```

| Dimension | Torvi today | Company Brain target |
|-----------|-------------|----------------------|
| Scope | 1 user, 1 machine | Team / org |
| Sources | Screen text (+ OAuth started) | Screen + Slack + email + tickets + docs |
| Structure | Raw chunks in SQLite | Policy / Process / Decision / Skill |
| Output | Context injected into chat | Executable skills + agent actions |
| Users | Individual productivity | Support ops / team automation |
| Agency | Helps *you* answer | AI does work safely & consistently |
| Privacy | Local-first personal | Local capture + org permissions + audit |

**Keep building on:** Windows UI Automation capture, privacy exclusions, local SQLite, Gmail/Calendar OAuth, overlay UX, RAG injection.

**Must add:** workspace, entity distillation, skills registry, one agent loop, team permissions, connector ingest (not just OAuth).

---

## 4. What YC looks for (selection reality)

Partners optimize for trajectory, not decks. Consistent signals:

1. **Founders** — speed, obsession, complementary team (solo is a tax)  
2. **Clarity** — one sentence: what you make, for whom  
3. **Insight** — non-obvious learning about the problem  
4. **Evidence** — users, retention, revenue, or extreme build speed with usage  
5. **Market path** — large market + believable first wedge  
6. **Honesty** — known risks + how you’ll attack them  

**Odds context (as of mid-2026):**

- Overall accept rate ~1–2%  
- Demo alone ≠ acceptance  
- Consumer “second brain” with $0 / 0 users is a long shot  
- Competitive apps show: vertical wedge, B2B seats, weekly active usage, live skills/agent demo  

**Torvi’s insight (use this everywhere):**

> Most company-brain competitors index *archives* (Slack exports, Drive). The highest-value knowledge is often created *on screen right now* and evaporates. Torvi captures work as it happens, then compiles it into skills agents can run.

---

## 5. Latest YC trends & Fall 2026 RFS adjacency

### Batch mood (2025–2026)

- AI is default, not the pitch — the **job** being automated matters  
- Heavy tilt to **B2B / vertical**; consumer apps need exceptional metrics  
- Revenue-first and “service-as-software” patterns rising  
- Physical / hard tech growing in newer RFSs  

### Company Brain vs Fall 2026 RFS

[Fall 2026 RFS](https://www.ycombinator.com/rfs) emphasizes physical world, defense, multiplayer AI, consumer at scale, compliance, etc. Company Brain remains linked and remains a valid Summer 2026 thesis.

**Optional bridges (do not dilute the wedge):**

| Fall 2026 theme | How Torvi can touch it later |
|-----------------|------------------------------|
| [Multiplayer AI](https://www.ycombinator.com/rfs) (Aaron Epstein) | Shared agent sessions on top of shared skills |
| AI-Native Compliance | Audit logs, policy enforcement, approval trails |
| Software for Agents / MCP world | Torvi as MCP knowledge + skills server |

**Strategy:** Win Company Brain *vertically* first; mention multiplayer agents as Phase 2 narrative, not the Day-1 product.

---

## 6. Research: competitive landscape

### Direct / adjacent competitors

| Player | Category | Strength | Blind spot Torvi can own |
|--------|----------|----------|--------------------------|
| **Glean** | Enterprise search + assistant + agents | Deep connectors, permissions, graph | Undocumented work that never hits APIs; live desktop process |
| **Mem0** | Agent memory infrastructure | Persistent memory API for apps | Not an org process/skills layer for humans |
| **Clearly / similar “company brain” brands** | Skills + MCP for agents | Explicit Company Brain positioning | Weaker live desktop capture story |
| **Rewind / Limitless** | Personal recall | Always-on capture | Personal, not team skills / not agent execution |
| **Notion AI / ChatGPT** | Manual context | Ubiquity | Cold start; no living process map |
| **Cluely-class overlays** | Live meeting/interview help | Momentary UX | No durable company skills |

### Category mistake to avoid

Do **not** compete as:

- “Privacy-first ChatGPT”  
- “Rewind but lighter”  
- “Interview stealth AI” as the YC story  

Compete as:

- **Process → skills → approved execution** for a specific team job  

### Pricing research (directional)

| Model | Range | Fit |
|-------|-------|-----|
| Consumer sub | $10–20 / user / mo | Weak YC story unless viral growth |
| B2B seats | $15–40 / seat / mo | Aligns with support ops wedge |
| Platform / MCP later | Usage + seats | After skills become agent substrate |

**Near-term target economics for narrative:** design partners → paid seats → path to $1M ARR via 50–80 seats × ~$25 or 2–3 mid-market teams.

---

## 7. Unique differentiation (must protect)

### Primary moat

**Live OS accessibility / screen-text capture of knowledge as it is created**, combined with:

1. Connector ingest (Slack, Gmail, tickets)  
2. Distillation into Policy / Process / Decision  
3. Compilation into **versioned Skills**  
4. Agent execution with **human approval + audit**  

### Positioning line (canonical)

> Torvi is the company brain that learns how work actually happens on employee machines — then compiles that into skills agents can execute — not another Slack search box.

### Differentiation checklist

| Differentiator | Status goal |
|----------------|-------------|
| Live capture (not only APIs) | Core — already partial |
| Skills file (not only RAG chat) | Must ship for YC |
| Provenance (skill ↔ sources) | Must ship |
| Freshness + conflict detection | Must ship |
| Approval + audit for actions | Must ship |
| MCP/API for external agents | P1 |
| Privacy exclusions + minimal context to LLMs | P0/P1 (enterprise trust) |

---

## 8. Vertical strategy

### Recommended ICP (primary)

**B2B SaaS support / CX operations teams (10–200 employees)**

**Why this vertical matches the RFS examples:**

- Refunds  
- Pricing exceptions  
- Escalation paths  
- Macros / canned replies tied to real policy  

**Why it fits Torvi technically:**

- Gmail + Calendar OAuth already started  
- Slack / Zendesk / Intercom are natural next connectors  
- Agents sit in admin panels and ticket UIs (screen capture helps)  
- Clear ROI: faster answers, fewer policy mistakes, fewer manager pings  

**Buyer:** Head of Support, CX Ops, Support Lead  
**User:** Agents + leads  
**Champion metric:** Time-to-first-response, refund error rate, % tickets resolved with policy citation  

### Alternate ICP (secondary)

**Software engineering incident response**

- Runbooks, on-call, Linear/Jira, Slack war rooms  
- Strong technical story; slower sales for a solo founder unless warm network  

### Explicit non-ICP (for 6–12 months)

- Broad consumer “remember my digital life”  
- Students / interview-only  
- “Every company, every role” horizontal GTM  

### One-sentence company description (use everywhere)

> Company brain for SaaS support teams — captures how refunds and exceptions are really handled, turns them into skills, and lets AI execute them with approval.

---

## 9. Product architecture shift

### Mental model

```
TODAY (Torvi)                              YC COMPANY BRAIN (target)
─────────────────                          ─────────────────────────
Screen text → chunks → chat                Screen + APIs → entities → skills → agents
Personal SQLite                            Team workspace + RBAC
Answer questions                           Execute workflows (with approval)
Integrations = OAuth tokens                Integrations = ingest + agent tools
```

### New core objects

| Object | Example |
|--------|---------|
| `Workspace` | Acme Support org |
| `Entity` | Policy: “Refunds ≤ $50 auto-approved” |
| `Process` | Steps for billing exception |
| `Decision` | “We decided X on 2026-07-12 because Y” |
| `Skill` | Executable YAML for agents |
| `Action` | Proposed / completed agent step + audit log |
| `Source` | Slack thread, Gmail, screen capture, Zendesk ticket |

### Skills file schema (draft)

```yaml
id: skill_refund_under_50
version: 3
title: Refund under $50
trigger:
  - customer_requests_refund
  - amount_usd_lte: 50
steps:
  - check_policy: refunds.under_50
  - verify_no_chargeback_flag
  - draft_customer_reply
  - create_ticket_note
  - require_approval_if: first_week_agent
permissions:
  roles: [support_agent, support_lead]
citations:
  - source: slack
    ref: "C0123/1700000"
  - source: screen
    ref: capture_abc
  - source: gmail
    ref: thread_xyz
staleness:
  last_confirmed: 2026-07-20
  confirm_every_days: 90
```

### Privacy architecture fix (enterprise-critical)

Current risk path:

```
Screen → chunks → SQLite → BM25 → raw text injected → cloud LLM
```

Target path:

```
Screen/APIs → redaction → entities/skills → retrieve skill + minimal facts → LLM/agent
                                              ↓
                                    audit log + approvals
```

Business secrets and processes must not be dumped wholesale into prompts. Prefer structured skill + cited snippets.

---

## 10. Must-have features & capabilities

### P0 — Required for a YC-credible demo (10 minutes)

1. **Team workspace** — invite seats, shared brain  
2. **Role basics** — admin / member (viewer later)  
3. **Connector ingest** — Gmail + one of Slack or Zendesk/Intercom (read → memory, not OAuth-only)  
4. **Live capture retained** — with app/domain exclusions  
5. **Distillation** — LLM proposes Policy/Process from captures; human Confirms  
6. **Skills registry** — list, version, enable/disable  
7. **One agent loop** — e.g. “Draft refund reply from skill” or “Propose ticket note” → Approve  
8. **Provenance UI** — skill shows source citations  
9. **Audit log** — who approved what action  

### P1 — Strengthens interview / early revenue

10. Conflict + staleness flags on entities/skills  
11. MCP server: `search_policies`, `get_skill`, `list_runbooks`  
12. Minimal-context RAG (structured retrieval)  
13. Calendar-aware context for support schedules / launches  
14. Admin dashboard: what’s captured, what’s stale, missing processes  
15. Per-seat billing  

### P2 — Scale / Fall RFS bridges

16. Knowledge graph visualization (“living map”)  
17. Multiplayer shared agent session  
18. More connectors (Notion, Linear, HubSpot, PagerDuty)  
19. Self-host / VPC / SOC2 path  
20. Multi-step agent runtime with rollback  

---

## 11. 90-day execution plan

### Days 0–30 — Reposition + vertical wedge

| Workstream | Deliverable |
|------------|-------------|
| Narrative | Landing + in-app copy = Support Ops Company Brain |
| Product | Workspace + invite (even crude) |
| Ingest | Gmail → memory chunks; start Slack *or* tickets |
| Distill | Candidate Policy/Process + Confirm button |
| Capture | Keep Windows capture; tighten exclusions for support tools |
| GTM | 3 design-partner support leads using weekly |

**Exit criteria:** Design partners can see shared confirmed policies from real work.

### Days 31–60 — Skills + one agent loop

| Workstream | Deliverable |
|------------|-------------|
| Skills | YAML schema + registry UI + versioning |
| Agent | One approved action (draft reply / ticket note) |
| Provenance | Citations on every skill |
| Conflicts | Flag contradictory policies |
| Platform | MCP: get_skill / search_policies |
| Demo script | Capture → skill → agent draft → approve (recorded) |

**Exit criteria:** 10-minute live demo with zero “chatbot over docs” vibe.

### Days 61–90 — Traction for YC

| Workstream | Deliverable |
|------------|-------------|
| Users | 5–10 teams or 30+ seats; weekly active metric |
| Proof | Case study: time-to-answer or error-rate improvement |
| Pricing | Per-seat B2B live or LOIs |
| Application | Rewrite Progress/Idea around Company Brain + vertical |
| Team | Co-founder search *or* exceptional solo + advisors |

**Exit criteria:** Interview-ready: users + execution demo + crisp wedge.

---

## 12. Prioritized engineering backlog

Map to existing Torvi modules where possible.

| Priority | Feature | Likely touchpoints |
|----------|---------|-------------------|
| P0 | Team workspace + RBAC | Cloud auth (Appwrite/Supabase), new `workspaces` |
| P0 | Entity tables (Policy/Process/Decision/Skill) | `context_db` / new SQLite+cloud sync |
| P0 | Distillation job (chunk → entity draft) | Rust/TS worker + LLM |
| P0 | Skills registry UI | Dashboard settings / new Skills page |
| P0 | Gmail ingest (not only OAuth) | `integrations/` + sync worker |
| P0 | Slack or Zendesk ingest | New provider modules |
| P0 | Agent action + approval | Commands + UI modal + audit table |
| P0 | Provenance links | `memory_sources`-style links |
| P1 | Staleness / conflict | Distillation + UI badges |
| P1 | MCP server | Local or cloud MCP over skills API |
| P1 | Minimal-context prompt builder | `ai-response` / RAG path |
| P1 | Seat billing | Existing billing page → B2B plans |
| P2 | Graph UI | New visualization |
| P2 | Multiplayer agent session | Realtime channel |
| P2 | Self-host path | Deploy docs + packaging |

### Demo script (engineering acceptance)

1. Support lead has Torvi running with exclusions set.  
2. Agent handles a refund in Zendesk + Slack; Torvi captures.  
3. Torvi proposes skill `refund_under_50`; lead Confirms.  
4. Next ticket: user asks Torvi to handle refund → agent drafts from skill → Approve.  
5. Skill panel shows Slack + screen citations.  
6. External Claude/Cursor calls MCP `get_skill(refund_under_50)`.

---

## 13. YC application narrative (copy)

### Company (one sentence)

> Company brain for SaaS support teams: we capture how refunds and exceptions are really handled, compile versioned skills, and let AI execute them with human approval.

### What are you building? (short)

> Torvi builds the missing layer between scattered company knowledge and reliable AI automation. Support teams’ real processes live in Slack, email, tickets, and on-screen admin tools — not in a clean wiki. We capture that work (desktop + connectors), structure it into policies and processes, compile an executable skills file, and let agents draft or perform actions with approval and audit. This is not enterprise search and not a chatbot over docs — it is a living map of how the company works.

### Why this idea / insight

> Models got good; domain knowledge did not. Every support org runs on tribal knowledge. Archives and Drive search miss what is decided in the moment on screen. We built live capture first so the brain learns how work actually happens, then turns it into skills agents can reuse safely.

### Competitors

> Glean wins connected-app search and horizontal enterprise AI. Mem0 is memory infrastructure for agents. Rewind/Limitless are personal recall. Notion AI / ChatGPT need manual context. We differ by combining **live desktop capture + process distillation + versioned skills + approved execution** for a specific job (support ops), then exposing that brain to other agents via MCP.

### How you make money

> B2B per-seat subscription for support teams ($15–40/seat/mo). Later platform fees when external agents consume skills via API/MCP. Near-term: design partners → paid seats. Path: ~50–100 seats or a handful of mid-market teams toward early ARR milestones.

### Progress framing (once traction exists)

> Working Windows desktop capture + local memory + AI chat shipped. Gmail/Calendar OAuth complete. Now shipping team workspaces, skill compilation, and first approved agent actions with N design partners / X weekly seats.

### What not to write

- “AI second brain for everyone”  
- “Privacy-first ChatGPT overlay”  
- “No competitors”  
- Inflated user numbers  

---

## 14. Success metrics for interview readiness

| Metric | Weak | Competitive |
|--------|------|-------------|
| Weekly active seats | 0–5 friends | 30+ real seats or 5+ teams |
| Skills confirmed | 0 | 20+ org skills in production use |
| Agent actions approved / week | 0 | Measurable weekly usage |
| Design partners | 0 | 3+ support leads on weekly calls |
| Narrative | Consumer memory | Company Brain + vertical |
| Demo | Chat with context | Capture → skill → approve action |
| Revenue | $0 forever | LOIs or paid seats (even small) |

---

## 15. What to stop building

Pause or de-prioritize unless a design partner demands it:

- More consumer chat cosmetics  
- Endless AI model provider toggles without skills  
- Interview-stealth as core positioning  
- Broad “life OS / remember everything” marketing  
- Feature parity with Cluely/Rewind as north star  
- macOS parity before vertical Windows demo is airtight (unless a partner requires Mac)  
- Full multi-agent runtime before **one** approved action works  

---

## 16. Risks & honest constraints

| Risk | Mitigation |
|------|------------|
| Solo founder tax at YC | Co-founder or show extreme shipping + traction |
| Enterprise privacy fear of screen capture | Exclusions, redaction, local-first option, admin controls, minimal LLM context |
| Looking like Glean-lite | Never demo “search”; always demo **skills + action** |
| Distillation quality (policy vs opinion) | Human confirm loop; start narrow (refunds/exceptions only) |
| Horizontal temptation | Written ICP; reject feature requests outside support ops for 90 days |
| Fall RFS shift away from Company Brain | Keep vertical + skills; optionally add multiplayer agent story later |
| Capture → cloud LLM leakage | Architecture fix in §9 before multi-seat rollout |

---

## Appendix A — Canonical YC one-liners

**50-character style:**  
`Company brain for SaaS support teams`

**Pitch:**  
`Capture real support processes → compile skills → AI executes with approval`

**Insight:**  
`APIs see archives; we see work as it happens — then make it executable`

---

## Appendix B — Relationship to existing docs

| Doc | Role |
|-----|------|
| [`Company-Brain.md`](./Company-Brain.md) | Full technical gap analysis & long roadmap (Phases 1–6) |
| **This file (`YC-alignedApp01.md`)** | YC alignment, vertical, differentiation, 90-day plan, app narrative |
| [`desktop-app-features-roadmap.md`](./desktop-app-features-roadmap.md) | Shipped vs planned product inventory |
| [`Integration-plan.md`](./Integration-plan.md) | Connector implementation details |

**Rule:** If `Company-Brain.md` and this file conflict on priority, **this file wins for the next 90 days** (YC wedge). Long-term architecture still follows `Company-Brain.md`.

---

## Appendix C — Immediate next actions (this week)

1. Rewrite public one-liner + Settings/Integrations copy toward Support Ops Company Brain.  
2. Spec `skills` + `entities` SQLite/cloud schema.  
3. Ship Gmail **ingest** (sync threads into memory), not only connect.  
4. Add “Confirm as Policy/Skill” on top of existing context chunks.  
5. Recruit 3 support-team design partners.  
6. Record a draft demo: capture → confirm skill → draft action.  

---

*End of YC-alignedApp01.md*
