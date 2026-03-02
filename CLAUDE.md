# NEXUS CORE

Self-hosted, model-agnostic autonomous agent framework. Fomo sells multi-agent setups to business clients. Each client = one Project with N specialized agents + 1 manager (copilot). Channels: WhatsApp, Telegram, Slack. Dashboard is **internal-only** (Fomo team), not client-facing.

## Stack

- Node.js 22 LTS · TypeScript strict · pnpm
- Fastify + @fastify/websocket · PostgreSQL + Prisma 6 · pgvector · BullMQ + Redis
- Zod (all external inputs) · Vitest · pino (structured logging)
- Dashboard: Next.js 16 · React 19 · Tailwind 4 · shadcn/ui · React Query

## Quick File Map

| Need to change… | Look here |
|-----------------|-----------|
| Agent loop logic | `src/core/agent-runner.ts` |
| New tool | `src/tools/definitions/<name>.ts` + register in `src/tools/definitions/index.ts` |
| DB schema | `prisma/schema.prisma` → `pnpm db:migrate` → `pnpm db:generate` |
| API route | `src/api/routes/<resource>.ts` + register in `src/api/index.ts` |
| Channel adapter | `src/channels/adapters/<name>.ts` |
| Secrets | `src/secrets/secret-service.ts` |
| Dashboard | `dashboard/` (separate git repo — commits go inside it) |

## Directory Structure

```
src/
├── core/           # AgentRunner, agent loop, types, errors
├── providers/      # LLM adapters (anthropic, openai, google, ollama)
├── tools/
│   ├── registry/   # ToolRegistry + RBAC
│   ├── definitions/# Tool implementations + index.ts
│   └── scaffold.ts # Code generation utility
├── memory/         # MemoryManager (4 layers + pgvector)
├── prompts/        # PromptBuilder + layer system
├── scheduling/     # BullMQ scheduled tasks
├── cost/           # CostGuard + usage tracking
├── security/       # ApprovalGate, InputSanitizer, RBAC
├── channels/       # Adapters: WAHA, Meta, Telegram, Slack, Chatwoot
├── agents/         # Agent registry + inter-agent comms
├── mcp/            # MCP client + tool adapter
├── secrets/        # Encrypted credential storage
├── files/          # File storage service
├── knowledge/      # Knowledge base + semantic search
├── api/            # REST + WebSocket routes (Fastify)
└── testing/        # Fixtures + test server helpers
prisma/             # schema.prisma + migrations + seed.ts
dashboard/          # Git submodule — Next.js admin dashboard
```

## Decision Guide

| Task | Approach |
|------|----------|
| Agent needs a new capability | New Tool |
| Agent calls external API | Tool + SecretService injection (never hardcode creds) |
| New HTTP endpoint | Route file + Zod schemas → delegate to service layer |
| DB model change | Prisma migration → `pnpm db:generate` |
| New channel | Adapter in `src/channels/adapters/` + register in ChannelResolver |
| Agent proposes a recurring task | `propose-scheduled-task` tool → starts as `proposed`, requires human approval |

## Adding a New Tool

1. `scaffoldTool()` from `src/tools/scaffold.ts` — generates boilerplate
2. Create `src/tools/definitions/<id>.ts` — fill Zod input/output schemas, set `riskLevel` + `requiresApproval`
3. Implement `execute()` (real logic) and `dryRun()` (validates, no side effects)
4. Register in `src/tools/definitions/index.ts`
5. Write all 3 test levels in `src/tools/definitions/<id>.test.ts`:
   - **Schema** — Zod rejects malformed LLM inputs
   - **Dry Run** — returns expected shape without side effects
   - **Integration** — real service call (mark `it.skip` if no test env)

## Adding a New API Endpoint

1. Create `src/api/routes/<resource>.ts` — Zod request/response schemas
2. Delegate to service layer (no business logic in handlers)
3. Register route in `src/api/index.ts`

## CRITICAL RULES

