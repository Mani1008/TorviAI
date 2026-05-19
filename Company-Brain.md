# Company Brain — Vision, Gap Analysis & Roadmap

## What is the YC "Company Brain" Vision?

Y Combinator lists "Company Brain" as one of the top 5 major problems they want founders to solve.

> "The biggest blocker to AI automation of companies is no longer the models — it's the domain knowledge. Every company has critical know-how scattered everywhere: people's heads, email threads, Slack conversations, support tickets, internal wikis, and databases. We need a system that pulls knowledge out of all these fragmented sources, structures it, keeps it current, and turns it into an executable skills file for AI agents. This isn't a company-wide search or a chatbot over documents. It's a living map of how a company works."

**Key distinction:** Not a search engine. Not a chatbot over docs. A **living map of how a company works** — with processes, decisions, and policies that AI agents can execute autonomously.

---

## How Close is Torvi AI to This Vision?

### Where Torvi Already Aligns

- **Real-time passive capture** — Context Memory is the exact primitive the vision asks for: pulling knowledge from fragmented sources *as it happens*. You capture Slack, email, VS Code, Teams, Notion, Linear *live on screen* — not from stale exports. This is a unique angle most competitors don't have
- **Multi-source awareness** — The content classifier already understands 7 domain types (code, email, meeting, document, PM, design, chat) across 45+ apps — the beginnings of a domain taxonomy
- **"Keeps it current"** — The WinEvent hook + 2-second timer is the mechanism for freshness. Context updates in real time as the user works
- **Context injection into AI** — The BM25 RAG pipeline is the retrieval side of the "skills file" concept — making captured knowledge available to AI at the moment it needs it
- **Auto system-prompt switching** — Torvi already selects *how to behave* based on what's on screen. That's the beginning of domain-aware AI behavior
- **Privacy-first architecture** — Local SQLite, PII redaction before storage, no cloud sync. A competitive moat for enterprise customers
- **Classification before storage** — Not dumping raw text; tagging, cleaning, deduplicating, and structuring it

### Where Torvi is Today vs. the Company Brain Vision

| Dimension | Torvi Today | Company Brain Needs |
|---|---|---|
| Scope | 1 user, 1 machine | All employees, all systems |
| Knowledge source | Passive screen reading | Active API integrations (Slack API, email API, CRM, etc.) |
| Knowledge structure | Raw text chunks in SQLite | Structured skills files / workflow maps |
| Output | Context injected into AI chat | Executable workflows for AI agents to act on |
| Users | Individual productivity tool | Organizational operating system |
| Knowledge type | "What's on your screen right now" | "How does this company handle refunds / incidents / pricing exceptions" |
| Agency | Helps YOU answer questions faster | AI agents autonomously doing work |

### Position on the Spectrum

```
Personal                                                       Company
AI assistant  →  Context-aware AI  →  Team knowledge  →  Company Brain
                        ↑
                   Torvi is here
```

Torvi has crossed from generic AI assistant into *context-aware AI* — a real and meaningful step. But the Company Brain lives two layers to the right.

### Honest Assessment

- Torvi is the **"personal brain"** layer — it solves the same problem for individuals that Company Brain solves for organizations
- The context capture architecture (capture → classify → store → RAG inject) is the **right foundation**
- Current use case: individual developer/knowledge worker who wants AI that knows what they're looking at
- Distance from Company Brain: **~2–3 major architectural leaps** (multi-user, active connectors, agent runtime)
- The **vision matches**; the **scope is individual vs. enterprise**; the **tech foundation is directionally correct**

> **The real insight in what's already built:** Real-time, in-the-moment capture. Most Company Brain competitors focus on *archived* knowledge — old Slack exports, uploaded documents, past tickets. Torvi's screen-reader approach is the only way to capture knowledge being *created right now*, before it evaporates. That's the unique architectural bet.

---

## Full Upgrade Roadmap (Personal → Company Brain)

### Phase 1 — Multi-User & Organizational Architecture
- Company account model — workspaces, org IDs, team membership
- Role-based access control — admin, member, viewer; different roles see different knowledge domains
- Shared knowledge base — replace per-user local SQLite with a cloud-synced org-wide store (PostgreSQL / Supabase)
- Knowledge ownership — every captured chunk tagged with author, team, department
- Capture agent deployed per employee machine — feeds into the central store
- Onboarding flow for orgs — invite teammates, assign roles, set capture scope

### Phase 2 — Source Integrations + Long-Term Persistence
- API connectors: Slack, Gmail, Notion, Jira, Linear, Confluence, HubSpot, Zendesk, PagerDuty
- Remove the 24-hour rolling window for company-level store — institutional memory must persist for years
- Versioned knowledge — every edit/update creates a new version with timestamp and author
- Retention policies — admin-configurable per knowledge type
- Archival layer — compress and cold-store old chunks not retrieved in 6+ months
- Audit log — track who captured what, when, and any edits/deletions

