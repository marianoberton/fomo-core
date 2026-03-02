# Nexus Core — Security, Scheduling, and Operations

## Security Architecture

Nexus Core has multiple layers of security, from input validation to encrypted credential storage. The key principle: **security is enforced in code, not in prompts.** Prompt injection can't bypass tool permissions, approval gates, or credential access.

## Approval Gate (src/security/approval-gate.ts)

### Purpose

When an agent tries to use a high-risk or critical-risk tool (like `send-email` or `catalog-order`), the execution pauses and waits for human approval. This is the "human-in-the-loop" (HITL) safety net.

### How It Works

1. Agent runner detects a tool call with `riskLevel: 'high'` or `'critical'`
2. Creates an `ApprovalRequest` in the database:
   ```typescript
   ApprovalRequest {
     toolCallId, toolId, toolInput,
     riskLevel, status: 'pending',
     expiresAt: now + 30 minutes
   }
   ```
3. Sends a notification to the Fomo team via Telegram:
   ```
   🔔 Approval Required
   Tool: send-email
   Input: { to: "client@example.com", subject: "..." }
   Risk: high
   [Approve] [Reject]
   ```
4. The agent execution pauses with status `'human_approval_pending'`
5. A human reviews and approves/rejects via:
   - Dashboard approvals page (`/projects/[id]/approvals`)
   - Telegram inline buttons
   - REST API: `PATCH /api/v1/approvals/:id`
6. If approved → tool executes, agent continues
7. If rejected → agent receives rejection, generates alternative response
8. If expired (30 min default) → treated as rejection

### Approval States

```
pending → approved → (tool executes)
pending → rejected → (agent handles rejection)
pending → expired  → (treated as rejected)
```

### Telegram HITL Notifier

The `TelegramApprovalNotifier` sends approval requests to a Telegram group/channel. Configured via:
- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather
- `TELEGRAM_CHAT_ID` — Target group/channel ID

It also bridges the approval context back to the dashboard via `SessionBroadcaster`, so the dashboard can show approval status in real-time.

## Input Sanitizer (src/security/input-sanitizer.ts)

### Purpose

Validates and sanitizes user input before it reaches the agent. Defense-in-depth — not a security boundary (prompts can always be creative), but catches obvious attacks.

### What It Does

1. **Max length enforcement:** Default 100KB. Rejects messages that are too long.
2. **Null byte stripping:** Removes `\0` characters that could cause issues.
3. **Prompt injection detection:** Scans for 8 known patterns:
   - "ignore all previous"
   - "ignore your instructions"
   - "system:"
   - "you are now"
   - "new instructions:"
   - "override your"
   - "forget everything"
   - "act as if"

**Important:** The sanitizer logs detections but does NOT strip the content. It's a monitoring tool, not a filter. Real security is enforced by:
- Tool RBAC (agent can't use tools it's not whitelisted for)
- ApprovalGate (high-risk tools need human approval)
- SecretService (credentials never in LLM context)

## Tool RBAC (src/tools/registry/)

### How Tool Permissions Work

1. **Agent config:** Each agent has `toolAllowlist: string[]` — an explicit list of tool IDs.
2. **Context setup:** At chat time, `allowedTools` is loaded into `ExecutionContext.permissions.allowedTools` as a `ReadonlySet<string>`.
3. **Tool description filtering:** Only whitelisted tools are included in the LLM's system prompt. The LLM literally can't see tools it doesn't have access to.
4. **Execution check:** Even if the LLM somehow calls an unlisted tool (impossible in practice but defense-in-depth), the ToolRegistry blocks it with `ToolNotAllowedError`.
5. **Hallucination detection:** If the LLM calls a tool that doesn't exist at all, it's caught and logged as `tool_hallucination` in the trace.

### Risk Levels

| Risk | Description | Approval | Example Tools |
|------|-------------|----------|---------------|
| `low` | Read-only, no side effects | No | calculator, date-time, knowledge-search |
| `medium` | External calls, limited impact | No | http-request, web-search, send-notification |
| `high` | Side effects, costs money, affects state | Yes | send-email, send-channel-message, catalog-order |
| `critical` | Irreversible, security-sensitive | Yes | (future: delete-data, modify-agent-config) |

## Secrets Management (src/secrets/)

### Architecture

Credentials are encrypted at rest using AES-256-GCM and decrypted only when needed at runtime:

```
User enters API key via dashboard
  → Dashboard sends to Nexus Core API
  → SecretService.set() encrypts with AES-256-GCM
  → Stores: encrypted_value, iv, auth_tag in secrets table
  → Returns: key name (never the value)

Tool needs a credential at execution time
  → Tool calls options.secretService.get(projectId, 'HUBSPOT_TOKEN')
  → SecretService.get() reads from DB
  → Decrypts with AES-256-GCM using SECRETS_ENCRYPTION_KEY env var
  → Returns plaintext to tool (in memory only)
  → Tool uses credential, then it goes out of scope
```

