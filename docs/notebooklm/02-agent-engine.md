# Nexus Core — Agent Engine Deep Dive

## Overview

The agent engine is the core of Nexus Core. It takes a user message, runs an LLM in a loop (calling tools as needed), and returns a final text response plus a full execution trace. The engine integrates five subsystems: LLM providers, prompt layers, memory management, cost tracking, and execution tracing.

## The Agent Runner Loop (src/core/agent-runner.ts)

The `AgentRunner` is created via a factory function that receives all its dependencies:

```typescript
interface AgentRunnerOptions {
  provider: LLMProvider;        // Primary LLM
  fallbackProvider?: LLMProvider; // Fallback LLM (optional)
  toolRegistry: ToolRegistry;    // Tool access + RBAC
  memoryManager: MemoryManager;  // 4-layer memory
  costGuard: CostGuard;          // Budget enforcement
}
```

The `run()` method implements the loop:

```typescript
interface AgentRunner {
  run(params: {
    message?: string;
    agentConfig: AgentConfig;
    sessionId: SessionId;
    systemPrompt: string;           // Pre-built by chat-setup
    promptSnapshot: PromptSnapshot; // Which prompt versions were used
    conversationHistory?: Message[];
    abortSignal?: AbortSignal;
    onEvent?: (event: AgentStreamEvent) => void; // Real-time streaming
  }): Promise<Result<ExecutionTrace, NexusError>>;
}
```

### Loop Pseudocode

```
1. Create ExecutionContext (projectId, sessionId, traceId, permissions, abortSignal)
2. Initialize empty ExecutionTrace
3. Load conversation history + new user message

WHILE should_continue:
  4. Check max turns limit → if exceeded, status = 'max_turns', break
  5. Cost guard pre-check → if budget exceeded, status = 'budget_exceeded', break
  6. Retrieve long-term memories (pgvector semantic search on user message)
  7. Fit conversation to context window via MemoryManager:
     - If messages exceed token budget → prune (turn-based or token-based)
     - If compaction enabled → LLM-summarize old messages → recover tokens
  8. Format tools for provider (convert Zod schemas to provider-specific format)
  9. Call LLM (streaming via async generator):
     - Try primary provider first
     - If it fails (rate limit, server error, timeout) → try fallback provider
     - Stream content_delta events to WebSocket client
  10. Parse LLM response:
      - If text content → final answer, break loop
      - If tool_use blocks → for each tool call:
        a. Validate tool exists in registry (catch hallucinations)
        b. Check RBAC (is tool in agent's allowedTools set?)
        c. Validate input against Zod schema
        d. Check risk level:
           - low/medium → execute immediately
           - high/critical → ApprovalGate.request() → pause execution
        e. Execute tool: tool.execute(input, context)
        f. Record tool_call + tool_result events in trace
        g. Add tool result to conversation
        h. Auto-store in long-term memory if tool is "memory-worthy"
      - Continue loop (LLM needs to process tool results)
  11. Record token usage (input + output + cache) in trace
  12. Update cost totals

13. Finalize trace (duration, status, turnCount)
14. Return Result<ExecutionTrace, NexusError>
```

### Streaming Events

The agent runner emits `AgentStreamEvent` events in real-time via the `onEvent` callback. The WebSocket endpoint relays these to the browser:

```typescript
type AgentStreamEvent =
  | { type: 'agent_start'; sessionId; traceId }
  | { type: 'content_delta'; delta: string }        // Streaming text chunks
  | { type: 'tool_use_start'; toolId; toolCallId; input }
  | { type: 'tool_result'; toolCallId; result; success }
  | { type: 'turn_complete'; turnNumber; tokensUsed }
  | { type: 'agent_complete'; trace: ExecutionTrace }
  | { type: 'approval_requested'; approvalId; toolId; input }
  | { type: 'error'; code; message }
```

### Failover

If the primary LLM provider fails, the runner automatically tries the fallback provider:

```typescript
const chatResult = await executeLLMCall({
  provider,
  fallbackProvider,
  systemPrompt,
  messages: fittedMessages,
  tools: formattedTools,
  agentConfig,
  context,
  trace,
  onStreamEvent,
  onFallback: () => { /* log */ },
});
```

Failover triggers on: rate limit errors, server errors (5xx), timeouts. Configurable per agent via `FailoverConfig`.

### Auto-Memory Storage

After a successful tool execution, the runner checks if the tool is "memory-worthy" and automatically stores the result in long-term memory:

```typescript
const MEMORY_WORTHY_TOOLS = [
  'catalog-search', 'catalog-order',
  'vehicle-lead-score', 'vehicle-check-followup',
  'wholesale-update-stock', 'wholesale-order-history',
  'knowledge-search', 'web-search',
];
```

