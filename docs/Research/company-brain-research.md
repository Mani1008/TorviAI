# Company Brain Research — YC RFS, GBrain, Glean, Littlebird, and the Torvi Architecture

**Research date:** 2026-08-26  
**Purpose:** Analyze the YC “Company Brain” thesis, the supplied videos, GBrain, Glean, Littlebird-inspired architecture, and the uploaded Torvi architecture/roadmap; then translate the findings into a practical product and architecture direction.

---

## 1. Executive conclusion

The YC Company Brain idea is **not primarily an enterprise-search product**.

The core primitive is:

> **Company data → structured organizational knowledge → executable skills/processes → agents that act → outcomes/feedback → updated knowledge/skills.**

YC's RFS explicitly says the problem is fragmented domain knowledge and asks for a system that extracts it, structures it, keeps it current, and turns it into an executable skills file. YC explicitly distinguishes this from company-wide search or a chatbot over documents.

The strongest interpretation after comparing the YC material, Tom Blomfield's talks, GBrain, Glean, AnswerThis, Littlebird, and the supplied Torvi architecture is:

**A Company Brain is a continuously learning operational context layer for agents.**

It needs four properties:

1. **Complete enough context** — data, people, decisions, processes, tools and activity.
2. **Structured enough to reason over** — entities, relationships, policies, procedures, timelines and provenance.
3. **Executable enough to act** — skills, tools, permissions, approvals and workflows.
4. **Adaptive enough to improve** — execution traces, quality gates, feedback, conflict detection and memory updates.

Your existing Torvi architecture already has a potentially valuable primitive: **live capture of knowledge as work happens on the employee's machine**. The major strategic mistake would be to stop at screen-aware RAG.

The product should evolve from:

`screen → chunks → BM25 → chat`

to:

`screen + APIs + meetings + systems → events → knowledge entities → process/decision graph → versioned skills → agent execution → evaluation → learning`

---

# 2. What YC actually means by Company Brain

YC's Summer 2026 RFS describes the problem as domain knowledge being scattered across people's heads, old email, Slack, support tickets and databases. It asks for knowledge to be pulled together, structured, kept current and converted into an executable skills file.

The important phrases are:

- **domain knowledge**
- **fragmented sources**
- **structure it**
- **keep it current**
- **executable skills file**
- **living map of how a company works**
- not company-wide search
- not chatbot-over-documents

Source: YC Requests for Startups, Company Brain.

The implication is that the unit of value is not the document.

The unit of value is the **operational knowledge encoded by the documents and work artifacts**.

For example:

A Slack message:

> “Refund this customer; we've done it before.”

is raw evidence.

A Company Brain should eventually infer something like:

```yaml
policy:
  name: refund_under_50
  condition:
    amount_usd: "<=50"
  authority:
    auto_approve: true
  exceptions:
    - chargeback_flag
    - suspected_fraud
  source_evidence:
    - slack:thread_123
    - zendesk:ticket_987
  confidence: 0.91
  last_confirmed: 2026-08-20
```

And then compile the policy/process into a skill that an agent can execute.

That distinction is fundamental.

---

# 3. Tom Blomfield's “How to Build a Self-Improving Company with AI”

The supplied YouTube URL `X_JsIHUfUjc` corresponds to YC's May 2026 talk:

**How to Build a Self-Improving Company with AI**

The official YouTube description gives these chapters:

- Companies Are Roman Legions
- Copilots Are the Wrong Mental Model
- Extract the Domain Knowledge
- Recursive Self-Improving Loop
- The Holy Shit Moment at YC
- Self-Optimizing Product and Support Loops
- Burn Tokens, Not Headcount
- Middle Management Is Over
- Make Everything Legible to AI
- Regenerating the YC User Manual
- Software Is Ephemeral, Context Is Valuable
- Where Humans Still Matter

The talk's central argument is broader than “build a company knowledge base.”

### 3.1 The company becomes a set of AI loops

Tom describes companies as traditionally hierarchical systems where humans are the conduit for information.

The AI-native alternative is a set of **recursive self-improving loops**.

A useful abstraction is:

```text
SENSE
  ↓
UNDERSTAND
  ↓
DECIDE
  ↓
ACT
  ↓
MEASURE
  ↓
QUALITY GATE
  ↓
LEARN
  ↓
UPDATE KNOWLEDGE / TOOLS / POLICY
  ↓
SENSE AGAIN
```

This is much closer to the actual target than a RAG chatbot.

### 3.2 The YC “holy shit” example

One of the most important examples from the talk is YC's internal agent.

The basic pattern:

