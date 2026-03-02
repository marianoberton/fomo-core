# Nexus Core — Architecture Overview

## What Is Nexus Core?

Nexus Core is a self-hosted, model-agnostic autonomous agent framework built by Fomo, an AI automation consultancy based in Argentina. The platform powers multi-agent customer engagement setups where each business client gets one "Project" containing multiple specialized AI agents plus one manager/copilot agent. Agents communicate with end customers via WhatsApp, Telegram, and Slack, and with the business owner via a web dashboard.

**The product in one sentence:** Fomo sells configured multi-agent setups to businesses — each setup has customer-facing agents (sales, support), a manager agent that orchestrates them all, and a dashboard where the business owner (and the Fomo team) can monitor everything.

## Who Uses It?

- **Fomo team (internal):** Uses the Nexus Dashboard to configure and monitor agents for their clients. The dashboard is internal-only — it's NOT exposed to end clients.
- **Business clients (end users of the system):** Interact with the agents via WhatsApp, Telegram, etc. They don't see the dashboard.
- **Business owners (client contacts with "owner" role):** Can also chat with the manager/copilot agent via WhatsApp or the dashboard.

## Technology Stack

### Backend (Nexus Core)
- **Runtime:** Node.js 22 LTS, TypeScript in strict mode
- **Package manager:** pnpm
- **Web framework:** Fastify + @fastify/websocket (for real-time chat streaming)
- **Database:** PostgreSQL + Prisma 6 ORM + pgvector extension (for semantic search)
- **Job queue:** BullMQ + Redis (for scheduled tasks and proactive messaging)
- **Validation:** Zod (for all external inputs — API requests, tool inputs/outputs, configs)
- **Testing:** Vitest
- **Logging:** pino (structured JSON logging)

### Frontend (Dashboard)
- **Framework:** Next.js 16 with App Router
- **React:** React 19
- **Styling:** Tailwind CSS 4
- **Components:** shadcn/ui (28+ pre-built components)
- **Data fetching:** React Query (@tanstack/react-query)
- **Forms:** React Hook Form + Zod
- **Charts:** Recharts
- **Icons:** Lucide React
- **Toast notifications:** Sonner
- **Code editor:** Monaco Editor (for prompt editing)

### Infrastructure
- PostgreSQL 16 + pgvector (port 5433 in dev)
- Redis (port 6380 in dev)
- WAHA (WhatsApp Web Automation, optional Docker container)
- Nexus Core server (port 3002)
- Dashboard Next.js (port 3000-3001)

### Critical Rule: No AI Frameworks
LangChain, AutoGen, CrewAI, Semantic Kernel — all banned on the backend. The entire agent loop is hand-built. This gives full control over execution, cost, and security. The frontend has no restrictions — it uses any library that makes sense.

## How a Message Flows Through the System

Here's the complete lifecycle of a WhatsApp message from a customer:

