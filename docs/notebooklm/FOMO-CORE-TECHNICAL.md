# FOMO Core — Technical Documentation

## Overview

fomo-core es el motor de agentes de FOMO. Procesa mensajes, orquesta LLMs, ejecuta tools y maneja integraciones con sistemas externos.

---

## 1. Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                          fomo-core                                 │
│                                                                    │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐ │
│  │  Fastify    │   │   Agent     │   │      Tool Registry      │ │
│  │  API Server │──►│ Processor   │──►│                         │ │
│  │             │   │             │   │  • odoo-get-debts       │ │
│  │  Routes:    │   │  • runAgent │   │  • gmail-send           │ │
│  │  /chat      │   │  • LLM call │   │  • excel-analyze        │ │
│  │  /agents    │   │  • tools    │   │  • licitaciones-*       │ │
│  │  /sessions  │   │             │   │  • ... (52 tools)       │ │
│  └─────────────┘   └─────────────┘   └─────────────────────────┘ │
│         │                 │                      │                │
│         ▼                 ▼                      ▼                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐ │
│  │   Prisma    │   │   Channel   │   │     Secret Service      │ │
│  │   Database  │   │   Adapters  │   │                         │ │
│  │             │   │             │   │  Per-project secrets    │ │
│  │  PostgreSQL │   │  • WhatsApp │   │  encrypted in DB        │ │
│  │             │   │  • Telegram │   │                         │ │
│  └─────────────┘   └─────────────┘   └─────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
src/
├── main.ts                 # Entry point, server setup, dependency injection
├── api/
│   ├── routes/             # REST API endpoints
│   │   ├── chat.ts         # POST /chat — main agent interaction
│   │   ├── agents.ts       # Agent CRUD
│   │   ├── sessions.ts     # Session management
│   │   ├── files.ts        # File upload/download
│   │   ├── secrets.ts      # Secret management
│   │   └── ...
│   ├── error-handler.ts    # Global error handling
│   └── types.ts            # RouteDependencies interface
├── agents/
│   ├── types.ts            # AgentConfig, AgentPromptConfig interfaces
│   ├── agent-registry.ts   # In-memory agent registration
│   ├── agent-processor.ts  # Main agent execution logic
│   └── fomo-internal/      # Internal agent definitions
│       └── agents.config.ts
├── channels/
│   ├── types.ts            # Channel, Message types
│   └── adapters/
│       ├── whatsapp.ts     # WAHA integration
│       ├── telegram.ts     # Telegram Bot API
│       └── ...
├── tools/
│   ├── types.ts            # ExecutableTool interface
│   ├── tool-registry.ts    # Tool registration & lookup
│   └── definitions/        # Individual tool implementations
│       ├── index.ts        # Exports all tools
│       ├── odoo-get-debts.ts
│       ├── gmail-send.ts
│       ├── excel-analyze.ts
│       └── ... (50+ tools)
├── files/
│   ├── file-service.ts     # File upload/download logic
│   ├── storage-local.ts    # Local filesystem storage
│   └── types.ts
├── core/
│   ├── types.ts            # ProjectId, SessionId branded types
│   ├── result.ts           # ok/err Result pattern
│   └── errors.ts           # NexusError class hierarchy
├── infrastructure/
│   └── repositories/       # Prisma repository wrappers
└── observability/
    └── logger.ts           # Structured logging
```

---

## 3. Core Patterns

### 3.1 Result Pattern
```typescript
// core/result.ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

function ok<T>(value: T): Result<T, never>
function err<E>(error: E): Result<never, E>

// Usage in tools
async execute(input, context): Promise<Result<ToolResult, NexusError>> {
  try {
    const data = await fetchSomething()
    return ok({ success: true, output: data, durationMs: 100 })
  } catch (e) {
    return err(new ToolExecutionError('tool-name', e.message))
  }
}
```

### 3.2 Branded Types
```typescript
// core/types.ts
type ProjectId = string & { readonly __brand: 'ProjectId' }
type SessionId = string & { readonly __brand: 'SessionId' }
type AgentId = string & { readonly __brand: 'AgentId' }

// Prevents accidentally passing wrong string IDs
function getAgent(projectId: ProjectId, agentId: AgentId): Promise<Agent>
```

### 3.3 Dependency Injection
```typescript
// main.ts
const toolRegistry = createToolRegistry()
const secretService = createSecretService({ prisma })
const fileService = createFileService({ storage, repository, logger })

