# PLATFORM-ROADMAP.md

> Roadmap de capacidades CORE de fomo-core. Estas funcionalidades son necesarias para cualquier agente, independientemente de su caso de uso.

## Estado Actual ✅

fomo-core tiene el engine funcionando:
- **AgentRunner**: Loop agentic con tool calls y streaming
- **Providers**: OpenAI + Anthropic con factory pattern
- **Memory**: pgvector, embeddings, memory manager
- **Prompts**: 3 capas (identity, instructions, safety) + builder
- **Scheduling**: BullMQ + cron + task executor
- **Security**: Approval gate, input sanitizer, RBAC
- **Cost tracking**: Usage store, cost guard
- **API**: Fastify + WebSocket
- **Config**: Zod schemas + loader
- **Docker**: Dockerfile + compose + seed

---

## 🔴 CORE 1: Channels + Contacts + Proactive Messaging

**Prioridad: CRÍTICA**
**Objetivo:** El agente puede hablar con personas por múltiples canales, sabe quién es cada persona, y puede iniciar conversaciones.

### 1.1 Contacts (Users/People)

El agente necesita saber con quién está hablando.

#### Schema Prisma

```prisma
model Contact {
  id          String   @id @default(cuid())
  projectId   String   @map("project_id")
  
  // Identity
  name        String
  displayName String?  @map("display_name")
  
  // Channel identifiers (one contact, multiple channels)
  phone       String?  // WhatsApp/SMS
  email       String?
  telegramId  String?  @map("telegram_id")
  slackId     String?  @map("slack_id")
  
  // Metadata
  timezone    String?
  language    String?  @default("es")
  metadata    Json?
  
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  project     Project  @relation(fields: [projectId], references: [id])
  sessions    Session[]
  
  @@unique([projectId, phone])
  @@unique([projectId, email])
  @@unique([projectId, telegramId])
  @@unique([projectId, slackId])
  @@map("contacts")
}
```

#### Repository Interface

```typescript
// src/contacts/types.ts
export interface Contact {
  id: string;
  projectId: string;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactRepository {
  create(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact>;
  findById(id: string): Promise<Contact | null>;
  findByChannel(projectId: string, channel: ChannelType, identifier: string): Promise<Contact | null>;
  update(id: string, data: Partial<Contact>): Promise<Contact>;
  list(projectId: string, filters?: ContactFilters): Promise<Contact[]>;
}
```

### 1.2 Channels (Messaging Abstraction)

Abstracción para enviar/recibir mensajes por cualquier canal.

#### Channel Types

```typescript
// src/channels/types.ts

export type ChannelType = 'whatsapp' | 'telegram' | 'slack' | 'email' | 'sms';

export interface InboundMessage {
  id: string;
  channel: ChannelType;
  channelMessageId: string;  // ID original del canal
  contactId: string;         // Resolved contact
  projectId: string;
  
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
  
  rawPayload: unknown;       // Payload original del canal
  receivedAt: Date;
}

export interface OutboundMessage {
  channel: ChannelType;
  contactId: string;
  
  content: string;
  mediaUrls?: string[];
  replyToId?: string;        // Reply to specific message
  
  // Channel-specific options
  options?: {
    parseMode?: 'markdown' | 'html';  // Telegram
    silent?: boolean;                  // No notification
  };
}

export interface SendResult {
  success: boolean;
  channelMessageId?: string;
  error?: string;
}

export interface ChannelAdapter {
  readonly channelType: ChannelType;
  
  // Send a message
  send(message: OutboundMessage): Promise<SendResult>;
  
  // Parse incoming webhook to InboundMessage
  parseInbound(payload: unknown): Promise<InboundMessage | null>;
  
  // Health check
  isHealthy(): Promise<boolean>;
}
```

#### Channel Router