```text
Employee asks question
        ↓
Internal agent attempts answer
        ↓
Monitoring agent observes failures
        ↓
Diagnoses why the answer failed
        ↓
Missing data / wrong tool / stale information / software issue
        ↓
Agent modifies the system
        ↓
Review / deployment
        ↓
Future query succeeds
```

This is the critical leap.

The AI is not merely using company knowledge.

**The AI system is improving the mechanism by which company knowledge is used.**

That is what makes the system self-improving.

### 3.3 Regenerating the YC User Manual

Tom describes YC using recorded office hours to regenerate its user manual.

The important pattern is:

```text
Continuous operational data
        ↓
Diarization / categorization
        ↓
Synthesis
        ↓
Living manual
        ↓
Compare future advice against current knowledge
        ↓
Keep / update / discard
```

The resulting manual is not treated as a static document.

It becomes a **living organizational memory**.

This strongly validates the architecture direction you already have around continuous capture, but it also shows why raw capture is only the beginning.

---

# 4. Tom Blomfield's August 2026 “Building And Structuring An AI Native Company”

The second YC video found in the research is a later Tom Blomfield talk from Startup School Paris:

**Building And Structuring An AI Native Company**

The talk contains a dedicated section:

**14:08 — What “Company Brain” Actually Means**

The explanation is particularly important because it clarifies the difference between formal SOPs and actual operational knowledge.

Tom's point is essentially:

- conventional companies write SOPs describing how work *should* happen;
- observing people reveals edge cases and exceptions;
- important knowledge exists in people's heads;
- the Company Brain combines the company's data and operational knowledge;
- intelligence moves from being distributed only through the organizational hierarchy into the system itself.

This means your product should prioritize:

**“How does work actually happen?”**

over:

**“What does the documentation say should happen?”**

That is a major product insight.

---

# 5. The supplied DGD9b8K42lk video — AnswerThis

The second supplied video is:

**How to Build an Internal AI Agent That Evolves Itself**

The company discussed is AnswerThis.

The talk is extremely relevant because it gives a concrete architecture for an internal AI employee rather than only a conceptual Company Brain.

Reported capabilities include:

- 100+ emails/day
- customer support ticket handling
- CRM updates
- business Q&A
- feedback through Slack
- self-updating instructions
- self-extending tooling

The most useful idea is the **three-memory model**.

## 5.1 Factual memory

What the company **is**.

Examples:

- codebase
- database
- product structure
- customer state
- operational data

This is your source-of-truth layer.

## 5.2 Behavioral memory

How the agent **should behave**.

AnswerThis uses an editable instruction file.

Feedback from the non-technical co-founder can directly change the instruction set.

This is analogous to:

```text
policy
behavior
preferences
guardrails
quality expectations
```

## 5.3 Procedural memory

What the company **does repeatedly**.

Examples:

- close support ticket
- update CRM
- send follow-up
- check landing page
- perform recurring business operation

Procedural memory becomes tools/skills.

This gives you an excellent model for your architecture:

```text
FACTUAL MEMORY
    ↓
company state / source of truth

BEHAVIORAL MEMORY
    ↓
policies / instructions / preferences

PROCEDURAL MEMORY
    ↓
skills / tools / workflows
```

This maps extremely well onto the YC Company Brain concept.

---

# 6. GBrain — the closest public reference implementation

GBrain is particularly important because Tom Blomfield explicitly references Garry Tan's G-Brain in the YC RFS.

The open-source GBrain project describes itself as a persistent brain for AI agents.

Its architecture includes:

- persistent pages
- people and company entities
- typed relationships
- hybrid search
- graph traversal
- timeline structures
- backlinks
- deduplication
- enrichment
- contradiction/gap analysis
- autonomous scheduled maintenance
- skills written as Markdown
- agent-oriented operation

The repository describes automatic graph wiring on page writes, typed edges such as:

```text
attended
works_at
invested_in
founded
advises
```

It also emphasizes that vector search alone is insufficient.

### 6.1 GBrain's most important architectural insight

GBrain is not merely:

```text
documents → embeddings → vector search
```

It is closer to:

```text
documents
   ↓
typed entities
   ↓
typed relationships
   ↓
graph + timeline
   ↓
hybrid retrieval
   ↓
synthesis
   ↓
gap / contradiction detection
   ↓
agent skills
```

That is highly relevant to Company Brain.

### 6.2 Why the graph matters

A query such as:

> “Who works at Acme?”

may be answered by semantic search.

But:

> “Who at Acme worked with the founders on the Series A, has discussed our product, and was involved in a prior customer introduction?”

requires multi-hop relationships.

A graph can encode:

```text
Person
  ↓ works_at
Company
  ↓ involved_in
Project
  ↓ discussed_in
Meeting
  ↓ mentions
Product
```

