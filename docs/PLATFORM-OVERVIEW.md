# Nexus Core — Platform Overview

> Comprehensive capabilities reference for commercial strategy and AI-assisted decision-making.
> Current as of 2026-02-24.

---

## What Is Nexus Core?

Nexus Core is a **self-hosted, model-agnostic autonomous agent platform** for enterprise environments. It is the engine that powers Fomo's AI agent service.

Key characteristics:
- **Vanilla implementation** — no LangChain, AutoGen, CrewAI, or any AI orchestration framework. Fomo owns the entire agent loop, which means full control over behavior, cost, and security.
- **Model-agnostic** — same codebase supports Anthropic Claude, OpenAI GPT, Google Gemini, and local models via Ollama. Switching providers requires a config change, not a code change.
- **Self-hosted** — runs on any VPS or on-premises server via Docker Compose. Client data never leaves the client's infrastructure if desired.
- **Multi-client** — a single deployment can host multiple clients (projects), each with isolated agents, channels, budgets, and memory.
- **Production-ready** — PostgreSQL + pgvector, Redis + BullMQ, structured JSON logging, full observability traces, approval gates, cost guards.

---

## Commercial Model

- **Fomo** sells AI agent implementations to business clients.
- Each client gets a **Project** — an isolated environment with:
  - N specialized agents (sales, support, scheduling, etc.)
  - 1 manager agent (the owner's copilot)
  - Connected messaging channels (WhatsApp, Telegram, Slack)
  - Configured tools and integrations
- **Revenue model**: setup fee + monthly per-agent-active.
- Fomo configures and monitors everything from the **Nexus Dashboard** (internal tool). Clients don't touch the platform.
- A future product (`fomo-platform`) will expose a client-facing UI.

---

## Deployment Model

### Primary: Docker Compose

`docker compose up -d` brings up the full stack — zero manual configuration required.

| Service | Image | Internal Port | External Port | Purpose |
|---------|-------|--------------|---------------|---------|
| `postgres` | `pgvector/pgvector:pg16` | 5432 | 5433 | Database + vector store |
| `redis` | `redis:7-alpine` | 6379 | 6380 | Queue + cache |
| `app` | (built from repo) | 3002 | 3002 | Nexus Core API |
| `waha` | `devlikeapro/waha` | 3000 | 3003 | WhatsApp gateway |

The `waha` service runs automatically alongside the app. No separate installation needed for WhatsApp.

### Key Environment Variables

```env
DATABASE_URL=postgresql://nexus:nexus@postgres:5432/nexus_core
REDIS_URL=redis://redis:6379
PORT=3002
HOST=0.0.0.0
NODE_ENV=production

# LLM providers (add whichever you use)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...

# WAHA (auto-set in Docker Compose)
WAHA_DEFAULT_URL=http://waha:3000
WAHA_API_KEY=nexus

# Enables webhook auto-configuration for channels
NEXUS_PUBLIC_URL=https://your-domain.com
```

### Alternative: Bare-Metal VPS

For production deployments that don't use Docker: Node.js 22 LTS + PostgreSQL 14+ with pgvector + Redis + PM2. See [DEPLOYMENT.md](../DEPLOYMENT.md).

---

## Architecture Overview

```
User message (WhatsApp / Telegram / Slack)
    ↓
Channel Webhook → InboundProcessor
    ↓
AgentRunner ──────────────────────────────────────────────┐
    │                                                       │
    ├─ PromptBuilder (Identity + Instructions + Safety)    │
    ├─ LLM Provider (Anthropic / OpenAI / Google / Ollama) │
    ├─ ToolRegistry (RBAC + ApprovalGate)                  │
    ├─ MemoryManager (4 layers + pgvector)                 │
    ├─ CostGuard (budget enforcement)                      │
    └─ ExecutionTrace (full observability)                 │
                                                           │
Response → ChannelRouter → Channel Adapter → User         │
                                              ↑            │
Dashboard (Fomo team) ────────────────────────────────────┘
    Real-time: inbox, approvals, traces, costs
```

---

## Core Capabilities

### 1. Agent Loop

The `AgentRunner` is a fully autonomous multi-turn agent loop:

- **Tool calling**: structured JSON tool calls, executed by the ToolRegistry
- **Streaming**: response tokens streamed via WebSocket to the dashboard
- **Multi-turn**: conversation continues until task is complete or budget is exhausted
- **Max turns guard**: configurable per-agent turn limit prevents runaway loops
- **Error recovery**: tool errors are fed back to the LLM for self-correction

### 2. LLM Providers

All providers implement the same `LLMProvider` interface — swap providers by changing agent config.

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude 3 Haiku, Claude 3 Sonnet, Claude 3 Opus, Claude 3.5 Sonnet, Claude 4.x |
| **OpenAI** | GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo |
| **Google** | Gemini 1.5 Flash, Gemini 1.5 Pro, Gemini 2.0 |
| **Ollama** | Any locally hosted model (Llama 3, Mistral, etc.) |

Provider-level failover: configure a secondary provider per project. If the primary fails, the system automatically routes to the secondary.

### 3. Memory System

Four layers managed by `MemoryManager`:

| Layer | Description |
|-------|-------------|
| **Context Window** | Token budget tracking — fits messages within model's context limit |
| **Pruning** | Drops old tool results, preserves conversation head + tail |
| **Compaction** | LLM-summarized compression of long conversations, persisted to DB |
| **Long-term** | pgvector semantic search over all past conversations (`memory_entries` table) |

Long-term memory is per-project. The agent can recall relevant past conversations from weeks ago.

### 4. Prompt Layer System

System prompts are assembled from **3 independently versioned layers**:

| Layer | Purpose | Example |
|-------|---------|---------|
| **Identity** | Who the agent is, personality, role | "You are Sofía, the sales agent for Ferretería Del Norte..." |
| **Instructions** | Business rules, what to do | "Always check stock before quoting. For orders over $5k, escalate for approval." |
| **Safety** | Hard constraints, what NOT to do | "Never share pricing from competitors. Never promise delivery dates." |

- Each layer is versioned independently in the database
- Activating a new version auto-deactivates the previous one
- Previous versions remain — rollback = activate an old version
- Every execution trace stores which version of each layer was active (`PromptSnapshot`)

### 5. Multi-Agent System

Multiple agents can run within the same project:

- **Agent Registry**: each agent has its own ID, config, tool allowlist, and channel mapping
- **Manager agent**: acts as the owner's copilot — routes tasks to specialized agents, provides status overview
- **Agent-to-agent communication**: EventEmitter-based messaging between agents within a project
- **Inbox routing**: inbound messages are routed to the appropriate agent based on channel mapping
- **Operating modes**:
  - `customer-facing` — agent talks directly to end customers via channels
  - `internal` — agent is a background worker (scheduled tasks, data processing)
  - `copilot` — agent assists the Fomo team via the dashboard chat interface

### 6. Scheduled Tasks

Agents can run on a schedule using cron expressions (powered by BullMQ):

- **Static tasks**: created via API, start as `active`, run immediately on schedule
- **Agent-proposed tasks**: the agent uses `propose-scheduled-task` tool to request a recurring task; it starts as `proposed` and requires human approval in the dashboard before activating
- **Lifecycle**: active → paused → resumed → cancelled
- Task runs are logged with full execution traces
- BullMQ + Redis handles job scheduling, retry, and deduplication

### 7. Cost Tracking & Budget Enforcement

`CostGuard` wraps every LLM call:

- **Daily and monthly budgets** configurable per project
- **Circuit breaker**: stops all LLM calls if budget is exceeded
- **Rate limiting**: requests per minute and per hour per project
- **Usage records**: every call creates a `UsageRecord` with tokens, cost (USD), model, provider
- **Cost normalization**: pricing tables for all supported models, kept up to date
- Dashboard shows spend per agent, per day, with budget bars

### 8. Human-in-the-Loop (HITL) Approvals

The `ApprovalGate` pauses execution when a high-risk tool is called:

- Agent hits a `requiresApproval: true` tool → execution pauses
- Dashboard shows the pending approval: what the agent wants to do + context
- Fomo team (or in future, the client) reviews and approves or rejects
- Agent receives the approval decision and continues (or handles the rejection)
- Full approval history is persisted

### 9. Execution Traces

Every agent run creates a full `ExecutionTrace`:

- Every loop iteration: prompt snapshot, LLM response, tool calls, tool results
- Timing data (ms per step)
- Token counts per call
- Tool risk levels and approval outcomes
- Errors and retries
- Viewable in the dashboard traces page in real time

### 10. MCP Client

Nexus Core is an MCP (Model Context Protocol) client — agents can use tools from any MCP server:

- **Transports**: `stdio` (subprocess, for development) and `SSE/HTTP` (for production services)
- **Tool naming**: MCP tools appear as `mcp:<serverName>:<toolName>` in the tool registry
- **Auto-discovery**: connect an MCP server, all its tools become available to the agent
- **Use cases**: Google Calendar, GitHub, custom business APIs, Fomo Platform MCP (for cross-project orchestration)
- See [MCP_GUIDE.md](MCP_GUIDE.md) for configuration examples

### 11. Knowledge Base

Per-project knowledge base with semantic search:

- Upload documents or add text entries via dashboard
- Stored in `knowledge_entries` table with pgvector embeddings
- `knowledge-search` tool lets agents search the knowledge base semantically
- Use cases: product manuals, FAQs, company policies, pricing sheets

### 12. File Handling

- Upload files (PDF, images, documents) via dashboard or API
- `read-file` tool lets agents read uploaded files (PDF text extraction via `pdf-parse`)
- Local storage (Docker volume); S3 storage is a planned future upgrade
- Files are project-scoped and access-controlled

### 13. Webhooks (Inbound)

Any external event can trigger an agent:

- Create a webhook endpoint via dashboard → get a unique URL like `/api/v1/webhooks/:webhookId`
- Configure HMAC secret for payload verification
- Configure IP allowlist for additional security
- Write a Mustache-style trigger prompt: `"New lead received: {{name}} from {{company}}. Contact: {{email}}"`
- When the webhook fires, the payload fills the template and the agent receives it as a task

### 14. Secrets Management

Per-project encrypted credential storage:

- API keys, tokens, and credentials are stored encrypted in the database via `SecretService`
- Secrets are injected at runtime by the tool executor — never passed to the LLM context
- Managed from the dashboard Secrets page (create, delete; values never shown after creation)
- Channel credentials (WhatsApp tokens, Telegram bot tokens) are stored as secrets

---

## Messaging Channels

Channels are configured **per project** via the dashboard Integrations wizard. Credentials are stored encrypted via SecretService. No environment variables needed per channel.

| Channel | Mode | Status | Notes |
|---------|------|--------|-------|
| **WhatsApp (WAHA)** | QR-based | ✅ Production | Bundled in Docker Compose. User scans QR from dashboard. No Meta approval needed. |
| **WhatsApp (Meta Cloud API)** | Cloud | ✅ Production | For scale/enterprise. Requires Meta Business Account. |
| **Telegram** | Bot | ✅ Production | Create bot via BotFather → paste token in dashboard. |
| **Slack** | Events API | ✅ Production | Create Slack app → paste bot token in dashboard. |
| **Chatwoot** | Live chat | ✅ Production | Self-hosted customer support platform integration. |

### Channel Features

- **Inbound**: receive text messages, images (WhatsApp), threads (Slack)
- **Outbound (proactive)**: agent can send messages without user initiating — via `send-channel-message` tool or scheduled tasks
- **Session management**: each unique contact gets a persistent session; conversation history maintained across messages
- **Contact management**: contacts are stored per-project with channel identifiers (phone, Telegram ID, Slack user ID)
- **Webhook auto-config**: if `NEXUS_PUBLIC_URL` is set, webhook URLs are auto-registered with Telegram and WAHA during channel setup

---

## Built-in Tools (22 tools)

Tools are explicitly whitelisted per agent — no wildcard permissions. Every tool has a `riskLevel` (`low` / `medium` / `high` / `critical`) and optionally `requiresApproval: true`.

### General Purpose

| Tool | Description | Risk |
|------|-------------|------|
| `calculator` | Evaluate mathematical expressions | Low |
| `date-time` | Get current date, time, and timezone info | Low |
| `json-transform` | Transform and reshape JSON data | Low |
| `http-request` | Make HTTP GET/POST/PUT/DELETE requests to external APIs | Medium |
| `web-search` | Search the web via Brave Search API | Low |
| `read-file` | Read uploaded files (PDF text extraction, plain text) | Low |
| `knowledge-search` | Semantic search over project knowledge base | Low |
| `send-notification` | Send an internal notification | Low |

### Communication

| Tool | Description | Risk |
|------|-------------|------|
| `send-email` | Send email via configured SMTP or API | Medium |
| `send-channel-message` | Send a proactive message via WhatsApp, Telegram, or Slack | Medium |
| `escalate-to-human` | Pause execution and ask a human for approval/input. Always requires approval. | Critical |

### Scheduling

| Tool | Description | Risk |
|------|-------------|------|
| `propose-scheduled-task` | Propose a new recurring scheduled task (cron). Starts as `proposed` — requires human activation. | Low |

### Business Intelligence (Shared Memory / Internal Agents)

| Tool | Description | Risk |
|------|-------------|------|
| `query-sessions` | Query past sessions across the project | Low |
| `read-session-history` | Read the full history of a specific session | Low |

### Commerce

| Tool | Description | Risk |
|------|-------------|------|
| `catalog-search` | Search the project's product catalog | Low |
| `catalog-order` | Place an order from the product catalog | High |

### Vertical — Vehicle Dealership

| Tool | Description | Risk |
|------|-------------|------|
| `vehicle-lead-score` | Score an inbound vehicle inquiry based on configured criteria | Low |
| `vehicle-check-followup` | Check if a lead needs a follow-up and return follow-up context | Low |

### Vertical — Wholesale / Hardware Store

| Tool | Description | Risk |
|------|-------------|------|
| `wholesale-update-stock` | Update stock levels for wholesale products | High |
| `wholesale-order-history` | Retrieve order history for a wholesale customer | Low |

### Vertical — Hotel

| Tool | Description | Risk |
|------|-------------|------|
| `hotel-detect-language` | Detect guest language from message to route to correct agent | Low |
| `hotel-seasonal-pricing` | Retrieve seasonal pricing rules for hotel rooms | Low |

---

## Security Model

Security is enforced in code, never in prompts. The LLM is explicitly treated as an untrusted actor.

| Layer | Mechanism |
|-------|-----------|
| **Tool access control** | `ToolRegistry` checks `allowedTools` whitelist per agent before any execution |
| **Approval gates** | `ApprovalGate` intercepts `requiresApproval: true` tools — execution halts until human approves |
| **Input sanitization** | `InputSanitizer` scrubs user input before entering the agent loop |
| **Secret injection** | Credentials are injected at runtime by the tool executor; never in LLM context |
| **No shell access** | Agents cannot run shell commands. Period. |
| **No filesystem access** | Agents cannot read/write host filesystem (only uploaded files via the file service) |
| **No wildcard permissions** | Every tool must be explicitly listed in `allowedTools` per agent |
| **RBAC** | Role-based access control enforced at the ToolRegistry level in TypeScript |

---

## Dashboard (Admin UI)

The Nexus Dashboard is an **internal tool for the Fomo team**. It is a Next.js app (separate git repo, mounted as submodule at `dashboard/`). It communicates with the Nexus Core API on port 3002.

**Runs at**: `http://localhost:3000` (development)

### Pages (27+ routes)

| Section | What You Can Do |
|---------|----------------|
| **Projects** | Create and manage client projects |
| **Agents** | Create agents, configure provider/model, set tool allowlist, assign channels, edit prompt layers, set operating mode |
| **Test Chat** | Send messages to any agent directly from the browser — tests the full loop in real time |
| **Integrations** | Add channels via wizard (WhatsApp QR scan, Telegram token, Slack token) |
| **Inbox** | WhatsApp Web-style conversation view — real-time, all channels in one place |
| **Approvals** | Review and approve/reject pending tool calls from agents |
| **Costs** | Per-agent spend visualization, daily/monthly breakdown, budget remaining |
| **Traces** | Full execution timeline for any agent run — prompts, tool calls, LLM responses |
| **Prompts** | Edit Identity/Instructions/Safety prompt layers, activate versions, view history |
| **Knowledge** | Add/edit knowledge base entries for semantic search |
| **Files** | Upload and manage project files (PDFs, documents) |
| **Tasks** | View/create scheduled tasks; approve agent-proposed tasks |
| **Webhooks** | Create webhook endpoints with Mustache trigger templates |
| **Secrets** | Add/delete encrypted project credentials |
| **MCP Servers** | Add MCP server instances (connect external tools) |
| **Contacts** | View and manage project contacts with channel identifiers |
| **Catalog** | Upload and manage product catalogs |
| **Sessions** | View conversation sessions per project |

---

## Current State (as of 2026-02-24)

### What Works End-to-End

- ✅ Full agent loop (tool calling, streaming, multi-turn) — verified with OpenAI GPT-4o-mini
- ✅ WhatsApp via WAHA (Docker bundled, QR scan, send/receive)
- ✅ WhatsApp via Meta Cloud API
- ✅ Telegram (bot token, webhook, send/receive)
- ✅ Slack (Events API, send/receive, thread replies)
- ✅ Chatwoot integration
- ✅ Multi-agent with manager agent
- ✅ Approval flow (agent proposes → dashboard shows → team approves → agent continues)
- ✅ Real-time inbox in dashboard
- ✅ Cost tracking and budget enforcement
- ✅ Execution traces with full observability
- ✅ MCP client (stdio + SSE transports)
- ✅ Scheduled tasks (cron via BullMQ)
- ✅ Prompt layer versioning and rollback
- ✅ Knowledge base with semantic search (pgvector)
- ✅ File upload and read (PDF extraction)
- ✅ Secrets management (encrypted storage)
- ✅ Webhooks (inbound, HMAC, Mustache templates)
- ✅ 1235+ tests passing, 0 TypeScript errors

### Seeded Demo Projects

Five demo projects are included in `pnpm db:seed`:

| Project | Vertical | Agents |
|---------|----------|--------|
| Demo | General | Demo agent |
| Ferretería Del Norte | Hardware/Wholesale | Sales agent, Manager |
| Concesionaria Motors | Vehicle Dealership | Lead scoring, Follow-up |
| Hotel Boutique | Hospitality | Multilingual concierge |
| Fomo Assistant | Internal | Fomo team copilot |

---

## Typical Client Setup: Ferretería Del Norte

To illustrate how Nexus Core is configured for a real client:

**Client**: A wholesale hardware store in Argentina.

**Setup**:
1. Project: `ferreteria-del-norte`
2. Agents:
   - `ventas` (sales) — handles product queries, price checks, stock verification. Tools: `catalog-search`, `knowledge-search`, `send-channel-message`, `catalog-order` (requires approval for orders > $50k ARS)
   - `gerente` (manager) — owner's copilot. Tools: `query-sessions`, `read-session-history`, `wholesale-update-stock`, `wholesale-order-history`, `escalate-to-human`. Mode: `copilot`
3. Channel: WhatsApp via WAHA (QR scan, customers contact on existing number)
4. Prompt Identity for `ventas`: "You are Rodrigo, the sales representative of Ferretería Del Norte. You speak informally (tuteo). You help clients find the right products and check stock."
5. Safety layer: "Never promise delivery dates unless stock is confirmed. Never discuss competitor pricing."
6. Approval rule: `catalog-order` is `riskLevel: high, requiresApproval: true` — every order over a threshold halts for manager approval
7. Scheduled task: every Monday 9am, `gerente` generates a weekly sales summary and sends it to the owner via Telegram

**Cost**: ~$30-50 USD/month at current GPT-4o-mini pricing for a typical SME volume.

---

## What Is Not Yet Built

| Feature | Status | Notes |
|---------|--------|-------|
| Client-facing UI (`fomo-platform`) | Not started | Clients manage their own agents. Roadmap item. |
| S3 file storage | Not built | Files are stored locally. S3 adapter is designed but not implemented. |
| Workflow state machines | Not built | Designed in PLATFORM-ROADMAP archive. Will enable multi-step structured workflows. |
| Audio/video message processing | Partial | WhatsApp audio/video messages received but not transcribed or processed. |
| WhatsApp Template messages | Not built | Required for business-initiated conversations on Meta Cloud API. |
| Multi-language UI | Not built | Dashboard is English-only. |
| SSO / multi-user auth | Not built | Dashboard uses a single API key. |
| Fine-tuning integration | Not planned | Out of scope; model-agnostic approach preferred. |

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js v22 LTS |
| Language | TypeScript (strict mode, zero `any`) |
| HTTP Framework | Fastify + @fastify/websocket |
| Database | PostgreSQL 16 + Prisma ORM |
| Vector Store | pgvector (via Prisma `$queryRaw`) |
| Queue / Scheduling | BullMQ + Redis |
| Validation | Zod (all external inputs) |
| Testing | Vitest (1235+ tests) |
| Logging | pino (structured JSON) |
| Package Manager | pnpm |
| Dashboard | Next.js + TypeScript + Tailwind + shadcn/ui |

---

## Repository Structure

```
fomo-core/
├── src/
│   ├── core/           # AgentRunner, agent loop, types, result, errors
│   ├── providers/      # LLM adapters (Anthropic, OpenAI, Google, Ollama)
│   ├── tools/          # Tool system (registry, 22 definitions)
│   ├── memory/         # MemoryManager (4 layers)
│   ├── prompts/        # PromptBuilder + layer system
│   ├── scheduling/     # BullMQ scheduled tasks
│   ├── cost/           # CostGuard + usage tracking
│   ├── security/       # ApprovalGate, InputSanitizer, RBAC
│   ├── channels/       # Channel adapters (WAHA, Meta, Telegram, Slack, Chatwoot)
│   ├── webhooks/       # Inbound webhook processor
│   ├── mcp/            # MCP client + tool adapter
│   ├── agents/         # Agent registry + inter-agent comms
│   ├── memory/         # Memory manager
│   ├── files/          # File storage service
│   ├── knowledge/      # Knowledge base service
│   ├── secrets/        # Encrypted secret storage
│   ├── observability/  # Structured logging
│   └── api/            # REST + WebSocket routes (Fastify)
├── prisma/             # Schema + migrations + seed data
├── dashboard/          # Git submodule → Next.js admin dashboard
├── docker-compose.yml  # Full stack: Nexus + PostgreSQL + Redis + WAHA
├── docs/               # Technical documentation
└── CLAUDE.md           # Authoritative platform spec (for AI coders)
```

---

## Further Reading

- [QUICKSTART.md](QUICKSTART.md) — Get a full stack running in 5 minutes
- [DASHBOARD.md](DASHBOARD.md) — Full guide to the admin dashboard
- [WAHA_SETUP.md](WAHA_SETUP.md) — WhatsApp WAHA setup (QR-based, Docker bundled)
- [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md) — Telegram bot setup
- [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md) — WhatsApp channels (WAHA + Meta Cloud API)
- [SLACK_SETUP.md](SLACK_SETUP.md) — Slack integration setup
- [MCP_GUIDE.md](MCP_GUIDE.md) — MCP server integration guide
- [MODEL-MAINTENANCE.md](MODEL-MAINTENANCE.md) — Adding and maintaining LLM models
- [../DEPLOYMENT.md](../DEPLOYMENT.md) — VPS and Docker deployment guide
- [../CLAUDE.md](../CLAUDE.md) — Authoritative platform spec (coding standards, architecture)