```typescript
// src/channels/channel-router.ts

export interface ChannelRouter {
  // Register channel adapters
  registerAdapter(adapter: ChannelAdapter): void;
  
  // Send message (picks adapter based on contact's preferred channel)
  send(message: OutboundMessage): Promise<SendResult>;
  
  // Send to specific channel
  sendVia(channel: ChannelType, message: OutboundMessage): Promise<SendResult>;
  
  // Broadcast to multiple contacts
  broadcast(contactIds: string[], content: string): Promise<Map<string, SendResult>>;
  
  // Handle inbound webhook
  handleInbound(channel: ChannelType, payload: unknown): Promise<InboundMessage | null>;
}
```

### 1.3 Channel Adapters

Implementar adaptadores para cada canal.

#### WhatsApp Adapter (Cloud API)

```typescript
// src/channels/adapters/whatsapp.ts

import type { ChannelAdapter, OutboundMessage, InboundMessage, SendResult } from '../types.js';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  apiVersion?: string;  // default: v18.0
}

export function createWhatsAppAdapter(config: WhatsAppConfig): ChannelAdapter {
  const baseUrl = `https://graph.facebook.com/${config.apiVersion ?? 'v18.0'}`;
  
  return {
    channelType: 'whatsapp',
    
    async send(message: OutboundMessage): Promise<SendResult> {
      // Resolve contact phone
      // POST to /{phone_number_id}/messages
      // Return result
    },
    
    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      // Parse WhatsApp webhook payload
      // Extract message content, sender, etc.
    },
    
    async isHealthy(): Promise<boolean> {
      // Check API connectivity
    }
  };
}
```

#### Telegram Adapter

```typescript
// src/channels/adapters/telegram.ts

export interface TelegramConfig {
  botToken: string;
  webhookSecret?: string;
}

export function createTelegramAdapter(config: TelegramConfig): ChannelAdapter {
  const baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  
  return {
    channelType: 'telegram',
    
    async send(message: OutboundMessage): Promise<SendResult> {
      // POST to /sendMessage
      // Support markdown, reply_to_message_id, etc.
    },
    
    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      // Parse Telegram Update object
    },
    
    async isHealthy(): Promise<boolean> {
      // GET /getMe
    }
  };
}
```

#### Slack Adapter

```typescript
// src/channels/adapters/slack.ts

export interface SlackConfig {
  botToken: string;       // xoxb-...
  signingSecret: string;
}

export function createSlackAdapter(config: SlackConfig): ChannelAdapter {
  return {
    channelType: 'slack',
    
    async send(message: OutboundMessage): Promise<SendResult> {
      // POST to chat.postMessage
    },
    
    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      // Parse Slack event
    },
    
    async isHealthy(): Promise<boolean> {
      // POST to auth.test
    }
  };
}
```

### 1.4 Proactive Messaging

El agente puede enviar mensajes sin que el usuario inicie.

```typescript
// src/channels/proactive.ts

export interface ProactiveMessageRequest {
  projectId: string;
  agentId?: string;         // Which agent is sending (for multi-agent)
  contactId: string;
  content: string;
  channel?: ChannelType;    // Optional: force specific channel
  scheduledFor?: Date;      // Optional: send later
  metadata?: Record<string, unknown>;
}

export interface ProactiveMessenger {
  // Send immediately
  send(request: ProactiveMessageRequest): Promise<SendResult>;
  
  // Schedule for later (uses BullMQ)
  schedule(request: ProactiveMessageRequest): Promise<string>;  // Returns job ID
  
  // Cancel scheduled message
  cancel(jobId: string): Promise<boolean>;
}
```

### 1.5 Inbound Message Processing

Conectar mensajes entrantes al AgentRunner.

```typescript
// src/channels/inbound-processor.ts

export interface InboundProcessor {
  // Process incoming message through the agent
  process(message: InboundMessage): Promise<void>;
}

export function createInboundProcessor(deps: {
  contactRepository: ContactRepository;
  sessionRepository: SessionRepository;
  agentRunner: AgentRunner;
  channelRouter: ChannelRouter;
  logger: Logger;
}): InboundProcessor {
  return {
    async process(message: InboundMessage): Promise<void> {
      // 1. Find or create contact
      const contact = await deps.contactRepository.findByChannel(
        message.projectId,
        message.channel,
        message.channelMessageId
      );
      
      // 2. Find or create session for this contact
      const session = await getOrCreateSession(contact);
      
      // 3. Run agent
      const response = await deps.agentRunner.run({
        projectId: message.projectId,
        sessionId: session.id,
        userMessage: message.content,
      });
      
      // 4. Send response back via same channel
      await deps.channelRouter.send({
        channel: message.channel,
        contactId: contact.id,
        content: response.content,
        replyToId: message.channelMessageId,
      });
    }
  };
}
```

### 1.6 Webhook Endpoints

Endpoints para recibir webhooks de cada canal.

```typescript
// src/api/routes/webhooks.ts