This is why the Company Brain should probably use **graph + hybrid retrieval**, not vector RAG alone.

---

# 7. Glean analysis

Glean is the most important competitive reference because it has already built a large portion of the infrastructure that a horizontal Company Brain requires.

Glean currently positions itself around:

- enterprise search
- Enterprise Context
- Enterprise Graph
- enterprise memory
- agents
- 275+ connectors
- permissions-aware retrieval
- agent actions
- MCP / APIs
- personal graph
- enterprise graph

## 7.1 What Glean does extremely well

Glean's public architecture can be summarized as:

```text
Connectors
    ↓
Unified enterprise index
    ↓
Knowledge graph
    ↓
Permissions
    ↓
Personalization
    ↓
Search / Assistant
    ↓
Agents
    ↓
Enterprise memory
```

Glean describes its Enterprise Graph as connecting:

- people
- projects
- teams
- processes
- products
- content
- activity

This is already very close to the “living map” language in YC's RFS.

## 7.2 Glean's recent evolution is especially important

Glean is no longer positioning itself only as enterprise search.

It now describes:

**Enterprise Context = connectors + indexes + graphs + memory + actions**

Its enterprise memory learns from agent execution traces:

```text
agent task
   ↓
tool selected
   ↓
parameters
   ↓
sequence
   ↓
outcome
   ↓
evaluation
   ↓
learned tool-use heuristic
   ↓
future agent hint
```

This is extremely close to the recursive self-improvement loop in Tom's YC talk.

## 7.3 Glean vs YC Company Brain

Glean is therefore not “just the competitor to search.”

It is a substantial implementation of the infrastructure layer underneath Company Brain.

The strategic question for your product is not:

> “Can we build Glean search?”

You should not attempt to win that battle horizontally.

The question is:

> **Can we capture and structure operational knowledge that Glean cannot easily observe?**

That is where your live desktop capture becomes strategically interesting.

---

# 8. Glean vs your architecture

| Capability | Glean | Your current architecture | Company Brain target |
|---|---|---|---|
| Enterprise connectors | Excellent | Partial | Required |
| Permissions | Excellent | Early | Required |
| Search | Excellent | BM25 | Hybrid |
| Knowledge graph | Excellent | Not yet core | Required |
| Personal context | Strong | Strong desktop context | Useful |
| Live screen/process capture | Not its primary wedge | Strong | Major differentiator |
| Raw operational behavior | Limited by connected systems | Potentially strong | Major opportunity |
| Structured policies | Increasingly strong | Not yet | Required |
| Processes/workflows | Strong | Not yet | Required |
| Executable skills | Strong | Not yet | Required |
| Agent execution | Strong | Absent | Required |
| Agent memory | Strong and evolving | Early | Required |
| Feedback loop | Strong | Absent | Required |
| Self-improvement | Strong | Absent | Required |
| Desktop-native capture | Not core | Strong | Potential moat |

---

# 9. Littlebird analysis

The supplied Littlebird architecture is valuable primarily for the **capture layer**.

The architecture describes:

```text
Desktop / mobile
      ↓
Local capture
      ↓
Privacy filtering
      ↓
Text extraction
      ↓
Chunking
      ↓
Embeddings
      ↓
Encrypted upload
      ↓
Cloud semantic memory
      ↓
AI inference
      ↓
Third-party integrations
```

Its key design principles include:

- zero-setup context capture
- privacy by design
- local + cloud processing
- user-controlled data
- integrations as additive context

The local capture engine is especially relevant.

It uses:

- OS accessibility APIs
- active-window observation
- event-driven + periodic capture
- diff detection
- privacy exclusion
- semantic chunking
- local embeddings
- upload queues

This validates your current architecture choice.

---

# 10. What your uploaded Torvi architecture already gets right

Your current Torvi architecture has a surprisingly strong starting point.

The v0.5 architecture describes:

- Windows UIAutomation
- no screenshots for context capture
- structured foreground-window text extraction
- privacy filtering before storage
- SHA-256 deduplication
- SQLite context storage
- content-aware chunking
- BM25 retrieval
- context injection into prompts
- 24-hour retrieval freshness

This is explicitly documented in your architecture file. fileciteturn2file1L5-L35

The current architecture therefore already implements:

```text
Observe
  ↓
Filter
  ↓
Normalize
  ↓
Chunk
  ↓
Store
  ↓
Retrieve
  ↓
Generate
```

That is a legitimate foundation.

---

# 11. But Torvi is currently a context-aware assistant, not a Company Brain

Your uploaded gap analysis correctly identifies the distinction:

