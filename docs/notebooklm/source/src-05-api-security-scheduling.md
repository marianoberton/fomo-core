# Nexus Core — Source: API Routes + Security + Scheduling

Complete source code for REST API, security layer, and scheduling system.

---
## src/api/types.ts
```typescript
import type { PrismaClient } from '@prisma/client';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { ExecutionTraceRepository } from '@/infrastructure/repositories/execution-trace-repository.js';
import type { ScheduledTaskRepository } from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ApprovalGate } from '@/security/approval-gate.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { Logger } from '@/observability/logger.js';
import type { ContactRepository } from '@/contacts/types.js';
import type { InboundProcessor } from '@/channels/inbound-processor.js';
import type { WebhookRepository } from '@/webhooks/types.js';
import type { WebhookProcessor } from '@/webhooks/webhook-processor.js';
import type { FileRepository } from '@/files/types.js';
import type { FileService } from '@/files/file-service.js';
import type { AgentRepository, AgentRegistry, AgentComms } from '@/agents/types.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { ProactiveMessenger } from '@/channels/proactive.js';
import type { SecretService } from '@/secrets/types.js';
import type { KnowledgeService } from '@/knowledge/types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { ChannelIntegrationRepository } from '@/channels/types.js';
import type { MCPServerRepository } from '@/infrastructure/repositories/mcp-server-repository.js';
import type { SessionBroadcaster } from '@/hitl/session-broadcaster.js';
import type { SkillService } from '@/skills/skill-service.js';

// ─── API Response Envelope ───────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Pagination ─────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ─── Chat Request/Response ──────────────────────────────────────

export interface ChatRequest {
  projectId: string;
  sessionId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  sessionId: string;
  traceId: string;
  response: string;
  toolCalls: {
    toolId: string;
    input: Record<string, unknown>;
    result: unknown;
  }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
}

// ─── Route Dependencies (DI) ───────────────────────────────────

/** Dependencies injected into all route plugins via Fastify register options. */
export interface RouteDependencies {
  projectRepository: ProjectRepository;
  sessionRepository: SessionRepository;
  promptLayerRepository: PromptLayerRepository;
  executionTraceRepository: ExecutionTraceRepository;
  scheduledTaskRepository: ScheduledTaskRepository;
  contactRepository: ContactRepository;
  webhookRepository: WebhookRepository;
  fileRepository: FileRepository;
  agentRepository: AgentRepository;
  approvalGate: ApprovalGate;
  toolRegistry: ToolRegistry;
  taskManager: TaskManager;
  mcpManager: MCPManager;
  inboundProcessor: InboundProcessor;
  webhookProcessor: WebhookProcessor;
  fileService: FileService;
  agentRegistry: AgentRegistry;
  agentComms: AgentComms;
  /** Proactive messenger for scheduled outbound messages (null if Redis not configured). */
  proactiveMessenger: ProactiveMessenger | null;
  /** Long-term memory store for pgvector semantic search (null if embeddings not configured). */
  longTermMemoryStore: LongTermMemoryStore | null;
  /** Encrypted per-project credential store. */
  secretService: SecretService;
  /** Knowledge base CRUD service (null if embeddings not configured). */
  knowledgeService: KnowledgeService | null;
  /** Per-project channel adapter resolver (secrets-based). */
  channelResolver: ChannelResolver;
  /** Channel integration repository for CRUD operations. */
  channelIntegrationRepository: ChannelIntegrationRepository;
  /** MCP server template + instance repository. */
  mcpServerRepository: MCPServerRepository;
  /** Skill service for template browsing, instance management, and composition. */
  skillService: SkillService;
  /** Prisma client for direct queries (dashboard aggregations). */
  prisma: PrismaClient;
  /** Session event broadcaster for cross-context updates (Telegram → Dashboard). */
  sessionBroadcaster: SessionBroadcaster;
  /** Callback to resume agent execution after human approval. Fire-and-forget. */
  resumeAfterApproval: (params: {
    approvalId: string;
    decision: 'approved' | 'denied';
    resolvedBy: string;
    note?: string;
  }) => Promise<void>;
  logger: Logger;
}
```

---
## src/api/error-handler.ts
```typescript
/**
 * Global Fastify error handler and response helpers.
 * Maps NexusError subclasses and ZodError to structured ApiResponse envelopes.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { NexusError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';
import type { ApiResponse } from './types.js';

const logger = createLogger({ name: 'error-handler' });

// ─── Response Helpers ───────────────────────────────────────────

/** Send a success response wrapped in the ApiResponse envelope. */
export async function sendSuccess(
  reply: FastifyReply,
  data: unknown,
  statusCode = 200,
): Promise<void> {
  const body: ApiResponse<unknown> = { success: true, data };
  await reply.status(statusCode).send(body);
}

/** Send an error response wrapped in the ApiResponse envelope. */
export async function sendError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode = 500,
  details?: Record<string, unknown>,
): Promise<void> {
  const body: ApiResponse<never> = {
    success: false,
    error: { code, message, ...(details && { details }) },
  };
  await reply.status(statusCode).send(body);
}

/** Send a 404 not-found response. */
export async function sendNotFound(
  reply: FastifyReply,
  resource: string,
  id: string,
): Promise<void> {
  await sendError(reply, 'NOT_FOUND', `${resource} "${id}" not found`, 404);
}

// ─── Global Error Handler ───────────────────────────────────────

/** Register the global Fastify error handler. */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler(async (error, _request, reply) => {
    // Zod validation errors
    if (error instanceof ZodError) {
      const details: Record<string, unknown> = {
        issues: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
      await sendError(reply, 'VALIDATION_ERROR', 'Request validation failed', 400, details);
      return;
    }

    // NexusError hierarchy — use the error's own statusCode and code
    if (error instanceof NexusError) {
      logger.warn('Request failed with NexusError', {
        component: 'error-handler',
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });
      await sendError(
        reply,
        error.code,
        error.message,
        error.statusCode,
        error.context,
      );
      return;
    }

    // Fastify built-in errors (e.g., JSON parse failures, validation)
    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = (error as { statusCode: number }).statusCode;
      await sendError(reply, 'REQUEST_ERROR', error.message, statusCode);
      return;
    }

    // Unknown errors
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('Unhandled error in request', {
      component: 'error-handler',
      error: message,
      stack,
    });
    await sendError(reply, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  });
}
```

---
## src/api/routes/index.ts
```typescript
/**
 * Route registration — registers all API route plugins with Fastify.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { projectRoutes } from './projects.js';
import { sessionRoutes } from './sessions.js';
import { promptLayerRoutes } from './prompt-layers.js';
import { traceRoutes } from './traces.js';
import { approvalRoutes } from './approvals.js';
import { toolRoutes } from './tools.js';
import { chatRoutes } from './chat.js';
import { chatStreamRoutes } from './chat-stream.js';
import { scheduledTaskRoutes } from './scheduled-tasks.js';
import { contactRoutes } from './contacts.js';
import { webhookRoutes } from './webhooks.js';
import { webhookGenericRoutes } from './webhooks-generic.js';
import { fileRoutes } from './files.js';
import { agentRoutes } from './agents.js';
import { dashboardRoutes } from './dashboard.js';
import { usageRoutes } from './usage.js';
import { wsDashboardRoutes } from './ws-dashboard.js';
import { catalogRoutes } from './catalog.js';
import { templateRoutes } from './templates.js';
import { secretRoutes } from './secrets.js';
import { knowledgeRoutes } from './knowledge.js';
import { integrationRoutes } from './integrations.js';
import { inboxRoutes } from './inbox.js';
import { mcpServerRoutes } from './mcp-servers.js';
import { proactiveRoutes } from './proactive.js';
import { operationsSummaryRoutes } from './operations-summary.js';
import { skillRoutes } from './skills.js';

/** Register all API routes on the Fastify instance. */
export async function registerRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  await fastify.register(projectRoutes, deps);
  await fastify.register(sessionRoutes, deps);
  await fastify.register(promptLayerRoutes, deps);
  await fastify.register(traceRoutes, deps);
  await fastify.register(approvalRoutes, deps);
  await fastify.register(toolRoutes, deps);
  await fastify.register(chatRoutes, deps);
  await fastify.register(chatStreamRoutes, deps);
  await fastify.register(scheduledTaskRoutes, deps);
  await fastify.register(contactRoutes, deps);
  await fastify.register(webhookRoutes, deps);
  await fastify.register(webhookGenericRoutes, deps);
  await fastify.register(fileRoutes, deps);
  await fastify.register(agentRoutes, deps);
  await fastify.register(dashboardRoutes, deps);
  await fastify.register(usageRoutes, deps);
  await fastify.register(wsDashboardRoutes, deps);
  await fastify.register(catalogRoutes, deps);
  await fastify.register(templateRoutes, deps);
  await fastify.register(secretRoutes, deps);
  await fastify.register(knowledgeRoutes, deps);
  await fastify.register(integrationRoutes, deps);
  await fastify.register(inboxRoutes, deps);
  await fastify.register(proactiveRoutes, deps);
  await fastify.register(skillRoutes, deps);
  operationsSummaryRoutes(fastify, deps);
  mcpServerRoutes(fastify, { mcpServerRepository: deps.mcpServerRepository, logger: deps.logger });
}
```

---
## src/api/routes/chat.ts
```typescript
/**
 * Chat route — main agent endpoint.
 * Accepts a user message, runs the agent loop, and returns the response.
 *
 * This is the synchronous MVP. When BullMQ is integrated, the agent run
 * will be enqueued as a job and this endpoint will return 202 with a traceId.
 */
import type { FastifyInstance } from 'fastify';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import {
  chatRequestSchema,
  prepareChatRun,
  extractAssistantResponse,
  extractToolCalls,
} from './chat-setup.js';

// ─── Route Plugin ───────────────────────────────────────────────

/** Register the POST /chat route. */
export function chatRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.post('/chat', async (request, reply) => {
    // 1. Validate request
    const body = chatRequestSchema.parse(request.body);

    // 2. Run shared setup (sanitize, load project/session/prompt, create services)
    const setupResult = await prepareChatRun(body, deps);
    if (!setupResult.ok) {
      return sendError(
        reply,
        setupResult.error.code,
        setupResult.error.message,
        setupResult.error.statusCode,
      );
    }

    const {
      sanitizedMessage,
      agentConfig,
      sessionId,
      systemPrompt,
      promptSnapshot,
      conversationHistory,
      provider,
      fallbackProvider,
      memoryManager,
      costGuard,
    } = setupResult.value;

    // 3. Create abort controller tied to client disconnect
    const abortController = new AbortController();
    request.raw.on('close', () => {
      if (!request.raw.complete) {
        abortController.abort();
      }
    });

    // 4. Create agent runner and execute
    const agentRunner = createAgentRunner({
      provider,
      fallbackProvider,
      toolRegistry: deps.toolRegistry,
      memoryManager,
      costGuard,
      logger: deps.logger,
    });

    const result = await agentRunner.run({
      message: sanitizedMessage,
      agentConfig,
      sessionId,
      systemPrompt,
      promptSnapshot,
      conversationHistory,
      abortSignal: abortController.signal,
    });

    if (!result.ok) {
      throw result.error;
    }

    const trace = result.value;

    // 5. Persist execution trace
    await deps.executionTraceRepository.save(trace);

    // 6. Persist messages
    await deps.sessionRepository.addMessage(sessionId, {
      role: 'user',
      content: sanitizedMessage,
    }, trace.id);

    const assistantText = extractAssistantResponse(trace.events);
    const toolCalls = extractToolCalls(trace.events);

    await deps.sessionRepository.addMessage(sessionId, {
      role: 'assistant',
      content: assistantText,
    }, trace.id);

    // 7. Return response
    return sendSuccess(reply, {
      sessionId,
      traceId: trace.id,
      response: assistantText,
      toolCalls,
      usage: {
        inputTokens: trace.totalTokensUsed,
        outputTokens: 0,
        costUSD: trace.totalCostUSD,
      },
    });
  });
}

```

---
## src/api/routes/chat-stream.ts
```typescript
/**
 * WebSocket chat streaming route.
 *
 * Accepts a WebSocket connection at /chat/stream, receives chat request
 * messages, and streams AgentStreamEvent objects back to the client in
 * real time via the agent runner's onEvent callback.
 *
 * Protocol:
 *   Client → Server: JSON matching chatRequestSchema { projectId, sessionId?, message, metadata? }
 *   Server → Client: JSON AgentStreamEvent objects (agent_start, content_delta, tool_use_start, ...)
 *
 * Only one agent run may be active per connection at a time. A second
 * message while a run is in progress receives an error event.
 */
import type { FastifyInstance } from 'fastify';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { AgentStreamEvent } from '@/core/stream-events.js';
import type { RouteDependencies } from '../types.js';
import {
  chatRequestSchema,
  prepareChatRun,
  extractAssistantResponse,
  type ChatRequestBody,
} from './chat-setup.js';

// ─── Core Handler ───────────────────────────────────────────────

/**
 * Process a single chat stream message.
 *
 * Extracted from the WebSocket route for testability. Runs the full
 * agent loop, streaming events via `send`, and persists messages on
 * completion.
 */
export async function handleChatStreamMessage(
  body: ChatRequestBody,
  deps: RouteDependencies,
  send: (event: AgentStreamEvent) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  // 1. Run shared setup
  const setupResult = await prepareChatRun(body, deps);
  if (!setupResult.ok) {
    send({
      type: 'error',
      code: setupResult.error.code,
      message: setupResult.error.message,
    });
    return;
  }

  const setup = setupResult.value;

  // 2. Create agent runner and execute with streaming callback
  const agentRunner = createAgentRunner({
    provider: setup.provider,
    fallbackProvider: setup.fallbackProvider,
    toolRegistry: deps.toolRegistry,
    memoryManager: setup.memoryManager,
    costGuard: setup.costGuard,
    logger: deps.logger,
  });

  const result = await agentRunner.run({
    message: setup.sanitizedMessage,
    agentConfig: setup.agentConfig,
    sessionId: setup.sessionId,
    systemPrompt: setup.systemPrompt,
    promptSnapshot: setup.promptSnapshot,
    conversationHistory: setup.conversationHistory,
    abortSignal,
    onEvent: send,
  });

  if (!result.ok) {
    send({
      type: 'error',
      code: result.error.code,
      message: result.error.message,
    });
    return;
  }

  // 3. Persist execution trace and messages
  const trace = result.value;

  await deps.executionTraceRepository.save(trace);

  await deps.sessionRepository.addMessage(
    setup.sessionId,
    { role: 'user', content: setup.sanitizedMessage },
    trace.id,
  );

  const assistantText = extractAssistantResponse(trace.events);

  await deps.sessionRepository.addMessage(
    setup.sessionId,
    { role: 'assistant', content: assistantText },
    trace.id,
  );
}

// ─── Socket Interface ───────────────────────────────────────────

/** Minimal WebSocket interface consumed by the route handler. */
interface ChatSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  removeListener(event: 'close', listener: () => void): void;
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Set up event handlers on a single WebSocket connection. */
function setupSocket(socket: ChatSocket, deps: RouteDependencies): void {
  let running = false;

  const send = (event: AgentStreamEvent): void => {
    // 1 === WebSocket.OPEN
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(event));
    }
  };

  socket.on('message', (data: Buffer) => {
    if (running) {
      send({ type: 'error', code: 'BUSY', message: 'Agent run already in progress' });
      return;
    }

    let body: ChatRequestBody;
    try {
      const text = data.toString('utf-8');
      const parsed: unknown = JSON.parse(text);
      body = chatRequestSchema.parse(parsed);
    } catch {
      send({ type: 'error', code: 'VALIDATION_ERROR', message: 'Invalid message format' });
      return;
    }

    running = true;
    const messageAbort = new AbortController();
    const onClose = (): void => {
      messageAbort.abort();
    };
    socket.on('close', onClose);

    handleChatStreamMessage(body, deps, send, messageAbort.signal)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unexpected error';
        send({ type: 'error', code: 'INTERNAL_ERROR', message: msg });
      })
      .finally(() => {
        running = false;
        socket.removeListener('close', onClose);
      });
  });

  socket.on('error', (err: Error) => {
    deps.logger.error('WebSocket error', {
      component: 'chat-stream',
      error: err.message,
    });
  });
}

/** Register the WebSocket /chat/stream route. */
export function chatStreamRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.get('/chat/stream', { websocket: true }, (socket) => {
    setupSocket(socket as unknown as ChatSocket, deps);
  });
}
```

---
## src/api/routes/chat-setup.ts
```typescript
/**
 * Shared chat setup module.
 * Extracts the common request validation and dependency resolution logic
 * used before running the agent loop. Both the REST chat route and the
 * WebSocket streaming endpoint share this preparation step.
 */
import { z } from 'zod';
import type { ProjectId, SessionId, TraceId, AgentConfig, PromptSnapshot } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { Message, LLMProvider } from '@/providers/types.js';
import type { MemoryManager } from '@/memory/memory-manager.js';
import type { CostGuard } from '@/cost/cost-guard.js';
import { createProvider } from '@/providers/factory.js';
import { createMemoryManager } from '@/memory/memory-manager.js';
import type { CompactionSummarizer } from '@/memory/memory-manager.js';
import { createCostGuard } from '@/cost/cost-guard.js';
import { createPrismaUsageStore } from '@/cost/prisma-usage-store.js';
import { validateUserInput } from '@/security/input-sanitizer.js';
import {
  buildPrompt,
  resolveActiveLayers,
  createPromptSnapshot,
  computeHash,
} from '@/prompts/index.js';
import { resolveAgentMode } from '@/agents/mode-resolver.js';
import type { RouteDependencies } from '../types.js';

// ─── Defaults ───────────────────────────────────────────────────

/**
 * Sensible defaults for projects created with a simplified config (config: {}).
 * These mirror the seed.ts defaults and ensure the agent loop never crashes
 * due to missing fields, regardless of how the project was created.
 * Agent-level llmConfig overrides are applied on top of these after loading.
 */
const DEFAULT_AGENT_CONFIG = {
  allowedTools: [] as string[],
  mcpServers: [] as AgentConfig['mcpServers'],
  maxTurnsPerSession: 10,
  maxConcurrentSessions: 5,
  failover: {
    maxRetries: 2,
    onTimeout: true,
    onRateLimit: true,
    onServerError: true,
    timeoutMs: 30_000,
  },
  memoryConfig: {
    longTerm: {
      enabled: false,
      maxEntries: 100,
      retrievalTopK: 5,
      embeddingProvider: 'openai',
      decayEnabled: false,
      decayHalfLifeDays: 30,
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based' as const,
      maxTurnsInContext: 20,
      compaction: {
        enabled: false,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 10,
    monthlyBudgetUSD: 100,
    maxTokensPerTurn: 4096,
    maxTurnsPerSession: 50,
    maxToolCallsPerTurn: 10,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 60,
    maxRequestsPerHour: 1000,
  },
} satisfies Partial<AgentConfig>;

// ─── Zod Schema ─────────────────────────────────────────────────

/** Zod schema for chat request body validation. */
export const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  sourceChannel: z.string().min(1).optional(),
  contactRole: z.string().min(1).optional(),
  message: z.string().max(100_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Inferred type from the chat request schema. */
export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

// ─── Result Types ───────────────────────────────────────────────

/** All resolved objects needed to run the agent loop. */
export interface ChatSetupResult {
  /** The sanitized user message, safe for the agent context. */
  sanitizedMessage: string;
  /** The project's agent configuration. */
  agentConfig: AgentConfig;
  /** The session ID (existing or newly created). */
  sessionId: SessionId;
  /** The pre-built system prompt assembled from prompt layers. */
  systemPrompt: string;
  /** Snapshot of which prompt layer versions were used. */
  promptSnapshot: PromptSnapshot;
  /** Prior messages in this session. */
  conversationHistory: Message[];
  /** The resolved LLM provider instance. */
  provider: LLMProvider;
  /** Fallback LLM provider for failover (optional). */
  fallbackProvider?: LLMProvider;
  /** Per-request memory manager. */
  memoryManager: MemoryManager;
  /** Per-request cost guard. */
  costGuard: CostGuard;
}

/** Structured error returned when chat setup fails. */
export interface ChatSetupError {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** HTTP status code to return to the client. */
  statusCode: number;
}

// ─── Dependencies ───────────────────────────────────────────────

/** Subset of RouteDependencies required by prepareChatRun. */
type ChatSetupDeps = Pick<
  RouteDependencies,
  'projectRepository' | 'sessionRepository' | 'promptLayerRepository' | 'toolRegistry' | 'mcpManager' | 'longTermMemoryStore' | 'prisma' | 'logger' | 'skillService'
> & {
  agentRegistry?: RouteDependencies['agentRegistry'];
};

// ─── Setup Function ─────────────────────────────────────────────

/**
 * Prepare all dependencies and resolved objects required to run the agent loop.
 *
 * Validates and sanitizes the request, loads the project / session / prompt layers,
 * builds the system prompt, and constructs per-request services (provider, memory
 * manager, cost guard). Returns a Result so callers can handle errors without
 * exceptions.
 *
 * @param body - The parsed (but not yet sanitized) chat request body.
 * @param deps - The subset of route dependencies needed for setup.
 * @returns A Result containing either a ChatSetupResult or a ChatSetupError.
 */
export async function prepareChatRun(
  body: ChatRequestBody,
  deps: ChatSetupDeps,
): Promise<Result<ChatSetupResult, ChatSetupError>> {
  const { projectRepository, sessionRepository, promptLayerRepository } = deps;

  // 1. Sanitize user message if provided
  const sanitized = body.message
    ? validateUserInput(body.message)
    : { sanitized: '', flags: [], original: '', isSafe: true, reason: null };

  // 2. Load project
  const project = await projectRepository.findById(body.projectId as ProjectId);
  if (!project) {
    return err({
      code: 'NOT_FOUND',
      message: `Project "${body.projectId}" not found`,
      statusCode: 404,
    });
  }

  // Merge defaults first so any field absent from project.config (e.g. config: {})
  // is always initialised. Project config then overrides the defaults, and agent
  // llmConfig overrides are applied on top in step 2b below.
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...project.config, projectId: project.id };

  // 2b. If agentId provided, load agent and apply LLM config override
  if (body.agentId && deps.agentRegistry) {
    const agent = await deps.agentRegistry.get(body.agentId as unknown as import('@/agents/types.js').AgentId);
    if (!agent) {
      return err({
        code: 'NOT_FOUND',
        message: `Agent "${body.agentId}" not found`,
        statusCode: 404,
      });
    }

    // Override project LLM config with agent-level overrides
    if (agent.llmConfig) {
      if (agent.llmConfig.provider) {
        agentConfig.provider = {
          ...agentConfig.provider,
          provider: agent.llmConfig.provider,
        };
      }
      if (agent.llmConfig.model) {
        agentConfig.provider = {
          ...agentConfig.provider,
          model: agent.llmConfig.model,
        };
      }
      if (agent.llmConfig.temperature !== undefined) {
        agentConfig.provider = {
          ...agentConfig.provider,
          temperature: agent.llmConfig.temperature,
        };
      }
      if (agent.llmConfig.maxOutputTokens !== undefined) {
        agentConfig.provider = {
          ...agentConfig.provider,
          maxOutputTokens: agent.llmConfig.maxOutputTokens,
        };
      }
    }

    // 2c. Resolve operating mode based on source channel
    const resolvedMode = body.sourceChannel
      ? resolveAgentMode(agent, body.sourceChannel, body.contactRole)
      : undefined;

    // Apply mode-specific tool allowlist, or fall back to agent's base list
    const effectiveToolAllowlist = resolvedMode
      ? resolvedMode.toolAllowlist
      : agent.toolAllowlist;

    if (effectiveToolAllowlist.length > 0) {
      agentConfig.allowedTools = [
        ...new Set([...agentConfig.allowedTools, ...effectiveToolAllowlist]),
      ];
    }

    // 2d. Sub-Agent Magic: Autowire the escalation tool and instructions
    // We keep this behavior for backward compatibility or if the user explicitly configures a manager,
    // though the escalation now goes to a human.
    if (agent.managerAgentId) {
      // Automatically add the escalation tool if not present
      if (!agentConfig.allowedTools.includes('escalate-to-human')) {
        agentConfig.allowedTools.push('escalate-to-human');
      }

      // Automatically add the context to the instructions
      const escalationPrompt = `