### Phase 3 — Knowledge Structuring Layer *(biggest technical lift)*
- **Entity extraction** — move from raw text chunks to typed knowledge entities: `Process`, `Policy`, `Decision`, `RunBook`, `FAQ`, `ContactPoint`
- **Process graph builder** — extract multi-step workflows from conversations/docs
- **Decision capture** — store *why* a decision was made, not just *what* it was
- **Policy detection** — identify rules/constraints from conversations ("refunds over $500 require manager approval")
- **Deduplication + conflict resolution** — when 3 people captured different versions of the same policy, merge or flag the conflict
- **Staleness tracking** — each entity gets a "last confirmed" timestamp; flag entities not touched in 90+ days
- **Auto-linking** — link related entities (this RunBook relates to this Process relates to this FAQ)

### Phase 4 — Hybrid RAG + Skills File Format
- Replace BM25-only with hybrid retrieval — BM25 + dense embeddings (vector search) for semantic understanding
- Graph-aware retrieval — when fetching a Process, also fetch its related Policy and RunBook nodes
- Org-scoped retrieval — queries search the whole company's knowledge, not just the current user's recent context
- Temporal retrieval — "what was our refund policy in Q1 2025?" requires time-aware querying
- Cross-domain retrieval with permission scoping
- **Design a structured skills schema** — machine-readable format (JSON/YAML) that defines: trigger conditions, steps, decision branches, required permissions, expected outputs
- **Skills compiler** — takes captured processes/policies and converts them to the skills format
- **Skills registry** — central catalog of all skills the company has (browsable, searchable, version-tracked)
- Human-in-the-loop annotation — experts review/approve auto-generated skills before they become executable

### Phase 5 — AI Agent Runtime *(currently entirely absent)*
- Agent framework — replace the "answer a question" model with agents that execute multi-step plans
- Tool registry — agents need tools: send Slack message, create Jira ticket, update Notion page, query database, call webhook
- Task queue — agents receive tasks, execute asynchronously, report results
- Approval workflows — high-stakes actions require human confirmation before execution
- Agent observability — every action an agent takes is logged, reversible where possible, auditable
- Failure recovery — if step 3 of a 5-step workflow fails, the agent knows how to roll back or escalate
- Parallel agent execution — multiple agents handling different tasks simultaneously

### Phase 6 — Compliance, Admin UI & Enterprise Billing
- Company knowledge dashboard — visualize the org's knowledge graph: what's captured, what's stale, what's missing
- Process editor — humans can manually edit, approve, or annotate auto-extracted processes
- Skills manager — view, edit, enable/disable skills in the registry
- Agent activity feed — real-time view of what agents are doing across the org
- Data residency — option to keep all knowledge in a specific region for compliance
- SOC 2 / ISO 27001 readiness — access logs, encryption at rest and in transit, key management
- Right to be forgotten — delete all captured knowledge from a specific employee on offboarding
- Per-seat pricing for organizations (current model is individual-subscription)
- Self-hosted option — large enterprises require on-premise deployment

---

## The Hard Technical Problems

The screen-reading capture engine (Phase 0) was hard because it required low-level OS integration. The next problems are hard in a **different way — they're semantically hard**, meaning no amount of clever engineering fully solves them. They require research-grade NLP, probabilistic systems, and accepting that the output will sometimes be wrong.

### Extreme Difficulty

**1. Knowledge Structuring / Entity Extraction**
- Distinguishing a *policy* from an *opinion* from *noise* in a Slack thread requires deep semantic understanding, not pattern matching
- Extracting multi-step processes from how people casually describe them — humans skip steps, assume context, use pronouns, and contradict themselves
- Deduplication is semantically hard: the same policy appears in a Slack message, a Notion doc, and an email — all worded differently, some partially outdated
- Conflict detection: knowing that "our SLA is 24 hours" and "we now commit to 12 hours" are *contradictions* about the same entity, not two separate facts

**2. Reliable Multi-Step Agent Execution**
- LLMs drift mid-workflow — by step 6, the model has "forgotten" the original goal
- Tool call failures mid-workflow require intelligent recovery: retry, escalate, compensate (undo previous steps), or gracefully abort
- Prompt injection through tool outputs is a real attack surface — a malicious Slack message or Jira ticket can hijack an agent's next action if not sandboxed
- Parallel agent coordination: when two agents both need to update the same resource simultaneously, distributed locking semantics are needed at the LLM call level

### Very Hard

**3. Hybrid RAG at Organizational Scale**
- Dense vector embeddings on millions of chunks requires ANN indexing (HNSW/IVF) — requires careful tuning or retrieval quality collapses
- Every knowledge entity update requires re-computing and re-indexing embeddings in real-time without search degrading
- Permission-scoped retrieval: most vector databases don't have native row-level security
- Temporal retrieval requires storing and querying embedding snapshots, which multiplies storage and index complexity

**4. Real-Time Multi-Device Sync Without Data Loss**
- Concurrent writes from 50 employees with no central lock create conflicts
- Must work offline-first then sync cleanly when reconnected — standard CRDTs don't understand semantic content
- Latency budget is brutal: the capture pipeline must not block the UI thread for any user, even while syncing

