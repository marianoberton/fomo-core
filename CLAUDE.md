# NEXUS CORE

Model-agnostic, self-hosted autonomous agent framework for enterprise environments.
Built by Fomo. The core engine is reusable — each client gets a configured instance
(different tools, permissions, prompts) but the engine is always Nexus Core.

## CRITICAL RULES

- NEVER install or import LangChain, AutoGen, CrewAI, or any AI orchestration framework.
  This is a vanilla implementation. We own the full agent loop.
- NEVER use `any` type in TypeScript. Use `unknown` + type narrowing if needed.
- NEVER expose secrets or credentials to the agent context. Credentials live in
  the secrets manager and are injected at runtime by the tool executor, never passed
  through the LLM.
- NEVER give agents filesystem access or shell execution capabilities.
- NEVER rely on prompts for security enforcement. The LLM is NOT a security boundary.
  All access control is enforced in code via RBAC checks in `src/security/` and
  `src/tools/registry/`.
- NEVER bypass approval gates for high/critical risk tools.
- NEVER mutate a PromptLayer. Layers are immutable. Create a new version of the
  layer and activate it. The previous version remains for rollback.

## Stack

- Runtime: Node.js v22 LTS
- Language: TypeScript (strict mode, no `any`)
- Database: PostgreSQL + Prisma ORM
- Vector Store: pgvector (via Prisma extension)
- Queue: BullMQ + Redis
- HTTP Framework: Fastify + @fastify/websocket
- Validation: Zod (all external inputs, all tool schemas)
- Testing: Vitest
- Logging: Structured JSON (pino)
- Package Manager: pnpm

## Commands

```bash
# Development
pnpm dev                    # Start dev server with hot reload
pnpm build                  # Compile TypeScript
pnpm typecheck              # tsc --noEmit

# Testing
pnpm test                   # Run all tests
pnpm test:unit              # Unit tests only
pnpm test:integration       # Integration tests (requires DB + Redis)
pnpm test:tools             # Tool test runner (schema + dry-run + integration)
pnpm test -- --run <file>   # Run single test file

# Database
pnpm db:migrate             # Run Prisma migrations
pnpm db:generate            # Regenerate Prisma client
pnpm db:seed                # Seed development data
pnpm db:studio              # Open Prisma Studio

# Quality
pnpm lint                   # ESLint
pnpm lint:fix               # ESLint with auto-fix
pnpm format                 # Prettier check
pnpm format:fix             # Prettier write
```

## Directory Structure

```
src/
├── core/               # Agent loop, execution engine, AgentRunner
├── providers/          # LLM adapters (anthropic, openai, google, ollama)
├── tools/              # Tool system
│   ├── registry/       # ToolRegistry + RBAC enforcement
│   ├── definitions/    # Individual tool implementations
│   └── scaffold.ts     # Tool scaffolding utility (code generation)
├── memory/             # MemoryManager (4 layers)
├── prompts/            # PromptBuilder + layer system (identity, instructions, safety)
├── scheduling/         # Scheduled tasks — TaskManager, TaskRunner (BullMQ)
├── cost/               # CostGuard middleware + usage tracking
├── observability/      # ExecutionTrace + structured logging
├── api/                # REST + WebSocket endpoints (Fastify)
├── config/             # AgentConfig + per-project configs
├── security/           # ApprovalGate, InputSanitizer, RBAC
└── testing/            # Tool test runner + fixtures
prisma/
├── schema.prisma       # Database schema
└── migrations/         # Migration history
```

## Architecture

### Agent Loop (src/core/)
The central execution cycle. `AgentRunner` takes an `AgentConfig` + user message,
then loops: build prompt → call LLM → parse response → execute tools → repeat
until done or budget exhausted. Every loop iteration creates `TraceEvent` entries
in the `ExecutionTrace`.

### LLM Providers (src/providers/)
Adapter pattern. Every provider implements the `LLMProvider` interface:
`chat(params) => AsyncGenerator<ChatEvent>`. The agent loop never calls a provider
directly — it goes through the provider resolved from `AgentConfig.provider`.
Failover to a secondary provider is configurable per project.
Adding a new provider = one new file implementing `LLMProvider`.