This is fire-and-forget — the memory store generates an embedding and saves it to pgvector without blocking the agent loop.

## LLM Providers (src/providers/)

### Provider Interface

All providers implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  id: string;
  chat(params: {
    systemPrompt: string;
    messages: Message[];
    tools?: ProviderTool[];
    abortSignal?: AbortSignal;
  }): AsyncGenerator<StreamEvent>;

  countTokens(messages: Message[]): Promise<number>;
  formatTools(tools: GenericTool[]): ProviderTool[];
  supportsToolUse(): boolean;
}
```

### Supported Providers

1. **OpenAI** (`src/providers/openai.ts`) — GPT-4o, GPT-4o-mini, o1-preview, etc. Uses the OpenAI SDK. Supports streaming and tool use.

2. **Anthropic** (`src/providers/anthropic.ts`) — Claude Sonnet, Claude Opus. Uses the Anthropic SDK. Supports streaming, tool use, and extended thinking.

3. **Google** (`src/providers/google.ts`) — Gemini models. Uses OpenAI-compatible API.

4. **Ollama** (`src/providers/ollama.ts`) — Local models via Ollama. Uses OpenAI-compatible API with custom base URL.

### Provider Factory

```typescript
function createProvider(config: LLMProviderConfig): LLMProvider {
  // Resolves API key from environment variable (never stored in config)
  const apiKey = process.env[config.apiKeyEnvVar ?? defaultEnvVar(config.provider)];

  switch (config.provider) {
    case 'openai': return createOpenAIProvider({ apiKey, model: config.model, ... });
    case 'anthropic': return createAnthropicProvider({ apiKey, model: config.model, ... });
    case 'google': return createGoogleProvider({ apiKey, model: config.model, ... });
    case 'ollama': return createOllamaProvider({ baseUrl: config.baseUrl, model: config.model, ... });
  }
}
```

### Model Registry

`src/providers/models.ts` contains pricing and capability data for all supported models:

```typescript
const MODELS = {
  'gpt-4o': {
    provider: 'openai',
    contextWindow: 128000,
    supportsTools: true,
    costPerInputToken: 0.000005,
    costPerOutputToken: 0.000015,
    // ...
  },
  'claude-sonnet-4-5-20250929': {
    provider: 'anthropic',
    contextWindow: 200000,
    supportsTools: true,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    // ...
  },
  // ... more models
};
```

## Prompt System (src/prompts/)

### 5-Layer Prompt Composition

The system prompt is assembled from 5 layers:

1. **Identity Layer** (from DB, versioned) — Who the agent is. Name, personality, tone, language.
   - Example: "Sos Luna, la asesora comercial de Papelera Market Paper. Hablás en español rioplatense."

2. **Instructions Layer** (from DB, versioned) — What the agent should do. Business rules, workflows.
   - Example: "Cuando recibas una consulta, evaluá si podés responderla directamente..."

3. **Tools Layer** (generated at runtime) — Documentation for available tools, auto-generated from Zod schemas.
   - Lists each tool's name, description, input parameters, and output format.

4. **Context Layer** (generated at runtime) — Retrieved memories, project context, current date/time.
   - Includes relevant long-term memories from pgvector search.

5. **Safety Layer** (from DB, versioned) — Red lines and guardrails.
   - Example: "Nunca compartas credenciales, datos de otros clientes, ni inventés información."

### Prompt Layer Versioning

Each layer is independently versioned per project. The database stores all versions:

```
PromptLayer {
  id, projectId, layerType (identity|instructions|safety),
  version (1, 2, 3...), content, isActive,
  createdBy, changeReason, performanceNotes
}
```

When a new version is created, the old one is deactivated. Previous versions are kept for audit and rollback. A `PromptSnapshot` records exactly which versions were used in each execution, enabling A/B testing and performance correlation.

### Prompt Builder

```typescript
function buildPrompt(options: {
  identityContent: string;
  instructionsContent: string;
  safetyContent: string;
  tools: ToolDefinition[];
  memories?: RetrievedMemory[];
  projectContext?: Record<string, string>; // for {{placeholder}} interpolation
}): string {
  // Assembles all 5 layers with markdown formatting
  // Interpolates {{agentName}}, {{projectName}}, etc. in layer content
}
```

### Layer Manager

The `LayerManager` service handles:
- Resolving the active layer for each type (identity, instructions, safety) per project
- Creating new layer versions
- Activating/deactivating layers
- Creating `PromptSnapshot` records for each execution

## Memory System (src/memory/)

### 4-Layer Architecture

The memory system is a pipeline that manages conversation context:

**Layer 1: Context Window Fitting**
- Tracks the token budget (model's context window minus reserved tokens)
- Calls `MemoryManager.fitToContextWindow(messages)` before each LLM call
- If messages fit → pass them through unchanged
- If messages don't fit → proceed to Layer 2

**Layer 2: Pruning**
Two strategies (configurable per agent):

- **Turn-based:** Keep first N messages (conversation start / system context) + last N messages (recent conversation). Drop the middle.
- **Token-based:** Start from the most recent messages, add backwards until token budget is reached. Always keep the first message (system context).

Both strategies preferentially drop `tool_result` content from the middle (tool results are large and less valuable over time).

**Layer 3: Compaction**
- If pruning dropped messages and compaction is enabled:
  - Take the dropped messages
  - Send them to the LLM with a summarization prompt
  - Replace them with a compact "[Previous conversation summary: ...]" message
  - This recovers context that would otherwise be lost
  - Optionally flush dropped messages to long-term store before compaction

**Layer 4: Long-Term Semantic Search (pgvector)**
- Stores important facts, decisions, preferences as vector embeddings
- Uses OpenAI's text-embedding-ada-002 (1536 dimensions) by default
- Retrieval: cosine similarity + temporal decay
- Temporal decay formula: `final_score = cosine_score * EXP(-λ * age_days)`
  - λ = ln(2) / decayHalfLifeDays (configurable per agent)
  - A memory's score decays to 50% after `decayHalfLifeDays` days
- Top-K retrieval (default 5) scoped to project or session
- Auto-generates embeddings if caller passes `embedding: []`

### Memory Entry Schema

```typescript
interface MemoryEntry {
  id: string;
  projectId: string;
  sessionId?: string;      // Session-scoped if set
  category: 'fact' | 'decision' | 'preference' | 'task_context' | 'learning';
  content: string;
  embedding: number[];     // 1536-dim vector (auto-generated if empty)
  importance: number;      // 0.0-1.0 (assigned by LLM or caller)
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}
```

### Memory Configuration Per Agent

```typescript
interface MemoryConfig {
  longTerm: {
    enabled: boolean;
    maxEntries: number;
    retrievalTopK: number;        // How many memories to retrieve
    embeddingProvider: string;     // 'openai' (default)
    decayEnabled: boolean;
    decayHalfLifeDays: number;    // e.g., 60 days
  };
  contextWindow: {
    reserveTokens: number;        // Tokens to reserve for response
    pruningStrategy: 'turn-based' | 'token-based';
    maxTurnsInContext: number;
    compaction: {
      enabled: boolean;
      memoryFlushBeforeCompaction: boolean; // Store memories before summarizing
    };
  };
}
```

## Cost Guard (src/cost/)

### Budget Enforcement

The CostGuard middleware sits between the agent runner and the LLM providers:

```typescript
interface CostGuard {
  preCheck(projectId: ProjectId): Promise<void>;  // Throws BudgetExceededError if over budget
  recordUsage(record: UsageRecord): Promise<void>;
  getUsageSummary(projectId: ProjectId): Promise<UsageSummary>;
}
```

### Budget Levels

Per project, configurable:
- **Daily budget:** e.g., $10/day
- **Monthly budget:** e.g., $200/month
- **Rate limits:** max requests per minute, max requests per hour
- **Alert threshold:** e.g., 80% of budget → log warning
- **Hard limit:** 100% → block execution

### Usage Tracking

Every LLM call records:
```typescript
interface UsageRecord {
  projectId, sessionId, traceId;
  provider: string;           // 'openai', 'anthropic', etc.
  model: string;              // 'gpt-4o', 'claude-sonnet-4-5', etc.
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;    // Anthropic prompt caching
  cacheWriteTokens: number;
  costUsd: number;            // Calculated from model pricing table
  timestamp: Date;
}
```

Cost calculation uses the model registry prices:
```typescript
function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = MODELS[model];
  return (
    usage.inputTokens * pricing.costPerInputToken +
    usage.outputTokens * pricing.costPerOutputToken +
    usage.cacheReadTokens * (pricing.costPerCacheReadToken ?? 0) +
    usage.cacheWriteTokens * (pricing.costPerCacheWriteToken ?? 0)
  );
}
```

## Execution Trace (src/core/types.ts)

Every agent run produces a complete execution trace:

```typescript
interface ExecutionTrace {
  id: TraceId;
  projectId: ProjectId;
  sessionId: SessionId;
  promptSnapshot: PromptSnapshot;  // Which prompt layer versions were used
  events: TraceEvent[];            // Timestamped event log
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUSD: number;
  turnCount: number;
  status: ExecutionStatus;         // completed, failed, budget_exceeded, max_turns, etc.
  createdAt: Date;
  completedAt?: Date;
}
```

### Trace Event Types

```typescript
type TraceEventType =
  | 'llm_request'           // LLM call started
  | 'llm_response'          // LLM response received
  | 'tool_call'             // Tool execution started
  | 'tool_result'           // Tool execution completed
  | 'tool_blocked'          // Tool blocked by RBAC
  | 'tool_hallucination'    // LLM tried to use non-existent tool
  | 'approval_requested'    // High-risk tool paused for approval
  | 'approval_resolved'     // Human approved/rejected tool call
  | 'memory_retrieval'      // Long-term memories retrieved
  | 'memory_store'          // Memory stored
  | 'compaction'            // Conversation compacted
  | 'error'                 // Error occurred
  | 'cost_check'            // Budget check passed
  | 'cost_alert'            // Budget threshold reached
  | 'failover';             // Primary provider failed, using fallback
