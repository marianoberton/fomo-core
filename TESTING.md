# Nexus Core — Testing Plan

## Overview

This document outlines the comprehensive testing strategy for Nexus Core. The framework has multiple testing levels to ensure reliability, security, and performance.

**Current State:** 59 test files, 828 tests passing, 0 type errors, 0 lint errors

---

## 1. Unit Tests (✅ Complete)

**Status:** 828 tests passing
**Command:** `pnpm test`

### Coverage Areas
- ✅ **Core**: agent-runner, result types, errors
- ✅ **Providers**: anthropic, openai, factory
- ✅ **Tools**: registry, all 7 tool definitions
- ✅ **Memory**: memory-manager, prisma-memory-store
- ✅ **Cost**: cost-guard, usage tracking
- ✅ **Security**: approval-gate, input-sanitizer
- ✅ **Prompts**: prompt-builder, layer-manager
- ✅ **Scheduling**: task-manager, task-runner
- ✅ **API**: all routes (projects, sessions, chat, etc.)
- ✅ **CLI**: chat.ts pure functions

### Run Unit Tests
```bash
pnpm test                    # All tests
pnpm test -- --run <file>   # Single file
pnpm test:unit              # Unit tests only (when integration tests exist)
```

---

## 2. Integration Tests (❌ TODO)

**Status:** Not yet implemented
**Command:** `pnpm test:integration` (to be created)

### What to Test

#### 2.1 Database Integration
- [ ] **Project CRUD** — Create, read, update, delete projects with real Prisma
- [ ] **Session persistence** — Sessions saved and retrieved correctly
- [ ] **Prompt layers** — Activate/deactivate layers, version management
- [ ] **Execution traces** — Full trace events written and queried
- [ ] **Usage records** — Cost tracking persists across runs
- [ ] **Memory entries** — Long-term memory with pgvector similarity search

#### 2.2 Redis + BullMQ Integration
- [ ] **Task scheduling** — Scheduled tasks enqueue and run via BullMQ
- [ ] **Task execution** — Worker processes jobs correctly
- [ ] **Cron parsing** — Cron expressions calculate next run times
- [ ] **Task state transitions** — proposed → approved → active → paused → completed

#### 2.3 Provider Integration (Real APIs)
- [ ] **Anthropic** — Real Claude API call with streaming
- [ ] **OpenAI** — Real GPT-4o API call with streaming + usage
- [ ] **Cost calculation** — Real usage → cost with actual model pricing
- [ ] **Failover** — Primary provider fails → fallback provider used
- [ ] **Rate limiting** — Respect provider rate limits

#### 2.4 Tool Execution
- [ ] **calculator** — Real math operations
- [ ] **date-time** — Real date/time queries
- [ ] **json-transform** — Real JSON manipulation
- [ ] **Tool approval** — High-risk tools pause for approval
- [ ] **Tool errors** — Graceful handling of tool failures

#### 2.5 Memory System
- [ ] **Context window** — Pruning when conversation exceeds limit
- [ ] **Compaction** — LLM-summarized compression works
- [ ] **Long-term memory** — pgvector retrieval returns relevant memories
- [ ] **Memory decay** — Decay function reduces old memory scores

### Setup
```bash
# Start Docker services
docker-compose up -d postgres redis

# Run migrations
pnpm db:migrate

# Seed test data
pnpm db:seed

# Run integration tests
pnpm test:integration
```

**TODO:** Create `src/**/*.integration.test.ts` files for above scenarios.

---

## 3. End-to-End Tests (❌ TODO)

**Status:** Manual only (no automated E2E yet)
**Scope:** Full agent loop from user input → LLM → tools → response

### 3.1 Chat API E2E
- [ ] POST `/chat` with real LLM provider
  - User message → agent response
  - Session continuity across messages
  - Tool use (calculator, date-time, json-transform)
  - Cost tracking updates
  - Trace events written to DB

### 3.2 WebSocket Streaming E2E
- [ ] WS `/chat/stream` with real LLM provider
  - Token-by-token streaming works
  - Tool use events emitted (tool_use_start, tool_result)
  - agent_complete event includes usage + cost
  - Reconnection handling