## Escalation Path & Manager
You have a human "Manager" available via the \`escalate-to-human\` tool. 
If a user asks for something outside your permissions (like a large discount), or if you encounter a complex situation you cannot resolve, you MUST use the \`escalate-to-human\` tool to consult them before taking final action. 
Do not decline a request if your Manager might be able to approve it.
`;
      // We will append this during step 11, we pass it via metadata
      if (!body.metadata) body.metadata = {};
      body.metadata['_managerPrompt'] = escalationPrompt;
    }

    // Use agent MCP servers, filtered by mode if applicable
    if (agent.mcpServers.length > 0) {
      const mcpServers = resolvedMode && resolvedMode.mcpServerNames.length > 0
        ? agent.mcpServers.filter((s) => resolvedMode.mcpServerNames.includes(s.name))
        : agent.mcpServers;
      agentConfig.mcpServers = mcpServers as unknown as typeof agentConfig.mcpServers;
    }

    // Store mode prompt overrides for later prompt building
    if (resolvedMode?.promptOverrides) {
      // Stash on metadata so prompt builder can access it (step 11)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!body.metadata) {
        body.metadata = {};
      }
      body.metadata['_modePromptOverrides'] = resolvedMode.promptOverrides;
      body.metadata['_modeName'] = resolvedMode.modeName;
    }

    // 2f. Compose assigned skills (merge instructions + tools + MCP)
    if (agent.skillIds.length > 0) {
      const composition = await deps.skillService.composeForAgent(agent.skillIds);

      if (composition.mergedInstructions) {
        if (!body.metadata) body.metadata = {};
        body.metadata['_skillInstructions'] = composition.mergedInstructions;
      }

      if (composition.mergedTools.length > 0) {
        agentConfig.allowedTools = [
          ...new Set([...agentConfig.allowedTools, ...composition.mergedTools]),
        ];
      }

      if (composition.mergedMcpServers.length > 0) {
        // Add skill-required MCP servers that aren't already configured
        const existingNames = new Set(
          (agentConfig.mcpServers as Array<{ name: string }>).map((s) => s.name),
        );
        for (const mcpName of composition.mergedMcpServers) {
          if (!existingNames.has(mcpName)) {
            (agentConfig.mcpServers as Array<{ name: string }>).push({ name: mcpName } as never);
          }
        }
      }
    }
  }

  // 3. Load or create session
  let sessionId: SessionId;
  if (body.sessionId) {
    const existing = await sessionRepository.findById(body.sessionId as SessionId);
    if (!existing) {
      return err({
        code: 'NOT_FOUND',
        message: `Session "${body.sessionId}" not found`,
        statusCode: 404,
      });
    }
    sessionId = existing.id;
  } else {
    const newSession = await sessionRepository.create({
      projectId: project.id,
      metadata: body.metadata,
    });
    sessionId = newSession.id;
  }

  // 4. Resolve active prompt layers
  const layersResult = await resolveActiveLayers(project.id, promptLayerRepository);
  if (!layersResult.ok) {
    return err({
      code: 'NO_ACTIVE_PROMPT',
      message: layersResult.error.message,
      statusCode: 400,
    });
  }
  const layers = layersResult.value;

  // 5. Load conversation history
  const storedMessages = await sessionRepository.getMessages(sessionId);
  const conversationHistory: Message[] = storedMessages.map((m) => ({
    role: m.role as Message['role'],
    content: m.content,
  }));

  // 6. Resolve LLM providers (primary + optional fallback)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!agentConfig.provider) {
    return err({
      code: 'MISCONFIGURATION',
      message: 'No LLM provider configured. Set "provider" in the project config or agent llmConfig.',
      statusCode: 400,
    });
  }
  const provider = createProvider(agentConfig.provider);
  const fallbackProvider = agentConfig.fallbackProvider
    ? createProvider(agentConfig.fallbackProvider)
    : undefined;

  // 7. Create per-request services (with optional long-term memory)
  const longTermStore = agentConfig.memoryConfig.longTerm.enabled
    ? deps.longTermMemoryStore ?? undefined
    : undefined;

  // Compaction summarizer — uses the LLM to summarize pruned conversations
  const compactionSummarizer: CompactionSummarizer = async (messages) => {
    const summaryMessages: Message[] = [
      ...messages,
      {
        role: 'user' as const,
        content: 'Summarize this conversation concisely. Preserve key facts, decisions, action items, and context needed for continuity. Return only the summary.',
      },
    ];
    let text = '';
    for await (const event of provider.chat({
      messages: summaryMessages,
      maxTokens: 2000,
      temperature: 0.3,
    })) {
      if (event.type === 'content_delta') text += event.text;
    }
    return text;
  };

  const memoryManager = createMemoryManager({
    memoryConfig: agentConfig.memoryConfig,
    contextWindowSize: 200_000,
    tokenCounter: (messages) => {
      // Approximate token count: ~4 chars per token
      let total = 0;
      for (const msg of messages) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        total += Math.ceil(content.length / 4);
      }
      return Promise.resolve(total);
    },
    compactionSummarizer,
    longTermStore,
  });

  const costGuard = createCostGuard({
    costConfig: agentConfig.costConfig,
    usageStore: createPrismaUsageStore(deps.prisma),
  });

  // 8. Connect MCP servers and register their tools (if configured)
  const mcpToolIds: string[] = [];
  if (agentConfig.mcpServers && agentConfig.mcpServers.length > 0) {
    const { mcpManager, toolRegistry } = deps;

    // Connect servers that aren't already connected
    const needConnection = agentConfig.mcpServers.filter(
      (s) => !mcpManager.getConnection(s.name),
    );
    if (needConnection.length > 0) {
      await mcpManager.connectAll(needConnection);
    }

    // Register discovered MCP tools in the shared tool registry
    for (const tool of mcpManager.getTools()) {
      if (!toolRegistry.has(tool.id)) {
        toolRegistry.register(tool);
      }
      mcpToolIds.push(tool.id);
    }
  }

  // 9. Build tool descriptions for the prompt
  const allAllowedTools = [...agentConfig.allowedTools, ...mcpToolIds];
  const executionContext = {
    projectId: agentConfig.projectId,
    sessionId,
    traceId: 'setup' as TraceId,
    agentConfig,
    permissions: { allowedTools: new Set(allAllowedTools) },
    abortSignal: new AbortController().signal,
  };
  const toolDescriptions = deps.toolRegistry
    .formatForProvider(executionContext)
    .map((t) => ({ name: t.name, description: t.description }));

  // 10. Retrieve relevant long-term memories for context injection
  const retrievedMemories = await memoryManager.retrieveMemories({
    query: sanitized.sanitized,
    topK: agentConfig.memoryConfig.longTerm.retrievalTopK,
  });

  // 11. Build the system prompt from layers + runtime content
  //     Apply mode-specific prompt overrides if present
  const modeOverrides = body.metadata?.['_modePromptOverrides'] as
    { identity?: string; instructions?: string; safety?: string } | undefined;

  const managerPrompt = body.metadata?.['_managerPrompt'] as string | undefined;

  const effectiveLayers = {
    identity: modeOverrides?.identity
      ? { ...layers.identity, content: `${layers.identity.content}\n\n## Mode Override\n${modeOverrides.identity}` }
      : layers.identity,
    instructions: modeOverrides?.instructions
      ? { ...layers.instructions, content: `${layers.instructions.content}\n\n## Mode Instructions\n${modeOverrides.instructions}` }
      : layers.instructions,
    safety: modeOverrides?.safety
      ? { ...layers.safety, content: `${layers.safety.content}\n\n## Mode Safety\n${modeOverrides.safety}` }
      : layers.safety,
  };

  if (managerPrompt) {
    effectiveLayers.instructions.content = `${effectiveLayers.instructions.content}\n\n${managerPrompt}`;
  }

  // Append skill instructions (from step 2f)
  const skillInstructions = body.metadata?.['_skillInstructions'] as string | undefined;
  if (skillInstructions) {
    effectiveLayers.instructions.content = `${effectiveLayers.instructions.content}\n\n# Skills\n\n${skillInstructions}`;
  }

  const systemPrompt = buildPrompt({
    identity: effectiveLayers.identity,
    instructions: effectiveLayers.instructions,
    safety: effectiveLayers.safety,
    toolDescriptions,
    retrievedMemories: retrievedMemories.map((m) => ({
      content: m.content,
      category: m.category,
    })),
  });

  // 12. Create snapshot for audit trail
  const toolDocsSection = toolDescriptions
    .map((t) => `${t.name}: ${t.description}`)
    .join('\n');
  const memorySection = retrievedMemories.map((m) => m.content).join('\n');
  const promptSnapshot = createPromptSnapshot(
    layers,
    computeHash(toolDocsSection),
    computeHash(memorySection),
  );

  return ok({
    sanitizedMessage: sanitized.sanitized,
    agentConfig,
    sessionId,
    systemPrompt,
    promptSnapshot,
    conversationHistory,
    provider,
    fallbackProvider,
    memoryManager,
    costGuard,
  });
}

// ─── Response Extraction Helpers ────────────────────────────────

/** Extract the final assistant text from trace events. */
export function extractAssistantResponse(
  events: { type: string; data: Record<string, unknown> }[],
): string {
  const llmResponses = events.filter((e) => e.type === 'llm_response');
  if (llmResponses.length === 0) return '';

  const lastResponse = llmResponses[llmResponses.length - 1];
  if (!lastResponse) return '';

  const text = lastResponse.data['text'];
  return typeof text === 'string' ? text : '';
}

/** Extract tool calls from trace events. */
export function extractToolCalls(
  events: { type: string; data: Record<string, unknown> }[],
): { toolId: string; input: Record<string, unknown>; result: unknown }[] {
  const calls: { toolId: string; input: Record<string, unknown>; result: unknown }[] = [];
  const toolCallEvents = events.filter((e) => e.type === 'tool_call');
  const toolResultEvents = events.filter((e) => e.type === 'tool_result');

  for (const callEvent of toolCallEvents) {
    const toolCallId = callEvent.data['toolCallId'] as string | undefined;
    const matchingResult = toolResultEvents.find(
      (r) => r.data['toolCallId'] === toolCallId,
    );

    calls.push({
      toolId: (callEvent.data['toolId'] as string | undefined) ?? '',
      input: (callEvent.data['input'] as Record<string, unknown> | undefined) ?? {},
      result: matchingResult?.data['output'],
    });
  }

  return calls;
}
```

---
## src/api/routes/projects.ts
```typescript
/**
 * Project routes — CRUD operations for agent projects.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import { loadProjectConfig } from '@/config/loader.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  environment: z.enum(['production', 'staging', 'development']).optional(),
  owner: z.string().min(1).max(200),
  tags: z.array(z.string().max(50)).max(20).optional(),
  config: z.record(z.unknown()),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  environment: z.enum(['production', 'staging', 'development']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  config: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'paused', 'deleted']).optional(),
});

const projectFiltersSchema = z.object({
  owner: z.string().optional(),
  status: z.string().optional(),
  tags: z.string().optional(),
});

const importProjectSchema = z.object({
  filePath: z.string().min(1),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register project CRUD routes. */