```

Each event has:
```typescript
interface TraceEvent {
  id: string;
  traceId: TraceId;
  type: TraceEventType;
  timestamp: Date;
  durationMs?: number;
  data: Record<string, unknown>; // Event-specific data
  parentEventId?: string;
}
```

## AgentConfig — The Full Agent Configuration

```typescript
interface AgentConfig {
  id: AgentId;
  projectId: ProjectId;
  name: string;
  description?: string;

  // Prompts
  promptConfig: {
    identity: string;     // Who the agent is
    instructions: string; // What it should do
    safety: string;       // What it must not do
  };

  // LLM
  llmConfig?: {
    provider?: 'anthropic' | 'openai' | 'google' | 'ollama';
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };

  // Tools
  toolAllowlist: string[];  // Explicit tool IDs this agent can use

  // MCP Servers
  mcpServers: MCPServerConfig[];

  // Channels
  channelConfig: {
    allowedChannels: string[]; // 'whatsapp', 'telegram', etc.
    defaultChannel?: string;
  };

  // Operating Modes
  modes: AgentMode[];           // Dual-mode support (public/internal)
  operatingMode: AgentOperatingMode; // customer-facing | internal | copilot | manager

  // Skills
  skillIds: string[];           // SkillInstance IDs (compose instructions + tools)

