# Nexus Core — Tools, MCP, and Skills

## Tool System Overview

The tool system is how agents interact with the outside world. Every capability an agent has — from checking the time to sending a WhatsApp message to delegating work to another agent — is implemented as a tool. Tools are the building blocks of agent behavior.

### Why Tools Matter

When an LLM (like GPT-4o or Claude) processes a user message, it can either:
1. Respond with text (final answer)
2. Request to use a tool (agent runner executes it and feeds the result back)

The LLM decides which tools to call based on the tool descriptions provided in the system prompt. Better tool design = better agent behavior.

## Tool Architecture

### ExecutableTool Interface

Every tool implements this interface:

```typescript
interface ExecutableTool extends ToolDefinition {
  execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;
  dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;
  healthCheck?(): Promise<boolean>;
}

interface ToolDefinition {
  id: string;                    // Unique ID (e.g., 'send-email')
  name: string;                  // Human-readable name
  description: string;           // Description for the LLM
  category: ToolCategory;        // 'utility', 'communication', 'data', 'integration', 'orchestration'
  inputSchema: z.ZodType;        // Zod schema for input validation
  outputSchema: z.ZodType;       // Zod schema for output validation
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;     // If true, high/critical calls pause for human review
  tags: string[];                // For categorization and filtering
}
```

### Key Methods

- **`execute(input, context)`** — The real implementation. Makes API calls, queries databases, sends messages. Returns `Result<ToolResult, NexusError>`.
- **`dryRun(input, context)`** — Validates input and returns expected output shape without side effects. Used for testing and previewing.
- **`healthCheck()`** — Optional. Verifies external dependencies are reachable.

### Tool Factory Pattern

Tools are created via factory functions that receive their dependencies:

```typescript
function createSendEmailTool(options: {
  secretService: SecretService;  // For resolving API keys at runtime
}): ExecutableTool {
  return {
    id: 'send-email',
    name: 'Send Email',
    description: 'Send an email to a specified recipient',
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    // ...
    async execute(input, context) {
      const data = input as { to: string; subject: string; body: string };
      const apiKey = await options.secretService.get(context.projectId, 'RESEND_API_KEY');
      // ... send email using Resend API
      return ok({ success: true, messageId: '...' });
    },
    async dryRun(input, context) {
      const result = this.inputSchema.safeParse(input);
      if (!result.success) return err(new NexusError('INVALID_INPUT', ...));
      return ok({ success: true, preview: true, wouldSendTo: result.data.to });
    },
  };
}
```

**Critical:** Dependencies like `SecretService`, `ChannelResolver`, and `FileService` are injected via the factory options — never via `ExecutionContext`. The `ExecutionContext` only carries request-scoped data (projectId, sessionId, permissions).

## Tool Registry (src/tools/registry/)

The `ToolRegistry` manages all available tools and enforces access control:

```typescript
interface ToolRegistry {
  register(tool: ExecutableTool): void;
  get(toolId: string): ExecutableTool | undefined;
  list(): ExecutableTool[];
  formatForProvider(context: ExecutionContext): GenericTool[];
  resolve(toolId: string, input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>>;
}
```

### RBAC Enforcement

When the agent runner calls `toolRegistry.resolve(toolId, input, context)`:

1. **Existence check:** Does the tool exist? If not → `ToolNotFoundError` (catches LLM hallucinations)
2. **Permission check:** Is `toolId` in `context.permissions.allowedTools`? If not → `ToolNotAllowedError`
3. **Input validation:** Does the input match the Zod schema? If not → `InvalidInputError`
4. **Risk check:** Is the tool high/critical risk AND `requiresApproval` is true? If yes → `ApprovalRequiredError` (pauses execution for human review)
5. **Execute:** Call `tool.execute(input, context)`

### formatForProvider

Converts tools into the format the LLM provider expects. For OpenAI:
```json
{
  "type": "function",
  "function": {
    "name": "send-email",
    "description": "Send an email to a specified recipient",
    "parameters": { /* JSON Schema from Zod */ }
  }
}
```

Only tools in the agent's `allowedTools` set are included — the LLM never sees tools it can't use.

## All 28 Built-In Tools

