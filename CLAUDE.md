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
| Agent archetype catalog | `prisma/schema.prisma` (`AgentTemplate` model) + `src/api/routes/agent-templates.ts` |
| Materialize template → agent | `src/api/routes/agents.ts` → `POST /projects/:id/agents/from-template` |
| Campaign audience from MCP | `src/campaigns/campaign-runner.ts` → `resolveAudience()` |

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
| Creating an agent from scratch for a common pattern | Use a template — `POST /agents/from-template` with `templateSlug` |
| Campaign needs audience from external system (HubSpot, CRM) | `audienceSource: { kind: 'mcp', serverName, toolName, args, mapping, ttlHours }` |
| Add a new official AgentTemplate to the catalog | New entry in `prisma/seed.ts` `seedAgentTemplates()` + manual SQL seed in prod (see `seed-prod` skill) |

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

## Agent Types & Templates (since April 2026)

### AgentType enum (replaces legacy `operatingMode`)

Three values based on what triggers the agent:

- **`conversational`** — customer-facing, replies to inbound messages on channels (WhatsApp/Telegram/Slack). The channel inbound is the primary trigger.
- **`process`** — scheduled/batch, triggered by cron or batch API call. No human sync conversation.
- **`backoffice`** — internal/copilot/manager/admin, triggered by Fomo team or owner via UI/Slack/WhatsApp-owner. Disambiguated further via `metadata.archetype`.

The legacy `operatingMode` field (5 values: customer-facing / internal / copilot / manager / admin) was dropped in migration `20260423000000_add_agent_type_and_campaign_links`. Dual-trigger agents (e.g., conversational agent with a scheduled task) keep their primary type — `scheduledTask.executor` does not filter by `agent.type`.

### Platform-bridge legacy role SHIM

`src/api/routes/platform-bridge.ts` serves fomo-platform (marketpaper-demo frontend), which still expects the old 5-value `role` string. The SHIM in `src/core/agent-role-shim.ts` maps `(type, metadata.archetype)` → legacy role:

- `conversational` → `customer-facing`
- `backoffice` + `archetype === 'manager'` → `manager`
- `backoffice` + `archetype === 'copilot'` → `copilot`
- `backoffice` + `archetype === 'admin'` → `admin`
- `backoffice` (other) → `internal`
- `process` → `internal`

Deprecate `legacyRoleOf()` when fomo-platform migrates to consume `type` + `archetype` directly.

### AgentTemplate catalog (global)

`AgentTemplate` is a global catalog (no `projectId`) of reusable agent archetypes. Fomo publishes official templates; projects materialize them via `POST /projects/:id/agents/from-template`. Fields use no `default` prefix: `promptConfig`, `suggestedTools`, `suggestedLlm`, `suggestedModes`, `suggestedChannels`, `suggestedMcps`, `suggestedSkillSlugs`, `metadata`, `maxTurns`, `maxTokensPerTurn`, `budgetPerDayUsd`.

Official seeded templates:

| Slug | Type | Purpose |
|------|------|---------|
| `customer-support` | conversational | Attend customer inquiries, escalate when unsure |
| `outbound-campaign` | process | Reactivation / prospecting; escalate on interest |
| `copilot-owner` | backoffice | Chief of Staff for the business owner |
| `manager-delegator` | backoffice | Routes requests to specialist sub-agents |
| `knowledge-bot` | conversational | RAG-only answers from the KB |

Read-only API:
- `GET /api/v1/agent-templates?type=&tag=&q=&isOfficial=`
- `GET /api/v1/agent-templates/:slug`

Materializer (12-step validation):
- `POST /api/v1/projects/:projectId/agents/from-template` → body `{ templateSlug, name, overrides? }`

`overrides` can shadow any field from the template (description, promptConfig, llmConfig, toolAllowlist, channelConfig, limits, metadata, managerAgentId). The materializer validates template exists, project exists, name collision, tool registry coverage, managerAgentId (must be backoffice in same project), channel availability (warning only), mode collision. It seeds project-level PromptLayers if missing (respecting the "no mutable PromptLayers" rule — only creates when no active layer exists).

### Campaign audience sources

Campaigns now require `agentId` (was implicit before). `audienceSource` is an optional discriminated union:

```ts
type AudienceSource =
  | { kind: 'contacts'; filter: AudienceFilter }        // legacy — local Contact table
  | { kind: 'mcp';                                       // via MCP tool (HubSpot, etc)
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
      mapping: { contactIdField, phoneField?, emailField?, nameField? };
      ttlHours: number }
```

Either `audienceFilter` OR `audienceSource` is required at creation time (Zod refine).

`campaign-runner.ts` exports `resolveAudience(deps, campaign, { force? })`:
- Cache hit (sourceHash match + expiresAt > now) → returns cached contactIds.
- Cache miss → calls MCP, upserts Contacts by (projectId, phone) or (projectId, email), persists `audienceCache` on the campaign.
- `force: true` ignores the cache.

Endpoint `POST /api/v1/projects/:projectId/campaigns/:id/refresh-audience` calls `resolveAudience(…, { force: true })`.