| Dimension | Current | Company Brain |
|---|---|---|
| Scope | Individual | Organization |
| Sources | Screen | Screen + APIs |
| Storage | Raw chunks | Structured knowledge |
| Output | AI answer | Executable skills |
| Agency | Assistance | Execution |
| Knowledge | Current screen context | Company operating knowledge |

Your existing analysis explicitly identifies the missing layers as:

- organizational architecture
- active connectors
- knowledge structuring
- hybrid retrieval
- skills
- agent runtime
- governance

fileciteturn2file2L31-L49

That assessment is directionally correct.

---

# 12. The biggest strategic opportunity

Do **not** position the product as:

> “Glean but cheaper.”

Do **not** position it as:

> “A better company chatbot.”

Do **not** position it as:

> “Rewind for teams.”

Instead:

> **A Company Brain that learns how work actually happens — including the work that never makes it into APIs — and compiles that knowledge into executable skills for AI agents.**

The differentiating pipeline becomes:

```text
                COMPANY BRAIN

      ┌─────────────────────────────┐
      │       SOURCE LAYER          │
      │                             │
      │ Slack / Gmail / CRM / Docs  │
      │ Tickets / DB / Meetings     │
      │ + LIVE DESKTOP WORK         │
      └──────────────┬──────────────┘
                     ↓
      ┌─────────────────────────────┐
      │     KNOWLEDGE DISTILLER     │
      │                             │
      │ facts / entities / policies │
      │ decisions / processes       │
      │ exceptions / relationships  │
      └──────────────┬──────────────┘
                     ↓
      ┌─────────────────────────────┐
      │       COMPANY GRAPH         │
      │                             │
      │ people / teams / customers  │
      │ products / processes        │
      │ policies / decisions        │
      │ sources / timelines         │
      └──────────────┬──────────────┘
                     ↓
      ┌─────────────────────────────┐
      │      SKILLS COMPILER        │
      │                             │
      │ trigger / conditions        │
      │ steps / branches            │
      │ permissions / approvals     │
      │ expected outputs            │
      └──────────────┬──────────────┘
                     ↓
      ┌─────────────────────────────┐
      │       AGENT RUNTIME         │
      │                             │
      │ tools / actions / planning  │
      │ approvals / retries         │
      │ audit / rollback            │
      └──────────────┬──────────────┘
                     ↓
      ┌─────────────────────────────┐
      │       LEARNING LOOP         │
      │                             │
      │ outcome / evaluator         │
      │ failures / feedback         │
      │ policy updates              │
      │ skill updates               │
      └─────────────────────────────┘
```

---

# 13. The most important architectural change: events, not chunks

Your current primary data object is a context chunk.

That is insufficient for a Company Brain.

Introduce an intermediate object:

```typescript
type KnowledgeEvent = {
  id: string
  workspaceId: string
  actorId: string

  sourceType:
    | "slack"
    | "gmail"
    | "zendesk"
    | "notion"
    | "screen"
    | "meeting"
    | "database"
    | "github"

  timestamp: string

  rawReference: string
  contentHash: string

  entities: EntityRef[]
  eventType:
    | "statement"
    | "decision"
    | "policy"
    | "action"
    | "exception"
    | "outcome"
    | "feedback"

  confidence: number
}
```

Then build knowledge entities from events.

---

# 14. Knowledge object model

A practical initial model:

```text
Workspace

Person
Team
Customer
Company
Product
Project

Source
Conversation
Meeting

Policy
Process
Decision
Exception
Runbook

Skill
Tool
Action
Outcome

KnowledgeEvent
```

Relationships:

```text
Person ──works_at──> Company
Person ──member_of──> Team
Person ──owns──> Process

Source ──supports──> Policy
Source ──contains──> Decision

Process ──governed_by──> Policy
Process ──has_exception──> Exception
Process ──compiled_to──> Skill

Skill ──uses──> Tool
Skill ──produces──> Action

Action ──produces──> Outcome
Outcome ──evaluated_by──> QualityGate

Outcome ──updates──> Skill
Outcome ──updates──> Policy
```

This is substantially more expressive than a vector database.

---

# 15. Skills should be first-class objects

A skill should not simply be an LLM prompt.

It should be executable, versioned and reviewable.

Example:

```yaml
id: refund_customer
version: 7

description: Handle standard customer refund requests.

trigger:
  event: refund_request

inputs:
  customer_id: string
  amount: number
  reason: string

preconditions:
  - customer_exists
  - no_chargeback
  - account_not_fraud_flagged

policy:
  reference: refund_policy

steps:
  - lookup_customer
  - validate_refund
  - calculate_refund_amount

branches:
  - if: amount <= 50
    then:
      - issue_refund

  - if: amount > 50
    then:
      - request_manager_approval

approval:
  required_for:
    - amount > 50

tools:
  - stripe
  - zendesk
  - slack

quality_gates:
  - refund_amount_matches_policy
  - ticket_updated
  - audit_record_created

on_failure:
  escalate_to: support_lead

provenance:
  sources:
    - slack:123
    - zendesk:456
    - policy:refund_policy_v3
```