### Utility Tools

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `calculator` | Safe mathematical expression evaluator (no eval/Function) | low | no |
| `date-time` | Current date/time in any timezone, date arithmetic | low | no |
| `json-transform` | Transform JSON data with JMESPath expressions | low | no |

### Knowledge & Search Tools

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `knowledge-search` | Semantic search over project knowledge base (pgvector) | low | no |
| `store-memory` | Explicitly store a fact/decision in long-term memory | low | no |
| `web-search` | Search the web using Tavily API | medium | no |
| `scrape-webpage` | Scrape a webpage using Puppeteer (headless Chrome), extract text/links, screenshots, CSS selectors, JS rendering. SSRF protection (blocks internal IPs) | medium | no |
| `read-file` | Read a file from the project's file storage | low | no |

### Communication Tools

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `send-email` | Send email via Resend API (requires secret) | high | yes |
| `send-channel-message` | Send a message via any configured channel (WhatsApp, Telegram, etc.) | high | yes |
| `send-notification` | Send a notification to the Fomo team | medium | no |
| `escalate-to-human` | Pause the conversation and request human takeover | medium | no |

### Integration Tools

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `http-request` | Make HTTP requests to external APIs. SSRF protection (blocks internal IPs, private ranges) | medium | no |
| `propose-scheduled-task` | Propose a recurring task (cron-based). Created as "proposed", needs human approval | high | yes |

### Orchestration Tools (Multi-Agent)

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `delegate-to-agent` | Delegate a task to another agent in the project. Creates a sub-session, waits for response | medium | no |
| `list-project-agents` | List all agents in the current project with their status and capabilities | low | no |

### Monitoring Tools (Manager-Only)

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `get-operations-summary` | Aggregate snapshot: agent count, active sessions, message volume, pending approvals, costs, escalations | low | no |
| `get-agent-performance` | Detailed metrics for one agent: sessions, messages, tool calls, cost, escalations over a time range | low | no |
| `review-agent-activity` | Recent activity feed for one agent: sessions, tool executions, errors | low | no |

### Session & History Tools

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `query-sessions` | Query sessions with filters (status, agent, date range, channel) | low | no |
| `read-session-history` | Read the full message history of a specific session | low | no |

### Vertical-Specific Tools (Industry Templates)

| Tool | Description | Risk | Approval |
|------|-------------|------|----------|
| `catalog-search` | Search product catalog by name, category, price range | low | no |
| `catalog-order` | Place an order in the catalog system | high | yes |
| `vehicle-lead-score` | Score a vehicle sales lead based on contact data and behavior | low | no |
| `vehicle-check-followup` | Check if a vehicle lead needs follow-up | low | no |
| `wholesale-update-stock` | Update wholesale stock quantities | high | yes |
| `wholesale-order-history` | Query wholesale order history | low | no |
| `hotel-detect-language` | Detect guest language from message text | low | no |
| `hotel-seasonal-pricing` | Calculate hotel room pricing with seasonal adjustments | low | no |

## Tool Scaffolding (src/tools/scaffold.ts)

The `scaffoldTool()` function generates boilerplate for new tools:

```typescript
scaffoldTool({
  id: 'my-new-tool',
  name: 'My New Tool',
  description: 'Does something useful',
  category: 'utility',
  riskLevel: 'low',
});
// → Generates src/tools/definitions/my-new-tool.ts with skeleton code
// → Generates src/tools/definitions/my-new-tool.test.ts with 3-level tests
```

## Testing Pattern (3 Levels)

Every tool must have three levels of tests:

1. **Schema tests** — Verify Zod schema rejects malformed LLM inputs:
   ```typescript
   it('rejects missing required fields', () => {
     const result = tool.inputSchema.safeParse({});
     expect(result.success).toBe(false);
   });
   ```

2. **Dry Run tests** — Verify `dryRun()` returns expected shape without side effects:
   ```typescript
   it('returns preview without executing', async () => {
     const result = await tool.dryRun({ to: 'test@example.com', ... }, context);
     expect(result.ok).toBe(true);
     expect(result.value.preview).toBe(true);
   });
   ```