### 3.3 CLI Chat E2E (✅ Manually Verified)
- [x] `pnpm chat` selects project
- [x] Streaming works in terminal
- [x] Token counts display correctly
- [x] Cost displays with real pricing
- [x] Commands work (/quit, /new, /help)

### 3.4 Scheduled Tasks E2E
- [ ] Agent proposes task via `propose-scheduled-task` tool
- [ ] Task appears as `proposed` status
- [ ] Human approves task via API
- [ ] BullMQ worker picks up task at next cron time
- [ ] Agent runs and completes task
- [ ] Task run saved to DB with trace

### 3.5 Multi-Turn Conversations
- [ ] Agent asks clarifying questions
- [ ] User provides more context
- [ ] Agent uses previous context to answer
- [ ] Memory pruning doesn't break context
- [ ] Max turns limit respected

### 3.6 Error Scenarios
- [ ] Budget exceeded → agent stops gracefully
- [ ] Max turns reached → agent returns partial answer
- [ ] LLM timeout → fallback provider used (if configured)
- [ ] Tool execution fails → agent handles error and informs user
- [ ] Invalid tool input → agent retries with corrected input

### Run E2E Tests
```bash
# Start services
docker-compose up -d
pnpm dev

# Run E2E suite (TODO: create)
pnpm test:e2e
```

---

## 4. Manual Testing Checklist

### 4.1 CLI Chat (`pnpm chat`)
- [x] Project selection menu
- [x] Streaming token-by-token output
- [x] Token count displays correctly
- [x] Cost displays with real pricing ($0.00XX format)
- [x] Session continuity (follow-up questions use context)
- [x] `/new` command starts new session
- [x] `/help` shows commands
- [x] `/quit` exits cleanly
- [x] ANSI colors render correctly
- [ ] Tool use displays (e.g., calculator)
- [ ] Error messages in red
- [ ] Ctrl+C graceful shutdown

### 4.2 REST API
- [ ] `GET /projects` — List all projects
- [ ] `POST /projects` — Create project with valid AgentConfig
- [ ] `GET /projects/:id` — Get single project
- [ ] `PATCH /projects/:id` — Update project config
- [ ] `GET /projects/:id/sessions` — List sessions
- [ ] `POST /chat` — Send message, get response
- [ ] `GET /projects/:id/prompt-layers/active` — Active layers per type
- [ ] `POST /projects/:id/prompt-layers` — Create new layer version
- [ ] `POST /prompt-layers/:id/activate` — Activate layer, deactivate old
- [ ] `GET /traces/:id` — Full execution trace
- [ ] `POST /scheduled-tasks/:id/approve` — Approve proposed task

### 4.3 WebSocket Streaming
- [ ] Connect to `ws://localhost:3002/chat/stream`
- [ ] Send `{ projectId, message }`
- [ ] Receive `agent_start` event
- [ ] Receive `content_delta` events (streaming text)
- [ ] Receive `tool_use_start` / `tool_result` (if tool used)
- [ ] Receive `agent_complete` with usage + cost
- [ ] Error events on invalid input

### 4.4 Security & Permissions
- [ ] High-risk tool blocks without approval
- [ ] Approval gate pauses execution
- [ ] POST `/approvals/:id/approve` unblocks
- [ ] POST `/approvals/:id/deny` aborts run
- [ ] Tool not in `allowedTools` is rejected
- [ ] Input sanitizer strips harmful patterns
- [ ] Secrets not exposed in logs or traces

### 4.5 Scheduled Tasks
- [ ] Agent proposes task with cron expression
- [ ] Task appears in `GET /scheduled-tasks?status=proposed`
- [ ] Approve via `POST /scheduled-tasks/:id/approve`
- [ ] Task runs at scheduled time (check logs)
- [ ] Task run saved to DB
- [ ] `POST /scheduled-tasks/:id/pause` prevents execution
- [ ] `POST /scheduled-tasks/:id/resume` re-enables

### 4.6 Cost & Budget
- [ ] Usage records saved after each turn
- [ ] Cost calculated with real model pricing
- [ ] Daily budget exceeded → agent stops
- [ ] Monthly budget exceeded → agent stops
- [ ] Alert threshold triggers warning log
- [ ] `GET /projects/:id/usage` returns aggregated costs