// Tools receive dependencies at creation time
toolRegistry.register(createOdooGetDebtsTool({ secretService }))
toolRegistry.register(createExcelAnalyzeTool({ fileService }))

// Routes receive all dependencies
await fastify.register(chatRoutes, {
  toolRegistry,
  secretService,
  sessionRepository,
  // ...
})
```

---

## 4. Agent Processor

### Message Processing Flow
```typescript
// agents/agent-processor.ts
async function runAgent(opts: RunAgentOpts): Promise<AgentResponse> {
  const { projectId, agentId, sessionId, message, context } = opts

  // 1. Load agent config
  const agent = await agentRegistry.get(agentId)

  // 2. Get/create session
  const session = sessionId 
    ? await sessionRepository.get(sessionId)
    : await sessionRepository.create({ projectId, agentId })

  // 3. Build messages array
  const messages = [
    { role: 'system', content: buildSystemPrompt(agent.promptConfig) },
    ...session.history,
    { role: 'user', content: message }
  ]

  // 4. Call LLM with tool definitions
  const allowedTools = agent.toolAllowlist.map(id => toolRegistry.get(id))
  const response = await llmClient.chat({
    model: agent.llmConfig.model,
    messages,
    tools: allowedTools.map(t => t.toOpenAIFormat()),
    temperature: agent.llmConfig.temperature,
  })

  // 5. Execute tool calls if any
  if (response.toolCalls) {
    for (const call of response.toolCalls) {
      const tool = toolRegistry.get(call.name)
      const result = await tool.execute(call.arguments, context)
      // Add tool result to messages, call LLM again
    }
  }

  // 6. Save to session history
  await sessionRepository.addMessages(sessionId, [...])

  // 7. Return response
  return { sessionId, message: response.content, toolCalls: [...] }
}
```

### System Prompt Construction
```typescript
function buildSystemPrompt(config: AgentPromptConfig): string {
  return `
${config.identity}

## Instructions
${config.instructions}

## Safety Guidelines
${config.safety}

## Current Context
- Date: ${new Date().toISOString()}
- Timezone: America/Argentina/Buenos_Aires
`.trim()
}
```

---

## 5. Tool System

### Tool Interface
```typescript
// tools/types.ts
interface ExecutableTool {
  id: string
  name: string
  description: string
  category: 'data' | 'integration' | 'search' | 'messaging' | 'memory'
  inputSchema: ZodSchema
  outputSchema: ZodSchema
  riskLevel: 'low' | 'medium' | 'high'
  requiresApproval: boolean
  sideEffects: boolean
  supportsDryRun: boolean

  execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>
  dryRun?(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>
}

interface ExecutionContext {
  projectId: ProjectId
  sessionId?: SessionId
  agentId?: AgentId
  traceId: string
}

interface ToolResult {
  success: boolean
  output: unknown
  durationMs: number
}
```

### Tool Registration
```typescript
// main.ts
const toolRegistry = createToolRegistry()

// Register tools with their dependencies
toolRegistry.register(createKnowledgeSearchTool({ knowledgeService }))
toolRegistry.register(createOdooGetDebtsTool({ secretService }))
toolRegistry.register(createGmailSendTool({ secretService }))
toolRegistry.register(createExcelAnalyzeTool({ fileService }))

// Tools are matched to agents via toolAllowlist
// Agent config: { toolAllowlist: ['odoo-get-debts', 'mp-create-payment-link'] }
```

### Example Tool: odoo-get-debts
```typescript
// tools/definitions/odoo-get-debts.ts
export function createOdooGetDebtsTool(deps: { secretService: SecretService }): ExecutableTool {
  const { secretService } = deps

  return {
    id: 'odoo-get-debts',
    name: 'Odoo Get Debts',
    description: 'Consulta facturas pendientes de un cliente en Odoo por email',
    category: 'integration',
    inputSchema: z.object({
      email: z.string().email().describe('Email del cliente'),
    }),
    outputSchema: z.object({
      clientId: z.number(),
      clientName: z.string(),
      invoices: z.array(z.object({
        id: z.number(),
        number: z.string(),
        amountUntaxed: z.number(),
        amountTotal: z.number(),
        daysOverdue: z.number(),
      })),
      totalDebt: z.number(),
      clientHistory: z.string().optional(),
    }),
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(input, context) {
      const { email } = inputSchema.parse(input)

      // Get Odoo credentials from project secrets
      const baseUrl = await secretService.get(context.projectId, 'ODOO_BASE_URL')
      const user = await secretService.get(context.projectId, 'ODOO_USER')
      const password = await secretService.get(context.projectId, 'ODOO_PASSWORD')

      // Authenticate with Odoo JSON-RPC
      const session = await odooAuth(baseUrl, user, password)

      // Search for partner by email
      const partnerId = await odooSearchPartner(session, email)

      // Get unpaid invoices
      const invoices = await odooGetUnpaidInvoices(session, partnerId)

      return ok({
        success: true,
        output: {
          clientId: partnerId,
          clientName: invoices[0]?.partnerName ?? 'Unknown',
          invoices: invoices.map(inv => ({
            id: inv.id,
            number: inv.name,
            amountUntaxed: inv.amount_untaxed,
            amountTotal: inv.amount_total,
            daysOverdue: calculateDaysOverdue(inv.invoice_date_due),
          })),
          totalDebt: invoices.reduce((sum, inv) => sum + inv.amount_residual, 0),
        },
        durationMs: Date.now() - startTime,
      })
    },
  }
}
```

---

## 6. Secret Service

### Per-Project Secrets
```typescript
// Secrets are stored encrypted in PostgreSQL
// Each project has its own set of secrets

interface SecretService {
  get(projectId: ProjectId, key: string): Promise<string | null>
  set(projectId: ProjectId, key: string, value: string): Promise<void>
  delete(projectId: ProjectId, key: string): Promise<void>
  list(projectId: ProjectId): Promise<SecretMetadata[]>
  exists(projectId: ProjectId, key: string): Promise<boolean>
}

// Usage in tools
const refreshToken = await secretService.get(projectId, 'GOOGLE_REFRESH_TOKEN')
if (!refreshToken) {
  return err(new ToolExecutionError('gmail-send', 'GOOGLE_REFRESH_TOKEN not configured'))
}
```

### Common Secrets
| Key | Description |
|-----|-------------|
| `ODOO_BASE_URL` | Odoo instance URL |
| `ODOO_USER` | Odoo login email |
| `ODOO_PASSWORD` | Odoo password |
| `ODOO_DB` | Odoo database name |
| `GOOGLE_REFRESH_TOKEN` | OAuth2 refresh token |
| `GOOGLE_CLIENT_ID` | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DB_ID` | Default Notion database |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `MP_ACCESS_TOKEN` | MercadoPago access token |
| `SUPABASE_LICI_URL` | Licitaciones Supabase URL |
| `SUPABASE_LICI_KEY` | Licitaciones Supabase anon key |

---

## 7. File System

### File Upload Flow
```typescript
// POST /api/v1/files/upload?projectId=xxx&filename=data.xlsx

// 1. Request arrives with binary body or base64 JSON
// 2. files.ts route parses body
// 3. fileService.upload() stores file and creates DB record
// 4. Returns file metadata with ID

interface StoredFile {
  id: string
  projectId: string
  filename: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  publicUrl?: string
  uploadedAt: Date
}
```

### excel-analyze Tool
```typescript
// Parses Excel files with messy formatting
// Handles: merged cells, multi-row headers, empty rows

const result = await excelAnalyzeTool.execute({
  filename: 'ventas-2024.xlsx'  // or fileId
}, context)

// Returns:
{
  filename: 'ventas-2024.xlsx',
  sheets: ['Ventas 2025', 'Resumen'],
  analyzedSheet: 'Ventas 2025',
  headerRowIndex: 3,  // Auto-detected
  totalRows: 156,
  columns: [
    { name: 'Mes', stats: { type: 'text', nonNull: 156, sample: ['Enero', 'Febrero'] } },
    { name: 'Importe', stats: { type: 'number', nonNull: 156, min: 1000, max: 500000, sum: 2340000 } },
  ],
  rows: [ /* first 500 rows as objects */ ],
  truncated: false
}
```

---

## 8. Channel Adapters

### Telegram Adapter
```typescript
// channels/adapters/telegram.ts
export function createTelegramAdapter(config: TelegramConfig): ChannelAdapter {
  return {
    channel: 'telegram',

    async handleIncoming(update: TelegramUpdate): Promise<IncomingMessage> {
      return {
        channel: 'telegram',
        externalId: update.message.chat.id.toString(),
        senderName: update.message.from?.first_name,
        content: update.message.text,
        attachments: parseAttachments(update.message),
        metadata: { chatId: update.message.chat.id },
      }
    },

    async send(message: OutgoingMessage): Promise<void> {
      await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.recipientId,
          text: message.content,
          parse_mode: 'Markdown',
        }),
      })
    },
  }
}
```

### Integration Registration
```typescript
// POST /api/v1/projects/:id/integrations
{
  "channel": "telegram",
  "config": {
    "botToken": "123:ABC...",
    "webhookSecret": "random-secret"
  },
  "agentId": "agent-to-handle"
}

// Webhook URL configured in Telegram:
// https://core.fomo.com.ar/api/v1/webhooks/telegram/{integrationId}
```

---

## 9. Scheduled Tasks

### Cron Jobs
```typescript
// POST /api/v1/projects/:id/scheduled-tasks
{
  "agentId": "mateo-cobranzas",
  "type": "cron",
  "schedule": "0 12 * * 1-5",  // 12:00 PM weekdays
  "task": "Revisá las facturas vencidas de hoy y armá un resumen",
  "notifyOwner": true
}

// Task runner checks every minute, executes matching tasks
// Results sent via notify-owner tool or stored in DB
```

### Task Types
- **cron** — Recurring schedule (cron expression)
- **once** — Single execution at specific time
- **interval** — Repeat every N minutes/hours

---

## 10. API Routes Summary

| Route | Method | Description |
|-------|--------|-------------|
| `/api/v1/chat` | POST | Send message, get agent response |
| `/api/v1/chat/stream` | POST | Streaming response (SSE) |
| `/api/v1/projects` | GET/POST | List/create projects |
| `/api/v1/projects/:id` | GET/PATCH/DELETE | Project CRUD |
| `/api/v1/projects/:id/agents` | GET/POST | List/create agents |
| `/api/v1/projects/:id/agents/:agentId` | GET/PATCH/DELETE | Agent CRUD |
| `/api/v1/projects/:id/sessions` | GET | List sessions |
| `/api/v1/projects/:id/inbox` | GET | Inbox view (active sessions) |
| `/api/v1/sessions/:id/messages` | GET | Session message history |
| `/api/v1/tools` | GET | List available tools |
| `/api/v1/projects/:id/secrets` | GET/POST | List/create secrets |
| `/api/v1/projects/:id/secrets/:key` | PUT/DELETE | Update/delete secret |
| `/api/v1/projects/:id/knowledge` | GET/POST | Knowledge base entries |
| `/api/v1/projects/:id/integrations` | GET/POST | Channel integrations |
| `/api/v1/files/upload` | POST | Upload file |
| `/api/v1/files/:id/download` | GET | Download file |
| `/api/v1/projects/:id/scheduled-tasks` | GET/POST | Scheduled tasks |

---

## 11. Error Handling

### Error Classes
```typescript
// core/errors.ts
class NexusError extends Error {
  code: string
  statusCode: number
  context?: Record<string, unknown>
}

class ValidationError extends NexusError { code = 'VALIDATION_ERROR' }
class NotFoundError extends NexusError { code = 'NOT_FOUND' }
class ToolExecutionError extends NexusError { code = 'TOOL_EXECUTION_ERROR' }
class AuthenticationError extends NexusError { code = 'AUTHENTICATION_ERROR' }
```

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "TOOL_EXECUTION_ERROR",
    "message": "Failed to connect to Odoo: connection refused"
  }
}
```

---

## 12. Development

### Running Locally
```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with DATABASE_URL, API keys