3. **Integration tests** — Real service calls (mark `it.skip` if no test environment):
   ```typescript
   it.skip('sends a real email', async () => {
     const result = await tool.execute({ ... }, context);
     expect(result.ok).toBe(true);
   });
   ```

## MCP (Model Context Protocol) — src/mcp/

### What is MCP?

MCP is a protocol for connecting LLMs to external tool servers. Instead of building tools directly into Nexus Core, you can connect to an MCP server that exposes tools. The tools are auto-discovered and registered in the ToolRegistry as if they were built-in.

### Architecture

```
Agent Runner → ToolRegistry → MCPToolAdapter → MCPClient → MCP Server (external)
```

- **MCPClient** — Wraps the `@modelcontextprotocol/sdk` library. Manages connections.
- **MCPToolAdapter** — Adapts MCP tools into Nexus `ExecutableTool` interface.
- **MCPManager** — CRUD for MCP server instances. Manages lifecycle (connect, discover, disconnect).

### Transport Types

1. **stdio** — Spawn a subprocess. The MCP server runs as a local process.
   ```typescript
   { transport: 'stdio', command: 'npx', args: ['-y', '@fomo/hubspot-crm-mcp'] }
   ```
   Environment variables are resolved from `process.env` and passed to the subprocess.

2. **sse** — HTTP Server-Sent Events. The MCP server runs remotely.
   ```typescript
   { transport: 'sse', url: 'https://mcp.example.com/sse' }
   ```

### Tool Namespacing

MCP tools are registered with a namespace prefix to avoid collisions:
```
mcp:{serverName}:{toolName}
```
For example, `mcp:hubspot:search-deals` for a HubSpot CRM tool.

### MCP Server Templates

The system includes 12 seeded MCP server templates in the database:

| Template | Category | Transport | Description |
|----------|----------|-----------|-------------|
| Fomo Platform API | erp | sse | Internal Fomo platform integration |
| HubSpot CRM | crm | stdio | CRM with contacts, deals, companies |
| Google Calendar | productivity | stdio | Calendar management |
| Google Sheets | productivity | stdio | Spreadsheet operations |
| Slack Integration | communication | stdio | Slack workspace |
| Odoo ERP | erp | sse | Enterprise resource planning |
| OpenWeather | utility | sse | Weather data |
| AFIP (Argentina) | finance | sse | Tax authority integration |
| MercadoPago | finance | sse | Payment processing |
| WooCommerce | ecommerce | sse | Online store |
| Generic REST API | integration | sse | Any REST API |
| Custom MCP Server | custom | stdio | Build your own |

### HubSpot CRM MCP Server (src/mcp/servers/hubspot-crm/)

A reference implementation with 5 tools:
- `search-contacts` — Search HubSpot contacts by name/email
- `search-deals` — Search deals by stage, pipeline, owner, inactive days
- `update-deal-stage` — Move a deal to a different pipeline stage
- `add-deal-note` — Add a note to a deal
- `search-companies` — Search companies

The `search-deals` tool supports filtering by days of inactivity, pipeline stage, and deal owner — useful for the Market Paper reactivation campaign.

### MCP Server Instances

Each project can have multiple MCP server instances. They're stored in the database and connected at chat time:

```typescript
MCPServerInstance {
  id, projectId, templateId (optional),
  name, transport, command, args, envSecretKeys, url, toolPrefix,
  status: 'active' | 'paused' | 'error'
}
```

## Skills System

### What Are Skills?

Skills are composable behavior modules. Instead of writing instructions directly into an agent's prompt, you can create reusable "skills" that add instructions and required tools. At chat time, skills are composed into the agent's configuration.

### Skill Templates (Global Catalog)

10 pre-seeded templates:

| Skill | Category | Description |
|-------|----------|-------------|
| Atención al Cliente | support | Standard customer support behavior |
| Seguimiento de Ventas | sales | Sales lead follow-up automation |
| Respuesta FAQ | support | FAQ auto-response patterns |
| Reporte Diario | operations | Daily summary report generation |
| Gestión de Calendario | operations | Calendar event management |
| Campañas WhatsApp | communication | WhatsApp campaign execution |
| Análisis de Sentimiento | operations | Sentiment analysis in conversations |
| Escalación Inteligente | support | Smart escalation rules |
| Onboarding de Clientes | sales | Customer onboarding flows |
| Gestión de Inventario | operations | Stock management |