export async function webhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies
): Promise<void> {
  // WhatsApp webhook verification
  fastify.get('/webhooks/whatsapp', async (request, reply) => {
    // Verify webhook challenge
  });
  
  // WhatsApp inbound
  fastify.post('/webhooks/whatsapp', async (request, reply) => {
    const message = await deps.channelRouter.handleInbound('whatsapp', request.body);
    if (message) {
      await deps.inboundProcessor.process(message);
    }
    return { status: 'ok' };
  });
  
  // Telegram webhook
  fastify.post('/webhooks/telegram', async (request, reply) => {
    const message = await deps.channelRouter.handleInbound('telegram', request.body);
    if (message) {
      await deps.inboundProcessor.process(message);
    }
    return { status: 'ok' };
  });
  
  // Slack events
  fastify.post('/webhooks/slack', async (request, reply) => {
    // Handle Slack challenge, events, etc.
  });
}
```

---

## 🔴 CORE 2: MCP Client

**Prioridad: CRÍTICA**
**Objetivo:** El agente puede conectar herramientas externas via Model Context Protocol.

### 2.1 MCP Client Implementation

```typescript
// src/mcp/types.ts

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;      // For stdio: command to run
  args?: string[];       // For stdio: command args
  url?: string;          // For http: server URL
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface MCPClient {
  // Connect to an MCP server
  connect(config: MCPServerConfig): Promise<void>;
  
  // Disconnect from a server
  disconnect(serverName: string): Promise<void>;
  
  // List all tools from all connected servers
  listTools(): MCPTool[];
  
  // Call a tool
  callTool(serverName: string, toolName: string, args: unknown): Promise<unknown>;
  
  // Check if a server is connected
  isConnected(serverName: string): boolean;
}
```

### 2.2 MCP Server Manager

```typescript
// src/mcp/server-manager.ts

export interface MCPServerManager {
  // Manage server lifecycle
  startServer(config: MCPServerConfig): Promise<void>;
  stopServer(name: string): Promise<void>;
  restartServer(name: string): Promise<void>;
  
  // Get status
  getStatus(name: string): 'running' | 'stopped' | 'error';
  listServers(): MCPServerConfig[];
  
  // Get client for a server
  getClient(name: string): MCPClient | null;
}

export function createMCPServerManager(deps: {
  logger: Logger;
}): MCPServerManager {
  const servers = new Map<string, {
    config: MCPServerConfig;
    client: MCPClient;
    status: 'running' | 'stopped' | 'error';
  }>();
  
  return {
    async startServer(config: MCPServerConfig): Promise<void> {
      // If stdio: spawn process with command/args
      // If http: just validate URL is reachable
      // Initialize client and connect
    },
    
    // ... rest of implementation
  };
}
```

### 2.3 Tool Bridge

Exponer tools de MCP al AgentRunner como si fueran tools nativos.

```typescript
// src/mcp/tool-bridge.ts

import type { Tool } from '@/tools/types.js';

export interface MCPToolBridge {
  // Get all MCP tools as native Tool objects
  getTools(): Tool[];
  
  // Refresh tools from all connected servers
  refresh(): Promise<void>;
}