export function projectRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { projectRepository } = deps;

  // GET /projects — list with optional filters and pagination
  fastify.get('/projects', async (request, reply) => {
    const query = paginationSchema.merge(projectFiltersSchema).parse(request.query);
    const { limit, offset, ...filterParams } = query;
    const filters = {
      owner: filterParams.owner,
      status: filterParams.status,
      tags: filterParams.tags ? filterParams.tags.split(',') : undefined,
    };
    const projects = await projectRepository.list(filters);
    return sendSuccess(reply, paginate(projects, limit, offset));
  });

  // GET /projects/:id
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const project = await projectRepository.findById(request.params.id as ProjectId);
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // POST /projects
  fastify.post('/projects', async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const project = await projectRepository.create({
      ...input,
      config: input.config as unknown as AgentConfig,
    });
    return sendSuccess(reply, project, 201);
  });

  // PUT /projects/:id
  fastify.put<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const input = updateProjectSchema.parse(request.body);
    const project = await projectRepository.update(
      request.params.id as ProjectId,
      {
        ...input,
        config: input.config ? input.config as unknown as AgentConfig : undefined,
      },
    );
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // DELETE /projects/:id
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const deleted = await projectRepository.delete(request.params.id as ProjectId);
    if (!deleted) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, { deleted: true });
  });

  // POST /projects/:id/pause
  fastify.post<{ Params: { id: string } }>('/projects/:id/pause', async (request, reply) => {
    const project = await projectRepository.update(request.params.id as ProjectId, {
      status: 'paused',
    });
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // POST /projects/:id/resume
  fastify.post<{ Params: { id: string } }>('/projects/:id/resume', async (request, reply) => {
    const project = await projectRepository.update(request.params.id as ProjectId, {
      status: 'active',
    });
    if (!project) return sendNotFound(reply, 'Project', request.params.id);
    return sendSuccess(reply, project);
  });

  // POST /projects/import — create a project from a JSON config file
  fastify.post('/projects/import', async (request, reply) => {
    const { filePath } = importProjectSchema.parse(request.body);
    const configResult = await loadProjectConfig(filePath);

    if (!configResult.ok) {
      return sendError(reply, 'CONFIG_ERROR', configResult.error.message, 400);
    }

    const configFile = configResult.value;
    const project = await projectRepository.create({
      name: configFile.name,
      description: configFile.description,
      environment: configFile.environment,
      owner: configFile.owner,
      tags: configFile.tags,
      config: configFile.agentConfig as unknown as AgentConfig,
    });

    return sendSuccess(reply, project, 201);
  });
}
```

---
## src/api/routes/agents.ts
```typescript
/**
 * Agent routes — CRUD for agents.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { AgentId, AgentMessageId } from '@/agents/types.js';
import { checkChannelCollision } from '@/channels/agent-channel-router.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Schemas ────────────────────────────────────────────────────

const mcpServerSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse']).default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  toolPrefix: z.string().optional(),
});

const channelConfigSchema = z.object({
  allowedChannels: z.array(z.string()),
  defaultChannel: z.string().optional(),
});

const promptConfigSchema = z.object({
  identity: z.string().min(1),
  instructions: z.string().optional().default(''),
  safety: z.string().optional().default(''),
});

const limitsSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  budgetPerDayUsd: z.number().positive().optional(),
});

const llmConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama']).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

const agentModeSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().max(100).optional(),
  promptOverrides: z.object({
    identity: z.string().optional(),
    instructions: z.string().optional(),
    safety: z.string().optional(),
  }).optional(),
  toolAllowlist: z.array(z.string()).optional(),
  mcpServerNames: z.array(z.string()).optional(),
  channelMapping: z.array(z.string()).min(1),
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  promptConfig: promptConfigSchema,
  llmConfig: llmConfigSchema.optional(),
  toolAllowlist: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServerSchema).optional(),
  channelConfig: channelConfigSchema.optional(),
  modes: z.array(agentModeSchema).optional(),
  operatingMode: z.enum(['customer-facing', 'internal', 'copilot', 'manager']).optional(),
  skillIds: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  managerAgentId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  promptConfig: promptConfigSchema.optional(),
  llmConfig: llmConfigSchema.optional(),
  toolAllowlist: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServerSchema).optional(),
  channelConfig: channelConfigSchema.optional(),
  modes: z.array(agentModeSchema).optional(),
  operatingMode: z.enum(['customer-facing', 'internal', 'copilot', 'manager']).optional(),
  skillIds: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
  managerAgentId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const sendMessageSchema = z.object({
  fromAgentId: z.string().min(1),
  content: z.string().min(1),
  context: z.record(z.unknown()).optional(),
  replyToId: z.string().optional(),
  waitForReply: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export function agentRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { agentRepository, agentRegistry, agentComms, logger } = deps;

  // ─── List Agents ────────────────────────────────────────────────

  const listAgentsQuerySchema = z.object({
    status: z.string().optional(),
  });

  fastify.get(
    '/projects/:projectId/agents',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = paginationSchema.merge(listAgentsQuerySchema).parse(request.query);
      const { limit, offset, status } = query;

      let agents;
      if (status === 'active') {
        agents = await agentRepository.listActive(projectId);
      } else {
        agents = await agentRepository.list(projectId);
      }

      return sendSuccess(reply, paginate(agents, limit, offset));
    },
  );

  // ─── Get Agent ──────────────────────────────────────────────────

  fastify.get(
    '/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agent = await agentRegistry.get(agentId as AgentId);

      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      return sendSuccess(reply, agent);
    },
  );

  // ─── Get Agent by Name ──────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/agents/name/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, name } = request.params as { projectId: string; name: string };

      const agent = await agentRegistry.getByName(projectId, name);

      if (!agent) {
        return sendNotFound(reply, 'Agent', name);
      }

      return sendSuccess(reply, agent);
    },
  );

  // ─── Create Agent ───────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createAgentSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const input = {
        projectId,
        ...parseResult.data,
      };

      // Validate no channel collision with other agents
      if (input.modes && input.modes.length > 0) {
        const collision = await checkChannelCollision(
          agentRepository, projectId, undefined, input.modes,
        );
        if (collision) {
          return sendError(
            reply,
            'CHANNEL_COLLISION',
            `Channel "${collision.channel}" is already claimed by agent "${collision.agentName}"`,
            409,
          );
        }
      }

      try {
        const agent = await agentRepository.create(input);
        logger.info('Agent created', { component: 'agents', agentId: agent.id, projectId });
        await sendSuccess(reply, agent, 201); return;
      } catch (error) {
        // Handle unique constraint violation
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(
            reply,
            'CONFLICT',
            'Agent with this name already exists in the project',
            409,
          );
        }
        throw error;
      }
    },
  );

  // ─── Update Agent ───────────────────────────────────────────────

  fastify.patch(
    '/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const parseResult = updateAgentSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      // Validate no channel collision with other agents
      if (parseResult.data.modes && parseResult.data.modes.length > 0) {
        const existing = await agentRepository.findById(agentId as AgentId);
        if (existing) {
          const collision = await checkChannelCollision(
            agentRepository, existing.projectId, agentId, parseResult.data.modes,
          );
          if (collision) {
            return sendError(
              reply,
              'CHANNEL_COLLISION',
              `Channel "${collision.channel}" is already claimed by agent "${collision.agentName}"`,
              409,
            );
          }
        }
      }

      try {
        const agent = await agentRepository.update(agentId as AgentId, parseResult.data);

        // Invalidate cache after update
        agentRegistry.invalidate(agentId as AgentId);

        logger.info('Agent updated', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
        // Prisma throws if record not found
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );

  // ─── Delete Agent ───────────────────────────────────────────────

  fastify.delete(
    '/agents/:agentId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      try {
        await agentRepository.delete(agentId as AgentId);

        // Invalidate cache after delete
        agentRegistry.invalidate(agentId as AgentId);

        logger.info('Agent deleted', { component: 'agents', agentId });
        return await reply.status(204).send();
      } catch {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Agent not found' });
      }
    },
  );

  // ─── Send Message to Agent ──────────────────────────────────────

  fastify.post(
    '/agents/:agentId/message',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const parseResult = sendMessageSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      // Verify target agent exists
      const targetAgent = await agentRegistry.get(agentId as AgentId);
      if (!targetAgent) {
        return reply.status(404).send({ error: 'Target agent not found' });
      }

      const { fromAgentId, content, context, replyToId, waitForReply, timeoutMs } =
        parseResult.data;

      const message = {
        fromAgentId: fromAgentId as AgentId,
        toAgentId: agentId as AgentId,
        content,
        context,
        replyToId: replyToId as AgentMessageId | undefined,
      };

      if (waitForReply) {
        try {
          const replyContent = await agentComms.sendAndWait(message, timeoutMs);
          return await reply.send({ reply: replyContent });
        } catch (error) {
          if (error instanceof Error && error.message.includes('timeout')) {
            return reply.status(408).send({ error: 'Message timeout waiting for reply' });
          }
          throw error;
        }
      }

      const messageId = await agentComms.send(message);
      return reply.status(202).send({ messageId });
    },
  );

  // ─── Refresh Agent Cache ────────────────────────────────────────

  fastify.post(
    '/agents/:agentId/refresh',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      await agentRegistry.refresh(agentId as AgentId);

      logger.debug('Agent cache refreshed', { component: 'agents', agentId });
      return reply.status(204).send();
    },
  );

  // ─── Pause Agent ─────────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/pause',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };

      try {
        const agent = await agentRepository.update(agentId as AgentId, { status: 'paused' });
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent paused', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );

  // ─── Resume Agent ────────────────────────────────────────────────

  fastify.post(
    '/projects/:projectId/agents/:agentId/resume',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };

      try {
        const agent = await agentRepository.update(agentId as AgentId, { status: 'active' });
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent resumed', { component: 'agents', agentId });
        await sendSuccess(reply, agent); return;
      } catch {
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );
}
```

---
## src/api/routes/sessions.ts
```typescript
/**
 * Session routes — CRUD for conversation sessions and message retrieval.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const createSessionSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'closed', 'expired']),
});

const sessionListQuerySchema = z.object({
  status: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register session routes. */
export function sessionRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { sessionRepository, projectRepository } = deps;

  // GET /projects/:projectId/sessions
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/sessions',
    async (request, reply) => {
      const query = paginationSchema.merge(sessionListQuerySchema).parse(request.query);
      const { limit, offset, ...filters } = query;
      const sessions = await sessionRepository.listByProject(
        request.params.projectId as ProjectId,
        filters.status,
      );
      return sendSuccess(reply, paginate(sessions, limit, offset));
    },
  );

  // GET /sessions/:id
  fastify.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const session = await sessionRepository.findById(request.params.id as SessionId);
    if (!session) return sendNotFound(reply, 'Session', request.params.id);
    return sendSuccess(reply, session);
  });

  // POST /projects/:projectId/sessions
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/sessions',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      // Verify project exists
      const project = await projectRepository.findById(projectId);
      if (!project) return sendNotFound(reply, 'Project', request.params.projectId);

      const input = createSessionSchema.parse(request.body);
      const session = await sessionRepository.create({
        projectId,
        metadata: input.metadata,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      });
      return sendSuccess(reply, session, 201);
    },
  );

  // PATCH /sessions/:id/status
  fastify.patch<{ Params: { id: string } }>(
    '/sessions/:id/status',
    async (request, reply) => {
      const { status } = updateStatusSchema.parse(request.body);
      const updated = await sessionRepository.updateStatus(
        request.params.id as SessionId,
        status,
      );
      if (!updated) return sendNotFound(reply, 'Session', request.params.id);
      return sendSuccess(reply, { updated: true });
    },
  );

  // GET /sessions/:id/messages
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id/messages',
    async (request, reply) => {
      const session = await sessionRepository.findById(request.params.id as SessionId);
      if (!session) return sendNotFound(reply, 'Session', request.params.id);

      const messages = await sessionRepository.getMessages(request.params.id as SessionId);
      return sendSuccess(reply, messages);
    },
  );
}
```

---
## src/api/routes/contacts.ts
```typescript
/**
 * Contact routes — CRUD for contacts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { ProjectId } from '@/core/types.js';
import { sendSuccess } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Schemas ────────────────────────────────────────────────────

const createContactSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  telegramId: z.string().optional(),
  slackId: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  role: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateContactSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  telegramId: z.string().optional(),
  slackId: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  role: z.string().max(50).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// listQuerySchema replaced by paginationSchema from pagination.ts

// ─── Route Registration ─────────────────────────────────────────

export function contactRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { contactRepository } = deps;

  // ─── List Contacts ──────────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/contacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = paginationSchema.parse(request.query);

      const contacts = await contactRepository.list(projectId as ProjectId, {
        limit: query.limit,
        offset: query.offset,
      });

      return sendSuccess(reply, paginate(contacts, query.limit, query.offset));
    },
  );

  // ─── Get Contact ────────────────────────────────────────────────

  fastify.get(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      const contact = await contactRepository.findById(contactId);

      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }

      return reply.send({ contact });
    },
  );

  // ─── Create Contact ─────────────────────────────────────────────

  fastify.post(
    '/contacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createContactSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const contact = await contactRepository.create({
        ...parseResult.data,
        projectId: parseResult.data.projectId as ProjectId,
      });

      return reply.status(201).send({ contact });
    },
  );

  // ─── Update Contact ─────────────────────────────────────────────

  fastify.patch(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      const parseResult = updateContactSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const contact = await contactRepository.update(contactId, parseResult.data);
        return await reply.send({ contact });
      } catch {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Contact not found' });
      }
    },
  );

  // ─── Delete Contact ─────────────────────────────────────────────

  fastify.delete(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      try {
        await contactRepository.delete(contactId);
        return await reply.status(204).send();
      } catch {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Contact not found' });
      }
    },
  );
}
```

---
## src/api/routes/approvals.ts
```typescript
/**
 * Approval routes — list pending approvals and resolve them.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApprovalId, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'approval-routes' });

// ─── Zod Schemas ────────────────────────────────────────────────

const resolveApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  resolvedBy: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

const decideApprovalSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(2000).optional(),
});

const approvalsFilterSchema = z.object({
  status: z.string().optional(),
  projectId: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register approval routes. */
export function approvalRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { approvalGate, resumeAfterApproval } = deps;

  // GET /approvals — global list with filters and pagination
  fastify.get('/approvals', async (request, reply) => {
    const query = paginationSchema.merge(approvalsFilterSchema).parse(request.query);
    const { limit, offset, status, projectId } = query;

    let approvals = await approvalGate.listAll();

    // Filter by project if provided
    if (projectId) {
      approvals = approvals.filter((a) => a.projectId === projectId);
    }

    // Filter by status if provided
    if (status) {
      approvals = approvals.filter((a) => a.status === status);
    }

    return sendSuccess(reply, paginate(approvals, limit, offset));
  });

  // GET /projects/:projectId/approvals/pending
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/approvals/pending',
    async (request, reply) => {
      const query = paginationSchema.parse(request.query);
      const pending = await approvalGate.listPending(
        request.params.projectId as ProjectId,
      );
      return sendSuccess(reply, paginate(pending, query.limit, query.offset));
    },
  );

  // GET /approvals/:id
  fastify.get<{ Params: { id: string } }>(
    '/approvals/:id',
    async (request, reply) => {
      const approval = await approvalGate.get(request.params.id as ApprovalId);
      if (!approval) return sendNotFound(reply, 'ApprovalRequest', request.params.id);
      return sendSuccess(reply, approval);
    },
  );

  // POST /approvals/:id/resolve — original endpoint
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/resolve',
    async (request, reply) => {
      const { decision, resolvedBy, note } = resolveApprovalSchema.parse(request.body);

      const resolved = await approvalGate.resolve(
        request.params.id as ApprovalId,
        decision,
        resolvedBy,
        note,
      );

      if (!resolved) return sendNotFound(reply, 'ApprovalRequest', request.params.id);

      // If already resolved/expired, inform the client
      if (resolved.status !== decision) {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${resolved.status}"`,
          409,
          { currentStatus: resolved.status },
        );
      }

      // Fire-and-forget: resume agent execution with the decision
      resumeAfterApproval({ approvalId: request.params.id, decision, resolvedBy, note })
        .catch((err: unknown) => logger.error('Failed to resume after approval', {
          component: 'approval-routes',
          approvalId: request.params.id,
          error: err instanceof Error ? err.message : String(err),
        }));

      return sendSuccess(reply, resolved);
    },
  );

  // POST /approvals/:id/decide — dashboard-compatible endpoint
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/decide',
    async (request, reply) => {
      const { approved, note } = decideApprovalSchema.parse(request.body);

      const decision = approved ? 'approved' : 'denied';
      const resolved = await approvalGate.resolve(
        request.params.id as ApprovalId,
        decision,
        'dashboard',
        note,
      );

      if (!resolved) return sendNotFound(reply, 'ApprovalRequest', request.params.id);

      if (resolved.status !== decision) {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${resolved.status}"`,
          409,
          { currentStatus: resolved.status },
        );
      }

      // Fire-and-forget: resume agent execution with the decision
      resumeAfterApproval({ approvalId: request.params.id, decision, resolvedBy: 'dashboard', note })
        .catch((err: unknown) => logger.error('Failed to resume after approval', {
          component: 'approval-routes',
          approvalId: request.params.id,
          error: err instanceof Error ? err.message : String(err),
        }));

      return sendSuccess(reply, resolved);
    },
  );
}
```

---
## src/api/routes/tools.ts
```typescript
/**
 * Tool routes — full catalog API for the UI tool picker.
 * Provides metadata + JSON schemas for all registered tools,
 * and per-agent tool management (toggle on/off).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';
import type { AgentId } from '@/agents/types.js';

// ─── Types ──────────────────────────────────────────────────────

/** Full tool catalog entry for UI display. */
interface ToolCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  sideEffects: boolean;
  supportsDryRun: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────

function toZodJsonSchema(zodSchema: import('zod').ZodType): Record<string, unknown> {
  return zodToJsonSchema(zodSchema, { target: 'openApi3' }) as Record<string, unknown>;
}

function buildCatalogEntry(tool: {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  sideEffects: boolean;
  supportsDryRun: boolean;
  inputSchema: import('zod').ZodType;
  outputSchema?: import('zod').ZodType;
}): ToolCatalogEntry {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    riskLevel: tool.riskLevel,
    requiresApproval: tool.requiresApproval,
    sideEffects: tool.sideEffects,
    supportsDryRun: tool.supportsDryRun,
    inputSchema: toZodJsonSchema(tool.inputSchema),
    outputSchema: tool.outputSchema ? toZodJsonSchema(tool.outputSchema) : undefined,
  };
}

// ─── Route Plugin ────────────────────────────────────────────────

/** Register tool catalog and per-agent tool management routes. */
export function toolRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { toolRegistry, agentRepository } = deps;

  // ─── GET /tools ─────────────────────────────────────────────────
  // Full catalog with JSON schemas for every registered tool

  fastify.get('/tools', async (_request: FastifyRequest, reply: FastifyReply) => {
    const catalog = toolRegistry.listAll()
      .map((id) => toolRegistry.get(id))
      .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
      .map(buildCatalogEntry);

    await sendSuccess(reply, catalog);
  });

  // ─── GET /tools/categories ──────────────────────────────────────
  // Tools grouped by category — useful for UI category pickers

  fastify.get('/tools/categories', async (_request: FastifyRequest, reply: FastifyReply) => {
    const byCategory = new Map<string, ToolCatalogEntry[]>();

    for (const id of toolRegistry.listAll()) {
      const tool = toolRegistry.get(id);
      if (!tool) continue;

      const entry = buildCatalogEntry(tool);
      const existing = byCategory.get(tool.category);
      if (existing) {
        existing.push(entry);
      } else {
        byCategory.set(tool.category, [entry]);
      }
    }

    const result = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, tools]) => ({ category, tools }));

    await sendSuccess(reply, result);
  });

  // ─── GET /tools/:id ─────────────────────────────────────────────
  // Single tool detail with full schemas

  fastify.get<{ Params: { id: string } }>(
    '/tools/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tool = toolRegistry.get(request.params.id);
      if (!tool) return sendNotFound(reply, 'Tool', request.params.id);
      await sendSuccess(reply, buildCatalogEntry(tool));
    },
  );

  // ─── GET /agents/:agentId/tools ─────────────────────────────────
  // Returns the full catalog entries for tools enabled on a specific agent

  fastify.get(
    '/agents/:agentId/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agent = await agentRepository.findById(agentId as AgentId);
      if (!agent) return sendNotFound(reply, 'Agent', agentId);

      const allToolIds = toolRegistry.listAll();
      const enabledTools = agent.toolAllowlist
        .map((id) => toolRegistry.get(id))
        .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
        .map(buildCatalogEntry);

      const disabledToolIds = allToolIds.filter((id) => !agent.toolAllowlist.includes(id));

      await sendSuccess(reply, {
        agentId,
        enabledTools,
        disabledToolIds,
      });
    },
  );

  // ─── PUT /agents/:agentId/tools ─────────────────────────────────
  // Set the tool allowlist for an agent (full replace)

  const updateToolsSchema = z.object({
    tools: z.array(z.string()),
  });

  fastify.put(
    '/agents/:agentId/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agent = await agentRepository.findById(agentId as AgentId);
      if (!agent) return sendNotFound(reply, 'Agent', agentId);

      const body = updateToolsSchema.parse(request.body);

      // Validate all requested tool IDs are registered
      const unknownTools = body.tools.filter((id) => !toolRegistry.has(id));
      if (unknownTools.length > 0) {
        await sendSuccess(reply, {
          error: 'UNKNOWN_TOOLS',
          unknownTools,
          message: `The following tool IDs are not registered: ${unknownTools.join(', ')}`,
        });
        return;
      }

      const updated = await agentRepository.update(agentId as AgentId, {
        toolAllowlist: body.tools,
      });

      await sendSuccess(reply, {
        agentId,
        toolAllowlist: updated.toolAllowlist,
      });
    },
  );
}
```

---
## src/api/routes/prompt-layers.ts
```typescript
/**
 * Prompt layer routes — create, list, and activate independently-versioned prompt layers.
 *
 * Each project has 3 layer types (identity, instructions, safety).
 * Layers are immutable. Rollback = deactivate current, activate previous.
 * Only one layer per (project, layerType) can be active at a time.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const layerTypeEnum = z.enum(['identity', 'instructions', 'safety']);

const createPromptLayerSchema = z.object({
  layerType: layerTypeEnum,
  content: z.string().min(1).max(100_000),
  createdBy: z.string().min(1).max(200),
  changeReason: z.string().min(1).max(2000),
  performanceNotes: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register prompt layer routes. */
export function promptLayerRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { promptLayerRepository } = deps;

  // GET /projects/:projectId/prompt-layers — list all layers (optional ?layerType= filter)
  fastify.get<{ Params: { projectId: string }; Querystring: { layerType?: string } }>(
    '/projects/:projectId/prompt-layers',
    async (request, reply) => {
      const { layerType } = request.query;
      const parsedType = layerType ? layerTypeEnum.parse(layerType) : undefined;

      const layers = await promptLayerRepository.listByProject(
        request.params.projectId as ProjectId,
        parsedType,
      );
      return sendSuccess(reply, layers);
    },
  );

  // GET /projects/:projectId/prompt-layers/active — get the 3 active layers
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/prompt-layers/active',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;
      const [identity, instructions, safety] = await Promise.all([
        promptLayerRepository.getActiveLayer(projectId, 'identity'),
        promptLayerRepository.getActiveLayer(projectId, 'instructions'),
        promptLayerRepository.getActiveLayer(projectId, 'safety'),
      ]);
      return sendSuccess(reply, { identity, instructions, safety });
    },
  );

  // GET /prompt-layers/:id — get a specific layer by ID
  fastify.get<{ Params: { id: string } }>(
    '/prompt-layers/:id',
    async (request, reply) => {
      const layer = await promptLayerRepository.findById(
        request.params.id as PromptLayerId,
      );
      if (!layer) return sendNotFound(reply, 'PromptLayer', request.params.id);
      return sendSuccess(reply, layer);
    },
  );

  // POST /projects/:projectId/prompt-layers — create a new layer version
  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/prompt-layers',
    async (request, reply) => {
      const input = createPromptLayerSchema.parse(request.body);
      const layer = await promptLayerRepository.create({
        ...input,
        projectId: request.params.projectId as ProjectId,
      });
      return sendSuccess(reply, layer, 201);
    },
  );

  // POST /prompt-layers/:id/activate — activate a specific layer
  fastify.post<{ Params: { id: string } }>(
    '/prompt-layers/:id/activate',
    async (request, reply) => {
      const activated = await promptLayerRepository.activate(
        request.params.id as PromptLayerId,
      );
      if (!activated) return sendNotFound(reply, 'PromptLayer', request.params.id);
      return sendSuccess(reply, { activated: true });
    },
  );
}
```

---
## src/api/routes/traces.ts
```typescript
/**
 * Execution trace routes — read-only access to agent run traces.
 */
import type { FastifyInstance } from 'fastify';
import type { SessionId, TraceId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Route Plugin ───────────────────────────────────────────────

/** Register execution trace routes (read-only). */
export function traceRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { executionTraceRepository } = deps;

  // GET /sessions/:sessionId/traces
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/traces',
    async (request, reply) => {
      const traces = await executionTraceRepository.listBySession(
        request.params.sessionId as SessionId,
      );
      return sendSuccess(reply, traces);
    },
  );

  // GET /traces/:id
  fastify.get<{ Params: { id: string } }>('/traces/:id', async (request, reply) => {
    const trace = await executionTraceRepository.findById(request.params.id as TraceId);
    if (!trace) return sendNotFound(reply, 'ExecutionTrace', request.params.id);
    return sendSuccess(reply, trace);
  });
}
```

---
## src/api/routes/scheduled-tasks.ts
```typescript
/**
 * Scheduled Tasks routes — CRUD + lifecycle for scheduled tasks and runs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';
import { createTaskExecutor } from '@/scheduling/task-executor.js';
import type { ScheduledTaskId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const createTaskSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  cronExpression: z.string().min(9).max(100),
  taskPayload: z.object({
    message: z.string().min(1).max(2000),
    metadata: z.record(z.unknown()).optional(),
  }),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  budgetPerRunUSD: z.number().min(0.01).max(100).optional(),
  maxDurationMinutes: z.number().int().min(1).max(120).optional(),
  maxTurns: z.number().int().min(1).max(50).optional(),
  maxRuns: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

const approveSchema = z.object({
  approvedBy: z.string().min(1).optional().default('admin'),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register scheduled task routes on a Fastify instance. */