```
1. Customer sends "Hola, quiero información del producto X" on WhatsApp

2. WAHA (WhatsApp Web Automation) receives the message via QR-linked session
   → Posts webhook to Nexus Core endpoint

3. Channel Adapter (WAHA adapter) parses the webhook payload
   → Extracts: sender phone, message text, media (if any)

4. Inbound Processor receives the normalized message
   → Looks up or creates Contact record (by phone number + project)
   → Looks up or creates Session record (active session for this contact)
   → Determines which Agent should handle this session
   → Resolves Agent Mode (public vs internal vs owner) based on contact.role + channel

5. Chat Setup (chat-setup.ts) prepares the execution:
   a. Loads Agent config from DB (tools, prompts, LLM settings, modes)
   b. Resolves active PromptLayers (identity, instructions, safety) from DB
   c. Retrieves relevant long-term memories from pgvector
   d. Builds the system prompt (5 layers: identity + instructions + tools + context + safety)
   e. Initializes LLM provider (resolves API key from env var)
   f. Creates MemoryManager (token counting, pruning, compaction)
   g. Creates CostGuard (budget check, rate limits)
   h. Loads conversation history from DB

6. Agent Runner (agent-runner.ts) executes the main loop:
   WHILE should_continue:
     a. Check max turns limit
     b. Pre-check cost guard (rate limits + daily/monthly budgets)
     c. Retrieve relevant long-term memories for the current query
     d. Fit conversation to context window (prune if needed)
     e. If pruning dropped messages → optionally compact via LLM summarization
     f. Format available tools for the LLM provider
     g. Call LLM (streaming via async generator)
     h. If LLM returns text → stream content deltas to client, break loop
     i. If LLM returns tool_use:
        - Validate tool exists (catch hallucinations)
        - Check RBAC (is this tool in agent's allowlist?)
        - Validate input with Zod schema
        - Check risk level (high/critical → require human approval)
        - If approval needed → pause, notify via Telegram, wait
        - Execute tool with ExecutionContext
        - Record tool result in trace
        - Add tool result to conversation, continue loop
     j. Record usage (tokens, cost) in trace + DB

7. Response is sent back through the channel:
   → Agent Runner returns ExecutionTrace with final response
   → Chat handler sends response via ChannelAdapter.send()
   → WAHA delivers the WhatsApp message to the customer

8. Post-execution:
   → Save messages to DB (user message + assistant response + tool calls)
   → Save ExecutionTrace to DB (full audit log)
   → Record UsageRecord (tokens, cost)
   → Auto-store notable tool results in long-term memory
```

## Directory Structure

```
src/
├── core/           # AgentRunner loop, types, errors, Result<T,E>
├── providers/      # LLM adapters (anthropic, openai, google, ollama)
├── tools/
│   ├── registry/   # ToolRegistry + RBAC enforcement
│   ├── definitions/# 28 tool implementations + index.ts
│   └── scaffold.ts # Code generation for new tools
├── memory/         # MemoryManager (4 layers + pgvector)
├── prompts/        # PromptBuilder + layer system
├── scheduling/     # BullMQ scheduled tasks
├── cost/           # CostGuard + usage tracking
├── security/       # ApprovalGate, InputSanitizer, RBAC
├── channels/       # Adapters: WAHA, Meta, Telegram, Slack, Chatwoot
├── agents/         # Agent registry + inter-agent communication
├── mcp/            # Model Context Protocol client + tool adapter
├── secrets/        # AES-256-GCM encrypted credential storage
├── files/          # File storage service
├── knowledge/      # Knowledge base + semantic search
├── contacts/       # Contact types
├── webhooks/       # Inbound webhook processing
├── api/            # REST + WebSocket routes (Fastify)
│   └── routes/     # 25+ route files
├── config/         # Configuration types and loading
├── observability/  # Logger (pino-based)
├── infrastructure/ # Database + repositories
├── verticals/      # Industry-specific logic (hotels, vehicles, wholesale)
├── templates/      # Pre-built agent templates
└── testing/        # Test fixtures and helpers
prisma/             # schema.prisma + migrations + seed.ts
dashboard/          # Git submodule — Next.js admin dashboard
```

## Key Subsystems at a Glance

### Agent Engine
The heart of the system. The `AgentRunner` implements a turn-based loop: call LLM → if it wants to use a tool → execute tool → feed result back → repeat until the LLM gives a text response. It integrates memory (4 layers), cost tracking, approval gates, and real-time streaming.

### Tool System
28 built-in tools that agents can use. Each tool has Zod schemas for input/output, risk levels (low/medium/high/critical), optional human approval gates, and both `execute()` (real) and `dryRun()` (validation-only) methods. Tools receive dependencies via factory injection — never from the LLM context.

### Memory System
4-layer architecture: (1) Context Window fitting, (2) Pruning old messages, (3) LLM-based compaction/summarization, (4) Long-term semantic search via pgvector embeddings with temporal decay.

### Channel System
Dynamic per-project channel adapters. Each project can have different WhatsApp numbers, Telegram bots, Slack workspaces. Adapters are created lazily from DB config + encrypted secrets. The `InboundProcessor` handles routing incoming messages to the right agent.