### Key Points

- **SECRETS_ENCRYPTION_KEY** must be a 32-byte hex string in the `.env` file
- Secrets are **never** returned in API responses (GET `/secrets` returns only key names)
- Secrets are **never** passed to the LLM context
- Each secret has a unique constraint: `@@unique([projectId, key])`
- Tools receive the `SecretService` via factory injection, not via `ExecutionContext`

### Encryption Details

```typescript
interface SecretService {
  set(projectId: string, key: string, value: string): Promise<void>;
  get(projectId: string, key: string): Promise<string | null>;
  delete(projectId: string, key: string): Promise<void>;
  list(projectId: string): Promise<string[]>; // Returns key names only
}
```

AES-256-GCM provides:
- Confidentiality (encryption)
- Integrity (authentication tag verifies no tampering)
- Uniqueness (random IV per encryption)

## Scheduling System (src/scheduling/)

### Architecture

The scheduling system uses BullMQ (Redis-backed) for reliable task execution:

```
Agent proposes a task via propose-scheduled-task tool
  → Creates ScheduledTask with status='proposed'
  → Human approves via dashboard or API
  → Status changes to 'active'
  → BullMQ picks it up on next cron tick
  → TaskExecutor runs the agent loop (one-shot)
  → Results stored in ScheduledTaskRun
```

### Components

**TaskManager (src/scheduling/task-manager.ts):**
- Creates and manages tasks
- Handles approval workflow (proposed → active)
- Calculates next run time from cron expression

**TaskRunner (src/scheduling/task-runner.ts):**
- BullMQ-based worker
- Polls for active tasks where `nextRunAt <= now`
- Spawns TaskExecutor for each eligible task

**TaskExecutor (src/scheduling/task-executor.ts):**
- Reuses `prepareChatRun` (same prompt/cost setup as regular chat)
- Runs the agent loop with the task's message payload
- Captures execution trace
- Records results in ScheduledTaskRun

### Task Lifecycle

```
proposed → (human approval) → active → (cron ticks) → running → completed
                                  ↑                        ↓
                                  └────────────────────────┘
                                     (next cron tick)

proposed → rejected (human rejects)
active → paused (human pauses)
active → expired (expiresAt reached)
active → completed (maxRuns reached)
```

### Cron Expressions

Uses cron-parser v5 (important: NOT v4 API):

```typescript
import { CronExpressionParser } from 'cron-parser';
const expr = CronExpressionParser.parse('0 9 * * 1-5');  // Weekdays at 9am
const nextRun = expr.next().toDate();
```

### Agent-Proposed Tasks

When an agent calls `propose-scheduled-task`:

```typescript
// Tool input
{
  "name": "Daily Summary Report",
  "description": "Generate a daily operations summary",
  "cronExpression": "0 9 * * 1-5",
  "message": "Generá un resumen de las operaciones de ayer",
  "budgetPerRunUsd": 2.0,
  "maxTurns": 10,
  "timeoutMs": 300000
}
```

The task is created with `origin: 'agent_proposed'` and `status: 'proposed'`. It MUST be approved by a human before it starts running.

### Budget Per Run

Each scheduled task has its own budget (`budgetPerRunUsd`). This is separate from the project's daily budget. The TaskExecutor creates a fresh CostGuard with this budget for each run.

## Operations Monitoring

### Manager Agent Tools

The manager agent has 3 monitoring tools for overseeing the project:

**get-operations-summary:**
```typescript
// No input needed — uses context.projectId
// Returns:
{
  agents: { total: 4, active: 3, list: [{name, status, activeSessions}] },
  sessions: { active: 12, total: 156 },
  messages: { today: 45, thisWeek: 312 },
  approvals: { pending: 2 },
  cost: { todayUsd: 3.42, thisWeekUsd: 18.90 },
  escalations: { totalPending: 1, recent: [{...}] }
}
```

**get-agent-performance:**
```typescript
// Input: { agentName: "Luna", timeRange: "week" }
// Returns:
{
  agentName: "Luna",
  timeRange: { label: "This Week", start: "2026-02-22", end: "2026-02-28" },
  sessions: { total: 45, active: 3, closed: 42 },
  messages: { total: 234, fromUser: 120, fromAssistant: 114 },
  toolCalls: { total: 89, successful: 87, failed: 2, byTool: [{name, count}] },
  cost: { totalUsd: 8.50, avgPerSessionUsd: 0.19 },
  escalations: 3
}
```

**review-agent-activity:**
```typescript
// Input: { agentName: "Luna", limit: 10 }
// Returns:
{
  recentSessions: [{sessionId, contactName, channel, status, messageCount, createdAt}],
  recentToolExecutions: [{toolName, success, durationMs, timestamp, inputPreview}],
  errors: [{type, message, timestamp}]
}
```

### Execution Traces