export function scheduledTaskRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { taskManager } = opts;

  // GET /projects/:projectId/scheduled-tasks
  const taskListQuerySchema = z.object({ status: z.string().optional() });

  fastify.get(
    '/projects/:projectId/scheduled-tasks',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const { projectId } = request.params;
      const query = paginationSchema.merge(taskListQuerySchema).parse(request.query);
      const { limit, offset, status } = query;
      const tasks = await taskManager.listTasks(
        projectId as Parameters<typeof taskManager.listTasks>[0],
        status,
      );
      await sendSuccess(reply, paginate(tasks, limit, offset));
    },
  );

  // GET /scheduled-tasks/:id
  fastify.get(
    '/scheduled-tasks/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const task = await taskManager.getTask(
        request.params.id as Parameters<typeof taskManager.getTask>[0],
      );
      if (!task) {
        await sendNotFound(reply, 'ScheduledTask', request.params.id);
        return;
      }
      await sendSuccess(reply, task);
    },
  );

  // POST /projects/:projectId/scheduled-tasks
  fastify.post(
    '/projects/:projectId/scheduled-tasks',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = createTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const { projectId } = request.params;
      const body = parseResult.data;

      const result = await taskManager.createTask({
        projectId: projectId as Parameters<typeof taskManager.createTask>[0]['projectId'],
        name: body.name,
        description: body.description,
        cronExpression: body.cronExpression,
        taskPayload: body.taskPayload,
        origin: 'static',
        maxRetries: body.maxRetries,
        timeoutMs: body.timeoutMs,
        budgetPerRunUSD: body.budgetPerRunUSD,
        maxDurationMinutes: body.maxDurationMinutes,
        maxTurns: body.maxTurns,
        maxRuns: body.maxRuns,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value, 201);
    },
  );

  // POST /scheduled-tasks/:id/approve
  fastify.post(
    '/scheduled-tasks/:id/approve',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = approveSchema.safeParse(request.body ?? {});
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const result = await taskManager.approveTask(
        request.params.id as Parameters<typeof taskManager.approveTask>[0],
        parseResult.data.approvedBy,
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // POST /scheduled-tasks/:id/reject
  fastify.post(
    '/scheduled-tasks/:id/reject',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await taskManager.rejectTask(
        request.params.id as Parameters<typeof taskManager.rejectTask>[0],
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // POST /scheduled-tasks/:id/pause
  fastify.post(
    '/scheduled-tasks/:id/pause',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await taskManager.pauseTask(
        request.params.id as Parameters<typeof taskManager.pauseTask>[0],
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // POST /scheduled-tasks/:id/resume
  fastify.post(
    '/scheduled-tasks/:id/resume',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await taskManager.resumeTask(
        request.params.id as Parameters<typeof taskManager.resumeTask>[0],
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // GET /scheduled-tasks/:id/runs
  fastify.get(
    '/scheduled-tasks/:id/runs',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const runs = await taskManager.listRuns(
        request.params.id as Parameters<typeof taskManager.listRuns>[0],
        limit,
      );
      await sendSuccess(reply, runs);
    },
  );

  // POST /scheduled-tasks/:id/trigger — manually trigger a task run (for testing)
  fastify.post(
    '/scheduled-tasks/:id/trigger',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const task = await taskManager.getTask(request.params.id as ScheduledTaskId);
      if (!task) {
        await sendNotFound(reply, 'ScheduledTask', request.params.id);
        return;
      }

      if (task.status !== 'active') {
        await sendError(
          reply,
          'TASK_NOT_ACTIVE',
          `Cannot trigger task in status '${task.status}'. Only 'active' tasks can be triggered.`,
          400,
        );
        return;
      }

      const executeTask = createTaskExecutor({
        projectRepository: opts.projectRepository,
        sessionRepository: opts.sessionRepository,
        promptLayerRepository: opts.promptLayerRepository,
        executionTraceRepository: opts.executionTraceRepository,
        toolRegistry: opts.toolRegistry,
        mcpManager: opts.mcpManager,
        skillService: opts.skillService,
        prisma: opts.prisma,
        logger: opts.logger,
      });

      const result = await executeTask(task);
      await sendSuccess(reply, {
        triggered: true,
        taskId: task.id,
        success: result.success,
        traceId: result.traceId,
        tokensUsed: result.tokensUsed,
      });
    },
  );
}
```

---
## src/api/routes/integrations.ts
```typescript
/**
 * Channel integration CRUD routes — manage per-project channel integrations.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';
import {
  TelegramIntegrationConfigSchema,
  WhatsAppIntegrationConfigSchema,
  WhatsAppWahaIntegrationConfigSchema,
  SlackIntegrationConfigSchema,
  ChatwootIntegrationConfigSchema,
} from '@/channels/types.js';
import type { IntegrationProvider, IntegrationConfigUnion, WhatsAppWahaIntegrationConfig } from '@/channels/types.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const CreateIntegrationSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('telegram'),
    config: TelegramIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('whatsapp'),
    config: WhatsAppIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('whatsapp-waha'),
    // wahaBaseUrl is optional at creation time — defaults to WAHA_DEFAULT_URL env var
    config: z.object({
      wahaBaseUrl: z.string().url().optional().transform(
        (v) => v ?? process.env['WAHA_DEFAULT_URL'] ?? 'http://localhost:3003',
      ),
      sessionName: z.string().min(1).max(64).optional(),
    }),
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('slack'),
    config: SlackIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
  z.object({
    provider: z.literal('chatwoot'),
    config: ChatwootIntegrationConfigSchema,
    status: z.enum(['active', 'paused']).optional(),
  }),
]);

const UpdateIntegrationStatusSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
});

const WahaSessionActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
});

// ─── WAHA Helpers ────────────────────────────────────────────────

interface WahaSessionStatus {
  status?: string;
  name?: string;
}

/** Build headers for WAHA API requests, including API key if configured. */
function getWahaHeaders(): Record<string, string> {
  const apiKey = process.env['WAHA_API_KEY'];
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
  };
}

/** Extract WAHA config from an integration config JSON. */
function getWahaConfig(config: Record<string, unknown>): { wahaBaseUrl: string; sessionName: string } {
  return {
    wahaBaseUrl: config['wahaBaseUrl'] as string,
    sessionName: (config['sessionName'] as string) || 'default',
  };
}

/** Start a WAHA session and configure its webhook. Non-throwing. */
async function setupWahaSession(
  wahaBaseUrl: string,
  sessionName: string,
  webhookUrl: string,
  logger: { info: (msg: string, ctx: { component: string; [k: string]: unknown }) => void; warn: (msg: string, ctx: { component: string; [k: string]: unknown }) => void },
): Promise<void> {
  const webhookConfig = { webhooks: [{ url: webhookUrl, events: ['message'] }] };
  try {
    // Try modern path-based API first: POST /api/sessions/{name}/start
    const pathRes = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/start`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ config: webhookConfig }),
    });

    if (pathRes.ok) {
      logger.info('WAHA session started (path API) and webhook configured', {
        component: 'integrations',
        sessionName,
        webhookUrl,
      });
      return;
    }

    // Session may already be running — try PUT to reconfigure webhook
    const putRes = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}`, {
      method: 'PUT',
      headers: getWahaHeaders(),
      body: JSON.stringify({ config: webhookConfig }),
    });
    if (putRes.ok) {
      logger.info('WAHA session webhook reconfigured (PUT)', {
        component: 'integrations',
        sessionName,
        webhookUrl,
      });
      return;
    }

    // Fall back to legacy API: POST /api/sessions/start with name in body
    const legacyRes = await fetch(`${wahaBaseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: getWahaHeaders(),
      body: JSON.stringify({ name: sessionName, config: webhookConfig }),
    });

    if (legacyRes.ok) {
      logger.info('WAHA session started (legacy API) and webhook configured', {
        component: 'integrations',
        sessionName,
        webhookUrl,
      });
    } else {
      const text = await legacyRes.text();
      logger.warn(`WAHA session start returned ${String(legacyRes.status)}: ${text}`, {
        component: 'integrations',
        sessionName,
      });
    }
  } catch {
    logger.warn('WAHA not reachable — session will need manual setup', {
      component: 'integrations',
      wahaBaseUrl,
      sessionName,
    });
  }
}

// ─── Secret Key Extraction ──────────────────────────────────────

/** Extract secret key references from an integration config for validation. */
function getReferencedSecretKeys(provider: IntegrationProvider, config: Record<string, unknown>): string[] {
  switch (provider) {
    case 'telegram':
      return [config['botTokenSecretKey'] as string].filter(Boolean);
    case 'whatsapp': {
      const keys = [config['accessTokenSecretKey'] as string];
      if (config['verifyTokenSecretKey']) keys.push(config['verifyTokenSecretKey'] as string);
      return keys.filter(Boolean);
    }
    case 'slack': {
      const keys = [config['botTokenSecretKey'] as string];
      if (config['signingSecretSecretKey']) keys.push(config['signingSecretSecretKey'] as string);
      return keys.filter(Boolean);
    }
    case 'whatsapp-waha':
      return []; // WAHA uses direct URL, no secrets
    case 'chatwoot':
      return []; // Chatwoot uses env vars, not secrets table
    default:
      return [];
  }
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register channel integration CRUD routes. */
export function integrationRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { channelIntegrationRepository, channelResolver, secretService, logger } = deps;

  // ─── GET /projects/:projectId/integrations ─────────────────────

  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/integrations',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;
      const integrations = await channelIntegrationRepository.findByProject(projectId);

      const items = integrations.map((i) => ({
        ...i,
        webhookUrl: i.provider === 'chatwoot'
          ? '/api/v1/webhooks/chatwoot'
          : `/api/v1/webhooks/${i.provider}/${i.id}`,
      }));

      return sendSuccess(reply, { items, total: items.length });
    },
  );

  // ─── POST /projects/:projectId/integrations ────────────────────

  fastify.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/integrations',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;
      const input = CreateIntegrationSchema.parse(request.body);

      // Validate referenced secret keys exist
      const secretKeys = getReferencedSecretKeys(input.provider, input.config as unknown as Record<string, unknown>);
      for (const key of secretKeys) {
        const exists = await secretService.exists(projectId, key);
        if (!exists) {
          return sendError(
            reply,
            'SECRET_NOT_FOUND',
            `Secret "${key}" not found for project. Create it first via POST /projects/${projectId}/secrets`,
            400,
          );
        }
      }

      try {
        const integration = await channelIntegrationRepository.create({
          projectId,
          provider: input.provider,
          config: input.config,
          status: input.status,
        });

        channelResolver.invalidate(projectId);

        const webhookUrl = integration.provider === 'chatwoot'
          ? '/api/v1/webhooks/chatwoot'
          : `/api/v1/webhooks/${integration.provider}/${integration.id}`;

        logger.info('Channel integration created', {
          component: 'integrations',
          projectId,
          provider: integration.provider,
          integrationId: integration.id,
        });

        // Auto-setup WAHA session + webhook when creating a whatsapp-waha integration
        if (integration.provider === 'whatsapp-waha') {
          const nexusPublicUrl = process.env['NEXUS_PUBLIC_URL'];
          if (nexusPublicUrl) {
            const wahaConfig = integration.config as unknown as Record<string, unknown>;
            const { wahaBaseUrl, sessionName } = getWahaConfig(wahaConfig);
            const wahaWebhookUrl = `${nexusPublicUrl}/api/v1/webhooks/whatsapp-waha/${integration.id}`;
            // Fire-and-forget — don't block the response
            void setupWahaSession(wahaBaseUrl, sessionName, wahaWebhookUrl, logger);
          } else {
            logger.warn('NEXUS_PUBLIC_URL not set — skipping WAHA auto-setup', {
              component: 'integrations',
              integrationId: integration.id,
            });
          }
        }

        await sendSuccess(reply, { ...integration, webhookUrl }, 201); return;
      } catch (error) {
        // Handle unique constraint violation (one integration per provider per project)
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(
            reply,
            'DUPLICATE_INTEGRATION',
            `A ${input.provider} integration already exists for this project`,
            409,
          );
        }
        throw error;
      }
    },
  );

  // ─── GET /projects/:projectId/integrations/:integrationId ──────

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      const webhookUrl = integration.provider === 'chatwoot'
        ? '/api/v1/webhooks/chatwoot'
        : `/api/v1/webhooks/${integration.provider}/${integration.id}`;

      return sendSuccess(reply, { ...integration, webhookUrl });
    },
  );

  // ─── PUT /projects/:projectId/integrations/:integrationId ──────

  fastify.put<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const existing = await channelIntegrationRepository.findById(request.params.integrationId);
      if (existing?.projectId !== projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      // Parse status (always valid regardless of provider)
      const body = request.body as Record<string, unknown>;
      const statusInput = UpdateIntegrationStatusSchema.parse({ status: body['status'] });

      // If config is being updated, validate against the provider's schema
      let validatedConfig: IntegrationConfigUnion | undefined;
      if (body['config'] !== undefined) {
        const configSchemas: Record<string, z.ZodType> = {
          telegram: TelegramIntegrationConfigSchema,
          whatsapp: WhatsAppIntegrationConfigSchema,
          'whatsapp-waha': WhatsAppWahaIntegrationConfigSchema,
          slack: SlackIntegrationConfigSchema,
          chatwoot: ChatwootIntegrationConfigSchema,
        };
        const schema = configSchemas[existing.provider];
        if (schema) {
          validatedConfig = schema.parse(body['config']) as IntegrationConfigUnion;
        }

        // Validate referenced secret keys
        if (validatedConfig) {
          const secretKeys = getReferencedSecretKeys(existing.provider, validatedConfig as unknown as Record<string, unknown>);
          for (const key of secretKeys) {
            const exists = await secretService.exists(projectId, key);
            if (!exists) {
              return sendError(
                reply,
                'SECRET_NOT_FOUND',
                `Secret "${key}" not found for project`,
                400,
              );
            }
          }
        }
      }

      const updated = await channelIntegrationRepository.update(request.params.integrationId, {
        ...(validatedConfig !== undefined && { config: validatedConfig }),
        ...statusInput,
      });
      channelResolver.invalidate(projectId);

      logger.info('Channel integration updated', {
        component: 'integrations',
        projectId,
        integrationId: updated.id,
      });

      return sendSuccess(reply, updated);
    },
  );

  // ─── DELETE /projects/:projectId/integrations/:integrationId ───

  fastify.delete<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const existing = await channelIntegrationRepository.findById(request.params.integrationId);
      if (existing?.projectId !== projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      // Stop WAHA session before deleting the integration (prevents stale sessions)
      if (existing.provider === 'whatsapp-waha') {
        const wahaConfig = existing.config as unknown as Record<string, unknown>;
        const { wahaBaseUrl, sessionName } = getWahaConfig(wahaConfig);
        try {
          await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: getWahaHeaders(),
          });
          logger.info('WAHA session stopped on integration delete', {
            component: 'integrations',
            sessionName,
          });
        } catch {
          // WAHA unreachable — session may already be gone
        }
      }

      await channelIntegrationRepository.delete(request.params.integrationId);
      channelResolver.invalidate(projectId);

      logger.info('Channel integration deleted', {
        component: 'integrations',
        projectId,
        integrationId: request.params.integrationId,
      });

      return sendSuccess(reply, { deleted: true });
    },
  );

  // ─── GET /projects/:projectId/integrations/:integrationId/health

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/health',
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId;

      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }

      const adapter = await channelResolver.resolveAdapter(projectId, integration.provider);
      if (!adapter) {
        return sendSuccess(reply, {
          healthy: false,
          provider: integration.provider,
          status: integration.status,
          error: 'Failed to resolve adapter (check secrets)',
        });
      }

      try {
        const healthy = await adapter.isHealthy();
        await sendSuccess(reply, {
          healthy,
          provider: integration.provider,
          status: integration.status,
        }); return;
      } catch {
        await sendSuccess(reply, {
          healthy: false,
          provider: integration.provider,
          status: integration.status,
          error: 'Health check failed',
        });
      }
    },
  );

  // ─── WAHA-specific endpoints ──────────────────────────────────

  // ─── GET .../waha/status ──────────────────────────────────────

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/waha/status',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }
      if (integration.provider !== 'whatsapp-waha') {
        return sendError(reply, 'INVALID_PROVIDER', 'This endpoint is only for WhatsApp (QR) integrations', 400);
      }

      const wahaConfig = integration.config as unknown as WhatsAppWahaIntegrationConfig;
      const wahaBaseUrl = wahaConfig.wahaBaseUrl;
      const sessionName = wahaConfig.sessionName ?? 'default';

      try {
        const response = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}`, {
          headers: getWahaHeaders(),
        });
        if (!response.ok) {
          return sendSuccess(reply, { sessionStatus: 'STOPPED', sessionName });
        }
        const data = (await response.json()) as unknown as WahaSessionStatus;
        return sendSuccess(reply, {
          sessionStatus: data.status ?? 'UNKNOWN',
          sessionName: data.name ?? sessionName,
        });
      } catch {
        return sendSuccess(reply, { sessionStatus: 'UNREACHABLE', sessionName });
      }
    },
  );

  // ─── GET .../waha/qr ──────────────────────────────────────────

  fastify.get<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/waha/qr',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }
      if (integration.provider !== 'whatsapp-waha') {
        return sendError(reply, 'INVALID_PROVIDER', 'This endpoint is only for WhatsApp (QR) integrations', 400);
      }

      const wahaConfig = integration.config as unknown as WhatsAppWahaIntegrationConfig;
      const wahaBaseUrl = wahaConfig.wahaBaseUrl;
      const sessionName = wahaConfig.sessionName ?? 'default';

      try {
        const response = await fetch(
          `${wahaBaseUrl}/api/${sessionName}/auth/qr?format=image`,
          { headers: getWahaHeaders() },
        );
        if (!response.ok) {
          return sendError(reply, 'QR_UNAVAILABLE', 'QR code not available (session may already be connected)', 404);
        }
        const contentType = response.headers.get('content-type') ?? 'image/png';
        const buffer = Buffer.from(await response.arrayBuffer());
        // Allow cross-origin <img> loads (dashboard is on a different port)
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
        await reply.type(contentType).send(buffer);
        return;
      } catch {
        return sendError(reply, 'WAHA_UNREACHABLE', 'Cannot reach WAHA service', 502);
      }
    },
  );

  // ─── POST .../waha/session ────────────────────────────────────

  fastify.post<{ Params: { projectId: string; integrationId: string } }>(
    '/projects/:projectId/integrations/:integrationId/waha/session',
    async (request, reply) => {
      const integration = await channelIntegrationRepository.findById(request.params.integrationId);
      if (integration?.projectId !== request.params.projectId) {
        return sendNotFound(reply, 'Integration', request.params.integrationId);
      }
      if (integration.provider !== 'whatsapp-waha') {
        return sendError(reply, 'INVALID_PROVIDER', 'This endpoint is only for WhatsApp (QR) integrations', 400);
      }

      const wahaConfig = integration.config as unknown as WhatsAppWahaIntegrationConfig;
      const wahaBaseUrl = wahaConfig.wahaBaseUrl;
      const sessionName = wahaConfig.sessionName ?? 'default';

      const { action } = WahaSessionActionSchema.parse(request.body);
      const nexusPublicUrl = process.env['NEXUS_PUBLIC_URL'] ?? '';
      const webhookUrl = nexusPublicUrl
        ? `${nexusPublicUrl}/api/v1/webhooks/whatsapp-waha/${request.params.integrationId}`
        : '';

      const webhookConfig = webhookUrl
        ? { webhooks: [{ url: webhookUrl, events: ['message'] }] }
        : undefined;

      try {
        if (action === 'stop') {
          // Try modern path-based API, fall back to legacy
          await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: getWahaHeaders(),
            body: JSON.stringify({}),
          }).catch(() =>
            fetch(`${wahaBaseUrl}/api/sessions/stop`, {
              method: 'POST',
              headers: getWahaHeaders(),
              body: JSON.stringify({ name: sessionName }),
            }),
          );
          return sendSuccess(reply, { action: 'stop', success: true });
        }

        if (action === 'restart') {
          // Stop first, then fall through to start (which configures the webhook)
          await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: getWahaHeaders(),
            body: JSON.stringify({}),
          }).catch(() => undefined);
        }

        // Start — try modern path-based API first
        const pathStartRes = await fetch(`${wahaBaseUrl}/api/sessions/${sessionName}/start`, {
          method: 'POST',
          headers: getWahaHeaders(),
          body: JSON.stringify(webhookConfig ? { config: webhookConfig } : {}),
        });

        if (pathStartRes.ok) {
          logger.info(`WAHA session ${action}ed (path API)`, { component: 'integrations', sessionName, webhookUrl });
          return sendSuccess(reply, { action, success: true });
        }

        // Fall back to legacy API (POST /api/sessions/start with name in body)
        const legacyBody: Record<string, unknown> = { name: sessionName };
        if (webhookConfig) legacyBody['config'] = webhookConfig;

        const legacyStartRes = await fetch(`${wahaBaseUrl}/api/sessions/start`, {
          method: 'POST',
          headers: getWahaHeaders(),
          body: JSON.stringify(legacyBody),
        });

        if (!legacyStartRes.ok) {
          const text = await legacyStartRes.text();
          return sendError(reply, 'WAHA_ERROR', `WAHA returned ${String(legacyStartRes.status)}: ${text}`, 502);
        }

        logger.info(`WAHA session ${action}ed (legacy API)`, { component: 'integrations', sessionName, webhookUrl });
        return sendSuccess(reply, { action, success: true });
      } catch {
        return sendError(reply, 'WAHA_UNREACHABLE', 'Cannot reach WAHA service', 502);
      }
    },
  );
}
```

---
## src/api/routes/channel-webhooks.ts
```typescript
/**
 * Dynamic channel webhook routes — receives inbound messages from
 * per-project channel integrations (Telegram, WhatsApp, Slack).
 *
 * URL pattern: POST /webhooks/:provider/:integrationId
 *
 * Flow:
 * 1. Look up integration by ID → resolve projectId
 * 2. Resolve adapter via channel resolver (secrets-based)
 * 3. adapter.parseInbound(payload) → InboundMessage
 * 4. Async fire-and-forget: runAgent → send response via adapter
 * 5. Return 200 immediately (messaging platforms require fast acks)
 *
 * Chatwoot has its own dedicated routes (chatwoot-webhook.ts) due to
 * HMAC validation, handoff support, and async queue processing.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { getSlackUrlChallenge } from '@/channels/adapters/slack.js';

const VALID_PROVIDERS = new Set<string>(['telegram', 'whatsapp', 'whatsapp-waha', 'slack']);

// ─── Route Registration ─────────────────────────────────────────

/** Register dynamic channel webhook routes. */
export function channelWebhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { channelResolver, inboundProcessor, logger } = deps;

  // ─── POST /webhooks/:provider/:integrationId ───────────────────

  fastify.post<{ Params: { provider: string; integrationId: string } }>(
    '/webhooks/:provider/:integrationId',
    async (request: FastifyRequest<{ Params: { provider: string; integrationId: string } }>, reply: FastifyReply) => {
      const { provider, integrationId } = request.params;

      // Validate provider
      if (!VALID_PROVIDERS.has(provider)) {
        return reply.status(400).send({ error: `Unknown provider: ${provider}` });
      }

      // Handle Slack URL verification challenge (POST-based)
      if (provider === 'slack') {
        const challenge = getSlackUrlChallenge(request.body);
        if (challenge) {
          logger.info('Slack URL verification challenge', {
            component: 'channel-webhooks',
            integrationId,
          });
          return reply.send({ challenge });
        }
      }

      // Resolve integration
      const integration = await channelResolver.resolveIntegration(integrationId);
      if (!integration) {
        logger.warn('Integration not found for webhook', {
          component: 'channel-webhooks',
          provider,
          integrationId,
        });
        return reply.status(404).send({ error: 'Integration not found' });
      }

      // Validate provider matches integration
      if (integration.provider !== provider) {
        logger.warn('Provider mismatch in webhook', {
          component: 'channel-webhooks',
          urlProvider: provider,
          integrationProvider: integration.provider,
          integrationId,
        });
        return reply.status(400).send({ error: 'Provider mismatch' });
      }

      if (integration.status !== 'active') {
        return reply.status(200).send({ ok: true, ignored: true, reason: 'integration_paused' });
      }

      const projectId = integration.projectId;

      // Resolve adapter
      const adapter = await channelResolver.resolveAdapter(projectId, provider);
      if (!adapter) {
        logger.error('Failed to resolve adapter for webhook', {
          component: 'channel-webhooks',
          provider,
          projectId,
          integrationId,
        });
        return reply.status(200).send({ ok: true, ignored: true, reason: 'adapter_unavailable' });
      }

      // Parse inbound message
      const message = await adapter.parseInbound(request.body);

      if (message) {
        // Process async via InboundProcessor (contact management + agent run + response)
        void inboundProcessor.process(message);
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ─── GET /webhooks/:provider/:integrationId/verify ─────────────

  fastify.get<{ Params: { provider: string; integrationId: string } }>(
    '/webhooks/:provider/:integrationId/verify',
    async (request: FastifyRequest<{ Params: { provider: string; integrationId: string } }>, reply: FastifyReply) => {
      const { provider, integrationId } = request.params;

      if (provider !== 'whatsapp') {
        return reply.status(400).send({ error: 'Verification only supported for WhatsApp' });
      }

      // WhatsApp Cloud API webhook verification
      const query = request.query as Record<string, string>;
      const mode = query['hub.mode'];
      const token = query['hub.verify_token'];
      const challenge = query['hub.challenge'];

      if (mode !== 'subscribe' || !token || !challenge) {
        return reply.status(400).send({ error: 'Missing verification parameters' });
      }

      // Resolve integration to find the verify token secret key
      const integration = await channelResolver.resolveIntegration(integrationId);
      if (integration?.provider !== 'whatsapp') {
        return reply.status(404).send({ error: 'Integration not found' });
      }

      // Resolve verify token from secrets
      const config = integration.config as { verifyTokenSecretKey?: string };
      if (!config.verifyTokenSecretKey) {
        logger.warn('WhatsApp integration missing verifyTokenSecretKey', {
          component: 'channel-webhooks',
          integrationId,
        });
        return reply.status(403).send('Forbidden');
      }

      try {
        const { secretService } = deps;
        const verifyToken = await secretService.get(integration.projectId, config.verifyTokenSecretKey);

        if (token === verifyToken) {
          logger.info('WhatsApp webhook verified', {
            component: 'channel-webhooks',
            integrationId,
          });
          return await reply.status(200).send(challenge);
        }
      } catch {
        logger.error('Failed to resolve WhatsApp verify token secret', {
          component: 'channel-webhooks',
          integrationId,
        });
      }

      logger.warn('WhatsApp webhook verification failed', {
        component: 'channel-webhooks',
        integrationId,
      });
      return reply.status(403).send('Forbidden');
    },
  );
}
```

---
## src/api/routes/secrets.ts
```typescript
/**
 * Secrets routes — encrypted per-project credential management.
 * Values are NEVER returned in API responses; only metadata (key, description, timestamps).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';

// ─── Request Schemas ─────────────────────────────────────────────

const SetSecretSchema = z.object({
  key: z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/, 'Key must be uppercase alphanumeric + underscore'),
  value: z.string().min(1),
  description: z.string().max(500).optional(),
});

const UpdateSecretSchema = z.object({
  value: z.string().min(1),
  description: z.string().max(500).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export function secretRoutes(fastify: FastifyInstance, deps: RouteDependencies): void {
  const { secretService, logger } = deps;

  // ─── GET /projects/:projectId/secrets ───────────────────────────
  // List all secret keys for a project (no values, ever)

  fastify.get(
    '/projects/:projectId/secrets',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const secrets = await secretService.list(projectId);
      await sendSuccess(reply, secrets);
    },
  );

  // ─── POST /projects/:projectId/secrets ──────────────────────────
  // Create or overwrite a secret

  fastify.post(
    '/projects/:projectId/secrets',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const body = SetSecretSchema.parse(request.body);

      const metadata = await secretService.set(projectId, body.key, body.value, body.description);

      logger.info('Secret set', { component: 'secrets-routes', projectId, key: body.key });
      await sendSuccess(reply, metadata, 201);
    },
  );

  // ─── PUT /projects/:projectId/secrets/:key ──────────────────────
  // Update an existing secret value

  fastify.put(
    '/projects/:projectId/secrets/:key',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, key } = request.params as { projectId: string; key: string };

      const exists = await secretService.exists(projectId, key);
      if (!exists) {
        await sendError(reply, 'SECRET_NOT_FOUND', `Secret "${key}" not found`, 404);
        return;
      }

      const body = UpdateSecretSchema.parse(request.body);
      const metadata = await secretService.set(projectId, key, body.value, body.description);

      logger.info('Secret updated', { component: 'secrets-routes', projectId, key });
      await sendSuccess(reply, metadata);
    },
  );

  // ─── DELETE /projects/:projectId/secrets/:key ───────────────────

  fastify.delete(
    '/projects/:projectId/secrets/:key',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, key } = request.params as { projectId: string; key: string };

      const deleted = await secretService.delete(projectId, key);
      if (!deleted) {
        await sendError(reply, 'SECRET_NOT_FOUND', `Secret "${key}" not found`, 404);
        return;
      }

      logger.info('Secret deleted', { component: 'secrets-routes', projectId, key });
      await sendSuccess(reply, { deleted: true });
    },
  );

  // ─── GET /projects/:projectId/secrets/:key/exists ───────────────
  // Boolean check — safe to call from frontend to verify a key is configured

  fastify.get(
    '/projects/:projectId/secrets/:key/exists',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, key } = request.params as { projectId: string; key: string };
      const exists = await secretService.exists(projectId, key);
      await sendSuccess(reply, { exists });
    },
  );

}
```

---
## src/api/routes/knowledge.ts
```typescript
/**
 * Knowledge base routes — per-project CRUD for memory entries.
 * Provides add, list, delete, and bulk import endpoints for the UI.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import type { MemoryCategory } from '@/memory/types.js';

// ─── Schemas ─────────────────────────────────────────────────────

const MemoryCategorySchema = z.string();

const AddKnowledgeSchema = z.object({
  content: z.string().min(1).max(10_000),
  category: MemoryCategorySchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ListKnowledgeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: MemoryCategorySchema.optional(),
});

const BulkImportSchema = z.object({
  items: z.array(
    z.object({
      content: z.string().min(1).max(10_000),
      category: MemoryCategorySchema.optional(),
      importance: z.number().min(0).max(1).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ).min(1).max(500),
});

// ─── Route Plugin ────────────────────────────────────────────────

/** Register knowledge base CRUD routes. */
export function knowledgeRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { knowledgeService } = deps;

  // ─── POST /projects/:projectId/knowledge ──────────────────────
  // Add a single knowledge entry

  fastify.post(
    '/projects/:projectId/knowledge',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const body = AddKnowledgeSchema.parse(request.body);

      const entry = await knowledgeService.add({
        projectId,
        content: body.content,
        category: body.category as MemoryCategory | undefined,
        importance: body.importance,
        metadata: body.metadata,
      });

      await sendSuccess(reply, entry, 201);
    },
  );

  // ─── GET /projects/:projectId/knowledge ───────────────────────
  // List knowledge entries with pagination

  fastify.get(
    '/projects/:projectId/knowledge',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const query = ListKnowledgeQuerySchema.parse(request.query);

      const result = await knowledgeService.list({
        projectId,
        page: query.page,
        limit: query.limit,
        category: query.category as MemoryCategory | undefined,
      });

      await sendSuccess(reply, result);
    },
  );

  // ─── DELETE /knowledge/:id ────────────────────────────────────
  // Delete a knowledge entry by ID

  fastify.delete(
    '/knowledge/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const deleted = await knowledgeService.delete(id);
      if (!deleted) {
        return sendNotFound(reply, 'Knowledge entry', id);
      }

      await sendSuccess(reply, { deleted: true, id });
    },
  );

  // ─── POST /projects/:projectId/knowledge/bulk ─────────────────
  // Bulk import knowledge entries from JSON

  fastify.post(
    '/projects/:projectId/knowledge/bulk',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      if (!knowledgeService) {
        await sendError(reply, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge base is not configured (embeddings disabled)', 503);
        return;
      }

      const body = BulkImportSchema.parse(request.body);

      const result = await knowledgeService.bulkImport({
        projectId,
        items: body.items as import('@/knowledge/types.js').BulkImportItem[],
      });

      await sendSuccess(reply, result, result.failed > 0 ? 207 : 201);
    },
  );
}
```

---
## src/api/routes/files.ts
```typescript
/**
 * File routes — upload, download, and manage files.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const uploadQuerySchema = z.object({
  projectId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  expiresIn: z.string().transform(Number).optional(), // seconds until expiry
});

const listQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export function fileRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { fileService, fileRepository, logger } = deps;

  // ─── Upload File ────────────────────────────────────────────────

  fastify.post(
    '/files/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = uploadQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: query.error.flatten(),
        });
      }

      const { projectId, filename, mimeType, expiresIn } = query.data;

      // Get raw body as buffer
      const content = request.body as Buffer | undefined;

      if (!content || content.length === 0) {
        return reply.status(400).send({ error: 'Empty file body' });
      }

      // Determine MIME type
      const resolvedMimeType = mimeType ?? 
        request.headers['content-type'] ?? 
        'application/octet-stream';

      // Calculate expiry if specified
      const expiresAt = expiresIn 
        ? new Date(Date.now() + expiresIn * 1000)
        : undefined;

      const file = await fileService.upload({
        projectId: projectId as ProjectId,
        filename,
        mimeType: resolvedMimeType,
        content,
        expiresAt,
      });

      logger.info('File uploaded via API', {
        component: 'files-route',
        fileId: file.id,
        projectId,
        filename,
        sizeBytes: file.sizeBytes,
      });

      return reply.status(201).send({ file });
    },
  );

  // ─── Download File ──────────────────────────────────────────────

  fastify.get(
    '/files/:fileId/download',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };

      try {
        const { file, content } = await fileService.download(fileId);

        return await reply
          .header('Content-Type', file.mimeType)
          .header('Content-Disposition', `attachment; filename="${file.originalFilename}"`)
          .header('Content-Length', file.sizeBytes)
          .send(content);
      } catch (error) {
        if ((error as Error).message.includes('not found')) {
          return reply.status(404).send({ error: 'File not found' });
        }
        throw error;
      }
    },
  );

  // ─── Get File Metadata ──────────────────────────────────────────

  fastify.get(
    '/files/:fileId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };

      const file = await fileService.getById(fileId);

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      return reply.send({ file });
    },
  );

  // ─── Get Temporary URL ──────────────────────────────────────────

  fastify.get(
    '/files/:fileId/url',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };
      const { expiresIn } = request.query as { expiresIn?: string };

      const expiresInSeconds = expiresIn ? Number(expiresIn) : 3600;

      const url = await fileService.getTemporaryUrl(fileId, expiresInSeconds);

      if (!url) {
        return reply.status(404).send({ error: 'File not found or URL not available' });
      }

      return reply.send({ url, expiresIn: expiresInSeconds });
    },
  );

  // ─── List Files by Project ──────────────────────────────────────

  fastify.get(
    '/projects/:projectId/files',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = listQuerySchema.parse(request.query);

      const files = await fileRepository.findByProject(projectId as ProjectId, {
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send({ files });
    },
  );

  // ─── Delete File ────────────────────────────────────────────────

  fastify.delete(
    '/files/:fileId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };

      try {
        await fileService.delete(fileId);

        logger.info('File deleted via API', {
          component: 'files-route',
          fileId,
        });

        return await reply.status(204).send();
      } catch (error) {
        if ((error as Error).message.includes('not found')) {
          return reply.status(404).send({ error: 'File not found' });
        }
        throw error;
      }
    },
  );
}
```

---
## src/api/routes/webhooks.ts
```typescript
/**
 * Webhook routes — health check endpoint.
 *
 * Channel-specific webhook routes have been replaced by dynamic routes:
 *   POST /webhooks/:provider/:integrationId  (channel-webhooks.ts)
 *   GET  /webhooks/:provider/:integrationId/verify
 *
 * Chatwoot retains its dedicated routes at /webhooks/chatwoot (chatwoot-webhook.ts).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';

// ─── Route Registration ─────────────────────────────────────────

export function webhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  void deps; // deps kept for consistent route signature

  // ─── Health Check for Channels ──────────────────────────────────

  fastify.get('/webhooks/health', (_request, reply: FastifyReply) => {
    return reply.send({
      dynamic: true,
      message: 'Channel webhooks are per-project. Use /projects/:projectId/integrations/:id/health for per-integration health.',
      timestamp: new Date().toISOString(),
    });
  });
}
```

---
## src/api/routes/templates.ts
```typescript
/**
 * Templates API Routes
 * Endpoints for listing and creating projects from vertical templates
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TemplateManager } from '@/templates/index.js';
import type { ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'api:templates' });

// ─── Schemas ───────────────────────────────────────────────────

const createFromTemplateSchema = z.object({
  projectName: z.string().min(1).max(100, 'Project name must be 1-100 characters'),
  projectDescription: z.string().max(500).optional(),
  environment: z.enum(['production', 'staging', 'development']).default('development'),
  owner: z.string().min(1, 'Owner is required'),
  tags: z.array(z.string()).optional(),
  provider: z.object({
    provider: z.enum(['anthropic', 'openai', 'google', 'ollama']),
    model: z.string().min(1, 'Model is required'),
    temperature: z.number().min(0).max(2).optional(),
    apiKeyEnvVar: z.string().optional(),
  }),
  includeSampleData: z.boolean().default(false),
});

const updatePromptsFromTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  updatedBy: z.string().min(1, 'updatedBy is required'),
});

// ─── Routes ────────────────────────────────────────────────────

/** Register template routes. */
export function templateRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const templateManager = new TemplateManager(deps.prisma);

  /**
   * GET /templates
   * List all available vertical templates
   */
  fastify.get('/templates', async (_request, reply) => {
    logger.debug('Listing available templates', { component: 'api:templates' });

    const templates = templateManager.listTemplates();

    return sendSuccess(reply, { templates });
  });

  /**
   * GET /templates/:templateId
   * Get a specific template by ID (without sample data)
   */
  fastify.get<{
    Params: { templateId: string };
  }>('/templates/:templateId', async (request, reply) => {
    const { templateId } = request.params;

    logger.debug('Getting template details', {
      component: 'api:templates',
      templateId,
    });

    const template = templateManager.getTemplate(templateId);
    
    if (!template) {
      return sendNotFound(reply, 'Template', templateId);
    }

    return sendSuccess(reply, {
      id: template.id,
      name: template.name,
      description: template.description,
      allowedTools: template.agentConfig.allowedTools ?? [],
      agentRole: template.agentConfig.agentRole,
    });
  });

  /**
   * POST /templates/:templateId/create-project
   * Create a new project from a template
   */
  fastify.post<{
    Params: { templateId: string };
  }>('/templates/:templateId/create-project', async (request, reply) => {
    const { templateId } = request.params;
    const body = createFromTemplateSchema.parse(request.body);

    logger.info('Creating project from template', {
      component: 'api:templates',
      templateId,
      projectName: body.projectName,
      owner: body.owner,
    });

    try {
      const result = await templateManager.createProjectFromTemplate({
        templateId,
        ...body,
      });

      logger.info('Project created successfully', {
        component: 'api:templates',
        projectId: result.projectId,
        templateId,
      });

      await sendSuccess(reply, {
        projectId: result.projectId,
        agentId: result.agentId,
        message: `Project created successfully from template ${templateId}`,
        sampleData: result.sampleData,
      }, 201);
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create project';
      if (message.includes('not found')) {
        await sendNotFound(reply, 'Template', templateId);
        return;
      }

      logger.error('Failed to create project from template', {
        component: 'api:templates',
        error: message,
        templateId,
      });
      await sendError(reply, 'PROJECT_CREATION_FAILED', message, 400);
      return;
    }
  });

  /**
   * POST /projects/:projectId/update-prompts-from-template
   * Update an existing project's prompts from a template
   */
  fastify.post<{
    Params: { projectId: string };
  }>('/projects/:projectId/update-prompts-from-template', async (request, reply) => {
    const { projectId } = request.params;
    const body = updatePromptsFromTemplateSchema.parse(request.body);

    logger.info('Updating project prompts from template', {
      component: 'api:templates',
      projectId,
      templateId: body.templateId,
      updatedBy: body.updatedBy,
    });

    try {
      // Verify project exists
      const project = await deps.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        await sendNotFound(reply, 'Project', projectId);
        return;
      }

      await templateManager.updateProjectPrompts({
        projectId: projectId as ProjectId,
        templateId: body.templateId,
        updatedBy: body.updatedBy,
      });

      logger.info('Project prompts updated successfully', {
        component: 'api:templates',
        projectId,
        templateId: body.templateId,
      });

      await sendSuccess(reply, {
        message: `Project prompts updated from template ${body.templateId}`,
      });
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update prompts';
      if (message.includes('not found')) {
        await sendNotFound(reply, 'Template', body.templateId);
        return;
      }

      logger.error('Failed to update prompts from template', {
        component: 'api:templates',
        error: message,
        projectId,
      });
      await sendError(reply, 'PROMPT_UPDATE_FAILED', message, 400);
    }
  });
}
```

---
## src/api/routes/catalog.ts
```typescript
/**
 * Catalog routes — upload and manage product catalogs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import type { ProjectId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';
import { nanoid } from 'nanoid';
import OpenAI from 'openai';

// ─── Schemas ────────────────────────────────────────────────────

const uploadQuerySchema = z.object({
  projectId: z.string().min(1),
  format: z.enum(['csv', 'excel']).optional(),
  replace: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().optional().default(false)
  ),
});

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.string(),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  unit: z.string().default('unidad'),
});

type Product = z.infer<typeof productSchema>;

// ─── Route Registration ─────────────────────────────────────────

export function catalogRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;

  // Initialize OpenAI client only if API key is available
  const openaiKey = process.env['OPENAI_API_KEY'];
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  if (!openai) {
    logger.warn('Catalog routes registered but embeddings disabled (no OPENAI_API_KEY)', {
      component: 'catalog-route',
    });
  }

  // ─── Upload Catalog ─────────────────────────────────────────────

  fastify.post(
    '/catalog/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = uploadQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: query.error.flatten(),
        });
      }

      const { projectId, format, replace } = query.data;

      // Get raw body as buffer
      const content = request.body as Buffer | undefined;

      if (!content || content.length === 0) {
        return reply.status(400).send({ error: 'Empty file body' });
      }

      // Check if OpenAI is available
      if (!openai) {
        return reply.status(503).send({
          error: 'Catalog functionality disabled',
          reason: 'OPENAI_API_KEY not configured',
        });
      }

      try {
        // Parse file based on format
        let products: Product[];

        if (format === 'excel' || request.headers['content-type']?.includes('spreadsheet')) {
          products = parseExcel(content);
        } else {
          // Default to CSV
          products = parseCsv(content.toString('utf-8'));
        }

        logger.info('Parsed catalog file', {
          component: 'catalog-route',
          projectId,
          format: format ?? 'csv',
          productsCount: products.length,
        });

        // If replace=true, delete existing catalog entries
        if (replace) {
          await prisma.memoryEntry.deleteMany({
            where: {
              projectId: projectId as ProjectId,
              category: 'catalog_product',
            },
          });

          logger.info('Deleted existing catalog', {
            component: 'catalog-route',
            projectId,
          });
        }

        // Generate embeddings and store in memory_entries
        const inserted = await ingestProducts(projectId as ProjectId, products, prisma, openai, logger);

        logger.info('Catalog uploaded successfully', {
          component: 'catalog-route',
          projectId,
          productsCount: products.length,
          insertedCount: inserted,
        });

        return await reply.status(201).send({
          success: true,
          productsCount: products.length,
          insertedCount: inserted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Catalog upload failed', {
          component: 'catalog-route',
          projectId,
          error: message,
        });
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ─── Get Catalog Stats ──────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/catalog/stats',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      const stats = await prisma.memoryEntry.groupBy({
        by: ['category'],
        where: {
          projectId: projectId as ProjectId,
          category: 'catalog_product',
        },
        _count: true,
      });

      const totalProducts = stats.reduce((sum, s) => sum + s._count, 0);

      // Get unique categories from metadata
      const entries = await prisma.memoryEntry.findMany({
        where: {
          projectId: projectId as ProjectId,
          category: 'catalog_product',
        },
        select: {
          metadata: true,
        },
      });

      const categories = new Set<string>();
      for (const entry of entries) {
        const metadata = entry.metadata as Record<string, unknown>;
        const cat = metadata['category'];
        if (typeof cat === 'string') {
          categories.add(cat);
        } else if (cat != null) {
          categories.add(String(cat as string | number));
        }
      }

      return reply.send({
        totalProducts,
        categories: Array.from(categories),
      });
    },
  );

  // ─── Delete Catalog ─────────────────────────────────────────────

  fastify.delete(
    '/projects/:projectId/catalog',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      const deleted = await prisma.memoryEntry.deleteMany({
        where: {
          projectId: projectId as ProjectId,
          category: 'catalog_product',
        },
      });

      logger.info('Catalog deleted', {
        component: 'catalog-route',
        projectId,
        deletedCount: deleted.count,
      });

      return await reply.status(200).send({
        success: true,
        deletedCount: deleted.count,
      });
    },
  );
}

// ─── Parsers ────────────────────────────────────────────────────

function parseCsv(content: string): Product[] {
   
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    escape: '\\',
  });

  return (records as Record<string, string>[]).map((row) => {
    const product = {
      sku: row['sku'] ?? row['SKU'] ?? '',
      name: row['name'] ?? row['nombre'] ?? row['Name'] ?? '',
      description: row['description'] ?? row['descripcion'] ?? row['Description'] ?? '',
      category: row['category'] ?? row['categoria'] ?? row['Category'] ?? '',
      price: parseFloat(row['price'] ?? row['precio'] ?? row['Price'] ?? '0'),
      stock: parseInt(row['stock'] ?? row['Stock'] ?? '0', 10),
      unit: row['unit'] ?? row['unidad'] ?? row['Unit'] ?? 'unidad',
    };
    return productSchema.parse(product);
  });
}

function parseExcel(content: Buffer): Product[] {
   
  const workbook = XLSX.read(content, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0] as string | undefined;
  if (!firstSheetName) {
    throw new Error('Excel file has no sheets');
  }
  const firstSheet = workbook.Sheets[firstSheetName];
  if (!firstSheet) {
    throw new Error('Excel sheet not found');
  }
  const rows = XLSX.utils.sheet_to_json(firstSheet);
   

  return (rows as Record<string, unknown>[]).map((row) => {
    // Excel cell values are primitives (string | number | boolean | Date)
    /* eslint-disable @typescript-eslint/no-base-to-string */
    const product = {
      sku: String(row['sku'] ?? row['SKU'] ?? ''),
      name: String(row['name'] ?? row['nombre'] ?? row['Name'] ?? ''),
      description: String(row['description'] ?? row['descripcion'] ?? row['Description'] ?? ''),
      category: String(row['category'] ?? row['categoria'] ?? row['Category'] ?? ''),
      price: Number(row['price'] ?? row['precio'] ?? row['Price'] ?? 0),
      stock: Number(row['stock'] ?? row['Stock'] ?? 0),
      unit: String(row['unit'] ?? row['unidad'] ?? row['Unit'] ?? 'unidad'),
    };
    /* eslint-enable @typescript-eslint/no-base-to-string */
    return productSchema.parse(product);
  });
}

