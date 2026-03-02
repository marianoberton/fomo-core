# Nexus Core — Data Model

## Overview

Nexus Core uses PostgreSQL with Prisma 6 as the ORM and pgvector extension for vector similarity search. The schema has 18 tables organized around projects, agents, sessions, and supporting entities.

## Database Configuration

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector, pgcrypto]
}
```

- **vector** — pgvector extension for 1536-dimensional embedding vectors (semantic search)
- **pgcrypto** — cryptographic functions (not actively used; encryption is in application layer)

## Entity Relationship Diagram (Text)

```
Project (1)
  ├── (N) Agent
  │     ├── (N) Session
  │     └── (N) Agent [sub-agents via managerAgentId]
  ├── (N) Session
  │     ├── (N) Message
  │     ├── (N) ExecutionTrace
  │     └── (N) ApprovalRequest
  ├── (N) Contact
  │     └── (N) Session
  ├── (N) PromptLayer
  ├── (N) UsageRecord
  ├── (N) MemoryEntry
  ├── (N) ApprovalRequest
  ├── (N) ScheduledTask
  │     └── (N) ScheduledTaskRun
  ├── (N) Webhook
  ├── (N) File
  ├── (N) ChannelIntegration
  ├── (N) Secret
  ├── (N) MCPServerInstance
  └── (N) SkillInstance

MCPServerTemplate (1) ── (N) MCPServerInstance
SkillTemplate (1) ── (N) SkillInstance
```

## Complete Table Schemas

### Projects

The top-level entity. Every resource belongs to a project. Represents one business client.

```
projects
  id              String    PK
  name            String
  description     String?
  environment     String    default="development"
  owner           String
  tags            String[]
  config_json     Json      (project-level default config: LLM, memory, cost, failover)
  status          String    default="active"
  created_at      DateTime
  updated_at      DateTime