Every agent run produces an `ExecutionTrace` with timestamped events. The dashboard's Traces page shows a timeline view:

```
09:15:00  llm_request      → GPT-4o, 5 messages, 12 tools
09:15:02  llm_response     → 456 tokens, 1.8s
09:15:02  tool_call        → knowledge-search("producto X")
09:15:02  tool_result      → success, 89ms
09:15:02  memory_retrieval → 3 memories found
09:15:03  llm_request      → GPT-4o, 7 messages
09:15:04  llm_response     → 234 tokens, 1.2s (final answer)
```

### Cost Tracking

The dashboard's Costs page shows:
- Daily cost breakdown by project
- Cost per agent
- Cost per model
- Token usage trends
- Budget utilization percentage

All data comes from the `UsageRecord` table, which records every LLM call.

## Observability (src/observability/)

### Structured Logging

All logging uses pino (JSON structured):

```typescript
import { createLogger } from '@/observability/logger.js';
const logger = createLogger({ name: 'my-service' });

logger.info('Processing message', {
  component: 'inbound-processor',
  projectId: 'proj-1',
  channel: 'whatsapp',
  contactId: 'contact-1',
});

// Output (JSON):
// {"level":30,"time":1709123456,"name":"my-service","msg":"Processing message","component":"inbound-processor","projectId":"proj-1","channel":"whatsapp"}
```

### Log Pattern

The `LogContext` interface requires a `component` field:

```typescript
interface LogContext {
  component: string;  // Required — identifies the subsystem
  [key: string]: unknown;
}
```

Usage: `logger.info('message', { component: 'agent-runner', traceId, sessionId })`.

### Log Levels

- `debug` — Detailed execution flow (off in production)
- `info` — Key milestones (agent start, tool execution, session creation)
- `warn` — Non-fatal issues (compaction failed, fallback triggered)
- `error` — Failures with context (provider error, tool error, budget exceeded)

**Never use `console.log`** — always pino logger.

## Error Handling

### NexusError Hierarchy

```typescript
class NexusError extends Error {
  code: string;           // Machine-readable: 'BUDGET_EXCEEDED'
  statusCode: number;     // HTTP: 429
  context?: Record<string, unknown>;  // Extra data for debugging
}

// Subclasses:
class BudgetExceededError extends NexusError { code = 'BUDGET_EXCEEDED'; statusCode = 429; }
class ToolNotAllowedError extends NexusError { code = 'TOOL_NOT_ALLOWED'; statusCode = 403; }
class ProviderError extends NexusError { code = 'PROVIDER_ERROR'; statusCode = 502; }
class ApprovalRequiredError extends NexusError { code = 'APPROVAL_REQUIRED'; statusCode = 202; }
```

### Result Type

Expected failures use `Result<T, E>` instead of exceptions:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Usage:
const result = await toolRegistry.resolve(toolId, input, context);
if (!result.ok) {
  // Handle error without try/catch
  logger.warn('Tool failed', { error: result.error.message });
  return;
}
// Use result.value
```

Exceptions are reserved for truly unexpected errors (bugs, infrastructure failures).

### API Error Handler

The Fastify error handler converts NexusErrors into HTTP responses:

```typescript
// src/api/error-handler.ts
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof NexusError) {
    reply.status(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message, statusCode: error.statusCode }
    });
  } else {
    // Unknown error — 500 with generic message
    reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred', statusCode: 500 }
    });
  }
});
```

## Environment Variables

### Required

```env
DATABASE_URL=postgresql://user:pass@localhost:5433/nexus_core
REDIS_URL=redis://localhost:6380
SECRETS_ENCRYPTION_KEY=<32-byte-hex>   # For AES-256-GCM credential encryption
```

### LLM Providers (at least one required)

```env
OPENAI_API_KEY=sk-...                   # For GPT models + embeddings
ANTHROPIC_API_KEY=sk-ant-...            # For Claude models
GOOGLE_API_KEY=...                       # For Gemini models
```

### Optional

```env
TELEGRAM_BOT_TOKEN=...     # For HITL approval notifications
TELEGRAM_CHAT_ID=...       # Telegram group for approvals
TAVILY_API_KEY=...         # For web-search tool
RESEND_API_KEY=...         # For send-email tool
HOST=::                    # IPv6 for Windows (default)
PORT=3002                  # Server port (default 3002)
```

### Dashboard

```env
NEXT_PUBLIC_API_URL=http://localhost:3002  # Points dashboard to Core API
```

## Development Ports (Avoiding Conflicts)

The development setup uses non-standard ports to avoid conflicts with the Fomo platform:

| Service | Nexus Core Port | Standard Port |
|---------|----------------|---------------|
| PostgreSQL | 5433 | 5432 |
| Redis | 6380 | 6379 |
| Core API | 3002 | 3000 |
| Dashboard | 3000-3001 | — |
| WAHA | 3003 | — |