- **No AI frameworks**: LangChain, AutoGen, CrewAI, Semantic Kernel — banned on the backend
- **No `any` types**: use `unknown` + type narrowing
- **No secrets in context**: credentials injected at runtime by tool executor, never passed to the LLM
- **No shell/filesystem access for agents**: period
- **No prompt-based security**: access control enforced in code at `ToolRegistry` + `src/security/`
- **No approval bypass**: never skip `ApprovalGate` for high/critical tools
- **No mutable PromptLayers**: create a new version, activate it — never edit existing
- **No direct LLM calls**: always go through the provider adapter + CostGuard
- **No wildcard tool permissions**: every tool explicitly whitelisted per agent

## Coding Standards

**Always**:
- TypeScript strict, zero `any` — use `unknown` + type guards
- Zod schemas for all external input (API, tool inputs/outputs, configs)
- JSDoc on every exported function and interface
- `pino` for logging — never `console.log`. Pattern: `logger.info('msg', { component: 'name' })`
- Dependency injection via constructor/function params
- Factory functions (not classes). Named exports only.
- `dryRun()` required on every tool
- `NexusError` subclass for errors, `Result<T, E>` for expected failures

**Never**:
- No circular deps between `src/` top-level directories
- No business logic in API route handlers
- No floating promises — always `await` or `.catch()`
- No hardcoded credentials, URLs, env-specific values

## Top Gotchas

- **`import { Prisma }` not `import type`** — `Prisma.sql` / `Prisma.join` are runtime values
- **cron-parser v5**: `CronExpressionParser.parse()` — not `parseExpression()` (that's v4)
- **Windows localhost**: use `HOST=::` (not `0.0.0.0`) — Windows resolves IPv6 first
- **`return await`** is required inside try/catch — ESLint enforces it
- **Logger pattern**: `logger.info('msg', { component: 'my-service' })` — `LogContext` requires `component`
- **Branded types**: cast with `as ProjectId`, `as AgentId`, etc.
- **`FastifyInstance`** type — not `ReturnType<typeof Fastify>` (that resolves to `any`)
- **Mock reset**: `mockClear()` + re-assign in `beforeEach`, not `vi.clearAllMocks()`
- **pgvector insert format**: `'[0.1,0.2,...]'::vector(1536)` in raw SQL
- **`inputSchema.safeParse().data`** is typed `any` — cast: `result.data as { field: Type }`
- **Fastify plugin**: outer function is sync (`void`), inner route handlers are `async`
- **void return in try/catch**: use `await fn(); return;` not `return await fn()` when fn returns void

## Commands

```bash
pnpm dev              # Dev server with hot reload
pnpm build            # Compile TypeScript
pnpm typecheck        # tsc --noEmit

pnpm test             # All tests
pnpm test:unit        # Unit tests only
pnpm test:integration # Integration (requires DB + Redis)
npx vitest run src    # All src tests directly

pnpm db:migrate       # Run Prisma migrations
pnpm db:generate      # Regenerate Prisma client
pnpm db:seed          # Seed dev data
pnpm db:studio        # Open Prisma Studio

pnpm lint             # ESLint
pnpm lint:fix         # ESLint auto-fix
pnpm format:fix       # Prettier write
```

## Testing

Test files live next to source: `foo.ts` → `foo.test.ts`.
Use `vi.mock()` for external deps. Fixtures in `src/testing/fixtures/`.
Every bug fix needs a regression test.
Integration tests run separately: `pnpm test:integration`.

## Dashboard (Git Submodule)

`dashboard/` is a separate git repo. The "no AI frameworks" rule is **backend only** — the dashboard uses shadcn/ui, React Query, Recharts, and any library that makes sense. No restrictions.

```bash
# Changes to dashboard code → commit inside dashboard/ → pushes to its own repo
# Update submodule pointer in this repo:
git submodule update --remote dashboard && git add dashboard && git commit -m "chore: update dashboard submodule"
```

See `dashboard/CLAUDE.md` for dashboard-specific standards and UX rules.