### Tool System (src/tools/)
Tools implement `ExecutableTool` which extends `ToolDefinition` with `execute()`
and `dryRun()`. The `ToolRegistry` resolves tools by ID, enforces RBAC via the
project's `allowedTools` whitelist, and routes high-risk tools through
`ApprovalGate`. If the LLM hallucinates a tool, the registry blocks it in code,
returns available tools to the LLM, and logs a `tool_hallucination` event.

### Memory System (src/memory/)
Four layers, managed by `MemoryManager`:
1. **Context Window** — token budget tracking, fits messages into model limit
2. **Pruning** — drops old tool results, preserves head + tail of conversation
3. **Compaction** — LLM-summarized compression, persisted as compaction entries
4. **Long-term** — pgvector semantic search over `memory_entries` table

### Prompt Layer System (src/prompts/)
System prompts are assembled from 3 independently-versioned layers:
1. **Identity** — who the agent is, personality, role
2. **Instructions** — business rules, workflows, what to do
3. **Safety** — boundaries, constraints, what NOT to do

`PromptBuilder` assembles the final system prompt from these layers plus tool
descriptions, retrieved memories, and project context. Each `PromptLayer` record
is immutable in the DB — rollback = activate a previous version of any single
layer without affecting the others. Every `ExecutionTrace` stores a
`PromptSnapshot` (version numbers + content hashes for all 3 layers + tool docs
+ runtime context) for performance correlation and reproducibility.

Key functions:
- `resolveActiveLayers(projectId, repo)` — fetches active layer per type
- `buildPrompt(params)` — assembles final system prompt string
- `createPromptSnapshot(layers, toolDocsHash, runtimeContextHash)` — snapshot for trace
- `computeHash(content)` — deterministic SHA-256 hash

### Scheduled Tasks (src/scheduling/)
BullMQ-based scheduled task execution for recurring agent work:
- **TaskManager** — business logic for task lifecycle: propose, approve, reject,
  pause, resume. Agents can propose tasks (start as `proposed`, require human
  approval). Static tasks created via API start as `active`.
- **TaskRunner** — BullMQ Queue + Worker. Scheduler loop polls every minute for
  due tasks, enqueues jobs. Worker processes jobs with configurable timeout.
  Conditional startup: only runs if `REDIS_URL` is set.
- **propose-scheduled-task** tool — allows agents to propose recurring tasks.
  Low-risk, no approval needed (proposing is safe; activating requires human).
- Cron parsing via `cron-parser` (v5 API: `CronExpressionParser.parse()`).

### Cost Control (src/cost/)
`CostGuard` middleware wraps every LLM call. Checks daily/monthly budgets per
project from `CostConfig`. Circuit breaker at configurable thresholds. Rate
limiting per project (RPM/RPH). Every call creates a `UsageRecord`. Costs are
normalized across providers.

### Security (src/security/)
`ApprovalGate` pauses execution of high/critical risk tools until human approval.
`InputSanitizer` scrubs user input before it enters the agent loop. RBAC is
enforced in code at the `ToolRegistry` level — the `allowedTools` whitelist is
the single source of truth. The model cannot bypass these checks.

## Key Interfaces

These are the contracts that bind the system. When modifying any of these,
check all implementations:

- `AgentConfig` — project-level configuration (provider, tools, budget, memory)
- `LLMProvider` — adapter interface for LLM providers (chat, countTokens, formatTools)
- `ExecutableTool` extends `ToolDefinition` — tool with execute() + dryRun()
- `ToolDefinition` — tool metadata (id, name, schema, riskLevel, requiresApproval)
- `ExecutionContext` — per-run context (project, session, permissions, trace)
- `MemoryEntry` / `MemoryConfig` — memory system types
- `CostConfig` / `UsageRecord` — cost tracking and budget types
- `PromptLayer` — immutable prompt layer record (identity, instructions, or safety)
- `PromptSnapshot` — point-in-time record of all layer versions + hashes
- `ScheduledTask` / `ScheduledTaskRun` — recurring task definition and execution records
- `TaskManager` — scheduled task lifecycle (propose, approve, reject, pause, resume)
- `ExecutionTrace` / `TraceEvent` — full observability timeline per agent run

