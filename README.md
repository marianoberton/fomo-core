# Nexus Core

**Model-agnostic, self-hosted autonomous agent framework for enterprise environments.**

Built by [Fomo](https://fomo.ai) — AI automation consultancy. The engine is reusable: each client gets a configured instance (different tools, permissions, prompts) but the core is always Nexus.

![Node.js 22](https://img.shields.io/badge/Node.js-22_LTS-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+pgvector-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)
![License](https://img.shields.io/badge/License-Proprietary-red)

---

## Table of Contents

- [What is Nexus Core?](#what-is-nexus-core)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Core Systems](#core-systems)
  - [Agent Runner](#1-agent-runner)
  - [LLM Providers](#2-llm-providers)
  - [Tool System](#3-tool-system)
  - [Memory System](#4-memory-system)
  - [Prompt Layer System](#5-prompt-layer-system)
  - [Security](#6-security)
  - [Cost Control](#7-cost-control)
  - [Scheduled Tasks](#8-scheduled-tasks)
  - [Channel System](#9-channel-system)
  - [MCP Client Integration](#10-mcp-client-integration)
  - [Multi-Agent System](#11-multi-agent-system)
  - [Webhooks](#12-webhooks)
  - [File System](#13-file-system)
  - [Contacts](#14-contacts)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Development](#development)
- [Security Model](#security-model)
- [Extension Points](#extension-points)
- [Critical Rules](#critical-rules)

---

## What is Nexus Core?

Nexus Core is a **complete autonomous agent engine** — it owns the full execution loop from user message to final response, with no dependency on AI orchestration frameworks (LangChain, AutoGen, CrewAI are explicitly prohibited).

### Key Capabilities

- **Model-agnostic**: Swap between Anthropic Claude, OpenAI GPT, Google Gemini, or local Ollama models via configuration. 100+ models registered with pricing and context window metadata.
- **Tool execution with RBAC**: 7 built-in tools + unlimited custom tools + MCP server integration. Per-project tool whitelists enforced at the code level (never via prompts).
- **Human-in-the-loop**: High/critical-risk tools pause execution until a human approves or rejects. Approval requests have expiration and audit trails.
- **4-layer memory**: Context window management, turn pruning, LLM-summarized compaction, and pgvector semantic search for long-term recall.
- **Immutable prompt versioning**: 3 independent prompt layers (identity, instructions, safety) — each versioned separately, never mutated. Rollback by activating a previous version.
- **Multi-channel**: Telegram, WhatsApp, Slack adapters with inbound message routing, contact management, and proactive outbound messaging.
- **Scheduled automation**: BullMQ-powered cron tasks. Agents can propose recurring tasks; humans approve before activation.
- **Cost control**: Per-project daily/monthly budgets, rate limits (RPM/RPH), per-turn token limits. Every LLM call is tracked with normalized USD costs.
- **Full observability**: Every agent run produces an `ExecutionTrace` with a timeline of events (LLM calls, tool executions, approvals, memory operations, failovers).
- **Multi-agent**: Agent registry with caching, inter-agent messaging via EventEmitter, per-agent configuration (tools, channels, limits).

### How It's Used

Fomo deploys one Nexus Core instance per client. Each client gets:
- A **Project** with its own `AgentConfig` (provider, tools, budgets, memory settings)
- Custom **prompt layers** defining the agent's persona, business rules, and safety boundaries
- Whitelisted **tools** (built-in + custom + MCP)
- **Channel adapters** for their communication platforms
- **Webhooks** for triggering agent runs from external systems

---

## Architecture Overview

```
                                    ┌─────────────────────────┐
                                    │      LLM Providers      │
                                    │  (Anthropic, OpenAI,    │
                                    │   Google, Ollama)       │
                                    └────────────▲────────────┘
                                                 │
┌──────────┐    ┌──────────┐    ┌────────────────┴────────────────┐
│  Client   │───▶  Fastify  │───▶       Agent Runner (Loop)       │
│ (REST/WS) │◀──│  API      │◀──│                                 │
└──────────┘    │ /api/v1   │   │  1. Build prompt (3 layers +    │
                └──────────┘   │     tools + memories)           │
                     │          │  2. Call LLM (stream tokens)    │
┌──────────┐         │          │  3. Parse tool calls            │
│ Channels │─────────┤          │  4. Execute tools (RBAC +       │
│ TG/WA/SL │         │          │     approval gate)              │
└──────────┘         │          │  5. Add results to context      │
                     │          │  6. Repeat until done or budget  │
┌──────────┐         │          │     exhausted                   │
│ Webhooks │─────────┤          └──────┬──────────┬───────────────┘
│ (Custom) │         │                 │          │
└──────────┘         │          ┌──────▼──┐ ┌────▼─────┐
                     │          │  Tools  │ │  Memory  │
┌──────────┐         │          │Registry │ │ Manager  │
│Scheduler │─────────┘          │ + RBAC  │ │ 4 layers │
│ (BullMQ) │                    └────┬────┘ └────┬─────┘
└──────────┘                         │           │
                               ┌─────▼───┐ ┌────▼──────┐
                               │ MCP     │ │ pgvector  │
                               │ Servers │ │ (1536-dim)│
                               └─────────┘ └───────────┘
```

### The Agent Loop

The `AgentRunner` is the central orchestrator. For each user message:

1. **Pre-check**: CostGuard verifies budgets and rate limits
2. **Memory retrieval**: Semantic search over long-term memory (pgvector)
3. **Prompt assembly**: PromptBuilder combines identity + instructions + safety layers with tool descriptions and retrieved memories
4. **LLM call**: Streaming via the configured provider (with automatic failover)
5. **Tool execution**: Parse tool calls → validate RBAC → check approval gate → execute → return results
6. **Loop**: Feed tool results back to LLM; repeat until `end_turn` or limits reached
7. **Trace**: Persist full `ExecutionTrace` with events timeline and `PromptSnapshot`

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Composition over inheritance** | Factory functions returning interfaces, not class hierarchies |
| **Dependency injection** | All services receive deps as constructor params (options objects) |
| **Explicit error handling** | `Result<T, E>` pattern — no throw-based control flow in agent loop |
| **Branded types** | `ProjectId`, `SessionId`, `TraceId` etc. prevent cross-type assignment |
| **Immutability** | Prompt layers versioned, trace events append-only, configs treated as snapshots |
| **Security in code** | RBAC enforced at ToolRegistry level, never in prompts |
| **Named exports only** | No default exports anywhere in the codebase |
| **Zod everywhere** | All external inputs validated with runtime schemas |

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 22 LTS | JavaScript runtime |
| Language | TypeScript | 5.7 | Strict mode, no `any`, `verbatimModuleSyntax` |
| HTTP | Fastify | 5.3 | REST API + WebSocket server |
| Database | PostgreSQL | 16 | Primary data store |
| Vector Store | pgvector | - | 1536-dim embeddings for semantic search |
| ORM | Prisma | 6.6 | Schema, migrations, type-safe queries |
| Queue | BullMQ | 5.67 | Scheduled tasks, async job processing |
| Cache/Queue Backend | Redis | 7 | BullMQ backend + proactive messaging |
| Validation | Zod | 3.24 | All input/output schemas |
| LLM (Anthropic) | @anthropic-ai/sdk | 0.73 | Claude models |
| LLM (OpenAI) | openai | 6.18 | GPT/o1 models + Google/Ollama via compatible API |
| MCP | @modelcontextprotocol/sdk | 1.26 | External tool server integration |
| Logging | pino | 9.6 | Structured JSON logging |
| Testing | Vitest | 3.0 | Unit + integration + E2E tests |
| Linting | ESLint | 9.20 | Strict TypeScript rules (`strictTypeChecked`) |
| Formatting | Prettier | 3.5 | Code style enforcement |
| Package Manager | pnpm | 9+ | Fast, disk-efficient package management |
| IDs | nanoid | 5.1 | URL-safe unique ID generation |

---

## Quick Start

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0
- **Docker** (for PostgreSQL + Redis)

### Setup

```bash
# Clone
git clone https://github.com/marianoberton/fomo-core.git
cd fomo-core

# Install dependencies
pnpm install

# Start infrastructure (PostgreSQL + pgvector on 5433, Redis on 6380)
docker compose up -d

# Create .env file
cp .env.example .env
# Edit .env with your API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)

# Run database migrations
pnpm db:migrate

# Generate Prisma client
pnpm db:generate

# Seed development data
pnpm db:seed

# Start development server (port 3002)
pnpm dev
```

### Verify

```bash
# Health check (root level, no prefix)
curl http://localhost:3002/health
# → { "status": "ok", "timestamp": "..." }

# List projects (API prefix)
curl http://localhost:3002/api/v1/projects
# → { "success": true, "data": { "items": [...], "total": 1, ... } }
```

---

## Project Structure

```
fomo-core/
├── prisma/
│   ├── schema.prisma              # 14 database models
│   ├── seed.ts                    # Development seed data
│   └── migrations/                # Migration history
├── src/
│   ├── main.ts                    # Server bootstrap (Fastify + all plugins)
│   ├── agents/                    # Multi-agent: registry, comms, types
│   ├── api/                       # REST + WebSocket endpoints
│   │   ├── error-handler.ts       # Global error handling + response envelope
│   │   ├── pagination.ts          # Pagination helper + Zod schema
│   │   ├── types.ts               # RouteDependencies, ApiResponse, ChatRequest
│   │   └── routes/                # 17 route modules
│   │       ├── index.ts           # Route registration
│   │       ├── projects.ts        # CRUD + pause/resume
│   │       ├── sessions.ts        # Session management
│   │       ├── chat.ts            # Synchronous agent execution
│   │       ├── chat-stream.ts     # WebSocket streaming
│   │       ├── chat-setup.ts      # Shared preparation (provider, memory, prompts)
│   │       ├── prompt-layers.ts   # Immutable layer versioning
│   │       ├── traces.ts          # Execution trace queries
│   │       ├── approvals.ts       # Human approval workflow
│   │       ├── tools.ts           # Tool listing + dry-run
│   │       ├── scheduled-tasks.ts # Task CRUD + lifecycle
│   │       ├── contacts.ts        # Contact management
│   │       ├── webhooks.ts        # Channel webhooks (TG/WA/Slack)
│   │       ├── webhooks-generic.ts# Custom trigger webhooks
│   │       ├── files.ts           # Upload/download/metadata
│   │       ├── agents.ts          # Multi-agent CRUD + messaging
│   │       ├── dashboard.ts       # Overview aggregation
│   │       ├── usage.ts           # Cost/token metrics
│   │       └── ws-dashboard.ts    # Dashboard WebSocket adapter
│   ├── channels/                  # Multi-channel communication
│   │   ├── channel-router.ts      # Route messages to adapters
│   │   ├── inbound-processor.ts   # Webhook → contact → session → agent → reply
│   │   ├── proactive.ts           # Outbound scheduled messages (BullMQ)
│   │   └── adapters/              # Telegram, WhatsApp, Slack
│   ├── cli/                       # Interactive chat CLI for testing
│   ├── config/                    # AgentConfig types, Zod schema, loader
│   ├── contacts/                  # Contact types + channel identifiers
│   ├── core/                      # The engine
│   │   ├── agent-runner.ts        # Central execution loop
│   │   ├── types.ts               # AgentConfig, ExecutionContext, ExecutionTrace, etc.
│   │   ├── errors.ts              # NexusError hierarchy (12 error types)
│   │   ├── result.ts              # Result<T, E> pattern
│   │   └── stream-events.ts       # Real-time client events
│   ├── cost/                      # Budget enforcement
│   │   ├── cost-guard.ts          # Pre-check + record usage
│   │   └── prisma-usage-store.ts  # DB-backed usage tracking
│   ├── files/                     # File storage
│   │   ├── types.ts               # StoredFile, FileStorage, FileService interfaces
│   │   ├── storage-local.ts       # Local filesystem backend
│   │   └── file-service.ts        # Storage + DB metadata combined
│   ├── infrastructure/            # Data access layer
│   │   ├── database.ts            # Prisma singleton + lifecycle
│   │   └── repositories/          # 9 Prisma-backed repositories
│   │       ├── project-repository.ts
│   │       ├── session-repository.ts
│   │       ├── prompt-layer-repository.ts
│   │       ├── execution-trace-repository.ts
│   │       ├── scheduled-task-repository.ts
│   │       ├── contact-repository.ts
│   │       ├── webhook-repository.ts
│   │       ├── file-repository.ts
│   │       └── agent-repository.ts
│   ├── mcp/                       # Model Context Protocol client
│   │   ├── types.ts               # MCPServerConfig, MCPConnection
│   │   ├── errors.ts              # MCPConnectionError, MCPToolExecutionError
│   │   ├── mcp-client.ts          # SDK wrapper (stdio/SSE transport)
│   │   ├── mcp-manager.ts         # Multi-server connection manager
│   │   └── mcp-tool-adapter.ts    # Wrap MCP tools as ExecutableTool
│   ├── memory/                    # 4-layer memory architecture
│   │   ├── memory-manager.ts      # Context window, pruning, compaction, long-term
│   │   └── prisma-memory-store.ts # pgvector-backed long-term store
│   ├── observability/             # Structured logging
│   │   └── logger.ts              # pino wrapper with redaction
│   ├── prompts/                   # Prompt assembly system
│   │   ├── types.ts               # PromptLayer, PromptSnapshot, PromptBuildParams
│   │   ├── prompt-builder.ts      # 5-section system prompt assembly
│   │   └── layer-manager.ts       # Resolve active layers, create snapshots
│   ├── providers/                 # LLM provider adapters
│   │   ├── types.ts               # LLMProvider, ChatParams, ChatEvent, Message
│   │   ├── factory.ts             # createProvider() from config
│   │   ├── models.ts              # 100+ model registry with pricing
│   │   ├── anthropic.ts           # Claude adapter
│   │   └── openai.ts              # GPT/Gemini/Ollama adapter
│   ├── scheduling/                # Cron-based task automation
│   │   ├── types.ts               # ScheduledTask, ScheduledTaskRun
│   │   ├── task-manager.ts        # Business logic (propose, approve, pause)
│   │   ├── task-runner.ts         # BullMQ queue + worker + scheduler
│   │   └── task-executor.ts       # Bridge to AgentRunner
│   ├── security/                  # Access control
│   │   ├── approval-gate.ts       # Human-in-the-loop for high-risk tools
│   │   ├── prisma-approval-store.ts # DB-backed approval storage
│   │   └── input-sanitizer.ts     # Injection detection + truncation
│   ├── testing/                   # Test infrastructure
│   │   ├── fixtures/              # context.ts (config factories), routes.ts (mock deps)
│   │   └── helpers/               # test-database.ts, test-server.ts, test-llm-provider.ts
│   ├── tools/                     # Tool system
│   │   ├── registry/
│   │   │   └── tool-registry.ts   # RBAC enforcement + tool resolution
│   │   └── definitions/           # 7 built-in tools
│   │       ├── calculator.ts
│   │       ├── date-time.ts
│   │       ├── json-transform.ts
│   │       ├── http-request.ts
│   │       ├── knowledge-search.ts
│   │       ├── send-notification.ts
│   │       └── propose-scheduled-task.ts
│   └── webhooks/                  # Generic webhook triggers
│       ├── types.ts               # Webhook, WebhookEvent
│       └── webhook-processor.ts   # HMAC validation + template parsing
├── docker-compose.yml             # Local dev: PostgreSQL + Redis
├── Dockerfile                     # Production container
├── docker-compose.prod.yml        # Production stack
├── package.json                   # Scripts, dependencies, engines
├── tsconfig.json                  # Strict TS config with path aliases
├── eslint.config.mjs              # Strict TypeScript linting
├── vitest.config.ts               # Test runner configuration
├── .prettierrc                    # Code formatting rules
└── CLAUDE.md                      # AI assistant coding instructions
```

---

## Core Systems

### 1. Agent Runner

**Location:** `src/core/`

The `AgentRunner` is the beating heart of Nexus Core. It implements the autonomous agent execution cycle.

#### Execution Flow

```
User Message
     │
     ▼
┌─ Pre-Check ─────────────────────────────────────────────┐
│  CostGuard: verify budgets + rate limits                │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─ Loop (until done or limits reached) ───────────────────┐
│                                                         │
│  1. Retrieve relevant memories (pgvector semantic search)│
│  2. Fit conversation to context window (prune/compact)   │
│  3. Build system prompt from 3 layers + tools + memories │
│  4. Stream LLM call (with failover if configured)        │
│  5. Parse response for tool calls                        │
│  6. For each tool call:                                  │
│     a. RBAC check (is tool in allowedTools?)             │
│     b. Hallucination check (does tool exist?)            │
│     c. Input validation (Zod schema)                     │
│     d. Approval gate (high/critical risk)                │
│     e. Execute tool                                      │
│  7. Add tool results to conversation                     │
│  8. Emit stream events to client                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
     │
     ▼
Persist ExecutionTrace + Messages
```

#### AgentConfig

The central configuration object for a project. Defined in `src/core/types.ts`:

```typescript
interface AgentConfig {
  projectId: ProjectId;
  provider: LLMProviderConfig;          // Primary LLM (provider, model, apiKeyEnvVar)
  fallbackProvider?: LLMProviderConfig;  // Secondary LLM for failover
  failover?: FailoverConfig;            // Triggers: onRateLimit, onServerError, onTimeout
  allowedTools: string[];               // RBAC whitelist — single source of truth
  mcpServers?: MCPServerConfig[];       // External tool servers
  memoryConfig: MemoryConfig;           // 4-layer memory settings
  costConfig: CostConfig;              // Budgets, rate limits, token limits
  agentRole?: string;                   // Agent persona description
  maxTurns?: number;                    // Max loop iterations (default: 25)
  maxConcurrentSessions?: number;       // Concurrent session limit
}
```

#### Key Types

| Type | Purpose |
|------|---------|
| `ExecutionContext` | Per-run state: projectId, sessionId, traceId, permissions, abortSignal |
| `ExecutionTrace` | Full observability record: events timeline, token usage, cost, status |
| `TraceEvent` | Single event in the timeline (llm_request, tool_call, approval_requested, etc.) |
| `PromptSnapshot` | Point-in-time capture of all prompt layer versions + content hashes |

#### Stream Events

Real-time events emitted to clients via WebSocket:

| Event | Data |
|-------|------|
| `agent_start` | Run initiated |
| `content_delta` | Text chunk from LLM |
| `tool_use_start` | Tool call starting (toolId, name) |
| `tool_result` | Tool execution result (success, output, duration) |
| `turn_complete` | Agent turn finished |
| `agent_complete` | Full run complete (response, usage, traceId) |
| `error` | Execution error |

#### Error Types

All errors extend `NexusError` with `code`, `statusCode`, `context`, and `isOperational`:

| Error | Code | Status |
|-------|------|--------|
| `BudgetExceededError` | `BUDGET_EXCEEDED` | 429 |
| `RateLimitError` | `RATE_LIMIT_EXCEEDED` | 429 |
| `ToolNotAllowedError` | `TOOL_NOT_ALLOWED` | 403 |
| `ToolHallucinationError` | `TOOL_HALLUCINATION` | 400 |
| `ApprovalRequiredError` | `APPROVAL_REQUIRED` | 202 |
| `ProviderError` | `PROVIDER_ERROR` | 502 |
| `ValidationError` | `VALIDATION_ERROR` | 400 |
| `SessionError` | `SESSION_ERROR` | 400 |
| `ToolExecutionError` | `TOOL_EXECUTION_ERROR` | 500 |

---

### 2. LLM Providers

**Location:** `src/providers/`

Adapter pattern — every provider implements the same `LLMProvider` interface. The agent loop never calls a provider directly; it goes through the factory-resolved instance.

#### LLMProvider Interface

```typescript
interface LLMProvider {
  readonly id: string;              // e.g. "anthropic:claude-opus-4-6"
  readonly displayName: string;

  chat(params: ChatParams): AsyncGenerator<ChatEvent>;  // Streaming
  countTokens(messages: Message[]): Promise<number>;
  getContextWindow(): number;
  supportsToolUse(): boolean;
  formatTools(tools: ToolDefinitionForProvider[]): unknown[];
  formatToolResult(result: { toolUseId: string; content: string; isError: boolean }): unknown;
}
```

#### Supported Providers

| Provider | Adapter | SDK | Notes |
|----------|---------|-----|-------|
| **Anthropic** | `createAnthropicProvider()` | @anthropic-ai/sdk | Native tool use, streaming via content blocks |
| **OpenAI** | `createOpenAIProvider()` | openai | Function calling format |
| **Google Gemini** | Via OpenAI-compatible | openai | Base URL: `generativelanguage.googleapis.com/v1beta/openai` |
| **Ollama** | Via OpenAI-compatible | openai | Base URL: `localhost:11434/v1`, no API key needed |

#### ChatEvent (Streaming)

Discriminated union for streaming events:

```typescript
type ChatEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'content_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'message_end'; stopReason: string; usage: TokenUsage }
  | { type: 'error'; error: string };
```

#### Model Registry

`src/providers/models.ts` contains 100+ model entries with metadata:

```typescript
interface ModelMeta {
  contextWindow: number;      // e.g. 1_000_000 for Claude Opus 4.6
  maxOutputTokens: number;
  supportsTools: boolean;
  inputPricePer1M: number;   // USD per 1M input tokens
  outputPricePer1M: number;  // USD per 1M output tokens
}
```

Key models: Claude Opus 4.6 (1M context), Claude Sonnet 4.5 (1M), GPT-5 (256K), GPT-4.1 (1M), Gemini 3 (2M), Gemini 2.5 Pro (1M).

#### API Key Handling

Keys are **never** stored in config. `AgentConfig.provider.apiKeyEnvVar` stores the environment variable name (e.g. `"ANTHROPIC_API_KEY"`). The provider factory resolves the actual key from `process.env` at construction time.

---

### 3. Tool System

**Location:** `src/tools/`

#### Interfaces

```typescript
interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema: ZodSchema;
  outputSchema?: ZodSchema;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  sideEffects: boolean;
  supportsDryRun: boolean;
}

interface ExecutableTool extends ToolDefinition {
  execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;
  dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;
  healthCheck?(): Promise<boolean>;
}
```

#### ToolRegistry

The registry enforces all access control at runtime:

1. **RBAC check**: Is tool in `context.permissions.allowedTools`? → `ToolNotAllowedError`
2. **Existence check**: Does tool exist in registry? → `ToolHallucinationError` (logs available tools for the LLM)
3. **Input validation**: Parse input against `tool.inputSchema` → Zod errors
4. **Approval gate**: If `tool.requiresApproval`, check approval status → `ApprovalRequiredError`
5. **Execution**: Call `tool.execute()` with full execution context

#### Built-in Tools

| Tool | Risk | Approval | Description |
|------|------|----------|-------------|
| `calculator` | low | No | Safe math expression evaluation (recursive-descent parser, no `eval`). Functions: sqrt, abs, ceil, floor, round, min, max, sin, cos, tan, log. Constants: PI, E. |
| `date-time` | low | No | Current time, timezone conversion, duration calculation, date formatting. |
| `json-transform` | low | No | JMESPath queries on JSON data. Safe transformations without side effects. |
| `http-request` | medium | No | HTTP calls (GET/POST/PUT/DELETE). **SSRF protection**: blocks private IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, IPv6 ULA/link-local). URL allowlist patterns, 1MB response limit, 30s timeout. |
| `knowledge-search` | low | No | Semantic search over long-term memory (pgvector). Requires embedding backend. |
| `send-notification` | medium | Config | Send messages via pluggable providers (Telegram, Slack, email). Requires injected NotificationSender. |
| `propose-scheduled-task` | low | No | Agent proposes a recurring cron task. Task starts as `proposed` — requires human approval to activate. "Agent proposes, human disposes." |

#### MCP Tools (Dynamic)

Tools discovered from external MCP servers are automatically wrapped as `ExecutableTool` with:
- **ID format**: `mcp:{serverName}:{toolName}` (namespaced to avoid collisions)
- **Risk level**: `medium` (default for all MCP tools)
- **Dry run**: Input validation only (doesn't call server)

---

### 4. Memory System

**Location:** `src/memory/`

Four layers managed by `MemoryManager`:

```
Layer 1: Context Window Management
  └── Token budget tracking, reserve tokens for response
Layer 2: Pruning
  └── Drop old turns: keep first N + last N (turn-based) or fill from end (token-based)
Layer 3: Compaction
  └── LLM-summarized compression of old turns → CompactionEntry
Layer 4: Long-Term Memory (pgvector)
  └── Semantic search with embeddings (1536-dim), importance scoring, decay
```

#### MemoryManager Interface

```typescript
interface MemoryManager {
  fitToContextWindow(messages: Message[]): Promise<Message[]>;
  compact(messages: Message[], sessionId: SessionId): Promise<{ messages: Message[]; entry: CompactionEntry }>;
  retrieveMemories(query: MemoryRetrieval): Promise<RetrievedMemory[]>;
  storeMemory(entry: MemoryEntry): Promise<MemoryEntry | null>;
}
```

#### Long-Term Memory

Stored in `memory_entries` table with pgvector:

```typescript
interface MemoryEntry {
  id: string;
  projectId: ProjectId;
  sessionId?: SessionId;          // null = project-wide
  category: 'fact' | 'decision' | 'preference' | 'task_context' | 'learning';
  content: string;
  embedding: number[];            // 1536-dimensional vector
  importance: number;             // 0.0–1.0 (LLM-assigned)
  accessCount: number;            // Tracks usage frequency
  lastAccessedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}
```

Retrieval uses cosine similarity on embeddings, filtered by category and minimum importance, with configurable top-K.

---

### 5. Prompt Layer System

**Location:** `src/prompts/`

System prompts are assembled from 3 independently-versioned, immutable layers:

| Layer | Purpose | Example |
|-------|---------|---------|
| **Identity** | Who the agent is — persona, tone, role | "You are Luna, a customer support agent for Acme Corp. You speak in a friendly, professional tone." |
| **Instructions** | What to do — business rules, workflows | "Always check order status before discussing refunds. Escalate billing issues to a human." |
| **Safety** | What NOT to do — boundaries, constraints | "Never share internal pricing. Never execute financial transactions without approval." |

#### Immutability & Versioning

- Layers are **never edited** in the database
- Creating a new version auto-increments `version` per (project, layerType)
- `activate(id)` deactivates the previous active version of the same type (atomic transaction)
- Rollback = activate a previous version
- Every `ExecutionTrace` stores a `PromptSnapshot` capturing exact layer versions + content hashes

#### Prompt Assembly

`PromptBuilder.buildPrompt()` produces a 5-section system prompt:

1. **Identity** (from DB layer, with `{{placeholder}}` interpolation)
2. **Instructions** (from DB layer)
3. **Available Tools** (runtime: tool names + descriptions + usage hints)
4. **Retrieved Memories** (runtime: semantically relevant long-term memories)
5. **Safety & Boundaries** (from DB layer)

---

### 6. Security

**Location:** `src/security/`

#### Approval Gate

High/critical risk tools pause execution until a human approves:

```
Tool call (high/critical risk)
     │
     ▼
┌─ ApprovalGate ─────────────────────────────────┐
│  Create ApprovalRequest (status: pending)       │
│  Set expiration (default: 5 minutes)            │
│  → Agent pauses, trace status: human_approval_pending │
└─────────────────────────────────────────────────┘
     │
     ▼ (human reviews via API)
     │
┌─ Resolution ───────────────────────────────────┐
│  POST /approvals/:id/approve → tool executes   │
│  POST /approvals/:id/reject  → tool blocked    │
│  Timeout → ApprovalRequest expires             │
└─────────────────────────────────────────────────┘
```

#### Input Sanitizer

Defense-in-depth (the LLM is **not** a security boundary):

- **Length limits**: Max 100K chars (configurable)
- **Null byte stripping**
- **Injection pattern detection**: "ignore all previous instructions", "you are now a...", `[INST]`, `<|im_start|>`, `<<SYS>>`, `[SYSTEM]` tags
- **Logging**: All injection attempts logged for audit

#### RBAC

Single source of truth: `AgentConfig.allowedTools: string[]`

- Enforced at the `ToolRegistry.resolve()` level — code-level, not prompt-based
- No dynamic tool allowlisting per request
- If the LLM hallucinates a tool name, `ToolHallucinationError` fires and logs available tools

---

### 7. Cost Control

**Location:** `src/cost/`

#### CostGuard Middleware

Wraps every LLM call with budget and rate limit checks:

```typescript
interface CostGuard {
  preCheck(projectId: ProjectId): Promise<void>;         // Before LLM call — throws if over budget
  recordUsage(projectId, provider, model, usage): Promise<void>;  // After LLM call
  getBudgetStatus(projectId): Promise<BudgetStatus>;
  checkTurnTokens(tokens: number): boolean;
}
```

#### CostConfig (per project)

```typescript
interface CostConfig {
  dailyBudgetUsd: number;       // e.g. 10.00
  monthlyBudgetUsd: number;     // e.g. 100.00
  maxTokensPerTurn: number;     // e.g. 4096
  maxTurnsPerSession: number;   // e.g. 25
  maxToolCallsPerTurn: number;  // e.g. 5
  alertThresholdPercent: number; // e.g. 80 (warning at 80%)
  hardLimitPercent: number;      // e.g. 100 (block at 100%)
  rateLimitRpm: number;          // Requests per minute
  rateLimitRph: number;          // Requests per hour
}
```

#### Cost Normalization

All costs normalized to USD using the model registry pricing:
```
cost = (inputTokens × inputPricePer1M / 1_000_000) + (outputTokens × outputPricePer1M / 1_000_000)
```

---

### 8. Scheduled Tasks

**Location:** `src/scheduling/`

BullMQ-powered cron-based task automation.

#### Two Origins

| Origin | Created By | Initial Status | Requires Approval |
|--------|-----------|---------------|-------------------|
| `static` | Human (via API) | `active` | No |
| `agent_proposed` | Agent (via `propose-scheduled-task` tool) | `proposed` | Yes |

#### Task Lifecycle

```
Static:   create → active ←→ paused → completed/expired
Proposed: create → proposed → approved → active ←→ paused → completed/expired
                           → rejected
```

#### TaskManager Interface

```typescript
interface TaskManager {
  createTask(input): Promise<Result<ScheduledTask, NexusError>>;     // Static, starts active
  proposeTask(input): Promise<Result<ScheduledTask, NexusError>>;    // Agent-proposed, starts proposed
  approveTask(id, approvedBy): Promise<Result<ScheduledTask, NexusError>>;
  rejectTask(id): Promise<Result<ScheduledTask, NexusError>>;
  pauseTask(id): Promise<Result<ScheduledTask, NexusError>>;
  resumeTask(id): Promise<Result<ScheduledTask, NexusError>>;
  getTask(id): Promise<ScheduledTask | null>;
  listTasks(projectId, status?): Promise<ScheduledTask[]>;
  listRuns(taskId, limit?): Promise<ScheduledTaskRun[]>;
  validateCron(expression): Result<Date[], NexusError>;  // Returns next 3 run times
}
```

#### TaskRunner (BullMQ)

- **Conditional startup**: Only runs if `REDIS_URL` is set
- **Poll interval**: 60 seconds (configurable)
- **Concurrency**: 5 workers
- **Job retention**: 100 completed, 100 failed
- For each due task: check maxRuns/expiry → enqueue job → calculate next `nextRunAt`
- Worker: create run record → mark running → execute via `TaskExecutor` → update result

---

### 9. Channel System

**Location:** `src/channels/`

Adapter pattern for multi-channel communication.

#### Supported Channels

| Channel | Adapter | Config Keys |
|---------|---------|------------|
| **Telegram** | `createTelegramAdapter()` | `TELEGRAM_BOT_TOKEN` |
| **WhatsApp** | `createWhatsAppAdapter()` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| **Slack** | `createSlackAdapter()` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |

#### ChannelAdapter Interface

```typescript
interface ChannelAdapter {
  readonly channelType: ChannelType;
  send(message: OutboundMessage): Promise<SendResult>;
  parseInbound(payload: unknown): Promise<InboundMessage | null>;
  isHealthy(): Promise<boolean>;
}
```

#### Inbound Processing Pipeline

```
Webhook (POST /webhooks/telegram)
  │
  ▼
ChannelRouter.parseInbound() → InboundMessage (normalized)
  │
  ▼
InboundProcessor.process()
  ├── Resolve/create Contact (by phone, telegramId, slackId, email)
  ├── Find/create Session (metadata: contactId, channel)
  ├── runAgent(projectId, sessionId, message)
  └── ChannelRouter.send(response) → back to user
```

#### Proactive Messaging

Outbound scheduled messages via `ProactiveMessenger`:
- Immediate: direct send via ChannelRouter
- Scheduled: enqueue BullMQ job with delay
- Queue: `proactive-messages` with 100-job retention

---

### 10. MCP Client Integration

**Location:** `src/mcp/`

Connect to external [Model Context Protocol](https://modelcontextprotocol.io/) servers, discover their tools, and register them as native `ExecutableTool` instances — zero changes to AgentRunner.

#### MCPServerConfig (per project)

```typescript
interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;              // For stdio: subprocess command
  args?: string[];               // For stdio: command arguments
  env?: Record<string, string>;  // Env var names to resolve
  url?: string;                  // For SSE: server URL
  toolPrefix?: string;           // Namespace prefix (defaults to name)
}
```

#### MCPManager

Manages multiple MCP server connections:

```typescript
interface MCPManager {
  connectAll(configs: MCPServerConfig[]): Promise<void>;  // Parallel, graceful degradation
  disconnect(serverName: string): Promise<void>;
  disconnectAll(): Promise<void>;
  getTools(): ExecutableTool[];                            // All discovered tools
  listConnections(): MCPServerStatus[];
}
```

#### Tool Wrapping

Each MCP tool becomes an `ExecutableTool` with:
- **ID**: `mcp:{prefix}:{toolName}`
- **Risk level**: `medium`
- **Category**: `mcp`
- **Execute**: Calls `connection.callTool()`, extracts text content from result
- **Dry run**: Input validation only (no server call)

---

### 11. Multi-Agent System

**Location:** `src/agents/`

#### Per-Agent Configuration

Each agent has its own:

```typescript
interface AgentConfig {
  id: AgentId;
  projectId: ProjectId;
  name: string;
  description?: string;
  promptConfig: {
    identity: string;
    instructions: string;
    safety: string;
  };
  toolAllowlist: string[];           // Independent tool whitelist
  mcpServers: MCPServerConfig[];     // Per-agent MCP connections
  channelConfig: {
    allowedChannels: string[];       // e.g. ['telegram', 'slack']
    defaultChannel?: string;
  };
  limits: {
    maxTurns: number;
    maxTokensPerTurn: number;
    budgetPerDayUsd: number;
  };
  status: 'active' | 'paused' | 'disabled';
}
```

#### Agent Registry (Cached)

```typescript
interface AgentRegistry {
  get(agentId): Promise<AgentConfig | null>;            // Cached (60s TTL)
  getByName(projectId, name): Promise<AgentConfig | null>; // Cached
  list(projectId): Promise<AgentConfig[]>;              // Always fresh
  refresh(agentId): Promise<void>;                      // Clear + refetch
  invalidate(agentId): void;                            // Clear cache
}
```

#### Inter-Agent Communication

```typescript
interface AgentComms {
  send(message): Promise<AgentMessageId>;                           // Fire-and-forget
  sendAndWait(message, timeoutMs?): Promise<string>;               // Blocking with reply
  subscribe(agentId, handler): () => void;                         // Returns unsubscribe fn
}
```

Current implementation: EventEmitter (in-process). Extensible to Redis pub/sub for distributed deployments.

---

### 12. Webhooks

**Location:** `src/webhooks/`

Generic webhooks for triggering agent runs from external systems (distinct from channel webhooks).

#### Webhook Configuration

```typescript
interface Webhook {
  id: WebhookId;
  projectId: ProjectId;
  agentId?: string;
  name: string;
  triggerPrompt: string;        // Mustache template: "New order from {{customer.name}}: {{order.items}}"
  secretEnvVar?: string;        // Env var name holding HMAC signing key
  allowedIps?: string[];        // IP whitelist (empty = allow all)
  status: 'active' | 'paused';
}
```

#### Processing Pipeline

```
POST /trigger/:webhookId
  │
  ├── Validate webhook exists (404)
  ├── Check status (503 if paused)
  ├── Validate source IP (403)
  ├── Validate HMAC signature (401)
  │   └── Reads secret from env var
  │   └── Checks x-webhook-signature / x-hub-signature-256 / x-signature
  │   └── Constant-time comparison (timing attack prevention)
  ├── Parse trigger prompt template
  │   └── {{field.path}} → nested payload access
  │   └── Objects → JSON.stringify
  ├── Create session
  └── Run agent with parsed prompt
```

---

### 13. File System

**Location:** `src/files/`

#### Architecture

```
FileService = FileStorage (where bytes live) + FileRepository (where metadata lives)
```

#### Storage Path Format

Platform-independent (always forward slashes):
```
{projectId}/{year}/{month}/{day}/{uuid}.{ext}
// Example: proj_abc123/2026/02/12/x7k9m2.pdf
```

#### FileService Interface

```typescript
interface FileService {
  upload(input: UploadFileInput): Promise<StoredFile>;
  download(id: FileId): Promise<{ file: StoredFile; content: Buffer }>;
  getById(id: FileId): Promise<StoredFile | null>;
  delete(id: FileId): Promise<void>;
  getTemporaryUrl(id: FileId, expiresInSeconds?: number): Promise<string | null>;
}
```

Current backend: `createLocalStorage({ basePath })`. Designed for future S3/GCS backends via the `FileStorage` interface.

---

### 14. Contacts

**Location:** `src/contacts/`

Contacts represent end users reachable via multiple channels:

```typescript
interface Contact {
  id: ContactId;
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;          // WhatsApp routing
  email?: string;          // Email routing
  telegramId?: string;     // Telegram routing
  slackId?: string;        // Slack routing
  timezone?: string;
  language: string;        // Default: "es"
  metadata?: Record<string, unknown>;
}
```

Contacts are auto-created by the inbound processor when a new sender is detected on any channel.

---

## API Reference

All endpoints are prefixed with `/api/v1`. The `/health` endpoint is at the root level.

### Response Envelope

**Success:**
```json
{ "success": true, "data": { ... } }
```

**Error:**
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

**Paginated:**
```json
{ "success": true, "data": { "items": [...], "total": 42, "limit": 20, "offset": 0 } }
```

### Endpoints

#### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects` | List projects (filters: owner, status, tags) |
| `GET` | `/projects/:id` | Get project by ID |
| `POST` | `/projects` | Create project |
| `PUT` | `/projects/:id` | Update project |
| `DELETE` | `/projects/:id` | Delete project |
| `POST` | `/projects/:id/pause` | Pause project (status → paused) |
| `POST` | `/projects/:id/resume` | Resume project (status → active) |

#### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/sessions` | List sessions |
| `GET` | `/sessions/:sessionId` | Get session |
| `POST` | `/projects/:projectId/sessions` | Create session |
| `DELETE` | `/sessions/:sessionId` | Delete session |

#### Chat

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Synchronous agent execution (blocking) |
| `GET` | `/chat/stream` | WebSocket for streaming agent execution |

#### Prompt Layers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/prompt-layers` | List all layers (optional `?layerType=`) |
| `GET` | `/projects/:projectId/prompt-layers/active` | Get the 3 active layers |
| `GET` | `/prompt-layers/:id` | Get specific layer by ID |
| `POST` | `/projects/:projectId/prompt-layers` | Create new layer version |
| `POST` | `/prompt-layers/:id/activate` | Activate a layer (auto-deactivates previous) |

#### Execution Traces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/traces` | List traces with filters |
| `GET` | `/traces/:traceId` | Get trace details |

#### Approvals

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/approvals` | List pending approvals |
| `GET` | `/approvals` | Global approvals list (filters: status, projectId) |
| `POST` | `/approvals/:id/approve` | Approve tool execution |
| `POST` | `/approvals/:id/reject` | Reject tool execution |
| `POST` | `/approvals/:id/decide` | Decide (approved: boolean) |

#### Tools

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tools` | List all registered tools (native + MCP) |
| `GET` | `/tools/:toolId` | Get tool definition + schema |
| `POST` | `/tools/:toolId/dry-run` | Test tool without side effects |

#### Scheduled Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/scheduled-tasks` | List tasks (optional `?status=`) |
| `GET` | `/scheduled-tasks/:id` | Get task details |
| `POST` | `/projects/:projectId/scheduled-tasks` | Create task (starts active) |
| `POST` | `/scheduled-tasks/:id/approve` | Approve proposed task |
| `POST` | `/scheduled-tasks/:id/reject` | Reject proposed task |
| `POST` | `/scheduled-tasks/:id/pause` | Pause active task |
| `POST` | `/scheduled-tasks/:id/resume` | Resume paused task |
| `GET` | `/scheduled-tasks/:id/runs` | List task execution runs |

#### Contacts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/contacts` | List contacts |
| `GET` | `/contacts/:contactId` | Get contact |
| `POST` | `/contacts` | Create contact |
| `PATCH` | `/contacts/:contactId` | Update contact |
| `DELETE` | `/contacts/:contactId` | Delete contact |

#### Webhooks (Channel)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/telegram` | Receive Telegram updates |
| `GET` | `/webhooks/whatsapp` | WhatsApp verification challenge |
| `POST` | `/webhooks/whatsapp` | Receive WhatsApp messages |
| `POST` | `/webhooks/slack` | Receive Slack events |
| `GET` | `/webhooks/health` | Channel adapter health check |

#### Webhooks (Generic/Custom)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/webhooks` | List project webhooks |
| `GET` | `/webhooks/:id` | Get webhook |
| `POST` | `/webhooks` | Create webhook |
| `PATCH` | `/webhooks/:id` | Update webhook |
| `DELETE` | `/webhooks/:id` | Delete webhook |
| `POST` | `/trigger/:webhookId` | Trigger webhook (external callers) |
| `POST` | `/webhooks/:id/test` | Test webhook with payload |

#### Files

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/files/upload` | Upload file (raw body, query: projectId, filename) |
| `GET` | `/files/:fileId` | Get file metadata |
| `GET` | `/files/:fileId/download` | Download file content |
| `GET` | `/files/:fileId/url` | Get temporary access URL |
| `GET` | `/projects/:projectId/files` | List project files |
| `DELETE` | `/files/:fileId` | Delete file |

#### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:projectId/agents` | List agents (optional `?status=`) |
| `GET` | `/agents/:agentId` | Get agent (cached) |
| `GET` | `/projects/:projectId/agents/name/:name` | Get agent by name (cached) |
| `POST` | `/projects/:projectId/agents` | Create agent |
| `PATCH` | `/agents/:agentId` | Update agent |
| `DELETE` | `/agents/:agentId` | Delete agent |
| `POST` | `/agents/:agentId/message` | Send inter-agent message |
| `POST` | `/agents/:agentId/refresh` | Refresh agent cache |
| `POST` | `/projects/:projectId/agents/:agentId/pause` | Pause agent |
| `POST` | `/projects/:projectId/agents/:agentId/resume` | Resume agent |

#### Dashboard & Usage

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard/overview` | Summary stats (projects, agents, sessions, costs) |
| `GET` | `/projects/:projectId/usage` | Token/cost usage metrics |

---

## Database Schema

14 Prisma models. PostgreSQL 16 with `pgvector` extension for embeddings.

| Model | Key Fields | Relations |
|-------|-----------|-----------|
| **Project** | id, name, owner, tags[], configJson (AgentConfig), status | → Sessions, PromptLayers, Agents, Contacts, Webhooks, Files, ScheduledTasks, UsageRecords, MemoryEntries, ApprovalRequests |
| **Contact** | id, projectId, name, phone?, email?, telegramId?, slackId?, timezone?, language | → Sessions |
| **Session** | id, projectId, contactId?, agentId?, status, metadata | → Messages, ExecutionTraces, ApprovalRequests |
| **Message** | id, sessionId, role (user/assistant/system), content, toolCalls?, usage? | → Session, ExecutionTrace |
| **MemoryEntry** | id, projectId, sessionId?, category, content, embedding (vector 1536), importance (0-1), accessCount | → Project |
| **PromptLayer** | id, projectId, layerType (identity/instructions/safety), version, content, isActive, createdBy, changeReason | → Project. Unique: (projectId, layerType, version) |
| **UsageRecord** | id, projectId, sessionId, traceId, provider, model, inputTokens, outputTokens, costUsd | → Project |
| **ExecutionTrace** | id, projectId, sessionId, promptSnapshot (JSON), events (JSON), totalDurationMs, totalTokensUsed, totalCostUsd, status | → Project, Session, Messages |
| **ApprovalRequest** | id, projectId, sessionId, toolCallId, toolId, toolInput, riskLevel, status (pending/approved/rejected), expiresAt | → Project, Session |
| **ScheduledTask** | id, projectId, name, cronExpression, taskPayload, origin (static/agent_proposed), status, maxRetries, timeoutMs, budgetPerRunUsd, nextRunAt | → Project, ScheduledTaskRuns |
| **ScheduledTaskRun** | id, taskId, status, durationMs, tokensUsed, costUsd, traceId, result?, errorMessage? | → ScheduledTask |
| **Webhook** | id, projectId, agentId?, name, triggerPrompt, secretEnvVar?, allowedIps[], status | → Project |
| **Agent** | id, projectId, name, promptConfig, toolAllowlist[], mcpServers, channelConfig, limits, status. Unique: (projectId, name) | → Project |
| **File** | id, projectId, filename, mimeType, sizeBytes, storageProvider, storagePath, uploadedBy, expiresAt? | → Project |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | No | Redis connection (enables scheduled tasks + proactive messaging) |
| `PORT` | No | Server port (default: 3000) |
| `HOST` | No | Bind address (default: `0.0.0.0`, use `::` for dual-stack) |
| `NODE_ENV` | No | `development` / `production` |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default: `info`) |
| `CORS_ORIGIN` | No | Comma-separated allowed origins |
| `FILE_STORAGE_PATH` | No | File storage directory (default: `./data/files`) |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude API key |
| `OPENAI_API_KEY` | No | OpenAI API key (also used for embeddings) |
| `GOOGLE_AI_API_KEY` | No | Google Gemini API key |
| `TELEGRAM_BOT_TOKEN` | No | Telegram Bot API token |
| `WHATSAPP_ACCESS_TOKEN` | No | WhatsApp Business API token |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | No | WhatsApp webhook challenge token |
| `SLACK_BOT_TOKEN` | No | Slack bot token |
| `SLACK_SIGNING_SECRET` | No | Slack request signing secret |

### Docker Ports (Local Development)

| Service | Port | Notes |
|---------|------|-------|
| PostgreSQL + pgvector | 5433 | Avoids conflict with default 5432 |
| Redis | 6380 | Avoids conflict with default 6379 |
| Nexus Core | 3002 | `HOST=::` for dual-stack IPv4+IPv6 |

---

## Development

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript + resolve path aliases |
| `pnpm typecheck` | Type check without emitting (`tsc --noEmit`) |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm test:unit` | Unit tests only (no external deps) |
| `pnpm test:integration` | Integration tests (requires DB + Redis) |
| `pnpm test:e2e` | End-to-end API tests |
| `pnpm test:tools` | Tool-specific tests (schema + dry-run + integration) |
| `pnpm test:security` | Security-focused tests |
| `pnpm test:performance` | Performance benchmarks |
| `pnpm test:all` | Run all test suites sequentially |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm db:seed` | Seed development data |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm lint` | ESLint check |
| `pnpm lint:fix` | ESLint auto-fix |
| `pnpm format` | Prettier check |
| `pnpm format:fix` | Prettier write |

### Testing Strategy

Every tool requires 3 test levels:

| Level | What | External Deps |
|-------|------|--------------|
| **Schema** | Zod validates/rejects input shapes | None |
| **Dry Run** | `tool.dryRun()` returns expected shape | None |
| **Integration** | `tool.execute()` against real services | DB, Redis, APIs |

Test files live next to source: `foo.ts` → `foo.test.ts`

Test infrastructure in `src/testing/`:
- **Fixtures**: `createTestAgentConfig()`, `createTestContext()` — type-safe test data factories
- **Mock deps**: `createMockDeps()` — all 19 route dependencies as `vi.fn()` mocks
- **Test database**: `createTestDatabase()` — Prisma client with `reset()` and `seed()` helpers
- **Test server**: `createTestServer()` — full Fastify instance with all routes for E2E tests
- **Mock LLM**: `createMockLLMProvider()` — configurable streaming responses without API calls

---

## Security Model

### What Agents CAN Do

- Call whitelisted tools (per-project `allowedTools`)
- Retrieve long-term memories (semantic search)
- Propose scheduled tasks (require human approval)
- Send messages via configured channels
- Make HTTP requests (with SSRF protection)

### What Agents CANNOT Do

- Execute shell commands (no shell access tool exists)
- Read/write the host filesystem (only via FileService abstraction)
- Access tools not in their whitelist (RBAC enforced at registry level)
- Execute high/critical risk tools without human approval
- Bypass budget or rate limits
- Access raw API keys (only env var names in config)
- Modify prompt layers (immutable; only humans via API)

### Security Layers

```
┌─────────────────────────────────────────────┐
│  1. Input Sanitizer                         │
│     Injection detection, length limits,     │
│     null byte stripping                     │
├─────────────────────────────────────────────┤
│  2. RBAC (ToolRegistry)                     │
│     allowedTools whitelist enforced in code  │
├─────────────────────────────────────────────┤
│  3. Approval Gate                           │
│     High/critical tools require human OK    │
├─────────────────────────────────────────────┤
│  4. CostGuard                               │
│     Budget limits, rate limits, token caps  │
├─────────────────────────────────────────────┤
│  5. SSRF Protection (HTTP Tool)             │
│     Block private IPs, URL allowlists       │
├─────────────────────────────────────────────┤
│  6. Webhook Validation                      │
│     HMAC signatures, IP allowlists          │
├─────────────────────────────────────────────┤
│  7. API Key Isolation                       │
│     Env var names only, resolved at factory │
├─────────────────────────────────────────────┤
│  8. Structured Logging                      │
│     Auto-redaction of sensitive fields      │
└─────────────────────────────────────────────┘
```

---

## Extension Points

### Adding a New LLM Provider

1. Create `src/providers/<name>.ts` implementing `LLMProvider`
2. Register in `src/providers/factory.ts` provider map
3. Add model entries to `src/providers/models.ts`
4. Add integration test in `src/providers/<name>.integration.test.ts`

### Adding a New Tool

1. Use `scaffoldTool()` from `src/tools/scaffold.ts` to generate boilerplate
2. Create `src/tools/definitions/<name>.ts` implementing `ExecutableTool`
3. Define Zod schemas for input and output
4. Set `riskLevel` and `requiresApproval` appropriately
5. Implement `execute()` and `dryRun()`
6. Register in `src/tools/definitions/index.ts`
7. Write 3 test levels: schema, dry-run, integration

### Adding a New Channel Adapter

1. Create `src/channels/adapters/<name>.ts` implementing `ChannelAdapter`
2. Implement `send()`, `parseInbound()`, `isHealthy()`
3. Register adapter with `ChannelRouter` in `src/main.ts`
4. Add webhook endpoint in `src/api/routes/webhooks.ts`
5. Add channel type to `ChannelType` union in `src/channels/types.ts`

### Adding a New Storage Backend

1. Create `src/files/storage-<name>.ts` implementing `FileStorage`
2. Implement `upload()`, `download()`, `delete()`, `exists()`, optionally `getSignedUrl()`
3. Wire in `src/main.ts` based on configuration

### Adding a New Prompt Layer Version

1. `POST /api/v1/projects/:projectId/prompt-layers` with layerType, content, createdBy, changeReason
2. `POST /api/v1/prompt-layers/:id/activate` — auto-deactivates previous version of same type
3. Rollback: just activate the old version again

---

## Critical Rules

These constraints are foundational to Nexus Core and must not be violated:

| Rule | Rationale |
|------|-----------|
| **No AI frameworks** (LangChain, AutoGen, CrewAI, Semantic Kernel) | We own the full agent loop. No black boxes. |
| **No `any` types** | Use `unknown` + type guards. TypeScript strict mode enforced. |
| **No shell execution** | Agents cannot run commands. Period. |
| **No filesystem access** | Only via FileService with storage abstraction. |
| **No prompt-based security** | Access control is in code (RBAC + approval gate), never in prompts. |
| **No mutable prompt layers** | Create new versions, never edit existing ones. |
| **No direct LLM calls** | Always via provider adapter + CostGuard. |
| **No secrets in config** | Credentials resolved from env vars at runtime. |
| **No `console.log`** | Use structured logger (pino). |
| **No circular dependencies** | Between `src/` top-level directories. |
| **No business logic in routes** | Route handlers delegate to service layer. |
| **No floating promises** | Always `await` or `.catch()`. |
| **No default exports** | Named exports only throughout the codebase. |
| **No wildcard tool permissions** | Every tool must be explicitly whitelisted per project. |

---

## License

Proprietary. Copyright Fomo.