export function createMCPToolBridge(deps: {
  serverManager: MCPServerManager;
  logger: Logger;
}): MCPToolBridge {
  return {
    getTools(): Tool[] {
      const tools: Tool[] = [];
      
      for (const server of deps.serverManager.listServers()) {
        const client = deps.serverManager.getClient(server.name);
        if (!client) continue;
        
        for (const mcpTool of client.listTools()) {
          tools.push({
            id: `mcp:${server.name}:${mcpTool.name}`,
            name: mcpTool.name,
            description: mcpTool.description,
            inputSchema: mcpTool.inputSchema,
            
            async execute(input: unknown): Promise<unknown> {
              return client.callTool(server.name, mcpTool.name, input);
            }
          });
        }
      }
      
      return tools;
    },
    
    async refresh(): Promise<void> {
      // Reconnect to servers and refresh tool list
    }
  };
}
```

### 2.4 Config Integration

Definir MCP servers en la config del agente.

```typescript
// Add to src/config/schema.ts

const mcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
});

const agentConfigSchema = z.object({
  // ... existing fields
  mcp: z.object({
    servers: z.array(mcpServerSchema).default([]),
  }).optional(),
});
```

Example config:

```yaml
agents:
  fomo-cos:
    mcp:
      servers:
        - name: google-calendar
          transport: stdio
          command: npx
          args: ["-y", "@anthropic/mcp-google-calendar"]
          env:
            GOOGLE_CREDENTIALS_PATH: /path/to/credentials.json
        
        - name: gmail
          transport: stdio
          command: npx
          args: ["-y", "@anthropic/mcp-gmail"]
```

---

## 🟡 CORE 3: Multi-Agent

**Prioridad: ALTA**
**Objetivo:** Múltiples agentes corriendo en la misma instancia, cada uno con su configuración.

### 3.1 Agent Schema

```prisma
model Agent {
  id          String   @id @default(cuid())
  projectId   String   @map("project_id")
  
  name        String
  description String?
  
  // Config
  promptConfig    Json    @map("prompt_config")     // identity, instructions, safety
  toolAllowlist   String[] @map("tool_allowlist")   // Allowed tool IDs
  mcpServers      Json?   @map("mcp_servers")       // MCP server configs
  channelConfig   Json?   @map("channel_config")    // Which channels this agent uses
  
  // Limits
  maxTurns            Int     @default(10) @map("max_turns")
  maxTokensPerTurn    Int     @default(4000) @map("max_tokens_per_turn")
  budgetPerDayUsd     Float   @default(10.0) @map("budget_per_day_usd")
  
  // Status
  status      String   @default("active")  // active, paused, disabled
  
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  project     Project  @relation(fields: [projectId], references: [id])
  
  @@unique([projectId, name])
  @@map("agents")
}
```

### 3.2 Agent Registry

```typescript
// src/agents/agent-registry.ts

export interface AgentConfig {
  id: string;
  name: string;
  projectId: string;
  promptConfig: PromptConfig;
  toolAllowlist: string[];
  mcpServers: MCPServerConfig[];
  channelConfig: ChannelConfig;
  limits: AgentLimits;
}

export interface AgentRegistry {
  // Get agent by ID
  get(agentId: string): Promise<AgentConfig | null>;
  
  // Get agent by name within project
  getByName(projectId: string, name: string): Promise<AgentConfig | null>;
  
  // List all agents for a project
  list(projectId: string): Promise<AgentConfig[]>;
  
  // Create/update agent
  upsert(config: AgentConfig): Promise<AgentConfig>;
  
  // Get the AgentRunner configured for this agent
  getRunner(agentId: string): Promise<AgentRunner>;
}
```

### 3.3 Agent-to-Agent Communication

```typescript
// src/agents/agent-comms.ts

export interface AgentMessage {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  context?: Record<string, unknown>;
  replyTo?: string;  // Message ID if this is a reply
}

export interface AgentComms {
  // Send message to another agent
  send(message: AgentMessage): Promise<string>;  // Returns message ID
  
  // Send and wait for response
  sendAndWait(message: AgentMessage, timeoutMs?: number): Promise<string>;
  
  // Subscribe to messages for an agent
  subscribe(agentId: string, handler: (message: AgentMessage) => void): () => void;
}
```

---

## 🟡 CORE 4: Webhooks Inbound

**Prioridad: ALTA**
**Objetivo:** Eventos externos disparan acciones del agente.

### 4.1 Webhook Registry

```typescript
// src/webhooks/types.ts