### Skill Template Schema

```typescript
SkillTemplate {
  id, name, displayName, description, category,
  instructionsFragment: string,  // Appended to agent's Instructions layer
  requiredTools: string[],       // Tool IDs that must be whitelisted
  requiredMcpServers: string[],  // MCP servers that must be connected
  parametersSchema?: object,     // JSON Schema for configurable parameters
  tags, icon, isOfficial, version, status
}
```

### Skill Instances (Per Project)

When you add a skill to a project, it creates a `SkillInstance`:

```typescript
SkillInstance {
  id, projectId, templateId (optional — null for custom skills),
  name, displayName, description,
  instructionsFragment: string,
  requiredTools: string[],
  requiredMcpServers: string[],
  parameters?: object,  // User-filled parameter values
  status: 'active' | 'disabled'
}
```

### Skill Composition at Chat Time

When `prepareChatRun` is called, the skill service:
1. Loads the agent's `skillIds`
2. Fetches each SkillInstance from the DB
3. Appends each skill's `instructionsFragment` to the Instructions layer
4. Merges each skill's `requiredTools` into the agent's `allowedTools`
5. The composed prompt is then passed to the agent runner

This means skills are transparent to the agent — it just sees a richer Instructions layer and more available tools.

## Tool Registration (src/main.ts)

All 28 tools are registered during server bootstrap:

```typescript
// Utility tools
toolRegistry.register(createCalculatorTool());
toolRegistry.register(createDateTimeTool());
toolRegistry.register(createJsonTransformTool());

// Knowledge tools
toolRegistry.register(createKnowledgeSearchTool({ knowledgeService }));
toolRegistry.register(createReadFileTool({ fileService }));
toolRegistry.register(createWebSearchTool({ secretService }));
toolRegistry.register(createScrapeWebpageTool());

// Communication tools
toolRegistry.register(createSendEmailTool({ secretService }));
toolRegistry.register(createSendChannelMessageTool({ channelResolver, secretService }));
toolRegistry.register(createSendNotificationTool());
toolRegistry.register(createEscalateToHumanTool());

// Integration tools
toolRegistry.register(createHttpRequestTool());
toolRegistry.register(createProposeScheduledTaskTool({ taskRepository }));

// Orchestration tools
toolRegistry.register(createDelegateToAgentTool({ agentRegistry, agentComms }));
toolRegistry.register(createListProjectAgentsTool({ agentRegistry }));

// Monitoring tools (manager-only)
toolRegistry.register(createGetOperationsSummaryTool({ prisma }));
toolRegistry.register(createGetAgentPerformanceTool({ prisma, agentRegistry }));
toolRegistry.register(createReviewAgentActivityTool({ prisma, agentRegistry }));

// Session tools
toolRegistry.register(createQuerySessionsTool({ prisma }));
toolRegistry.register(createReadSessionHistoryTool({ prisma }));

// Memory tool (if embeddings available)
if (longTermMemoryStore) {
  toolRegistry.register(createStoreMemoryTool({ longTermStore: longTermMemoryStore }));
}

// Vertical-specific tools
toolRegistry.register(createCatalogSearchTool());
toolRegistry.register(createCatalogOrderTool());
// ... etc.
```

## Tool RBAC — How It Works End to End

1. **Agent creation:** The dashboard user selects which tools this agent can use (checkboxes in the wizard).
2. **Database:** The agent's `toolAllowlist` field stores the list of allowed tool IDs.
3. **Chat setup:** The `toolAllowlist` is loaded from DB and placed in `ExecutionContext.permissions.allowedTools` as a `ReadonlySet<string>`.
4. **Format for provider:** Only tools in the allowlist are included in the LLM's tool descriptions.
5. **Resolve:** If the LLM somehow calls a tool not in the allowlist, the ToolRegistry blocks it with `ToolNotAllowedError`.
6. **Trace:** Blocked tool calls are recorded as `tool_blocked` events in the execution trace.
7. **Hallucinated tools:** If the LLM calls a tool that doesn't exist at all, it's recorded as `tool_hallucination` in the trace.