The key is that **the skill contains both knowledge and execution constraints**.

---

# 16. Freshness and conflict resolution are core features

A Company Brain cannot assume the latest document is correct.

Consider:

```text
Slack:
Refunds under $50 → automatic

Notion:
Refunds under $25 → automatic

Support lead:
We changed this last month → $50
```

The brain needs to detect:

```text
CONFLICT

Policy: refund_auto_approval

Candidate A: <= $25
Candidate B: <= $50

Evidence:
- Notion: 90 days old
- Slack: 20 days old
- Support lead: 15 days old

Recommended current value:
<= $50

Confidence: 0.87
Human confirmation required
```

Every knowledge object should therefore have:

```text
created_at
updated_at
last_confirmed_at
effective_from
effective_until
source_count
confidence
status
supersedes
superseded_by
```

---

# 17. Provenance is non-negotiable

Every important piece of knowledge should be traceable.

For example:

```text
Skill: Refund under $50

Derived from:

✓ Slack #support — message 1938
✓ Zendesk ticket 8821
✓ Support training call — 2026-07-12
✓ Manual policy — refund-policy-v3

Last confirmed:
2026-08-21

Approved by:
Support Lead
```

This gives you:

- trust
- auditability
- debugging
- human review
- conflict resolution
- explainability

It also protects against hallucinated “company policies.”

---

# 18. Retrieval architecture

Do not replace BM25 with vector search.

Use a hybrid stack.

Recommended:

```text
                Query
                  ↓
        ┌─────────┴─────────┐
        ↓                   ↓
    BM25 / lexical       Embedding
        ↓                   ↓
        └─────────┬─────────┘
                  ↓
             Reranker
                  ↓
          Graph expansion
                  ↓
       Permission filtering
                  ↓
       Temporal filtering
                  ↓
       Source authority rank
                  ↓
       Knowledge synthesis
```

Retrieval should rank:

1. semantic relevance
2. lexical relevance
3. graph relationship
4. freshness
5. source authority
6. user/team permissions
7. historical reliability
8. execution success

That last factor is important.

If a particular policy/skill repeatedly produces successful outcomes, it should gain confidence.

---

# 19. Permissions must exist at retrieval time

This is one of the hardest parts of enterprise Company Brain.

Never:

```text
retrieve everything
    ↓
filter after LLM
```

Instead:

```text
user identity
     ↓
authorization policy
     ↓
candidate retrieval
     ↓
permission-aware ranking
     ↓
allowed context
     ↓
LLM
```

The graph itself should contain access metadata.

Example:

```text
KnowledgeEntity
 ├── workspace_id
 ├── visibility
 ├── source_acl
 ├── allowed_roles
 └── allowed_users
```

---

# 20. Privacy architecture

Your uploaded architecture currently has an important privacy advantage because screen context can be processed locally.

However, your earlier analysis correctly identifies a weakness:

```text
screen
 ↓
raw text
 ↓
cloud LLM
```

is problematic for company-scale confidential knowledge.

A stronger architecture is:

```text
Screen
 ↓
local privacy filter
 ↓
local classification
 ↓
local entity/fact extraction
 ↓
structured event
 ↓
encrypted sync
 ↓
Company Brain
```

The cloud should receive the minimum information necessary.

However, do not force every extraction step onto small local models from day one. For the MVP, benchmark quality and latency first.

A practical progression:

### Phase A
Local capture + privacy + encrypted raw event storage.

### Phase B
Local embeddings + semantic retrieval.

### Phase C
Structured extraction.

### Phase D
Selective raw-source access only for authorized synthesis.

### Phase E
Enterprise/on-premise inference option.

---

# 21. Your live desktop capture can be a genuine differentiator

This is the strongest part of your current architecture.

Glean has enormous advantages in:

- connectors
- enterprise graph
- permissions
- search
- agents
- enterprise scale

You cannot realistically beat Glean by rebuilding those horizontally.

But an API connector sees:

```text
Slack message
Gmail email
Zendesk ticket
Notion page
GitHub commit
```

It does not necessarily see the complete process a human follows while working across systems.

Your desktop capture can observe:

```text
Open Zendesk ticket
      ↓
Check Stripe
      ↓
Search Slack
      ↓
Ask manager
      ↓
Open internal admin
      ↓
Apply exception
      ↓
Update ticket
      ↓
Send customer response
```

That sequence is **procedural knowledge**.

This is potentially much more valuable for Company Brain than another search index.