// ─── Ingestion ──────────────────────────────────────────────────

async function ingestProducts(
  projectId: ProjectId,
  products: Product[],
  prisma: PrismaClient,
  openai: OpenAI,
  logger: Logger,
): Promise<number> {
  let inserted = 0;

  // Process in batches to avoid rate limits
  const batchSize = 20;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    // Generate embeddings for batch
    const embeddingTexts = batch.map((p) => 
      `${p.name} - ${p.description} (${p.category})`
    );

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingTexts,
    });

    // Insert entries with embeddings
    for (let j = 0; j < batch.length; j++) {
      const product = batch[j];
      const embeddingData = embeddingResponse.data[j];
      if (!product || !embeddingData) continue;
      const embedding = embeddingData.embedding;

      await prisma.$executeRaw`
        INSERT INTO memory_entries (
          id,
          project_id,
          category,
          content,
          embedding,
          importance,
          metadata,
          created_at,
          last_accessed_at
        ) VALUES (
          ${nanoid()},
          ${projectId},
          'catalog_product',
          ${product.description},
          ${`[${embedding.join(',')}]`}::vector,
          0.7,
          ${JSON.stringify(product)}::jsonb,
          NOW(),
          NOW()
        )
      `;

      inserted++;
    }

    logger.debug('Batch inserted', {
      component: 'catalog-ingestion',
      projectId,
      batchIndex: i / batchSize,
      batchSize: batch.length,
    });
  }

  return inserted;
}
```

---
## src/api/routes/onboarding.ts
```typescript
/**
 * Onboarding routes — provision new clients in a single API call.
 *
 * Creates a complete project setup: Project + Prompt Layers + Channel Integration + Agent.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import type { ChannelIntegrationRepository, ChatwootIntegrationConfig } from '@/channels/types.js';

// ─── Extended Dependencies ──────────────────────────────────────

export interface OnboardingDeps extends RouteDependencies {
  channelIntegrationRepository: ChannelIntegrationRepository;
}

// ─── Zod Schemas ────────────────────────────────────────────────

const chatwootConfigSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  agentBotId: z.number().int().positive(),
  apiTokenEnvVar: z.string().min(1),
});

const providerConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: z.string().min(1),
  apiKeyEnvVar: z.string().min(1).optional(),
});

const promptsSchema = z.object({
  identity: z.string().min(1).max(100_000),
  instructions: z.string().min(1).max(100_000),
  safety: z.string().min(1).max(100_000),
});

const budgetSchema = z.object({
  dailyUSD: z.number().positive().default(10),
  monthlyUSD: z.number().positive().default(100),
  maxPerRunUSD: z.number().positive().default(2),
});

const provisionSchema = z.object({
  clientName: z.string().min(1).max(200),
  owner: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  environment: z.enum(['production', 'staging', 'development']).default('production'),
  provider: providerConfigSchema,
  chatwoot: chatwootConfigSchema,
  prompts: promptsSchema,
  budget: budgetSchema.optional(),
  tools: z.array(z.string()).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register onboarding routes. */