**5. Skills Compiler (Natural Language → Executable Workflow)**
- Humans describe processes incompletely — they assume shared context, skip "obvious" steps, describe the happy path only
- Branches and conditionals are almost never explicit in natural language
- Validating correctness of a compiled skill is fundamentally hard — you can't unit test a business process like code
- Any error in the compiled skill gets amplified by every agent execution

---

## The Privacy Problem & Architecture Fix

### The Current Privacy Reality

The current architecture has a serious data exposure problem:

```
Screen → UIAutomation → text chunks → SQLite → BM25 → inject raw text into prompt → SENT TO CLOUD LLM
```

Whatever was captured (code, Slack messages, emails) gets sent verbatim to OpenAI/Anthropic. The PII filter catches SSNs and credit cards — but NOT business logic, internal processes, pricing strategies, confidential conversations, or proprietary code.

For a personal tool, this is an acceptable tradeoff (same as manually pasting into ChatGPT). For a **Company Brain where 50 employees' screens feed into the context — this is a serious liability**.

### Problems with the Current RAG Architecture

- **Sending noise** — BM25 retrieves by keyword overlap, not semantic relevance. The AI receives irrelevant chunks, wasting tokens and sometimes confusing the model
- **No pre-computed understanding** — the AI re-interprets the same raw captured text from scratch on every single query. Nothing is learned ahead of time
- **Raw exposure** — sending the most sensitive form of the data (verbatim screen text) rather than a distilled, abstracted form
- **No hierarchy** — a random Slack message and a critical company policy have identical weight
- **Token waste** — if 15 chunks describe the same thing slightly differently, all 15 get injected

### The Right Architecture — Two-Stage Pipeline

```
CURRENT (problematic):
Screen text → stored raw → sent raw to cloud LLM

BETTER:
Screen text → LOCAL small model extracts facts/entities → structured knowledge stored
                                                                      ↓
                                               only structured facts sent to cloud LLM
```

| Step | Runs where | Sent to cloud? |
|---|---|---|
| Screen capture + PII filter | Local (Rust) | ❌ Never |
| Entity/fact extraction | Local small model (Phi-3, Llama 3.2 1B) | ❌ Never |
| Structured knowledge store | Local SQLite | ❌ Never |
| Query-time semantic retrieval | Local | ❌ Never |
| Final answer generation | Cloud LLM — receives *clean structured facts* only | ✅ Minimal, abstracted |

The cloud LLM only sees something like:
> "User is working in VS Code on a React component. Recently modified: `useCompletion.ts`. Related policy: streaming responses should use SSE not WebSocket (captured from Slack 3 days ago)."

Not the raw Slack message. Not the raw code. Just extracted, structured facts.

### Specific Improvements to Build

**Immediate / Low effort:**
- Context compression before sending — run a local summarization pass before injecting chunks; strip noise and shorten what gets sent
- Chunk scoring + filtering — only send top 3–5 chunks above a relevance threshold, not everything BM25 returns

**Medium effort:**
- Swap BM25 for local semantic embeddings — use a small local embedding model (all-MiniLM-L6, ~80MB) to generate vectors on-device; store via `sqlite-vec`. Retrieval becomes semantic, not keyword-based. Raw text never leaves device at the embedding step
- Structured fact extraction — background job processes stored chunks with a local small model and extracts typed facts: `{type: "policy", content: "refunds over $500 need approval", confidence: 0.87, source: "Slack"}`. Send facts, not raw text

**For Company Brain scale:**
- Local extraction model running continuously — a small model (Phi-3-mini, ~2GB RAM) runs locally on every employee's machine purely for extraction. Only needs to be good at entity recognition, not conversation. Solvable with small models
- Encrypted structured sync — only extracted structured facts (never raw screen text) sync to the company knowledge base
- On-premise LLM option — for enterprise customers, the final answering LLM also runs on-premise (private Azure OpenAI, self-hosted Llama). Zero data leaves the company

### The Architectural Principle

> **Stop treating the cloud LLM as the brain that reads your raw data. Make it the voice that speaks from a local brain that already understood your data.**

The local model does the understanding (slow, happens in background, raw data never leaves). The cloud LLM does the articulation (fast, happens at query time, only sees abstractions). This is how you get Company Brain without handing your company's confidential knowledge to OpenAI.

---

## Summary

| What | Status |
|---|---|
| Real-time passive screen capture | ✅ Built — Phase 0, the hardest and most novel piece |
| Multi-source content classification | ✅ Built |
| BM25 RAG injection | ✅ Built (needs upgrade to semantic) |
| Multi-user / org architecture | ❌ Not started |
| Source API integrations | ❌ Not started |
| Knowledge structuring / entity extraction | ❌ Not started — hardest remaining problem |
| Long-term persistent memory | ❌ Not started (currently 24-hour rolling) |
| Hybrid semantic RAG | ❌ Not started |
| Skills file format | ❌ Not started |
| AI agent runtime | ❌ Not started |
| Privacy-safe two-stage pipeline | ❌ Not started — important to build early |
| Enterprise compliance + admin UI | ❌ Not started |