export interface WebhookConfig {
  id: string;
  projectId: string;
  agentId?: string;      // Optional: route to specific agent
  
  name: string;
  description?: string;
  
  // Security
  secret?: string;       // For HMAC validation
  allowedIps?: string[];
  
  // Routing
  triggerPrompt: string; // Template for the message to send to agent
                         // e.g. "New lead received: {{name}} ({{email}})"
  
  status: 'active' | 'paused';
}

export interface WebhookEvent {
  webhookId: string;
  payload: unknown;
  headers: Record<string, string>;
  receivedAt: Date;
}

export interface WebhookProcessor {
  // Process incoming webhook
  process(event: WebhookEvent): Promise<void>;
  
  // Register webhook config
  register(config: WebhookConfig): Promise<string>;
  
  // Get webhook by ID
  get(id: string): Promise<WebhookConfig | null>;
}
```

### 4.2 Webhook Endpoint

```typescript
// src/api/routes/webhooks.ts

// Dynamic webhook endpoint
fastify.post('/webhooks/:webhookId', async (request, reply) => {
  const { webhookId } = request.params;
  
  const event: WebhookEvent = {
    webhookId,
    payload: request.body,
    headers: request.headers as Record<string, string>,
    receivedAt: new Date(),
  };
  
  await deps.webhookProcessor.process(event);
  
  return { status: 'received' };
});
```

---

## 🟢 CORE 5: File Handling

**Prioridad: MEDIA**
**Objetivo:** Agente puede recibir y enviar archivos.

### 5.1 File Storage

```typescript
// src/files/types.ts

export interface StoredFile {
  id: string;
  projectId: string;
  
  filename: string;
  mimeType: string;
  sizeBytes: number;
  
  storageProvider: 'local' | 's3';
  storagePath: string;
  
  uploadedAt: Date;
  expiresAt?: Date;
  
  metadata?: Record<string, unknown>;
}

export interface FileStorage {
  // Upload file
  upload(projectId: string, file: Buffer, filename: string, mimeType: string): Promise<StoredFile>;
  
  // Get file
  get(fileId: string): Promise<StoredFile | null>;
  
  // Get file content
  download(fileId: string): Promise<Buffer>;
  
  // Get public URL (if supported)
  getUrl(fileId: string, expiresInSeconds?: number): Promise<string | null>;
  
  // Delete file
  delete(fileId: string): Promise<void>;
}
```

### 5.2 File Tool

```typescript
// src/tools/definitions/file-upload.ts

export const fileUploadTool: Tool = {
  id: 'file_upload',
  name: 'file_upload',
  description: 'Upload a file and get a shareable URL',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Base64 encoded file content' },
      filename: { type: 'string' },
      mimeType: { type: 'string' },
    },
    required: ['content', 'filename', 'mimeType'],
  },
  
  async execute(input, context) {
    const buffer = Buffer.from(input.content, 'base64');
    const file = await context.fileStorage.upload(
      context.projectId,
      buffer,
      input.filename,
      input.mimeType
    );
    return { fileId: file.id, url: await context.fileStorage.getUrl(file.id) };
  }
};
```

---

## 🟢 CORE 6: State Machines (Workflows)

**Prioridad: MEDIA**
**Objetivo:** Workflows con estados y transiciones.

### 6.1 State Machine Schema

```prisma
model Workflow {
  id          String   @id @default(cuid())
  projectId   String   @map("project_id")
  
  name        String
  description String?
  
  // State machine definition
  states      Json     // { [stateName]: { transitions: [...], onEnter?, onExit? } }
  initialState String  @map("initial_state")
  
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  project     Project  @relation(fields: [projectId], references: [id])
  instances   WorkflowInstance[]
  
  @@map("workflows")
}

model WorkflowInstance {
  id          String   @id @default(cuid())
  workflowId  String   @map("workflow_id")
  contactId   String?  @map("contact_id")
  sessionId   String?  @map("session_id")
  
  currentState String  @map("current_state")
  context      Json    @default("{}")
  
  startedAt    DateTime @default(now()) @map("started_at")
  completedAt  DateTime? @map("completed_at")
  
  workflow    Workflow @relation(fields: [workflowId], references: [id])
  
  @@map("workflow_instances")
}
```

### 6.2 State Machine Engine

```typescript
// src/workflows/engine.ts

