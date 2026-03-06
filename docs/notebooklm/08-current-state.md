# Nexus Core — Current State, Decisions, and Roadmap

## What's Built (as of March 6, 2026)

### Core Engine — COMPLETE
- Full agent runner loop with streaming, failover, abort signal support
- 4-layer memory system (context window, pruning, compaction, pgvector long-term)
- 5-layer prompt system with independent versioning per project
- Cost guard with daily/monthly budgets and rate limiting
- Execution tracing with 15 event types (full audit trail)
- Result<T,E> type for expected failures, NexusError hierarchy

### LLM Providers — COMPLETE
- OpenAI (GPT-4o, GPT-4o-mini, o1) — verified E2E
- Anthropic (Claude Sonnet, Opus) — implemented, needs API key to test
- Google (Gemini) — implemented via OpenAI-compatible API
- Ollama (local models) — implemented via OpenAI-compatible API
- Failover between primary and fallback providers

### Tools — 28 IMPLEMENTED
All 28 tools are implemented, registered, and tested:
- Utility: calculator, date-time, json-transform
- Knowledge: knowledge-search, store-memory, web-search, scrape-webpage, read-file
- Communication: send-email, send-channel-message, send-notification, escalate-to-human
- Integration: http-request, propose-scheduled-task
- Orchestration: delegate-to-agent, list-project-agents
- Monitoring: get-operations-summary, get-agent-performance, review-agent-activity
- Session: query-sessions, read-session-history
- Vertical: catalog-search/order, vehicle-lead-score/check-followup, wholesale-update-stock/order-history, hotel-detect-language/seasonal-pricing

### Multi-Agent System — COMPLETE
- Agent registry with caching (1-min TTL)
- Inter-agent communication (EventEmitter-based: send, sendAndWait, subscribe)
- 4 operating modes: customer-facing, internal, copilot, manager
- Mode resolver: channel + contact role → agent mode
- Dual-mode support (same agent behaves differently per channel/audience)

### Channel System — COMPLETE
- WAHA adapter (WhatsApp Web Automation via QR code)
- Meta WhatsApp Cloud API adapter
- Telegram Bot API adapter
- Slack adapter
- Chatwoot adapter
- Dynamic channel resolver (lazy adapter creation from DB config + secrets)
- Inbound processor (webhook → contact → session → agent → response) — now includes session status awareness (skips closed sessions)
- Proactive messenger (BullMQ-backed outbound queue)
- Channel webhook routes (dynamic per project)

### Human Operator Takeover — NEW (March 6, 2026)
- `POST /projects/:id/sessions/:id/operator-message` — operator sends a message bypassing the agent loop
- Only works on `paused` sessions (409 if active)
- Message stored as `role: assistant` with `fromOperator: true` metadata
- Delivered to the customer's channel (WhatsApp/Telegram) if routing metadata exists
- Broadcasts via WebSocket to connected dashboard clients
- Enables full human takeover flow: pause session → operator types → customer receives

### Models API — NEW (March 6, 2026)
- `GET /models` — exposes curated list of LLM models with metadata (provider, context window, pricing, tool support)
- Powers the model selector in fomo-platform's agent config UI
- 15 models across Anthropic, OpenAI, Google, OpenRouter

### Security — COMPLETE
- Tool RBAC (explicit whitelist per agent, no wildcards)
- Approval Gate (high/critical tools pause for human review)
- Input Sanitizer (8 prompt injection patterns, max length)
- Secret Service (AES-256-GCM encrypted credentials)
- Telegram HITL notifier (approval notifications via Telegram)

### Scheduling — COMPLETE
- BullMQ-based task queue
- Cron expression support (cron-parser v5)
- Agent-proposed tasks with human approval flow
- Task executor (reuses prepareChatRun for consistency)
- Per-run budgets and timeouts

### MCP System — COMPLETE
- MCP client (stdio + SSE transport)
- Tool auto-discovery and registration
- MCPManager for server lifecycle
- 12 seeded templates (HubSpot CRM, Google Calendar, Odoo, etc.)
- HubSpot CRM reference server with 5 tools (including search-deals)

### Skills System — COMPLETE
- Skill templates (global catalog, 10 seeded)
- Skill instances (per project)
- Composition at chat time (instructions + tools merged into agent config)
- Dashboard UI for browsing, adding, configuring skills