  // Limits
  limits: {
    maxTurns: number;           // Max turns per session
    maxTokensPerTurn: number;   // Max tokens per LLM call
    budgetPerDayUsd: number;    // Daily budget
  };

  // Escalation
  managerAgentId?: string;      // Manager agent for escalation

  // Status
  status: 'active' | 'paused' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}
```

## Chat Setup (src/api/routes/chat-setup.ts)

The `prepareChatRun` function is the bridge between the API layer and the agent runner. It's shared between the REST endpoint (`/chat`) and the WebSocket endpoint (`/chat/stream`):

```
prepareChatRun(request) → ChatSetupResult:
  1. Validate request schema (Zod)
  2. Sanitize user input (InputSanitizer)
  3. Load project config from DB
  4. Load agent config from DB (merge with project defaults)
  5. Resolve active prompt layers (identity, instructions, safety)
  6. Compose skills (append skill instructions to Instructions layer)
  7. Retrieve long-term memories for context
  8. Build system prompt (5 layers)
  9. Create PromptSnapshot (record which versions were used)
  10. Initialize LLM provider (resolve API key from env var)
  11. Create per-request MemoryManager
  12. Create per-request CostGuard
  13. Load conversation history from DB
  14. Return { agentRunner, agentConfig, systemPrompt, history, ... }
```

## Branded ID Types

The system uses branded types to prevent accidental type confusion:

```typescript
type ProjectId = Brand<string, 'ProjectId'>;
type SessionId = Brand<string, 'SessionId'>;
type TraceId = Brand<string, 'TraceId'>;
type AgentId = Brand<string, 'AgentId'>;
// ... etc.
```

This means you can't accidentally pass a `SessionId` where a `ProjectId` is expected — TypeScript catches the error at compile time. IDs are created via explicit casting: `const pid = 'abc' as ProjectId`.

## Result Type

The system uses a `Result<T, E>` type instead of try/catch for expected failures:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function ok<T>(value: T): Result<T, never>;
function err<E>(error: E): Result<never, E>;
```

The agent runner returns `Result<ExecutionTrace, NexusError>`. Callers check `result.ok` to determine success/failure without catching exceptions. Exceptions are reserved for truly unexpected errors (bugs, infrastructure failures).

## Error Hierarchy

```typescript
class NexusError extends Error {
  code: string;
  statusCode: number;
  context?: Record<string, unknown>;
}

class BudgetExceededError extends NexusError { /* ... */ }
class ToolNotAllowedError extends NexusError { /* ... */ }
class ProviderError extends NexusError { /* ... */ }
class ApprovalRequiredError extends NexusError { /* ... */ }
```