---

# 22. Turn desktop capture into process mining

This should become a major product feature.

Instead of storing:

```text
User was looking at Zendesk.
```

infer:

```text
Process candidate:

Customer refund escalation

Observed sequence:
1. Zendesk ticket opened
2. Customer account checked
3. Stripe transaction inspected
4. Slack #support-leads searched
5. Refund policy consulted
6. Manager approval obtained
7. Refund issued
8. Ticket updated
9. Customer notified
```

Then aggregate many executions.

After 50 executions:

```text
Typical process:
1 → 2 → 3 → 5 → 7 → 8 → 9

Exception:
4 → manager approval

Fraud path:
3 → fraud check → escalation
```

This is how you move from screen capture to a living process graph.

---

# 23. Process mining should be your moat

Your strongest long-term data flywheel could be:

```text
More employees
      ↓
More observed workflows
      ↓
More process variants
      ↓
Better process extraction
      ↓
Better skills
      ↓
Better agents
      ↓
More successful automation
      ↓
More execution data
      ↓
Better skills
```

That is a genuine compounding loop.

It is more defensible than:

> “We use GPT + vector database.”

---

# 24. The Agent Runtime

Your current architecture lacks the execution layer.

You need:

```text
Agent
 ├── Planner
 ├── Knowledge Retriever
 ├── Skill Resolver
 ├── Tool Registry
 ├── Permission Engine
 ├── Approval Engine
 ├── Executor
 ├── Retry Manager
 ├── State Store
 ├── Quality Evaluator
 └── Audit Logger
```

A task:

```text
User:
"Handle this refund."

Agent:
1. identify applicable skill
2. retrieve policy
3. inspect customer
4. inspect transaction
5. evaluate conditions
6. determine authority
7. execute or request approval
8. update ticket
9. record outcome
10. evaluate result
11. update memory
```

---

# 25. Approval model

Do not make the agent fully autonomous initially.

Use risk tiers.

### Level 0 — Read only

Examples:

- search
- summarize
- classify
- inspect ticket

No approval.

### Level 1 — Low-risk write

Examples:

- add internal note
- update CRM field
- draft reply

Optional approval.

### Level 2 — External communication

Examples:

- send customer email
- send Slack message

Approval required initially.

### Level 3 — Financial / destructive

Examples:

- refund
- delete customer
- modify billing
- change production configuration

Human approval required.

This gives you a credible “safe execution” story for YC.

---

# 26. Self-improvement loop

This should be one of your core architectural modules.

```text
Agent executes skill
        ↓
Outcome recorded
        ↓
Evaluator
        ↓
Success?
  /       \
yes       no
 |         |
reinforce  diagnose
            ↓
      missing knowledge?
      wrong tool?
      stale policy?
      bad sequence?
      permission issue?
            ↓
      propose improvement
            ↓
      human approval
            ↓
      new skill version
```

The key rule:

**Agents should propose changes; humans approve high-impact changes.**

Never allow an agent to silently rewrite company policy.

---

# 27. Company Brain vs Glean vs GBrain vs Littlebird

## Glean

Best at:

- enterprise connectors
- enterprise graph
- permissions
- search
- agent platform
- enterprise memory
- horizontal deployment

Your opportunity:

- live desktop/process observation
- operational process mining
- undocumented edge cases
- turning observed workflows into skills
- vertical specialization

## GBrain

Best at:

- personal agent memory
- self-wiring graph
- typed relationships
- hybrid retrieval
- autonomous maintenance
- skill-oriented agent memory

Your opportunity:

- multi-employee organizational brain
- permissions
- enterprise source connectors
- workflow observation
- execution governance
- company processes

## Littlebird

Best at:

- continuous personal context
- desktop observation
- meetings
- local privacy
- cross-app context

Your opportunity:

- convert personal context into organizational process knowledge
- shared company graph
- skills
- agents
- operational automation

## AnswerThis

Best insight:

- factual memory
- behavioral memory
- procedural memory
- self-extending tools
- feedback-driven behavioral updates

Your opportunity:

- make these memories organizational rather than founder-specific
- connect them to observed workflows
- formalize them into governed skills

---

# 28. Recommended MVP

Do not build “Company Brain for every company.”

Pick one workflow category.

Your supplied roadmap recommends:

**B2B SaaS support / CX operations**

This is a strong wedge.

Example:

> **AI company brain for support teams that learns how refunds, pricing exceptions and escalations actually get handled.**

Start with:

### Sources

- Zendesk / Intercom
- Slack
- Gmail
- screen capture

### Knowledge

- policies
- processes
- decisions
- exceptions

### Skills

- refund
- pricing exception
- escalation

### Agent actions