### Database — COMPLETE
- 18 Prisma models
- pgvector for semantic search
- 6 seeded projects, 6 seeded agents
- 18+ prompt layers
- Scheduled tasks (Manager daily summary, Market Paper campaign)

### Dashboard — 29 PAGES
All pages implemented:
- Home (stats, approvals, projects)
- Projects (list, create, overview)
- Agents (list, create wizard, detail/config, test chat, logs)
- Copilot (manager chat + sidebar)
- Inbox (WhatsApp Web-style)
- Integrations (channel wizard)
- Skills (catalog + project instances)
- MCP Servers (templates + instances)
- Approvals, Prompts, Costs, Traces, Knowledge, Files, Tasks, Webhooks, Secrets, Contacts, Catalog
- Global approvals, settings, templates

### Test Coverage
- 0 TypeScript errors
- 91 test files, 1235 tests passing
- 1 pre-existing send-email test failure (expected — no Resend API key in test env)
- 2 skipped integration tests (require external services)

## Key Product Decisions (confirmed Feb 24, 2026)

1. **Dashboard is internal-only.** Only the Fomo team uses it. Client-facing UI will be a separate product (fomo-platform) later.

2. **Deploy model:** Both shared (multi-project on one server) and dedicated (per-client Docker Compose).

3. **MVP scope:** Multi-agent + manager. Create project → agents → connect WhatsApp → agent responds. Manager copilot for the business owner.

4. **Manager/Copilot agent** is the core differentiator. One per project, it's the business owner's right-hand: monitors operations, reviews conversations, delegates tasks, reports with full autonomy + on-demand chat.

5. **UX principles** (non-negotiable):
   - No technical jargon in the dashboard
   - Wizard flows for multi-step setup
   - Visual catalogs with logos/icons for tools, channels, MCP servers
   - Smart defaults — pre-fill everything possible
   - Immediately testable — "Test Chat" right after configuration
   - Empty states with CTAs
   - Error states with actions
   - Max 2-3 visible fields, rest under "Advanced"

6. **WAHA bundled in Docker Compose.** Runs alongside the server, user just scans QR. Also supports Meta WhatsApp Business API from day one.

7. **All prompts in Spanish rioplatense** (Argentine Spanish) by default. Per-agent language configuration.

## Known Issues & Gaps

### Blocking Issues
- **ANTHROPIC_API_KEY empty in .env** — Only OpenAI works for E2E testing. Anthropic provider is implemented but untested.
- **Prisma migrations on VPS** — Two migrations (`add_channel_integrations`, `add_secrets_table`) need `prisma migrate deploy` on production.
- **Market Paper agent** needs HubSpot access token + WAHA outbound number configured via secrets.

### Non-Blocking Gaps
- **Agent edit page** — Still uses old "Operating Modes" raw UI instead of the new "Canales" (Channels) visual UI that was implemented for agent creation.
- **Webhook signature validation** — Implemented for Slack, Meta; Telegram relies on bot token secrecy.
- **Rate limiting** — Basic Fastify rate limiting exists but not per-project.
- **Multi-tenant isolation** — All data filtered by projectId, but no row-level security in DB.
- **Backup/restore** — No automated backup strategy for PostgreSQL.
- **Monitoring/alerting** — No external monitoring (Sentry, Datadog, etc.) integrated yet.

## What's Next (Priority Order)

### Immediate (This Sprint)
1. **Market Paper — Complete Setup**
   - Set HubSpot access token in project secrets
   - Configure WAHA outbound WhatsApp number
   - Test reactivation campaign: find inactive deals, send 3 test messages
   - Finalize agent name (Reactivadora + vendedora name)

### Short-Term
2. **Dashboard UX overhaul**
   - Update agent edit page to use new Channels UI
   - Wizard flow for channel setup (currently basic form)
   - Visual catalog for MCP servers and tools (card grid with logos)
   - Conversation view polish in inbox

3. **WAHA Docker bundled flow**
   - WAHA runs in docker-compose auto-configured
   - User just scans QR in the dashboard
   - Webhook URL auto-registered

### Medium-Term
4. **Manager capabilities expansion**
   - `analyze-conversations` tool — sentiment trends, topic clustering
   - `manage-contacts` tool — bulk tag, segment, export
   - `generate-report` tool — PDF/HTML report generation
   - `update-agent-config` tool — manager can tweak agent settings (with approval)