# Run database migrations
pnpm prisma migrate dev

# Start development server
pnpm dev  # Starts on :3002
```

### Testing
```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# E2E tests
pnpm test:e2e
```

### Adding a New Tool
1. Create `src/tools/definitions/my-tool.ts`
2. Export factory function `createMyTool(deps): ExecutableTool`
3. Add export to `src/tools/definitions/index.ts`
4. Register in `src/main.ts`: `toolRegistry.register(createMyTool({...}))`
5. Add to agent's `toolAllowlist` via API or config

---

## 13. Production Deployment

### Docker Compose
```yaml
# docker-compose.prod.yml
services:
  fomo-core:
    build: .
    environment:
      - DATABASE_URL=postgresql://...
      - NODE_ENV=production
    ports:
      - "3002:3002"

  postgres:
    image: postgres:15
    volumes:
      - pgdata:/var/lib/postgresql/data
```

### Dokploy Deployment
```bash
# Trigger deploy via Dokploy API
curl -X POST "http://147.79.81.222:3000/api/trpc/compose.deploy" \
  -H "x-api-key: ${DOKPLOY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"json": {"composeId": "0lbVmerbdYh4-zFXTZk7k"}}'
```

### Health Check
```bash
curl https://core.fomo.com.ar/health
# {"status":"ok","timestamp":"2026-03-06T..."}
```