- update ticket
- query customer
- query Stripe
- draft/send response
- ask manager for approval

### Dashboard

Show:

```text
Company Brain

Policies: 48
Processes: 31
Skills: 12
Conflicts: 4
Stale knowledge: 7
Observed workflows: 1,284
Automated executions: 318
Human approvals: 73
Success rate: 94.1%
```

That is a much stronger YC demo than generic company chat.

---

# 29. 90-day implementation plan

## Weeks 1–2 — Workspace foundation

Build:

- workspace
- users
- teams
- RBAC
- source ACL
- audit events

## Weeks 2–4 — Connector ingestion

Start with:

1. Slack
2. Gmail
3. Zendesk

Do not build ten connectors.

Build an excellent ingestion abstraction:

```text
Connector
 ├── authenticate()
 ├── backfill()
 ├── sync()
 ├── webhook()
 ├── normalize()
 └── permissions()
```

## Weeks 3–5 — Knowledge extraction

Create:

```text
Raw Event
 ↓
Entity Extractor
 ↓
Policy Extractor
 ↓
Decision Extractor
 ↓
Process Extractor
```

## Weeks 4–6 — Knowledge graph

Implement:

- entity tables
- relationship tables
- provenance
- timestamps
- versions
- confidence
- conflicts

Postgres + pgvector is a reasonable MVP.

You do not need a dedicated graph database initially.

## Weeks 5–7 — Hybrid retrieval

Implement:

- BM25
- embeddings
- reranking
- graph expansion
- permission filtering
- temporal filtering

## Weeks 6–8 — Skills

Create:

- skill schema
- compiler
- registry
- versioning
- provenance
- review UI

## Weeks 8–10 — One agent

Build one agent:

**Support Refund Agent**

Only three or four tools.

## Weeks 10–12 — Learning loop

Add:

- execution logs
- outcome evaluation
- failure classification
- feedback
- skill improvement suggestions
- human approval

---

# 30. What NOT to build yet

Avoid:

- 50 connectors
- mobile app
- generic consumer assistant
- interview assistant
- elaborate meeting assistant
- arbitrary autonomous agents
- fully autonomous policy modification
- complicated multi-agent orchestration
- custom vector database
- custom graph database
- enterprise compliance checklist before real usage

The first proof should be:

> **The system observed how the support team handled refunds, discovered the actual process and exceptions, compiled a skill, and successfully executed it.**

---

# 31. The core data architecture I recommend

```text
                    ┌───────────────┐
                    │   SOURCES     │
                    ├───────────────┤
                    │ Slack         │
                    │ Gmail         │
                    │ Zendesk       │
                    │ Screen        │
                    │ Meetings      │
                    │ DB            │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │ RAW EVENTS    │
                    └───────┬───────┘
                            ↓
              ┌─────────────┴─────────────┐
              ↓                           ↓
      ┌───────────────┐           ┌───────────────┐
      │ Vector Index  │           │ Event Store   │
      └───────────────┘           └───────┬───────┘
                                          ↓
                                  ┌───────────────┐
                                  │ KNOWLEDGE     │
                                  │ DISTILLER     │
                                  └───────┬───────┘
                                          ↓
                              ┌─────────────────────┐
                              │ COMPANY KNOWLEDGE   │
                              │ GRAPH               │
                              ├─────────────────────┤
                              │ entities            │
                              │ policies            │
                              │ decisions           │
                              │ processes           │
                              │ exceptions          │
                              │ sources             │
                              │ timelines           │
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ SKILL COMPILER      │
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ SKILL REGISTRY      │
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ AGENT RUNTIME       │
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ EXECUTION TRACE     │
                              └──────────┬──────────┘
                                         ↓
                              ┌─────────────────────┐
                              │ EVALUATION / LEARN  │
                              └──────────┬──────────┘
                                         │
                                         └──────→ update graph / skills
```

---

# 32. Recommended technical stack

For your existing Tauri/Rust foundation:

## Desktop

- Tauri 2
- Rust
- React
- TypeScript
- Windows UIAutomation
- macOS Accessibility API
- SQLite
- encrypted local cache

## Backend

- PostgreSQL
- pgvector
- Redis or equivalent queue
- object storage
- API service
- worker service

## Search

- PostgreSQL full-text / BM25
- pgvector
- reranker
- graph traversal in relational tables initially

## Knowledge graph

Do not introduce Neo4j immediately.

Use:

```text
entities
relationships
entity_versions
knowledge_events
sources
```

inside Postgres.

Move to a dedicated graph system only when query patterns justify it.

## Agent

Keep the first runtime deterministic:

```text
Planner
→ Skill Resolver
→ Permission Check
→ Tool Call
→ Observation
→ Quality Gate
→ Next Step
```