export function onboardingRoutes(
  fastify: FastifyInstance,
  deps: OnboardingDeps,
): void {
  const {
    projectRepository,
    promptLayerRepository,
    agentRepository,
    channelIntegrationRepository,
    logger,
  } = deps;

  /**
   * POST /onboarding/provision — provision a new client in one call.
   *
   * Creates: Project + 3 Prompt Layers (active) + Channel Integration + Agent.
   */
  fastify.post('/onboarding/provision', async (request, reply) => {
    const input = provisionSchema.parse(request.body);

    try {
      // 1. Create project
      const defaultBudget = { dailyUSD: 10, monthlyUSD: 100, maxPerRunUSD: 2 };
      const budget = input.budget ?? defaultBudget;

      const projectConfig: AgentConfig = {
        projectId: '' as ProjectId, // Will be set after creation
        agentRole: 'customer-support',
        provider: {
          provider: input.provider.provider,
          model: input.provider.model,
          apiKeyEnvVar: input.provider.apiKeyEnvVar ?? `${input.provider.provider.toUpperCase()}_API_KEY`,
        },
        allowedTools: input.tools ?? ['calculator', 'date-time', 'json-transform'],
        failover: {
          onRateLimit: true,
          onServerError: true,
          onTimeout: true,
          timeoutMs: 120_000,
          maxRetries: 2,
        },
        memoryConfig: {
          longTerm: {
            enabled: false,
            maxEntries: 1000,
            retrievalTopK: 5,
            embeddingProvider: 'openai',
            decayEnabled: false,
            decayHalfLifeDays: 30,
          },
          contextWindow: {
            reserveTokens: 100_000,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 20,
            compaction: {
              enabled: true,
              memoryFlushBeforeCompaction: false,
            },
          },
        },
        costConfig: {
          dailyBudgetUSD: budget.dailyUSD,
          monthlyBudgetUSD: budget.monthlyUSD,
          maxTokensPerTurn: 4000,
          maxTurnsPerSession: 15,
          maxToolCallsPerTurn: 5,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 20,
          maxRequestsPerHour: 200,
        },
        maxTurnsPerSession: 15,
        maxConcurrentSessions: 100,
      };

      const project = await projectRepository.create({
        name: input.clientName,
        description: input.description,
        environment: input.environment,
        owner: input.owner,
        tags: input.tags ?? [],
        config: projectConfig as unknown as AgentConfig,
      });

      const projectId = project.id;

      // Update projectId in config (it was empty before creation)
      projectConfig.projectId = projectId;
      await projectRepository.update(projectId, {
        config: projectConfig as unknown as AgentConfig,
      });

      // 2. Create and activate prompt layers
      const layerTypes = ['identity', 'instructions', 'safety'] as const;
      const layerContents = {
        identity: input.prompts.identity,
        instructions: input.prompts.instructions,
        safety: input.prompts.safety,
      };

      for (const layerType of layerTypes) {
        const layer = await promptLayerRepository.create({
          projectId,
          layerType,
          content: layerContents[layerType],
          createdBy: input.owner,
          changeReason: 'Initial onboarding setup',
        });

        await promptLayerRepository.activate(layer.id);
      }

      // 3. Create channel integration (Chatwoot)
      const chatwootConfig: ChatwootIntegrationConfig = {
        baseUrl: input.chatwoot.baseUrl,
        accountId: input.chatwoot.accountId,
        inboxId: input.chatwoot.inboxId,
        agentBotId: input.chatwoot.agentBotId,
        apiTokenEnvVar: input.chatwoot.apiTokenEnvVar,
      };

      const integration = await channelIntegrationRepository.create({
        projectId,
        provider: 'chatwoot',
        config: chatwootConfig,
      });

      // 4. Create agent
      const agent = await agentRepository.create({
        projectId,
        name: `${input.clientName} Agent`,
        description: `AI agent for ${input.clientName}`,
        promptConfig: {
          identity: input.prompts.identity,
          instructions: input.prompts.instructions,
          safety: input.prompts.safety,
        },
        toolAllowlist: input.tools ?? ['calculator', 'date-time', 'json-transform'],
        channelConfig: {
          allowedChannels: ['chatwoot'],
          defaultChannel: 'chatwoot',
        },
        limits: {
          maxTurns: 15,
          maxTokensPerTurn: 4000,
          budgetPerDayUsd: budget.dailyUSD,
        },
      });

      logger.info('Client provisioned successfully', {
        component: 'onboarding',
        projectId,
        agentId: agent.id,
        integrationId: integration.id,
        clientName: input.clientName,
      });

      await sendSuccess(reply, {
        projectId,
        agentId: agent.id,
        channelIntegrationId: integration.id,
        chatwootWebhookUrl: '/api/v1/webhooks/chatwoot',
        status: 'provisioned',
      }, 201);
      return;
    } catch (error) {
      logger.error('Failed to provision client', {
        component: 'onboarding',
        clientName: input.clientName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return sendError(
        reply,
        'ONBOARDING_FAILED',
        error instanceof Error ? error.message : 'Failed to provision client',
        500,
      );
    }
  });
}
```

---
## src/api/routes/chatwoot-webhook.ts
```typescript
/**
 * Chatwoot webhook routes — receives Agent Bot events from Chatwoot.
 *
 * Flow:
 * 1. Chatwoot sends webhook event (message_created, conversation_status_changed)
 * 2. We extract account_id from the payload → resolve to a Nexus project
 * 3. Parse the message via the Chatwoot adapter
 * 4. Process with inbound processor (contact → session → agent → response)
 * 5. Agent response sent back via Chatwoot API
 *
 * Handoff:
 * - If agent response contains [HANDOFF] marker, escalate to human in Chatwoot
 * - If customer message contains escalation keywords, escalate immediately
 */
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { HandoffManager } from '@/channels/handoff.js';
import type { ChatwootWebhookEvent, ChatwootAdapter } from '@/channels/adapters/chatwoot.js';
import type { ProjectId } from '@/core/types.js';
import type { WebhookQueue } from '@/channels/webhook-queue.js';

// ─── Extended Dependencies ──────────────────────────────────────

export interface ChatwootWebhookDeps extends RouteDependencies {
  channelResolver: ChannelResolver;
  handoffManager: HandoffManager;
  /** Optional webhook queue for async processing. If not provided, webhooks are processed inline. */
  webhookQueue?: WebhookQueue;
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

// ─── Route Registration ─────────────────────────────────────────

export function chatwootWebhookRoutes(
  fastify: FastifyInstance,
  deps: ChatwootWebhookDeps,
): void {
  const { channelResolver, handoffManager, webhookQueue, logger } = deps;

  /**
   * POST /webhooks/chatwoot — receives Agent Bot webhook events from Chatwoot.
   */
  fastify.post('/webhooks/chatwoot', async (request: FastifyRequest, reply: FastifyReply) => {
    // ─── HMAC Signature Validation ─────────────────────────────────
    const signature = request.headers['x-chatwoot-api-signature'] as string | undefined;

    if (!signature) {
      logger.warn('Chatwoot webhook missing signature', {
        component: 'chatwoot-webhook',
        ip: request.ip,
      });
      return reply.status(401).send({ error: 'Missing signature' });
    }

    const secret = process.env['CHATWOOT_WEBHOOK_SECRET'];
    if (!secret) {
      logger.error('CHATWOOT_WEBHOOK_SECRET not configured', {
        component: 'chatwoot-webhook',
      });
      return reply.status(500).send({ error: 'Server misconfigured' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      logger.warn('Chatwoot webhook invalid signature', {
        component: 'chatwoot-webhook',
        ip: request.ip,
        received: signature.slice(0, 10) + '...',
        expected: expectedSignature.slice(0, 10) + '...',
      });
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    // ─── Process Webhook ───────────────────────────────────────────
    const event = request.body as ChatwootWebhookEvent;

    logger.debug('Received Chatwoot webhook', {
      component: 'chatwoot-webhook',
      event: event.event,
      accountId: event.account?.id,
      conversationId: event.conversation?.id,
    });

    // Only handle message_created events from contacts (incoming messages)
    if (event.event !== 'message_created') {
      return reply.status(200).send({ ok: true });
    }

    if (event.message_type !== 'incoming' || !event.content || event.sender?.type !== 'contact') {
      return reply.status(200).send({ ok: true });
    }

    const accountId = event.account?.id;
    const conversationId = event.conversation?.id;

    if (accountId === undefined || conversationId === undefined) {
      logger.warn('Chatwoot webhook missing account or conversation ID', {
        component: 'chatwoot-webhook',
      });
      return reply.status(200).send({ ok: true });
    }

    // Resolve project from Chatwoot account ID
    const projectId = await channelResolver.resolveProjectByAccount(accountId);
    if (!projectId) {
      logger.warn('No project found for Chatwoot account', {
        component: 'chatwoot-webhook',
        accountId,
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // ─── Process via Queue (if available) or Inline ──────────────────

    if (webhookQueue) {
      // Async processing: enqueue job and respond 200 OK immediately
      const webhookId = nanoid();

      await webhookQueue.enqueue({
        webhookId,
        projectId,
        event,
        receivedAt: new Date().toISOString(),
        conversationId,
      });

      logger.debug('Webhook enqueued for async processing', {
        component: 'chatwoot-webhook',
        webhookId,
        projectId,
        conversationId,
      });

      return reply.status(200).send({ ok: true, webhookId, queued: true });
    }

    // Fallback: Inline processing (legacy behavior, no queue configured)
    const adapter = await channelResolver.resolveAdapter(projectId, 'chatwoot') as ChatwootAdapter | null;
    if (!adapter) {
      logger.error('No Chatwoot adapter for project', {
        component: 'chatwoot-webhook',
        projectId,
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // Check if customer is requesting human escalation
    if (handoffManager.shouldEscalateFromMessage(event.content)) {
      void handoffManager
        .escalate(conversationId, adapter, 'Cliente solicito agente humano')
        .catch((error: unknown) => {
          logger.error('Failed to escalate to human', {
            component: 'chatwoot-webhook',
            conversationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

      return reply.status(200).send({ ok: true, escalated: true });
    }

    // Parse message and process via inbound processor (async, respond immediately)
    const message = await adapter.parseInbound(event);

    if (message) {
      void (async () => {
        try {
          // Run agent
          const result = await deps.runAgent({
            projectId,
            sessionId: `cw-${String(conversationId)}`,
            userMessage: message.content,
          });

          let responseText = result.response;

          // Check if agent wants to hand off
          if (handoffManager.shouldEscalateFromResponse(responseText)) {
            responseText = handoffManager.stripHandoffMarker(responseText);

            // Send the response before escalating
            if (responseText) {
              await adapter.send({
                channel: 'chatwoot',
                recipientIdentifier: String(conversationId),
                content: responseText,
              });
            }

            await handoffManager.escalate(
              conversationId,
              adapter,
              'El agente AI determino que se requiere asistencia humana',
            );
            return;
          }

          // Send response back via Chatwoot
          await adapter.send({
            channel: 'chatwoot',
            recipientIdentifier: String(conversationId),
            content: responseText,
          });
        } catch (error) {
          logger.error('Failed to process Chatwoot message', {
            component: 'chatwoot-webhook',
            conversationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
    }

    return reply.status(200).send({ ok: true });
  });

  /**
   * POST /webhooks/chatwoot/conversation-resolved — handle when human resolves.
   * Chatwoot can be configured to send a webhook when a conversation is resolved.
   * This re-enables the bot for the next message.
   */
  fastify.post('/webhooks/chatwoot/status', async (request: FastifyRequest, reply: FastifyReply) => {
    // ─── HMAC Signature Validation ─────────────────────────────────
    const signature = request.headers['x-chatwoot-api-signature'] as string | undefined;

    if (!signature) {
      logger.warn('Chatwoot webhook missing signature (status endpoint)', {
        component: 'chatwoot-webhook',
        ip: request.ip,
      });
      return reply.status(401).send({ error: 'Missing signature' });
    }

    const secret = process.env['CHATWOOT_WEBHOOK_SECRET'];
    if (!secret) {
      logger.error('CHATWOOT_WEBHOOK_SECRET not configured', {
        component: 'chatwoot-webhook',
      });
      return reply.status(500).send({ error: 'Server misconfigured' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      logger.warn('Chatwoot webhook invalid signature (status endpoint)', {
        component: 'chatwoot-webhook',
        ip: request.ip,
        received: signature.slice(0, 10) + '...',
        expected: expectedSignature.slice(0, 10) + '...',
      });
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    // ─── Process Status Change ─────────────────────────────────────
    const event = request.body as ChatwootWebhookEvent;

    if (event.event !== 'conversation_status_changed') {
      return reply.status(200).send({ ok: true });
    }

    const status = event.conversation?.status;
    const conversationId = event.conversation?.id;
    const accountId = event.account?.id;

    if (status === 'resolved' && conversationId !== undefined && accountId !== undefined) {
      const projectId = await channelResolver.resolveProjectByAccount(accountId);
      if (projectId) {
        const adapter = await channelResolver.resolveAdapter(projectId, 'chatwoot') as ChatwootAdapter | null;
        if (adapter) {
          void handoffManager.resume(conversationId, adapter).catch((error: unknown) => {
            logger.error('Failed to resume bot after resolve', {
              component: 'chatwoot-webhook',
              conversationId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        }
      }
    }

    return reply.status(200).send({ ok: true });
  });
}
```

---
## src/api/routes/skills.ts
```typescript
/**
 * Skill routes — templates, instances, and agent assignment.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { AgentId } from '@/agents/types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';

// ─── Schemas ────────────────────────────────────────────────────

const createInstanceSchema = z.object({
  templateId: z.string().optional(),
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  instructionsFragment: z.string().min(1),
  requiredTools: z.array(z.string()).optional(),
  requiredMcpServers: z.array(z.string()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const createFromTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  instructionsFragment: z.string().min(1).optional(),
  requiredTools: z.array(z.string()).optional(),
  requiredMcpServers: z.array(z.string()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const assignSkillsSchema = z.object({
  skillIds: z.array(z.string()),
});

// ─── Route Registration ─────────────────────────────────────────

export function skillRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { skillService, agentRepository, agentRegistry, logger } = deps;

  // ─── Skill Templates (Global) ─────────────────────────────────

  fastify.get(
    '/skill-templates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = z.object({
        category: z.enum(['sales', 'support', 'operations', 'communication']).optional(),
      }).parse(request.query);

      const templates = await skillService.listTemplates(query.category);
      await sendSuccess(reply, templates); return;
    },
  );

  fastify.get(
    '/skill-templates/:templateId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { templateId } = request.params as { templateId: string };
      const template = await skillService.getTemplate(templateId);

      if (!template) {
        return sendNotFound(reply, 'SkillTemplate', templateId);
      }

      await sendSuccess(reply, template); return;
    },
  );

  // ─── Skill Instances (Per-Project) ────────────────────────────

  fastify.get(
    '/projects/:projectId/skills',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const instances = await skillService.listInstances(projectId);
      await sendSuccess(reply, instances); return;
    },
  );

  fastify.get(
    '/projects/:projectId/skills/:skillId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { projectId: string; skillId: string };
      const instance = await skillService.getInstance(skillId);

      if (!instance) {
        return sendNotFound(reply, 'SkillInstance', skillId);
      }

      await sendSuccess(reply, instance); return;
    },
  );

  fastify.post(
    '/projects/:projectId/skills',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createInstanceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await skillService.createInstance({
          projectId,
          ...parseResult.data,
        });
        logger.info('Skill instance created', { component: 'skills', instanceId: instance.id, projectId });
        await sendSuccess(reply, instance, 201); return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(reply, 'CONFLICT', 'Skill with this name already exists in the project', 409);
        }
        throw error;
      }
    },
  );

  fastify.post(
    '/projects/:projectId/skills/from-template',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createFromTemplateSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await skillService.createFromTemplate(
          projectId,
          parseResult.data.templateId,
          {
            name: parseResult.data.name,
            displayName: parseResult.data.displayName,
            description: parseResult.data.description,
            parameters: parseResult.data.parameters,
          },
        );
        logger.info('Skill instance created from template', {
          component: 'skills',
          instanceId: instance.id,
          projectId,
          templateId: parseResult.data.templateId,
        });
        await sendSuccess(reply, instance, 201); return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return sendError(reply, 'NOT_FOUND', error.message, 404);
        }
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(reply, 'CONFLICT', 'Skill with this name already exists in the project', 409);
        }
        throw error;
      }
    },
  );

  fastify.patch(
    '/projects/:projectId/skills/:skillId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { projectId: string; skillId: string };
      const parseResult = updateInstanceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await skillService.updateInstance(skillId, parseResult.data);
        logger.info('Skill instance updated', { component: 'skills', instanceId: skillId });
        await sendSuccess(reply, instance); return;
      } catch {
        return sendNotFound(reply, 'SkillInstance', skillId);
      }
    },
  );

  fastify.delete(
    '/projects/:projectId/skills/:skillId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { projectId: string; skillId: string };

      try {
        await skillService.deleteInstance(skillId);
        logger.info('Skill instance deleted', { component: 'skills', instanceId: skillId });
        return await reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: 'Skill instance not found' });
      }
    },
  );

  // ─── Agent Skill Assignment ───────────────────────────────────

  fastify.get(
    '/projects/:projectId/agents/:agentId/skills',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };

      const agent = await agentRegistry.get(agentId as AgentId);
      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      // Return the full skill instances for the agent's assigned skills
      const composition = await skillService.composeForAgent(agent.skillIds);
      const instances = agent.skillIds.length > 0
        ? await Promise.all(
            agent.skillIds.map((id) => skillService.getInstance(id)),
          )
        : [];

      await sendSuccess(reply, {
        skills: instances.filter(Boolean),
        composition,
      }); return;
    },
  );

  fastify.post(
    '/projects/:projectId/agents/:agentId/skills',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };
      const parseResult = assignSkillsSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const agent = await agentRepository.update(
          agentId as AgentId,
          { skillIds: parseResult.data.skillIds },
        );
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent skills updated', {
          component: 'skills',
          agentId,
          skillCount: parseResult.data.skillIds.length,
        });
        await sendSuccess(reply, agent); return;
      } catch {
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );

  fastify.delete(
    '/projects/:projectId/agents/:agentId/skills/:skillId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId, skillId } = request.params as { projectId: string; agentId: string; skillId: string };

      const agent = await agentRegistry.get(agentId as AgentId);
      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      const updatedSkillIds = agent.skillIds.filter((id) => id !== skillId);
      await agentRepository.update(agentId as AgentId, { skillIds: updatedSkillIds });
      agentRegistry.invalidate(agentId as AgentId);

      logger.info('Skill unassigned from agent', { component: 'skills', agentId, skillId });
      return await reply.status(204).send();
    },
  );
}
```

---
## src/security/types.ts
```typescript
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';

// ─── Approval Status ────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

// ─── Approval Request ───────────────────────────────────────────

export interface ApprovalRequest {
  id: ApprovalId;
  projectId: ProjectId;
  sessionId: SessionId;
  toolCallId: ToolCallId;
  toolId: string;
  toolInput: Record<string, unknown>;
  riskLevel: 'high' | 'critical';
  status: ApprovalStatus;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
}

// ─── Approval Store ─────────────────────────────────────────────

/** Storage interface for ApprovalRequests. Allows swapping in-memory vs Prisma. */
export interface ApprovalStore {
  /** Persist a new approval request. */
  create(request: ApprovalRequest): Promise<void>;
  /** Retrieve an approval request by ID. */
  get(id: ApprovalId): Promise<ApprovalRequest | undefined>;
  /** Update fields on an existing approval request. Returns the updated record, or null if not found. */
  update(id: ApprovalId, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest | null>;
  /** List pending approval requests for a project. */
  listPending(projectId: ProjectId): Promise<ApprovalRequest[]>;
  /** List all approval requests across all projects. */
  listAll(): Promise<ApprovalRequest[]>;
}

// ─── RBAC Context ───────────────────────────────────────────────

export interface RBACContext {
  projectId: ProjectId;
  allowedTools: ReadonlySet<string>;
}
```

---
## src/security/approval-gate.ts
```typescript
/**
 * ApprovalGate — pauses execution of high/critical risk tools until human approval.
 * Uses an in-memory store by default; can be backed by the DB ApprovalRequest table.
 */
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import { nanoid } from 'nanoid';
import type { ApprovalRequest, ApprovalStatus, ApprovalStore } from './types.js';

const logger = createLogger({ name: 'approval-gate' });

/** Callback notified when an approval is requested. */
export type ApprovalNotifier = (request: ApprovalRequest) => Promise<void>;

export interface ApprovalGateOptions {
  /** How long approvals are valid before expiring (ms). Default: 5 minutes. */
  expirationMs?: number;
  /** Optional callback to notify humans of pending approvals. */
  notifier?: ApprovalNotifier;
  /** Optional injected store. Defaults to in-memory. */
  store?: ApprovalStore;
}

export interface ApprovalGate {
  /**
   * Request approval for a tool execution.
   * Returns the ApprovalRequest record (initially 'pending').
   */
  requestApproval(params: {
    projectId: ProjectId;
    sessionId: SessionId;
    toolCallId: ToolCallId;
    toolId: string;
    toolInput: Record<string, unknown>;
    riskLevel: 'high' | 'critical';
  }): Promise<ApprovalRequest>;

  /**
   * Resolve an approval (approve or deny).
   */
  resolve(
    approvalId: ApprovalId,
    decision: 'approved' | 'denied',
    resolvedBy: string,
    note?: string,
  ): Promise<ApprovalRequest | null>;

  /**
   * Get an approval request by ID.
   */
  get(approvalId: ApprovalId): Promise<ApprovalRequest | undefined>;

  /**
   * List pending approvals for a project.
   */
  listPending(projectId: ProjectId): Promise<ApprovalRequest[]>;

  /**
   * List all approvals across all projects.
   */
  listAll(): Promise<ApprovalRequest[]>;

  /**
   * Check if a specific approval has been granted.
   * Also checks for expiration.
   */
  isApproved(approvalId: ApprovalId): Promise<boolean>;
}

/**
 * Create an in-memory ApprovalStore for testing and development.
 */
export function createInMemoryApprovalStore(): ApprovalStore {
  const requests = new Map<string, ApprovalRequest>();

  return {
    create(request: ApprovalRequest): Promise<void> {
      requests.set(request.id, request);
      return Promise.resolve();
    },

    get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
      return Promise.resolve(requests.get(id));
    },

    update(_id: ApprovalId, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest | null> {
      const idToUpdate = updates.id ?? _id;
      const existing = requests.get(idToUpdate);
      if (!existing) return Promise.resolve(null);
      const updated: ApprovalRequest = { ...existing, ...updates };
      requests.set(idToUpdate, updated);
      return Promise.resolve(updated);
    },

    listPending(projectId: ProjectId): Promise<ApprovalRequest[]> {
      return Promise.resolve(
        [...requests.values()].filter(
          (r) => r.projectId === projectId && r.status === 'pending',
        ),
      );
    },

    listAll(): Promise<ApprovalRequest[]> {
      return Promise.resolve([...requests.values()]);
    },
  };
}

/**
 * Create an ApprovalGate instance.
 */
export function createApprovalGate(options?: ApprovalGateOptions): ApprovalGate {
  const expirationMs = options?.expirationMs ?? 5 * 60 * 1000;
  const store = options?.store ?? createInMemoryApprovalStore();

  function checkExpiration(request: ApprovalRequest): ApprovalRequest {
    if (request.status === 'pending' && new Date() >= request.expiresAt) {
      return { ...request, status: 'expired' };
    }
    return request;
  }

  async function getAndCheckExpiration(approvalId: ApprovalId): Promise<ApprovalRequest | undefined> {
    const request = await store.get(approvalId);
    if (!request) return undefined;
    const checked = checkExpiration(request);
    // Persist expiration if status changed
    if (checked.status !== request.status) {
      await store.update(approvalId, checked);
    }
    return checked;
  }

  return {
    async requestApproval(params): Promise<ApprovalRequest> {
      const id = `appr_${nanoid()}` as ApprovalId;
      const now = new Date();

      const request: ApprovalRequest = {
        id,
        projectId: params.projectId,
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        toolId: params.toolId,
        toolInput: params.toolInput,
        riskLevel: params.riskLevel,
        status: 'pending',
        requestedAt: now,
        expiresAt: new Date(now.getTime() + expirationMs),
      };

      await store.create(request);

      logger.info('Approval requested', {
        component: 'approval-gate',
        approvalId: id,
        toolId: params.toolId,
        riskLevel: params.riskLevel,
        projectId: params.projectId,
      });

      if (options?.notifier) {
        await options.notifier(request);
      }

      return request;
    },

    async resolve(
      approvalId: ApprovalId,
      decision: 'approved' | 'denied',
      resolvedBy: string,
      note?: string,
    ): Promise<ApprovalRequest | null> {
      const checked = await getAndCheckExpiration(approvalId);
      if (!checked) return null;

      if (checked.status !== 'pending') {
        logger.warn('Attempted to resolve non-pending approval', {
          component: 'approval-gate',
          approvalId,
          currentStatus: checked.status,
        });
        return checked;
      }

      const resolved: ApprovalRequest = {
        ...checked,
        status: decision as ApprovalStatus,
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNote: note,
      };

      const result = await store.update(approvalId, resolved);

      logger.info('Approval resolved', {
        component: 'approval-gate',
        approvalId,
        decision,
        resolvedBy,
        toolId: resolved.toolId,
      });

      return result;
    },

    async get(approvalId: ApprovalId): Promise<ApprovalRequest | undefined> {
      return getAndCheckExpiration(approvalId);
    },

    async listPending(projectId: ProjectId): Promise<ApprovalRequest[]> {
      const pending = await store.listPending(projectId);
      return pending.map(checkExpiration).filter((r) => r.status === 'pending');
    },

    async listAll(): Promise<ApprovalRequest[]> {
      const all = await store.listAll();
      return all.map(checkExpiration);
    },

    async isApproved(approvalId: ApprovalId): Promise<boolean> {
      const checked = await getAndCheckExpiration(approvalId);
      if (!checked) return false;
      return checked.status === 'approved';
    },
  };
}
```

---
## src/security/prisma-approval-store.ts
```typescript
/**
 * Prisma-backed ApprovalStore for persistent approval request tracking.
 * Maps between the app's ApprovalRequest type and the Prisma ApprovalRequest model.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import type { ApprovalRequest, ApprovalStatus, ApprovalStore } from './types.js';

/** Map a Prisma ApprovalRequest record to the app's ApprovalRequest type. */
function toAppModel(record: {
  id: string;
  projectId: string;
  sessionId: string;
  toolCallId: string;
  toolId: string;
  toolInput: unknown;
  riskLevel: string;
  status: string;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}): ApprovalRequest {
  return {
    id: record.id as ApprovalId,
    projectId: record.projectId as ProjectId,
    sessionId: record.sessionId as SessionId,
    toolCallId: record.toolCallId as ToolCallId,
    toolId: record.toolId,
    toolInput: record.toolInput as Record<string, unknown>,
    riskLevel: record.riskLevel as 'high' | 'critical',
    status: record.status as ApprovalStatus,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    resolvedAt: record.resolvedAt ?? undefined,
    resolvedBy: record.resolvedBy ?? undefined,
    resolutionNote: record.resolutionNote ?? undefined,
  };
}

/**
 * Create a Prisma-backed ApprovalStore.
 */
export function createPrismaApprovalStore(prisma: PrismaClient): ApprovalStore {
  return {
    async create(request: ApprovalRequest): Promise<void> {
      await prisma.approvalRequest.create({
        data: {
          id: request.id,
          projectId: request.projectId,
          sessionId: request.sessionId,
          toolCallId: request.toolCallId,
          toolId: request.toolId,
          toolInput: request.toolInput as Prisma.InputJsonValue,
          riskLevel: request.riskLevel,
          status: request.status,
          requestedAt: request.requestedAt,
          expiresAt: request.expiresAt,
          resolvedAt: request.resolvedAt ?? null,
          resolvedBy: request.resolvedBy ?? null,
          resolutionNote: request.resolutionNote ?? null,
        },
      });
    },

    async get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
      const record = await prisma.approvalRequest.findUnique({
        where: { id },
      });
      if (!record) return undefined;
      return toAppModel(record);
    },

    async update(id: ApprovalId, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest | null> {
      try {
        const record = await prisma.approvalRequest.update({
          where: { id },
          data: {
            ...(updates.status !== undefined && { status: updates.status }),
            ...(updates.resolvedAt !== undefined && { resolvedAt: updates.resolvedAt }),
            ...(updates.resolvedBy !== undefined && { resolvedBy: updates.resolvedBy }),
            ...(updates.resolutionNote !== undefined && { resolutionNote: updates.resolutionNote }),
          },
        });
        return toAppModel(record);
      } catch {
        return null;
      }
    },

    async listPending(projectId: ProjectId): Promise<ApprovalRequest[]> {
      const records = await prisma.approvalRequest.findMany({
        where: { projectId, status: 'pending' },
        orderBy: { requestedAt: 'desc' },
      });
      return records.map(toAppModel);
    },

    async listAll(): Promise<ApprovalRequest[]> {
      const records = await prisma.approvalRequest.findMany({
        orderBy: { requestedAt: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
```

---
## src/security/input-sanitizer.ts
```typescript
/**
 * InputSanitizer — scrubs user input before it enters the agent loop.
 * Defends against prompt injection, excessive length, and dangerous patterns.
 * This is a defense-in-depth measure — the LLM is NOT a security boundary.
 */
import { ValidationError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'input-sanitizer' });

export interface SanitizeOptions {
  /** Maximum input length in characters. Default: 100_000 */
  maxLength?: number;
  /** Whether to strip potential prompt injection patterns. Default: true */
  stripInjectionPatterns?: boolean;
}

/** Known prompt injection patterns to detect and flag. */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /<<\s*SYS\s*>>/i,
  /BEGININSTRUCTION/i,
  /\[SYSTEM\]/i,
];

export interface SanitizeResult {
  /** The sanitized input text. */
  sanitized: string;
  /** Whether any injection patterns were detected. */
  injectionDetected: boolean;
  /** The specific patterns that matched (for logging). */
  detectedPatterns: string[];
  /** Whether the input was truncated. */
  wasTruncated: boolean;
}

/**
 * Sanitize user input before it enters the agent loop.
 * Returns a SanitizeResult with the cleaned text and detection flags.
 */
export function sanitizeInput(
  input: string,
  options?: SanitizeOptions,
): SanitizeResult {
  const maxLength = options?.maxLength ?? 100_000;
  const stripInjection = options?.stripInjectionPatterns ?? true;

  let sanitized = input;
  let wasTruncated = false;
  const detectedPatterns: string[] = [];

  // Length check
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    wasTruncated = true;
    logger.warn('Input truncated due to length', {
      component: 'input-sanitizer',
      originalLength: input.length,
      maxLength,
    });
  }

  // Strip null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Detect injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      detectedPatterns.push(pattern.source);
    }
  }

  const injectionDetected = detectedPatterns.length > 0;

  if (injectionDetected) {
    logger.warn('Potential prompt injection detected', {
      component: 'input-sanitizer',
      patterns: detectedPatterns,
    });

    if (stripInjection) {
      for (const pattern of INJECTION_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    }
  }

  return {
    sanitized,
    injectionDetected,
    detectedPatterns,
    wasTruncated,
  };
}

/**
 * Validate and sanitize input, throwing on empty input.
 * Convenience wrapper for API route handlers.
 */
export function validateUserInput(
  input: unknown,
  options?: SanitizeOptions,
): SanitizeResult {
  if (typeof input !== 'string') {
    throw new ValidationError('Input must be a string', { receivedType: typeof input });
  }

  if (input.trim().length === 0) {
    throw new ValidationError('Input must not be empty');
  }

  return sanitizeInput(input, options);
}
```

---
## src/security/index.ts
```typescript
// ApprovalGate, InputSanitizer, RBAC
export type { ApprovalRequest, ApprovalStatus, ApprovalStore, RBACContext } from './types.js';
export { createApprovalGate, createInMemoryApprovalStore } from './approval-gate.js';
export type { ApprovalGate, ApprovalGateOptions, ApprovalNotifier } from './approval-gate.js';
export { createPrismaApprovalStore } from './prisma-approval-store.js';
export { sanitizeInput, validateUserInput } from './input-sanitizer.js';
export type { SanitizeOptions, SanitizeResult } from './input-sanitizer.js';
```

---
## src/scheduling/types.ts
```typescript
/**
 * Scheduled Tasks — types for BullMQ-based task scheduling with agent proposals.
 *
 * Two origins:
 * - `static`: created by humans via API/config
 * - `agent_proposed`: proposed by agent tool, requires human approval to activate
 *
 * Only `active` tasks are eligible for execution.
 */
import type { ProjectId, ScheduledTaskId, ScheduledTaskRunId, TraceId } from '@/core/types.js';

// ─── Enums ──────────────────────────────────────────────────────

export type ScheduledTaskOrigin = 'static' | 'agent_proposed';

export type ScheduledTaskStatus =
  | 'proposed'
  | 'active'
  | 'paused'
  | 'rejected'
  | 'completed'
  | 'expired';

export type ScheduledTaskRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'budget_exceeded';

// ─── Task Payload ───────────────────────────────────────────────

/** The message/instruction the agent will receive when the task executes. */
export interface TaskPayload {
  /** The user message to send to the agent. */
  message: string;
  /** Optional metadata passed to the agent context. */
  metadata?: Record<string, unknown>;
}

// ─── Scheduled Task ─────────────────────────────────────────────

export interface ScheduledTask {
  id: ScheduledTaskId;
  projectId: ProjectId;
  name: string;
  description?: string;
  cronExpression: string;
  taskPayload: TaskPayload;
  origin: ScheduledTaskOrigin;
  status: ScheduledTaskStatus;
  proposedBy?: string;
  approvedBy?: string;
  maxRetries: number;
  timeoutMs: number;
  budgetPerRunUSD: number;
  maxDurationMinutes: number;
  maxTurns: number;
  maxRuns?: number;
  runCount: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Scheduled Task Run ─────────────────────────────────────────

export interface ScheduledTaskRun {
  id: ScheduledTaskRunId;
  taskId: ScheduledTaskId;
  status: ScheduledTaskRunStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  traceId?: TraceId;
  result?: Record<string, unknown>;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
}

// ─── Create Inputs ──────────────────────────────────────────────

export interface ScheduledTaskCreateInput {
  projectId: ProjectId;
  name: string;
  description?: string;
  cronExpression: string;
  taskPayload: TaskPayload;
  origin: ScheduledTaskOrigin;
  /** For agent-proposed tasks, the agent/session that proposed it. */
  proposedBy?: string;
  maxRetries?: number;
  timeoutMs?: number;
  budgetPerRunUSD?: number;
  maxDurationMinutes?: number;
  maxTurns?: number;
  maxRuns?: number;
  expiresAt?: Date;
}

export interface ScheduledTaskRunCreateInput {
  taskId: ScheduledTaskId;
  traceId?: TraceId;
}
```

---
## src/scheduling/task-manager.ts
```typescript
/**
 * TaskManager — business logic for scheduled task lifecycle.
 *
 * Handles proposing, approving, rejecting, pausing, resuming tasks,
 * and computing next run times from cron expressions.
 */
import { CronExpressionParser } from 'cron-parser';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { NexusError, ValidationError } from '@/core/errors.js';
import type { ProjectId, ScheduledTaskId } from '@/core/types.js';
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskCreateInput,
} from './types.js';
import type {
  ScheduledTaskRepository,
  ScheduledTaskUpdateInput,
} from '@/infrastructure/repositories/scheduled-task-repository.js';

// ─── Interface ──────────────────────────────────────────────────

export interface TaskManager {
  /** Create a task directly (origin: static, starts as active). */
  createTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>>;
  /** Propose a task from an agent (origin: agent_proposed, starts as proposed). */
  proposeTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>>;
  /** Approve a proposed task — transitions to active and calculates nextRunAt. */
  approveTask(id: ScheduledTaskId, approvedBy: string): Promise<Result<ScheduledTask, NexusError>>;
  /** Reject a proposed task. */
  rejectTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>>;
  /** Pause an active task — stops scheduling runs. */
  pauseTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>>;
  /** Resume a paused task — restores to active with new nextRunAt. */
  resumeTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>>;
  /** Get a task by ID. */
  getTask(id: ScheduledTaskId): Promise<ScheduledTask | null>;
  /** List tasks for a project with optional status filter. */
  listTasks(projectId: ProjectId, status?: string): Promise<ScheduledTask[]>;
  /** List runs for a task. */
  listRuns(taskId: ScheduledTaskId, limit?: number): Promise<ScheduledTaskRun[]>;
  /** Validate a cron expression. Returns the next 3 run times on success. */
  validateCron(cronExpression: string): Result<Date[], NexusError>;
}

// ─── Options ────────────────────────────────────────────────────

export interface TaskManagerOptions {
  repository: ScheduledTaskRepository;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Parse a cron expression and compute the next N run times. */
function computeNextRuns(cronExpression: string, count: number, from?: Date): Date[] {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: from ?? new Date(),
  });

  const runs: Date[] = [];
  for (let i = 0; i < count; i++) {
    runs.push(interval.next().toDate());
  }
  return runs;
}

/** Validate a cron expression. Returns null if valid, error message if invalid. */
function validateCronExpression(cronExpression: string): string | null {
  try {
    CronExpressionParser.parse(cronExpression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a TaskManager instance. */
export function createTaskManager(options: TaskManagerOptions): TaskManager {
  const { repository } = options;

  return {
    async createTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>> {
      const cronError = validateCronExpression(input.cronExpression);
      if (cronError) {
        return err(new ValidationError(`Invalid cron expression: ${cronError}`, {
          cronExpression: input.cronExpression,
        }));
      }

      // Static tasks start as active
      const taskInput: ScheduledTaskCreateInput = {
        ...input,
        origin: 'static',
      };

      const task = await repository.create(taskInput);

      // Calculate first run time
      const nextRuns = computeNextRuns(task.cronExpression, 1);
      const nextRunAt = nextRuns[0];
      if (nextRunAt) {
        const updated = await repository.update(task.id, { nextRunAt });
        if (updated) return ok(updated);
      }

      return ok(task);
    },

    async proposeTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>> {
      const cronError = validateCronExpression(input.cronExpression);
      if (cronError) {
        return err(new ValidationError(`Invalid cron expression: ${cronError}`, {
          cronExpression: input.cronExpression,
        }));
      }

      const taskInput: ScheduledTaskCreateInput = {
        ...input,
        origin: 'agent_proposed',
      };

      const task = await repository.create(taskInput);
      return ok(task);
    },

    async approveTask(
      id: ScheduledTaskId,
      approvedBy: string,
    ): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'proposed') {
        return err(new ValidationError(
          `Cannot approve task in status '${task.status}'. Only 'proposed' tasks can be approved.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const nextRuns = computeNextRuns(task.cronExpression, 1);
      const nextRunAt = nextRuns[0];

      const updateData: ScheduledTaskUpdateInput = {
        status: 'active',
        approvedBy,
        nextRunAt,
      };

      const updated = await repository.update(id, updateData);
      if (!updated) {
        return err(new NexusError({
          message: `Failed to approve task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async rejectTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'proposed') {
        return err(new ValidationError(
          `Cannot reject task in status '${task.status}'. Only 'proposed' tasks can be rejected.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const updated = await repository.update(id, { status: 'rejected' });
      if (!updated) {
        return err(new NexusError({
          message: `Failed to reject task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async pauseTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'active') {
        return err(new ValidationError(
          `Cannot pause task in status '${task.status}'. Only 'active' tasks can be paused.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const updated = await repository.update(id, { status: 'paused', nextRunAt: null });
      if (!updated) {
        return err(new NexusError({
          message: `Failed to pause task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async resumeTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'paused') {
        return err(new ValidationError(
          `Cannot resume task in status '${task.status}'. Only 'paused' tasks can be resumed.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const nextRuns = computeNextRuns(task.cronExpression, 1);
      const nextRunAt = nextRuns[0];

      const updated = await repository.update(id, { status: 'active', nextRunAt });
      if (!updated) {
        return err(new NexusError({
          message: `Failed to resume task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async getTask(id: ScheduledTaskId): Promise<ScheduledTask | null> {
      return repository.findById(id);
    },

    async listTasks(projectId: ProjectId, status?: string): Promise<ScheduledTask[]> {
      const validStatuses = ['proposed', 'active', 'paused', 'rejected', 'completed', 'expired'];
      const taskStatus = status && validStatuses.includes(status)
        ? status as ScheduledTask['status']
        : undefined;
      return repository.listByProject(projectId, taskStatus);
    },

    async listRuns(taskId: ScheduledTaskId, limit?: number): Promise<ScheduledTaskRun[]> {
      return repository.listRuns(taskId, limit);
    },

    validateCron(cronExpression: string): Result<Date[], NexusError> {
      const cronError = validateCronExpression(cronExpression);
      if (cronError) {
        return err(new ValidationError(`Invalid cron expression: ${cronError}`, {
          cronExpression,
        }));
      }

      const nextRuns = computeNextRuns(cronExpression, 3);
      return ok(nextRuns);
    },
  };
}
```

---
## src/scheduling/task-runner.ts
```typescript
/**
 * TaskRunner — BullMQ-based scheduled task execution.
 *
 * Scheduler loop runs every minute, queries tasks due for execution,
 * and enqueues BullMQ jobs. Worker processes jobs by creating agent
 * runs with the task's payload.
 *
 * Conditional startup: only starts if REDIS_URL is set.
 */
import { Queue, Worker } from 'bullmq';
import { CronExpressionParser } from 'cron-parser';
import type { Logger } from '@/observability/logger.js';
import type {
  ScheduledTaskRepository,
} from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ScheduledTask } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  repository: ScheduledTaskRepository;
  logger: Logger;
  /** Redis connection URL. */
  redisUrl: string;
  /** Poll interval in milliseconds. Defaults to 60_000 (1 minute). */
  pollIntervalMs?: number;
  /** Callback invoked for each task execution. Returns trace data. */
  onExecuteTask: (task: ScheduledTask) => Promise<TaskExecutionResult>;
}

export interface TaskExecutionResult {
  success: boolean;
  traceId?: string;
  tokensUsed?: number;
  costUsd?: number;
  result?: Record<string, unknown>;
  errorMessage?: string;
}

export interface TaskRunner {
  /** Start the scheduler loop and worker. */
  start(): Promise<void>;
  /** Stop the scheduler loop, close queue and worker. */
  stop(): Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Compute the next run time from a cron expression. */
function computeNextRunAt(cronExpression: string, from?: Date): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: from ?? new Date(),
  });
  return interval.next().toDate();
}

/** Parse Redis URL into host/port/password for BullMQ connection. */
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password ? parsed.password : undefined,
  };
}

// ─── Factory ────────────────────────────────────────────────────

const QUEUE_NAME = 'scheduled-tasks';

/** Create a TaskRunner backed by BullMQ. */
export function createTaskRunner(options: TaskRunnerOptions): TaskRunner {
  const {
    repository,
    logger,
    redisUrl,
    pollIntervalMs = 60_000,
    onExecuteTask,
  } = options;

  const connection = parseRedisUrl(redisUrl);

  let queue: Queue<{ taskId: string }> | null = null;
  let worker: Worker<{ taskId: string }> | null = null;
  let schedulerInterval: ReturnType<typeof setInterval> | null = null;

  /** Poll for due tasks and enqueue them. */
  async function pollAndEnqueue(): Promise<void> {
    try {
      const now = new Date();
      const dueTasks = await repository.getTasksDueForExecution(now);

      for (const task of dueTasks) {
        // Check if task has hit maxRuns
        if (task.maxRuns !== undefined && task.runCount >= task.maxRuns) {
          await repository.update(task.id, { status: 'completed', nextRunAt: null });
          logger.info('Task completed (maxRuns reached)', {
            component: 'task-runner',
            taskId: task.id,
            runCount: task.runCount,
            maxRuns: task.maxRuns,
          });
          continue;
        }

        // Check if task has expired
        if (task.expiresAt && task.expiresAt <= now) {
          await repository.update(task.id, { status: 'expired', nextRunAt: null });
          logger.info('Task expired', {
            component: 'task-runner',
            taskId: task.id,
            expiresAt: task.expiresAt.toISOString(),
          });
          continue;
        }

        // Enqueue the task
        if (queue) {
          await queue.add(`task-${task.id}`, { taskId: task.id }, {
            removeOnComplete: 100,
            removeOnFail: 100,
          });
        }

        // Calculate next run time immediately
        const nextRunAt = computeNextRunAt(task.cronExpression, now);
        await repository.update(task.id, { nextRunAt });

        logger.debug('Enqueued scheduled task', {
          component: 'task-runner',
          taskId: task.id,
          nextRunAt: nextRunAt.toISOString(),
        });
      }
    } catch (error) {
      logger.error('Scheduler poll failed', {
        component: 'task-runner',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async start(): Promise<void> {
      queue = new Queue<{ taskId: string }>(QUEUE_NAME, { connection });

      worker = new Worker<{ taskId: string }>(
        QUEUE_NAME,
        async (job) => {
          const taskId = job.data.taskId;
          const task = await repository.findById(taskId as Parameters<typeof repository.findById>[0]);

          if (task?.status !== 'active') {
            logger.warn('Skipping task execution (not active)', {
              component: 'task-runner',
              taskId,
              status: task?.status,
            });
            return;
          }

          // Create run record
          const run = await repository.createRun({ taskId: task.id });

          // Mark run as started
          const startedAt = new Date();
          await repository.updateRun(run.id, { status: 'running', startedAt });

          try {
            // Execute with timeout
            const timeoutPromise = new Promise<never>((resolve, reject) => {
              void resolve;
              setTimeout(() => {
                reject(new Error('Task execution timeout'));
              }, task.timeoutMs);
            });

            const executionResult = await Promise.race([
              onExecuteTask(task),
              timeoutPromise,
            ]);

            const completedAt = new Date();
            const durationMs = completedAt.getTime() - startedAt.getTime();

            await repository.updateRun(run.id, {
              status: executionResult.success ? 'completed' : 'failed',
              completedAt,
              durationMs,
              tokensUsed: executionResult.tokensUsed,
              costUsd: executionResult.costUsd,
              traceId: executionResult.traceId as Parameters<typeof repository.updateRun>[1]['traceId'],
              result: executionResult.result,
              errorMessage: executionResult.errorMessage,
            });

            // Update task counters
            await repository.update(task.id, {
              lastRunAt: startedAt,
              runCount: task.runCount + 1,
            });

            logger.info('Task execution completed', {
              component: 'task-runner',
              taskId: task.id,
              runId: run.id,
              success: executionResult.success,
              durationMs,
            });
          } catch (error) {
            const completedAt = new Date();
            const durationMs = completedAt.getTime() - startedAt.getTime();
            const errorMessage = error instanceof Error ? error.message : String(error);

            const status = errorMessage === 'Task execution timeout' ? 'timeout' : 'failed';

            await repository.updateRun(run.id, {
              status,
              completedAt,
              durationMs,
              errorMessage,
            });

            // Update task counters even on failure
            await repository.update(task.id, {
              lastRunAt: startedAt,
              runCount: task.runCount + 1,
            });

            logger.error('Task execution failed', {
              component: 'task-runner',
              taskId: task.id,
              runId: run.id,
              error: errorMessage,
            });
          }
        },
        { connection, concurrency: 5 },
      );

      worker.on('error', (error) => {
        logger.error('BullMQ worker error', {
          component: 'task-runner',
          error: error.message,
        });
      });

      // Start polling loop
      schedulerInterval = setInterval(() => void pollAndEnqueue(), pollIntervalMs);
      // Initial poll
      await pollAndEnqueue();

      logger.info('Task runner started', {
        component: 'task-runner',
        pollIntervalMs,
        queueName: QUEUE_NAME,
      });
    },

    async stop(): Promise<void> {
      if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
      }

      if (worker) {
        await worker.close();
        worker = null;
      }

      if (queue) {
        await queue.close();
        queue = null;
      }

      logger.info('Task runner stopped', { component: 'task-runner' });
    },
  };
}
```

---
## src/scheduling/task-executor.ts
```typescript
/**
 * TaskExecutor — bridges scheduled tasks to the agent execution loop.
 *
 * Reuses `prepareChatRun` from chat-setup so the same prompt-layer
 * resolution, tool formatting, and cost guard wiring that powers the
 * REST/WebSocket endpoints also drives scheduled task execution.
 *
 * Returns a callback suitable for `TaskRunnerOptions.onExecuteTask`.
 */
import { createAgentRunner } from '@/core/agent-runner.js';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { ExecutionTraceRepository } from '@/infrastructure/repositories/execution-trace-repository.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { PrismaClient } from '@prisma/client';
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { SkillService } from '@/skills/skill-service.js';
import type { Logger } from '@/observability/logger.js';
import {
  prepareChatRun,
  extractAssistantResponse,
} from '@/api/routes/chat-setup.js';
import type { ScheduledTask } from './types.js';
import type { TaskExecutionResult } from './task-runner.js';

// ─── Options ────────────────────────────────────────────────────

/** Dependencies required to create a task executor. */
export interface TaskExecutorOptions {
  projectRepository: ProjectRepository;
  sessionRepository: SessionRepository;
  promptLayerRepository: PromptLayerRepository;
  executionTraceRepository: ExecutionTraceRepository;
  toolRegistry: ToolRegistry;
  mcpManager: MCPManager;
  skillService: SkillService;
  prisma: PrismaClient;
  logger: Logger;
}

// ─── Factory ────────────────────────────────────────────────────

/**
 * Create a task execution callback for the TaskRunner.
 *
 * The returned function resolves the task's project, builds the
 * system prompt from active prompt layers, creates an agent runner,
 * and executes the task payload as a one-shot agent run.
 */
export function createTaskExecutor(
  options: TaskExecutorOptions,
): (task: ScheduledTask) => Promise<TaskExecutionResult> {
  const {
    projectRepository,
    sessionRepository,
    promptLayerRepository,
    executionTraceRepository,
    toolRegistry,
    mcpManager,
    skillService,
    prisma,
    logger,
  } = options;

  const chatSetupDeps = {
    projectRepository,
    sessionRepository,
    promptLayerRepository,
    toolRegistry,
    mcpManager,
    skillService,
    longTermMemoryStore: null,
    prisma,
    logger,
  };

  return async (task: ScheduledTask): Promise<TaskExecutionResult> => {
    logger.info('Starting scheduled task execution', {
      component: 'task-executor',
      taskId: task.id,
      taskName: task.name,
      projectId: task.projectId,
    });

    // 1. Prepare the agent run via shared chat setup
    const setupResult = await prepareChatRun(
      {
        projectId: task.projectId,
        message: task.taskPayload.message,
        metadata: task.taskPayload.metadata,
      },
      chatSetupDeps,
    );

    if (!setupResult.ok) {
      logger.error('Task setup failed', {
        component: 'task-executor',
        taskId: task.id,
        error: setupResult.error.message,
        code: setupResult.error.code,
      });
      return {
        success: false,
        errorMessage: `Setup failed: ${setupResult.error.message}`,
      };
    }

    const setup = setupResult.value;

    // 2. Create agent runner
    const agentRunner = createAgentRunner({
      provider: setup.provider,
      fallbackProvider: setup.fallbackProvider,
      toolRegistry,
      memoryManager: setup.memoryManager,
      costGuard: setup.costGuard,
      logger,
    });

    // 3. Execute the agent run with abort signal based on task timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => { abortController.abort(); },
      task.timeoutMs,
    );

    try {
      const result = await agentRunner.run({
        message: setup.sanitizedMessage,
        agentConfig: setup.agentConfig,
        sessionId: setup.sessionId,
        systemPrompt: setup.systemPrompt,
        promptSnapshot: setup.promptSnapshot,
        conversationHistory: setup.conversationHistory,
        abortSignal: abortController.signal,
      });

      if (!result.ok) {
        logger.error('Task agent run failed', {
          component: 'task-executor',
          taskId: task.id,
          error: result.error.message,
          code: result.error.code,
        });
        return {
          success: false,
          errorMessage: result.error.message,
        };
      }

      const trace = result.value;

      // 4. Persist execution trace
      await executionTraceRepository.save(trace);

      // 5. Persist messages to the session
      await sessionRepository.addMessage(
        setup.sessionId,
        { role: 'user', content: setup.sanitizedMessage },
        trace.id,
      );

      const assistantText = extractAssistantResponse(trace.events);

      await sessionRepository.addMessage(
        setup.sessionId,
        { role: 'assistant', content: assistantText },
        trace.id,
      );

      logger.info('Task execution completed', {
        component: 'task-executor',
        taskId: task.id,
        traceId: trace.id,
        status: trace.status,
        tokensUsed: trace.totalTokensUsed,
        costUSD: trace.totalCostUSD.toFixed(4),
      });

      return {
        success: trace.status === 'completed',
        traceId: trace.id,
        tokensUsed: trace.totalTokensUsed,
        costUsd: trace.totalCostUSD,
        result: {
          response: assistantText,
          sessionId: setup.sessionId,
          status: trace.status,
          turnCount: trace.turnCount,
        },
        errorMessage: trace.status !== 'completed'
          ? `Agent run ended with status: ${trace.status}`
          : undefined,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
```

---
## src/scheduling/index.ts
```typescript
// Scheduling module — scheduled task types, manager, and runner
export type {
  ScheduledTaskOrigin,
  ScheduledTaskStatus,
  ScheduledTaskRunStatus,
  TaskPayload,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskCreateInput,
  ScheduledTaskRunCreateInput,
} from './types.js';

export { createTaskManager } from './task-manager.js';
export type { TaskManager, TaskManagerOptions } from './task-manager.js';

export { createTaskRunner } from './task-runner.js';
export type { TaskRunner, TaskRunnerOptions, TaskExecutionResult } from './task-runner.js';

export { createTaskExecutor } from './task-executor.js';
export type { TaskExecutorOptions } from './task-executor.js';
```