5. **MCP integrations**
   - Google Calendar MCP server (appointment booking)
   - Google Sheets MCP server (data export/import)
   - Stripe/MercadoPago MCP server (payment processing)
   - Slack MCP server (team notifications)

6. **Skills expansion**
   - `daily-briefing` skill — automated morning summary
   - `competitor-monitor` skill — web scraping competitive intelligence
   - `conversation-digest` skill — daily conversation summary
   - `onboarding-checklist` skill — guided client setup

### Long-Term
7. **Client-facing platform (fomo-platform)**
   - Separate Next.js app for business clients
   - Read-only dashboard: conversation view, basic metrics
   - Self-service agent configuration (limited)

8. **Advanced features**
   - Voice channel support (Twilio)
   - Image/document understanding (multimodal)
   - A/B testing for prompt layers
   - Auto-scaling based on load

## Architecture Principles (Summary)

| Principle | Implementation |
|-----------|---------------|
| Type safety | TypeScript strict, zero `any`, branded IDs, Zod for all boundaries |
| No AI frameworks | Custom agent loop, no LangChain/AutoGen/CrewAI |
| DI via factories | No classes, factory functions with options objects |
| Result type | Expected failures return `Result<T,E>`, exceptions for bugs only |
| Observability | ExecutionTrace with 15 event types, pino structured logging |
| Security in code | RBAC at ToolRegistry, ApprovalGate for HITL, SecretService for credentials |
| Immutable prompts | New versions created, old retained for audit |
| Budget enforcement | CostGuard with pre-check before every LLM call |

## Common Development Tasks

### Add a new tool
1. `scaffoldTool()` → generates boilerplate
2. Fill Zod schemas, implement `execute()` + `dryRun()`
3. Register in `src/tools/definitions/index.ts`
4. Register in `src/main.ts`
5. Write 3-level tests (schema, dryRun, integration)

### Add a new API route
1. Create `src/api/routes/<resource>.ts` with Zod schemas
2. Implement Fastify route plugin
3. Register in `src/api/routes/index.ts`
4. Inject dependencies via RouteDependencies

### Add a channel adapter
1. Implement `ChannelAdapter` interface in `src/channels/adapters/`
2. Add integration config type
3. Register in `ChannelResolver.createAdapter()`
4. Add webhook route

### Modify the database
1. Edit `prisma/schema.prisma`
2. Run `pnpm db:migrate` (creates migration)
3. Run `pnpm db:generate` (regenerates Prisma client)
4. Update seed if needed

### Test commands
```bash
pnpm test:unit            # Unit tests (excludes tool tests)
npx vitest run src/tools/definitions/  # All tool tests
npx vitest run src        # ALL tests
pnpm typecheck            # TypeScript check (tsc --noEmit)
```

## Client Deployments (Current)

### Demo Project
- Full-featured demo with all entity types
- 3 agents: Customer Support, Sales, Internal Analyst
- 1 Manager agent with daily summary task
- All 28 tools registered

### Market Paper (Production-Ready)
- Paper/packaging wholesale company
- Reactivación campaign via WhatsApp
- HubSpot CRM integration for deal tracking
- Agent: "Reactivadora" — contacts inactive deals, engages in conversation
- Scheduled: L-V 9am, checks HubSpot for leads in "Seguimiento" stage with 14+ days inactivity

### Templates Available
- Car Dealership (vehicle lead scoring)
- Wholesale Hardware (stock management)
- Boutique Hotel (seasonal pricing, language detection)
- E-commerce Store (catalog orders)

## Gotchas & Common Pitfalls

1. **cron-parser v5** — Use `CronExpressionParser.parse()`, NOT `parseExpression()` (v4 API)
2. **Windows localhost** — Use `HOST=::` (IPv6), not `0.0.0.0`
3. **Prisma JSON columns** — Cast with `as Prisma.InputJsonValue`, never `as any`
4. **pgvector inserts** — Use `'[0.1,0.2,...]'::vector(1536)` format in raw SQL
5. **Branded types** — Cast with `as ProjectId`, ESLint allows it
6. **`return await` in try/catch** — ESLint enforces it (return-await rule)
7. **void returns in try/catch** — Use `await fn(); return;` not `return await fn()`
8. **Mock reset** — Use `mockClear()` + re-set in `beforeEach`, NOT `vi.clearAllMocks()`
9. **`dotenv/config`** — Must be first import in `main.ts`
10. **Dashboard submodule** — Changes committed inside `dashboard/`, separate git repo