Avoid complicated multi-agent architecture initially.

---

# 33. Your moat

Your moat should not be the LLM.

It should be:

### 1. Workflow observation

You see what people actually do.

### 2. Organizational process graph

You understand relationships between people, systems, policies and workflows.

### 3. Skills generated from real behavior

Skills are based on observed execution, not only documentation.

### 4. Outcome feedback

Every execution improves the system.

### 5. Vertical process dataset

For example:

```text
10,000 refund workflows
50,000 exceptions
20,000 approval decisions
100,000 customer interactions
```

This creates increasingly valuable process intelligence.

---

# 34. The strongest product positioning

### Weak

> AI assistant that knows your company.

### Better

> AI that learns your company's processes.

### Strong

> Company Brain for support teams: learns how your team handles refunds, exceptions and escalations, then turns those workflows into executable AI skills.

### Strongest long-term framing

> **The operating memory for AI-native companies.**

The long-term product is not a chatbot.

It is:

```text
Company knowledge
       +
Company processes
       +
Company skills
       +
Company agents
       +
Company feedback loops
```

---

# 35. The YC demo I would build

The ideal demo should take 5–10 minutes.

### Step 1 — Connect Slack + Zendesk

Import several weeks of history.

### Step 2 — Turn on desktop observer

Let the system watch a support agent handle real tickets.

### Step 3 — Show discovered knowledge

Example:

```text
Discovered policy:
Refunds under $50 usually require no approval.

Discovered exception:
Chargeback risk requires manager review.

Discovered process:
Zendesk → Stripe → Slack → refund → ticket update.
```

### Step 4 — Show provenance

Click the policy.

Show:

- Slack
- tickets
- screen observations
- dates
- people
- confidence

### Step 5 — Compile skill

```text
refund_customer
v7
```

### Step 6 — Agent receives a real ticket

Agent determines:

```text
$42 refund
No chargeback
No fraud flag
Eligible
```

### Step 7 — Agent executes

- Stripe refund
- Zendesk update
- customer response

### Step 8 — Human approval

Only required if the amount or risk crosses a threshold.

### Step 9 — Show learning

The next time a similar ticket appears:

```text
Skill reused
→ faster execution
→ no manager ping
```

That is the Company Brain story.

---

# 36. Final strategic assessment

Your current architecture is **not wasted work**.

It is actually a potentially differentiated first layer.

Your uploaded Company Brain analysis correctly identifies that the existing architecture is currently a “personal brain” / context-aware layer and is approximately 2–3 major architectural leaps away from the organizational Company Brain target. fileciteturn2file2L65-L77

The critical shift is:

```text
CAPTURE
   ↓
CONTEXT
   ↓
KNOWLEDGE
   ↓
PROCESS
   ↓
SKILL
   ↓
ACTION
   ↓
OUTCOME
   ↓
LEARNING
   ↺
```

Not:

```text
CAPTURE
   ↓
RAG
   ↓
CHAT
```

The latter is an assistant.

The former is a **Company Brain**.

---

# 37. Research sources

## Primary

- Y Combinator — Requests for Startups, Company Brain
- Y Combinator / YC Root Access — How to Build a Self-Improving Company with AI
- Y Combinator / YC Root Access — How to Build an Internal AI Agent That Evolves Itself
- Y Combinator / Startup School Paris — Building And Structuring An AI Native Company
- Glean official product and technical materials
- Glean official Enterprise Graph / Enterprise Context materials
- Glean official autonomous-agent and enterprise-memory materials
- Garry Tan / GBrain GitHub repository

## User-provided architecture sources

- Littlebird-inspired architecture reference
- Torvi architecture document
- Company Brain gap-analysis document
- Torvi → YC-Aligned Company Brain Plan

---

# 38. Important source links

YC Company Brain:
https://www.ycombinator.com/rfs#company-brain

YC self-improving company talk:
https://www.youtube.com/watch?v=X_JsIHUfUjc

YC internal AI agent talk:
https://www.youtube.com/watch?v=DGD9b8K42lk

Glean comparison:
https://www.glean.com/compare

GBrain:
https://github.com/garrytan/gbrain

---

## Bottom line

**Build the brain before building the employee.**

The brain is:

- the durable company context,
- the graph of how things relate,
- the living policies,
- the observed processes,
- the versioned skills,
- the provenance,
- and the learned execution history.

The agent is merely the thing that uses it.

Your biggest architectural opportunity is to combine **Littlebird-style live context capture + GBrain-style persistent graph memory + Glean-style enterprise context/permissions + AnswerThis-style factual/behavioral/procedural memory + YC-style recursive execution loops**.

That combination is much more compelling than simply building another enterprise RAG product.