`CampaignSend.agentId` is populated from `campaign.agentId` for historical traceability (if the campaign's agent is changed later, sends keep the agent they were sent under).

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
- **`prisma migrate deploy` does NOT run seeds in production** — only schema migrations. Any table needing initial data (agent_templates, skill_templates, etc.) requires manual seeding via SQL. See `seed-prod` skill.
- **`prisma/seed.ts` main() is gated by `ALLOW_PROD_SEED=1`** — running `pnpm db:seed` in prod without that env var throws `assertSafeToSeed` error. Intentional guardrail: `main()` seeds demo projects/agents that would clobber real client data.
- **Dashboard deploy is MANUAL in Dokploy** — unlike the backend (auto-deploys on push to `main`). After pushing to `main` of the `fomo-core-dashboard` repo, go to Dokploy UI and click Deploy on the dashboard app.
- **`submodule update` after pulling main** — if someone updated the dashboard pointer, a fresh pull leaves `dashboard/` pointing to the old commit. Run `git submodule update` to sync.
- **AgentTemplate fields use NO `default` prefix** — it's `promptConfig`, not `defaultPromptConfig`. The "suggested*" prefix marks fields overridable at instantiation; `promptConfig` and `metadata` use no prefix.
- **`suggestedChannels` is `string[]` not `{ channels: [...] }`** — flat array, no wrapper object.

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

## Production Operations

### Infrastructure
- **VPS**: SSH alias `hostinger-fomo` (equivalent to `ssh root@147.79.81.222`)
- **Backend container**: `compose-generate-multi-byte-system-fqoeno-app-1`
- **Auto-deploy**: push to `main` → Dokploy picks it up in ~2-3 min
- **API key**: stored in `.env` as `NEXUS_API_KEY` — never hardcode in code or docs

### Pre-push Checklist (mandatory — skipping broke deploy 4× in April 2026)

```bash
pnpm build                                    # Must exit 0 with no errors
timeout 10 node dist/main.js 2>&1 | head -50  # Must print "Server listening on 0.0.0.0:3002"
                                              # Must NOT print ReferenceError / TypeError
```

If build fails, fix before pushing. If startup crashes, diagnose before pushing.

### Deploy & Verify

```bash
git push origin main

# Wait ~2-3 min, then:
ssh hostinger-fomo "docker ps --format '{{.Names}}\t{{.Status}}' | grep fqoeno"
# ✅ "Up X seconds/minutes" (< 3 min = fresh deploy)
# ❌ "Up X hours" = deploy didn't apply — check Dokploy UI for the app "compose-generate-multi-byte-system-fqoeno"
```

### Testing Against the Production Container

Base image is `node:22-alpine` — **no `curl`**. Use `wget`. Always use `127.0.0.1`, not `localhost` (IPv6 resolves first inside the container).

```bash
# HTTP endpoint (GET)
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 \
  wget -qO- --header="Authorization: Bearer $NEXUS_API_KEY" \
  http://127.0.0.1:3002/api/v1/<path> 2>&1'

# HTTP endpoint with headers only (check status code)
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 \
  wget -S --header="Authorization: Bearer $NEXUS_API_KEY" \
  http://127.0.0.1:3002/api/v1/<path> 2>&1 | head -5'

# WebSocket handshake (expect 101)
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 sh -c \
  "wget -S --header=\"Upgrade: websocket\" --header=\"Connection: Upgrade\" \
   --header=\"Sec-WebSocket-Version: 13\" --header=\"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\" \
   \"http://127.0.0.1:3002/api/v1/ws?projectId=test\" 2>&1 | head -5"'
```

### Reading Production Logs

```bash
# Last N lines
ssh hostinger-fomo "docker logs --tail 30 compose-generate-multi-byte-system-fqoeno-app-1 2>&1"

# Since N minutes ago
ssh hostinger-fomo "docker logs --since 5m compose-generate-multi-byte-system-fqoeno-app-1 2>&1"

# Filter by component (logs are JSON; grep on component name)
ssh hostinger-fomo "docker logs --since 5m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep 'auth-middleware'"

# Filter by keyword
ssh hostinger-fomo "docker logs --since 10m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep 'ERROR\|WARN'"
```

### Common Prod Diagnostics

| Symptom | What to check |
|---------|--------------|
| 401 with no log | A `preHandler` hook (e.g. `adminAuth`) applied globally — check if route fn uses `fastify.addHook()` outside `register()` |
| 401 with "Rejected" log | `auth-middleware.ts` exemption not matching the actual URL |
| 403 | `requireProjectAccess` or `requireScope` blocking |
| Deploy not applied | Container "Up X hours" → check Dokploy app UI |
| Container restart loop | `docker logs` for startup crash — usually DB unreachable or bad env var |

### Fastify Hook Scope Rule

When a route file calls `fastify.addHook('preHandler', hook)` **without** wrapping in `fastify.register()`, the hook applies to the entire parent scope. If a route function is called directly (`adminRoutes(fastify, deps)`) the hook bleeds into all siblings. Fix: wrap in `fastify.register(async (f) => { adminRoutes(f, deps); })` to encapsulate.

### Dashboard deploy (manual)

The dashboard app in Dokploy is configured with manual deploy (not auto like the backend). After pushing changes to `fomo-core-dashboard/main`:

1. Log into Dokploy UI.
2. Go to the dashboard application.
3. Click "Deploy" manually.
4. Wait ~2 min for the build.
5. Verify at `https://fomo-core-dashboard.fomo.com.ar`.

This is intentional — dashboard changes are more visual / user-facing and benefit from a manual gate before going live.

### Seeding non-schema data in production

`prisma migrate deploy` handles schema but not data. For catalogs (AgentTemplates, SkillTemplates, MCPTemplates) the flow is:

1. Add the new entry to `prisma/seed.ts` (so dev + future resets are correct).
2. Generate an idempotent SQL with `ON CONFLICT DO NOTHING`.
3. Copy to VPS, run inside the postgres container.

See `.claude/skills/seed-prod.md` for the full procedure.