## Coding Standards

### Always
- TypeScript strict mode. Zero `any` types.
- Zod schemas for all external input (API requests, tool inputs/outputs, configs).
- JSDoc on every exported function and interface.
- Structured JSON logging via pino. Never `console.log`.
- Dependency injection — pass dependencies as constructor/function params.
- Composition over inheritance. Prefer interfaces + factory functions.
- Every tool must implement `dryRun()` that validates without side effects.
- Error types: extend `NexusError` base class with error codes.
- Use `Result<T, E>` pattern for operations that can fail expectedly.
- Named exports only. No default exports.

### Never
- No `any` types. Use `unknown` + type guards.
- No circular dependencies between `src/` top-level directories.
- No business logic in API route handlers — delegate to core services.
- No floating promises. Always await or explicitly handle with `.catch()`.
- No hardcoded credentials, URLs, or environment-specific values.
- No `console.log` / `console.error`. Use the structured logger.
- No direct database queries outside Prisma. No raw SQL unless for migrations.

## Testing Strategy

Tools have 3 test levels (all required for new tools):
1. **Schema** — Zod rejects malformed inputs the LLM might generate
2. **Dry Run** — `tool.dryRun()` returns expected shape without side effects
3. **Integration** — `tool.execute()` against real services in test environment

Test files live next to source: `foo.ts` → `foo.test.ts`.
Integration tests run separately: `pnpm test:integration`.
Use `vi.mock()` for external deps. Use factories in `src/testing/fixtures/`.
Every bug fix must include a regression test.

## Adding Common Things

### New LLM Provider
1. Create `src/providers/<name>.ts` implementing `LLMProvider`
2. Register in `src/providers/index.ts` provider map
3. Add config type to `LLMProviderConfig` union
4. Add integration test in `src/providers/<name>.test.ts`

### New Tool
1. Use `scaffoldTool()` from `src/tools/scaffold.ts` to generate boilerplate
2. Create `src/tools/definitions/<name>.ts` from the generated `implementationContent`
3. Fill in Zod schemas for input and output
4. Set `riskLevel` and `requiresApproval` appropriately
5. Implement `execute()` and `dryRun()` logic
6. Add the generated `registrationLine` to `src/tools/definitions/index.ts`
7. Create test from generated `testContent`, extend with integration tests
8. Write all 3 test levels in `src/tools/definitions/<name>.test.ts`

### New Prompt Layer Version
1. Create via `POST /projects/:projectId/prompt-layers` with layerType, content, createdBy, changeReason
2. Activate via `POST /prompt-layers/:id/activate` — auto-deactivates previous version of same type
3. Previous versions remain for rollback — just activate the old version again

### New Scheduled Task
1. Create via API: `POST /projects/:projectId/scheduled-tasks` (starts as active)
2. Or via agent: the `propose-scheduled-task` tool creates tasks as `proposed`
3. Approve proposed tasks via `POST /scheduled-tasks/:id/approve`
4. Tasks run automatically when `REDIS_URL` is configured (BullMQ)

### New API Endpoint
1. Create route in `src/api/routes/<resource>.ts`
2. Define Zod request/response schemas
3. Delegate to service layer — no business logic in the handler
4. Add to OpenAPI spec

## PROHIBITED

- **No AI frameworks**: LangChain, AutoGen, CrewAI, Semantic Kernel, etc.
- **No shell execution**: Agents cannot run commands. Period.
- **No filesystem access**: Agents cannot read or write files on the host.
- **No prompt-based security**: Access control lives in code, never in prompts.
- **No mutable prompt layers**: Create new layer versions, never edit existing ones.
- **No direct LLM calls**: Always go through the provider adapter + CostGuard.
- **No secrets in config files**: Use the secrets manager integration.
- **No synchronous LLM calls in request handlers**: Use BullMQ for async processing.
- **No wildcard tool permissions**: Every tool must be explicitly whitelisted per project.