### Multi-Agent System
Each project can have N agents with different roles. The manager agent can delegate tasks to sub-agents via the `delegate-to-agent` tool, query their sessions, review their activity, and get operations summaries. Inter-agent communication is EventEmitter-based.

### MCP (Model Context Protocol)
Connect to external tool servers. Each MCP server exposes tools that get auto-discovered and registered in the ToolRegistry. Supports stdio (spawn subprocess) and SSE (HTTP long-polling) transports. Used for integrations like HubSpot CRM, Google Calendar, etc.

### Security
- **RBAC:** Every tool explicitly whitelisted per agent. No wildcard permissions.
- **Approval Gate:** High/critical risk tools pause for human review. Notifications via Telegram.
- **Input Sanitizer:** Max length, null bytes, prompt injection detection (8 patterns).
- **Secrets:** AES-256-GCM encrypted, injected at runtime, never in LLM context.

### Scheduling
BullMQ-based. Agent-proposed tasks require human approval before activation. Tasks run as one-shot agent invocations with their own budget and trace.

### Dashboard
29 pages covering: project management, agent configuration (wizard + detail), test chat (WebSocket), copilot/manager chat, inbox (WhatsApp Web-style), skills catalog, MCP server management, cost analytics, execution traces, approvals, scheduled tasks, contacts, knowledge base, files, webhooks, secrets, and more.

## Design Principles

1. **Type Safety First:** TypeScript strict mode, zero `any` types, branded ID types (ProjectId, SessionId, etc.), Zod validation for all boundaries.

2. **Dependency Injection via Factory Functions:** No classes. Every service is a factory function that receives its dependencies as an options object. This makes testing trivial.

3. **Result Type for Expected Failures:** Functions return `Result<T, E>` instead of throwing. Throws are reserved for truly unexpected errors. Error hierarchy uses `NexusError` as base class.

4. **Observability Built-In:** Every agent execution produces an `ExecutionTrace` with timestamped events (LLM calls, tool executions, memory retrievals, cost checks, errors). Full audit trail.

5. **Safety by Default:** Tools need explicit whitelisting. High-risk tools need human approval. No secrets in LLM context. No filesystem/shell access for agents.

6. **Immutable Prompt Versioning:** Prompt layers are never edited — new versions are created and activated. Previous versions retained for audit and A/B correlation via PromptSnapshot.

## Bootstrap Sequence (main.ts)

When the server starts:

1. Load environment variables (dotenv)
2. Connect to PostgreSQL, ensure pgvector extension
3. Initialize all repositories (project, session, agent, trace, etc.)
4. Create SecretService (AES-256-GCM encryption)
5. Create ChannelResolver (lazy adapter loading)
6. Create ApprovalGate (Prisma-backed)
7. Create ToolRegistry and register all 28 tools
8. Create MCPManager for external tool connections
9. Create TaskManager + TaskRunner (BullMQ)
10. Create FileService (local storage)
11. Create AgentRegistry (cached access with TTL)
12. Create SkillService (skill composition)
13. Optionally create long-term memory store (requires OpenAI API key for embeddings)
14. Optionally create knowledge service (requires embeddings)
15. Start Fastify server with CORS, Helmet, rate limiting, WebSocket
16. Register all API routes with dependency injection
17. Start listening on port 3002 (HOST=:: for Windows IPv6)

## Deployment Model

- **Development:** Docker Compose bundles PostgreSQL+pgvector, Redis, optional WAHA
- **Production:** Both shared (multi-project on one server) and dedicated (per-client Docker Compose)
- **Dashboard:** Deployed separately as a Next.js app, connects to Nexus Core API via `NEXT_PUBLIC_API_URL`

## Git Structure

The main repo (`fomo-core`) contains the backend. The dashboard is a git submodule at `dashboard/` pointing to a separate repo (`fomo-core-dashboard`). Changes to dashboard code are committed inside `dashboard/` and push to their own repo. The submodule pointer in the parent repo is updated separately.