---

## 5. Performance Testing (❌ TODO)

### 5.1 Load Testing
- [ ] 10 concurrent chat requests
- [ ] 50 concurrent chat requests
- [ ] 100 concurrent chat requests
- [ ] Measure: response time, throughput, error rate

### 5.2 Streaming Performance
- [ ] WebSocket streaming latency (time to first token)
- [ ] Token throughput (tokens/sec)
- [ ] Concurrent WebSocket connections

### 5.3 Database Performance
- [ ] Trace write performance (10k+ events)
- [ ] pgvector similarity search (1k+ memories)
- [ ] Session query performance (1k+ sessions)

### 5.4 Memory Limits
- [ ] Context window pruning (200k token conversations)
- [ ] Compaction triggers correctly
- [ ] Long-term memory retrieval speed

### Tools
- **k6** or **Artillery** for HTTP load testing
- **wscat** for WebSocket testing
- **pgbench** for database benchmarking

---

## 6. Security Testing (❌ TODO)

### 6.1 Input Validation
- [ ] SQL injection attempts blocked
- [ ] XSS payloads sanitized
- [ ] Command injection rejected
- [ ] Path traversal blocked
- [ ] Excessively long inputs rejected

### 6.2 Tool Security
- [ ] Tools cannot access filesystem
- [ ] Tools cannot execute shell commands
- [ ] Tools cannot access network (except HTTP tool with allowlist)
- [ ] Hallucinated tools rejected by registry

### 6.3 Prompt Injection
- [ ] Agent doesn't leak system prompt
- [ ] Agent doesn't execute user-injected instructions
- [ ] Safety layer enforced even with adversarial prompts

### 6.4 RBAC
- [ ] Tools respect `allowedTools` whitelist
- [ ] Approval gates cannot be bypassed
- [ ] Projects isolated from each other

---

## 7. Regression Testing

### When to Run
- Before every release
- After any core system change (agent-runner, providers, tools)
- After dependency updates

### Checklist
- [ ] All unit tests pass (`pnpm test`)
- [ ] No type errors (`pnpm typecheck`)
- [ ] No lint errors (`pnpm lint`)
- [ ] Manual E2E scenarios pass
- [ ] No performance degradation vs baseline

---

## 8. Continuous Integration (❌ TODO)

### GitHub Actions Workflow (TODO)
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 22
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm test:integration
```

---

## 9. Test Data Management

### Seeds
- `pnpm db:seed` — Demo Project (now with correct config)
- `pnpm db:seed:fomo` — Fomo Internal Assistant (OpenAI)

### Fixtures
- `src/testing/fixtures/context.ts` — Mock ExecutionContext
- `src/testing/fixtures/routes.ts` — Mock Fastify instance

### Test Database
- Use separate test DB: `nexus_core_test`
- Reset between integration test runs
- Seed test data via fixtures

---

## 10. Known Issues & Edge Cases

### Fixed
- ✅ OpenAI usage chunk skipped (fixed by capturing chunk.usage separately)
- ✅ Demo Project config wrong shape (fixed by migration script)
- ✅ Cost always $0.0000 (fixed by importing real pricing from models.ts)

### To Investigate
- [ ] MaxListenersExceededWarning on server start (11 exit listeners)
- [ ] tsx watch DLL lock issue (EPERM on Prisma generate while server running)
- [ ] Windows path separators in file storage (use `/` not `\`)

---

## Summary

| Test Level        | Status      | Coverage |
|-------------------|-------------|----------|
| Unit Tests        | ✅ Complete | 828 tests |
| Integration Tests | ❌ TODO     | 0%       |
| E2E Tests         | 🟡 Manual   | CLI only |
| Performance Tests | ❌ TODO     | 0%       |
| Security Tests    | ❌ TODO     | 0%       |

**Next Steps:**
1. ✅ Fix CLI chat + token usage (DONE)
2. ✅ Fix cost calculation (DONE)
3. ✅ Fix Demo Project config (DONE)
4. ❌ Create integration tests for DB + Redis + providers
5. ❌ Automate E2E tests for full agent loop
6. ❌ Set up CI/CD pipeline with automated tests