export interface WorkflowEngine {
  // Start a new workflow instance
  start(workflowId: string, context?: Record<string, unknown>): Promise<WorkflowInstance>;
  
  // Trigger a transition
  transition(instanceId: string, event: string, data?: unknown): Promise<WorkflowInstance>;
  
  // Get current state
  getState(instanceId: string): Promise<WorkflowInstance | null>;
  
  // Get available transitions from current state
  getAvailableTransitions(instanceId: string): Promise<string[]>;
}
```

---

## Implementation Order

```
Week 1-2: CORE 1 (Channels + Contacts + Proactive)
├── Day 1-2: Contact schema + repository
├── Day 3-4: Channel types + router interface
├── Day 5-6: Telegram adapter (simplest to test)
├── Day 7-8: WhatsApp adapter
├── Day 9-10: Inbound processor + proactive messenger

Week 3-4: CORE 2 (MCP Client)
├── Day 1-3: MCP client implementation (use @modelcontextprotocol/sdk)
├── Day 4-5: Server manager (stdio transport)
├── Day 6-7: Tool bridge integration with AgentRunner
├── Day 8-10: Config + testing with Google Calendar MCP

Week 5-6: CORE 3 + 4 (Multi-Agent + Webhooks)
├── Day 1-3: Agent schema + registry
├── Day 4-5: Agent-aware routing in inbound processor
├── Day 6-8: Webhook registry + processor
├── Day 9-10: Testing + documentation

Week 7-8: CORE 5 + 6 (Files + Workflows)
├── Day 1-3: File storage (local first, S3 later)
├── Day 4-5: File tool + channel integration
├── Day 6-8: Workflow schema + engine
├── Day 9-10: Integration testing
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@slack/web-api": "^7.0.0",
    "telegraf": "^4.16.0"
  }
}
```

For WhatsApp, options:
- **Cloud API**: Direct HTTP calls (recommended for production)
- **Baileys**: Open source library (good for development)

---

## File Structure

```
src/
├── channels/
│   ├── types.ts
│   ├── channel-router.ts
│   ├── inbound-processor.ts
│   ├── proactive.ts
│   ├── adapters/
│   │   ├── telegram.ts
│   │   ├── whatsapp.ts
│   │   ├── slack.ts
│   │   └── email.ts
│   └── index.ts
├── contacts/
│   ├── types.ts
│   ├── contact-repository.ts
│   └── index.ts
├── mcp/
│   ├── types.ts
│   ├── client.ts
│   ├── server-manager.ts
│   ├── tool-bridge.ts
│   └── index.ts
├── agents/
│   ├── types.ts
│   ├── agent-registry.ts
│   ├── agent-comms.ts
│   └── index.ts
├── webhooks/
│   ├── types.ts
│   ├── webhook-processor.ts
│   └── index.ts
├── files/
│   ├── types.ts
│   ├── storage-local.ts
│   ├── storage-s3.ts
│   └── index.ts
└── workflows/
    ├── types.ts
    ├── engine.ts
    └── index.ts
```

---

## Testing Strategy

Each module should have:
1. **Unit tests**: Test individual functions with mocks
2. **Integration tests**: Test with real dependencies (DB, Redis)
3. **E2E tests**: Test full flows (message in → agent response → message out)

Use `vitest` (already configured) for all tests.

---

## Notes for AI Coder

1. **Follow existing patterns**: Look at how `src/tools/definitions/` implements tools
2. **Use existing types**: Import from `@/core/types.js`, `@/tools/types.js`, etc.
3. **Add tests**: Every new file needs a `.test.ts` file
4. **Use Zod**: All external inputs should be validated with Zod schemas
5. **Error handling**: Use the `Result` pattern from `@/core/result.js`
6. **Logging**: Use the logger from `@/observability/logger.js`
7. **Database**: Use Prisma repositories (see `src/infrastructure/repositories/`)

Start with CORE 1 (Channels). It's the foundation everything else builds on.