```

The `config_json` field stores project-wide defaults that agents inherit if they don't have their own overrides:
```json
{
  "provider": { "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7 },
  "failover": { "onRateLimit": true, "onServerError": true, "timeoutMs": 30000 },
  "memoryConfig": {
    "longTerm": { "enabled": true, "retrievalTopK": 5, "decayHalfLifeDays": 60 },
    "contextWindow": { "pruningStrategy": "turn-based", "maxTurnsInContext": 20 }
  },
  "costConfig": { "dailyBudgetUSD": 50, "monthlyBudgetUSD": 500 }
}
```

### Agents

Individual AI agents within a project. Each has its own personality, tools, channels, and LLM config.

```
agents
  id                String    PK (cuid)
  project_id        String    FK → projects.id
  name              String
  description       String?
  prompt_config     Json      { identity, instructions, safety }
  llm_config        Json?     { provider, model, temperature, maxOutputTokens }
  tool_allowlist    String[]  list of allowed tool IDs
  mcp_servers       Json?     MCP server configs
  channel_config    Json?     { channels: ['whatsapp','telegram'] }
  modes             Json?     AgentMode[] array
  max_turns         Int       default=10
  max_tokens_per_turn Int     default=4000
  budget_per_day_usd Float    default=10.0
  skill_ids         String[]  references to SkillInstance IDs
  operating_mode    String    default="customer-facing" (customer-facing|internal|copilot|manager)
  status            String    default="active" (active|paused|disabled)
  metadata          Json?
  manager_agent_id  String?   FK → agents.id (self-referential)
  created_at        DateTime
  updated_at        DateTime

  UNIQUE(project_id, name)    -- No duplicate agent names per project
  INDEX(project_id, status)
```

The `prompt_config` JSON:
```json
{
  "identity": "Sos Luna, la asesora comercial...",
  "instructions": "Cuando recibas una consulta...",
  "safety": "Nunca compartas credenciales..."
}
```

The `modes` JSON (AgentMode array):
```json
[
  {
    "name": "clients",
    "label": "Clientes",
    "channelMapping": ["whatsapp", "telegram"],
    "promptOverrides": { "instructions": "Be friendly to customers..." }
  },
  {
    "name": "owner",
    "label": "Dueño",
    "channelMapping": ["whatsapp:owner", "dashboard"],
    "toolAllowlist": ["query-sessions", "get-operations-summary"]
  }
]
```

### Contacts

People who interact with agents. Linked to sessions and identified by channel-specific IDs.

```
contacts
  id              String    PK (cuid)
  project_id      String    FK → projects.id
  name            String
  display_name    String?
  phone           String?
  email           String?
  telegram_id     String?
  slack_id        String?
  role            String?   'customer' | 'staff' | 'owner'
  tags            String[]  e.g., ["vip", "wholesale", "prospect"]
  timezone        String?
  language        String    default="es"
  metadata        Json?
  created_at      DateTime
  updated_at      DateTime

  UNIQUE(project_id, phone)
  UNIQUE(project_id, email)
  UNIQUE(project_id, telegram_id)
  UNIQUE(project_id, slack_id)
  INDEX(project_id)
```

### Sessions

A conversation between a contact and an agent. Can span multiple messages and tool calls.

```
sessions
  id              String    PK
  project_id      String    FK → projects.id
  contact_id      String?   FK → contacts.id
  agent_id        String?   FK → agents.id
  status          String    default="active" (active|closed|escalated)
  metadata        Json?
  created_at      DateTime
  updated_at      DateTime
  expires_at      DateTime?

  INDEX(project_id, status)
  INDEX(contact_id)
  INDEX(agent_id)
```

### Messages

Individual messages within a session. Includes user messages, assistant responses, and tool call metadata.

```
messages
  id              String    PK
  session_id      String    FK → sessions.id
  role            String    'user' | 'assistant' | 'tool'
  content         String
  tool_calls      Json?     array of tool call objects (for assistant messages)
  usage           Json?     token usage for this message
  trace_id        String?   links to the execution trace that generated this message
  created_at      DateTime

  INDEX(session_id, created_at)
```

### Execution Traces

Complete audit log of an agent run. Every LLM call, tool execution, memory retrieval, and error.

```
execution_traces
  id                String    PK
  project_id        String
  session_id        String    FK → sessions.id
  prompt_snapshot   Json      which prompt layer versions were used
  events            Json      array of TraceEvent objects
  total_duration_ms Int
  total_tokens_used Int
  total_cost_usd    Float
  turn_count        Int
  status            String    completed|failed|budget_exceeded|max_turns|human_approval_pending|aborted
  created_at        DateTime
  completed_at      DateTime?

  INDEX(project_id, created_at)
  INDEX(session_id)
```

The `events` JSON stores the full execution timeline:
```json
[
  { "type": "llm_request", "timestamp": "...", "data": { "model": "gpt-4o", "messageCount": 5 } },
  { "type": "llm_response", "timestamp": "...", "durationMs": 1234, "data": { "tokensUsed": 500 } },
  { "type": "tool_call", "timestamp": "...", "data": { "toolId": "knowledge-search", "input": {...} } },
  { "type": "tool_result", "timestamp": "...", "durationMs": 89, "data": { "success": true } },
  { "type": "memory_retrieval", "timestamp": "...", "data": { "count": 3 } }
]
```

### Usage Records

Per-request token and cost tracking for budgeting.

```
usage_records
  id                String    PK
  project_id        String    FK → projects.id
  session_id        String
  trace_id          String
  provider          String    'openai' | 'anthropic' | 'google' | 'ollama'
  model             String    'gpt-4o' | 'claude-sonnet-4-5' | etc.
  input_tokens      Int
  output_tokens     Int
  cache_read_tokens Int       default=0 (Anthropic prompt caching)
  cache_write_tokens Int      default=0
  cost_usd          Float
  timestamp         DateTime

  INDEX(project_id, timestamp)
  INDEX(project_id, session_id)
```

### Memory Entries (pgvector)

Long-term semantic memory with vector embeddings for similarity search.

```
memory_entries
  id              String                  PK
  project_id      String                  FK → projects.id
  session_id      String?                 optional session scope
  category        String                  'fact'|'decision'|'preference'|'task_context'|'learning'
  content         String                  the actual memory text
  embedding       vector(1536)?           pgvector embedding (Unsupported type in Prisma)
  importance      Float                   default=0.5 (0.0-1.0)
  access_count    Int                     default=0
  last_accessed_at DateTime               default=now()
  created_at      DateTime                default=now()
  expires_at      DateTime?
  metadata        Json?

  INDEX(project_id, category)
  INDEX(project_id, importance)
```

Note: The `embedding` field uses Prisma's `Unsupported("vector(1536)")` type because Prisma doesn't natively support pgvector. All vector operations (insert, search) use raw SQL via `prisma.$queryRaw` and `prisma.$executeRaw`.

### Prompt Layers

Versioned prompt components with independent lifecycle.

```
prompt_layers
  id              String          PK
  project_id      String          FK → projects.id
  layer_type      Enum            identity | instructions | safety
  version         Int
  content         String
  is_active       Boolean         default=false
  created_at      DateTime
  created_by      String
  change_reason   String
  performance_notes String?
  metadata        Json?

  UNIQUE(project_id, layer_type, version)
  INDEX(project_id, layer_type, is_active)
```

### Approval Requests

Human-in-the-loop approval for high-risk tool calls.

```
approval_requests
  id              String    PK
  project_id      String    FK → projects.id
  session_id      String    FK → sessions.id
  tool_call_id    String
  tool_id         String
  tool_input      Json
  risk_level      String
  status          String    default="pending" (pending|approved|rejected|expired)
  requested_at    DateTime
  expires_at      DateTime
  resolved_at     DateTime?
  resolved_by     String?
  resolution_note String?

  INDEX(status)
  INDEX(project_id, status)
```

### Scheduled Tasks

Agent-proposed or static recurring tasks.

```
scheduled_tasks
  id                    String              PK
  project_id            String              FK → projects.id
  name                  String
  description           String?
  cron_expression       String              e.g., "0 9 * * 1-5" (weekdays at 9am)
  task_payload          Json                { message, metadata }
  origin                Enum                static | agent_proposed
  status                Enum                proposed|active|paused|rejected|completed|expired
  proposed_by           String?
  approved_by           String?
  max_retries           Int                 default=2
  timeout_ms            Int                 default=300000 (5 min)
  budget_per_run_usd    Float               default=1.0
  max_duration_minutes  Int                 default=30
  max_turns             Int                 default=10
  max_runs              Int?
  run_count             Int                 default=0
  last_run_at           DateTime?
  next_run_at           DateTime?
  expires_at            DateTime?
  created_at            DateTime
  updated_at            DateTime

  INDEX(project_id, status)
  INDEX(status, next_run_at)
```

### Scheduled Task Runs

Individual execution records for scheduled tasks.

```
scheduled_task_runs
  id              String              PK
  task_id         String              FK → scheduled_tasks.id
  status          Enum                pending|running|completed|failed|timeout|budget_exceeded
  started_at      DateTime?
  completed_at    DateTime?
  duration_ms     Int?
  tokens_used     Int?
  cost_usd        Float?
  trace_id        String?             links to execution trace
  result          Json?
  error_message   String?
  retry_count     Int                 default=0
  created_at      DateTime

  INDEX(task_id, created_at)
  INDEX(status)
```

### Webhooks

Custom inbound webhook endpoints for third-party integrations.

```
webhooks
  id              String    PK (cuid)
  project_id      String    FK → projects.id
  agent_id        String?
  name            String
  description     String?
  trigger_prompt  String    Mustache-style template: "Order {{payload.id}} received"
  secret_env_var  String?   for HMAC validation
  allowed_ips     String[]
  status          String    default="active"
  created_at      DateTime
  updated_at      DateTime

  INDEX(project_id, status)
```

### Channel Integrations

Per-project channel configurations.

```
channel_integrations
  id              String    PK (cuid)
  project_id      String    FK → projects.id
  provider        String    'whatsapp'|'whatsapp-waha'|'telegram'|'slack'|'chatwoot'
  config          Json      provider-specific config
  status          String    default="active" (active|paused)
  created_at      DateTime
  updated_at      DateTime

  UNIQUE(project_id, provider)
  INDEX(provider, status)
```

### Secrets

AES-256-GCM encrypted credentials.

```
secrets
  id              String    PK (cuid)
  project_id      String    FK → projects.id
  key             String    e.g., "TELEGRAM_BOT_TOKEN", "HUBSPOT_ACCESS_TOKEN"
  encrypted_value String    AES-256-GCM ciphertext (hex)
  iv              String    initialization vector (hex)
  auth_tag        String    GCM authentication tag (hex)
  description     String?
  created_at      DateTime
  updated_at      DateTime

  UNIQUE(project_id, key)
  INDEX(project_id)
```

### Files

Uploaded and generated files.

```
files
  id                String    PK (cuid)
  project_id        String    FK → projects.id
  filename          String
  original_filename String
  mime_type         String
  size_bytes        Int
  storage_provider  String
  storage_path      String
  public_url        String?
  uploaded_by       String?
  uploaded_at       DateTime
  expires_at        DateTime?
  metadata          Json?

  INDEX(project_id, uploaded_at)
  INDEX(project_id, mime_type)
```

### MCP Server Templates (Global Catalog)

```
mcp_server_templates
  id              String    PK (cuid)
  name            String    UNIQUE
  display_name    String
  description     String
  category        String    erp|crm|productivity|communication|custom
  transport       String    stdio|sse
  command         String?
  args            String[]
  default_env     Json?
  url             String?
  tool_prefix     String?
  required_secrets String[]
  is_official     Boolean   default=false
  created_at      DateTime
  updated_at      DateTime

  INDEX(category)
```

### MCP Server Instances (Per Project)

```
mcp_server_instances
  id              String    PK (cuid)
  project_id      String    FK → projects.id
  template_id     String?   FK → mcp_server_templates.id (null for custom)
  name            String
  display_name    String?
  description     String?
  transport       String    stdio|sse
  command         String?
  args            String[]
  env_secret_keys Json?     { "API_KEY": "secret-key-name" }
  url             String?
  tool_prefix     String?
  status          String    default="active" (active|paused|error)
  created_at      DateTime
  updated_at      DateTime

  UNIQUE(project_id, name)
  INDEX(project_id, status)
```

### Skill Templates (Global Catalog)

```
skill_templates
  id                      String    PK (cuid)
  name                    String    UNIQUE
  display_name            String
  description             String
  category                String    sales|support|operations|communication
  instructions_fragment   String    text appended to agent's Instructions layer
  required_tools          String[]  tool IDs needed
  required_mcp_servers    String[]  MCP server names needed
  parameters_schema       Json?     JSON Schema for configurable parameters
  tags                    String[]
  icon                    String?   Lucide icon name
  is_official             Boolean   default=false
  version                 Int       default=1
  status                  String    default="published" (draft|published|deprecated)
  created_at              DateTime
  updated_at              DateTime

  INDEX(category)
```

### Skill Instances (Per Project)

```
skill_instances
  id                      String    PK (cuid)
  project_id              String    FK → projects.id
  template_id             String?   FK → skill_templates.id (null for custom)
  name                    String
  display_name            String
  description             String?
  instructions_fragment   String
  required_tools          String[]
  required_mcp_servers    String[]
  parameters              Json?     user-filled parameter values
  status                  String    default="active" (active|disabled)
  created_at              DateTime
  updated_at              DateTime

  UNIQUE(project_id, name)
  INDEX(project_id, status)
```

## Seed Data (prisma/seed.ts)

The seed script creates demo data for development:

### Projects (6)
1. **Demo Project** — Full-featured demo with all entity types
2. **Car Dealership** — Vehicle sales with lead scoring
3. **Wholesale Hardware** — B2B wholesale with stock management
4. **Boutique Hotel** — Hospitality with seasonal pricing
5. **E-commerce Store** — Online retail
6. **Market Paper** — Paper/packaging wholesale with WhatsApp reactivation campaign

### Agents (6)
1. **Customer Support** (Demo) — customer-facing, WhatsApp + Telegram
2. **Sales Agent** (Demo) — customer-facing, WhatsApp
3. **Internal Analyst** (Demo) — internal, dashboard only
4. **Manager** (Demo) — manager, dashboard only, 13 tools, orchestrates other agents
5. **Reactivadora Market Paper** — customer-facing, WhatsApp, HubSpot CRM integration
6. Various vertical-specific agents per project template

### Prompt Layers (18+)
Each project gets 3 layers (identity, instructions, safety). The Manager agent has extensive prompt layers defining its supervisory behavior.

### MCP Server Templates (12)
Pre-seeded catalog of MCP servers (HubSpot, Google Calendar, Odoo, etc.)

### Skill Templates (10)
Pre-seeded catalog of reusable skills (Customer Support, Sales Follow-up, FAQ, etc.)

### Scheduled Tasks
- Manager agent daily summary: `0 9 * * 1-5` (weekdays at 9am)
- Market Paper reactivation campaign: `0 9 * * 1-5`

## Key Database Operations

### pgvector Queries (Raw SQL)

Because Prisma doesn't natively support pgvector, vector operations use raw SQL:

**Insert memory with embedding:**
```sql
INSERT INTO memory_entries (id, project_id, category, content, embedding, importance)
VALUES ($1, $2, $3, $4, $5::vector(1536), $6)
```

**Semantic search with temporal decay:**
```sql
SELECT id, category, content, importance,
  1 - (embedding <=> $1::vector(1536)) AS cosine_similarity,
  (1 - (embedding <=> $1::vector(1536))) * EXP(-$2 * EXTRACT(EPOCH FROM NOW() - created_at) / 86400) AS decayed_score
FROM memory_entries
WHERE project_id = $3
ORDER BY decayed_score DESC
LIMIT $4
```

### Common Query Patterns

**Active sessions for an agent:**
```typescript
prisma.session.findMany({
  where: { agentId, status: 'active' },
  include: { contact: true, _count: { select: { messages: true } } }
})
```

**Today's cost for a project:**
```typescript
prisma.usageRecord.aggregate({
  where: { projectId, timestamp: { gte: startOfDay } },
  _sum: { costUsd: true }
})
```

**Active prompt layer:**
```typescript
prisma.promptLayer.findFirst({
  where: { projectId, layerType: 'identity', isActive: true }
})
```

## Migration Commands

```bash
pnpm db:migrate       # Run pending migrations
pnpm db:generate      # Regenerate Prisma client (after schema changes)
pnpm db:seed          # Seed development data
pnpm db:studio        # Open Prisma Studio (GUI)
```
