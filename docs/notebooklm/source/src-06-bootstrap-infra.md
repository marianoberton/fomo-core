# Nexus Core — Source: Bootstrap + Config + Infrastructure + Utilities

Complete source code for main.ts, seed, config, infrastructure repositories, secrets, knowledge, files, contacts, webhooks, observability, verticals, templates.

---
## src/main.ts
```typescript
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocketPlugin from '@fastify/websocket';
import { createLogger } from '@/observability/logger.js';
import { createDatabase } from '@/infrastructure/database.js';
import {
  createProjectRepository,
  createSessionRepository,
  createPromptLayerRepository,
  createExecutionTraceRepository,
  createScheduledTaskRepository,
  createContactRepository,
  createWebhookRepository,
  createFileRepository,
  createAgentRepository,
} from '@/infrastructure/repositories/index.js';
import { createSecretRepository } from '@/infrastructure/repositories/secret-repository.js';
import { createSecretService } from '@/secrets/secret-service.js';
import { createKnowledgeService } from '@/knowledge/knowledge-service.js';
import type { KnowledgeService } from '@/knowledge/types.js';
import { createApprovalGate } from '@/security/approval-gate.js';
import { createPrismaApprovalStore } from '@/security/prisma-approval-store.js';
import { createToolRegistry } from '@/tools/registry/tool-registry.js';
import {
  createCalculatorTool,
  createDateTimeTool,
  createJsonTransformTool,
  createKnowledgeSearchTool,
  createHttpRequestTool,
  createSendNotificationTool,
  createProposeScheduledTaskTool,
  createWebSearchTool,
  createSendEmailTool,
  createSendChannelMessageTool,
  createReadFileTool,
  createQuerySessionsTool,
  createReadSessionHistoryTool,
  createCatalogSearchTool,
  createCatalogOrderTool,
  createVehicleLeadScoreTool,
  createVehicleCheckFollowupTool,
  createWholesaleUpdateStockTool,
  createWholesaleOrderHistoryTool,
  createHotelDetectLanguageTool,
  createHotelSeasonalPricingTool,
  createEscalateToHumanTool,
  createDelegateToAgentTool,
  createListProjectAgentsTool,
  createStoreMemoryTool,
  createGetOperationsSummaryTool,
  createGetAgentPerformanceTool,
  createReviewAgentActivityTool,
  createScrapeWebpageTool,
} from '@/tools/definitions/index.js';
import { resolveEmbeddingProvider } from '@/providers/embeddings.js';
import { createPrismaMemoryStore } from '@/memory/prisma-memory-store.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import { createTaskManager } from '@/scheduling/task-manager.js';
import { createTaskRunner } from '@/scheduling/task-runner.js';
import { createTaskExecutor } from '@/scheduling/task-executor.js';
import { createMCPManager } from '@/mcp/mcp-manager.js';
import { Queue } from 'bullmq';
import { createProactiveMessenger, PROACTIVE_MESSAGE_QUEUE } from '@/channels/proactive.js';
import type { ProactiveMessenger, ProactiveMessageJobData } from '@/channels/proactive.js';
import { createInboundProcessor } from '@/channels/inbound-processor.js';
import { createWebhookProcessor } from '@/webhooks/webhook-processor.js';
import { createFileService } from '@/files/file-service.js';
import { createLocalStorage } from '@/files/storage-local.js';
import { createAgentRegistry } from '@/agents/agent-registry.js';
import { createAgentComms } from '@/agents/agent-comms.js';
import type { ContactId } from '@/contacts/types.js';
import { createAgentChannelRouter } from '@/channels/agent-channel-router.js';
import { createChannelIntegrationRepository } from '@/infrastructure/repositories/channel-integration-repository.js';
import { createChannelResolver } from '@/channels/channel-resolver.js';
import { createMCPServerRepository } from '@/infrastructure/repositories/mcp-server-repository.js';
import { createSkillRepository } from '@/skills/skill-repository.js';
import { createSkillService } from '@/skills/skill-service.js';
import { createHandoffManager, DEFAULT_HANDOFF_CONFIG } from '@/channels/handoff.js';
import { registerErrorHandler } from '@/api/error-handler.js';
import { registerRoutes } from '@/api/routes/index.js';
import { chatwootWebhookRoutes } from '@/api/routes/chatwoot-webhook.js';
import { channelWebhookRoutes } from '@/api/routes/channel-webhooks.js';
import { createWebhookQueue } from '@/channels/webhook-queue.js';
import type { WebhookQueue } from '@/channels/webhook-queue.js';
import { onboardingRoutes } from '@/api/routes/onboarding.js';
import { telegramApprovalWebhookRoutes } from '@/api/routes/telegram-webhook.js';
import { createTelegramApprovalNotifier } from '@/hitl/telegram-approval-notifier.js';
import { createSessionBroadcaster } from '@/hitl/session-broadcaster.js';
import type { RouteDependencies } from '@/api/types.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import {
  prepareChatRun,
  extractAssistantResponse,
} from '@/api/routes/chat-setup.js';
import type { ProjectId } from '@/core/types.js';

const logger = createLogger();

const server = Fastify({
  logger: false,
});

server.get('/health', () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

async function start(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '0.0.0.0';

  try {
    // Initialize database
    const db = createDatabase({
      logQueries: process.env['NODE_ENV'] === 'development',
    });
    await db.connect();

    const prisma = db.client;

    // Create repositories
    const projectRepository = createProjectRepository(prisma);
    const sessionRepository = createSessionRepository(prisma);
    const promptLayerRepository = createPromptLayerRepository(prisma);
    const executionTraceRepository = createExecutionTraceRepository(prisma);
    const scheduledTaskRepository = createScheduledTaskRepository(prisma);
    const contactRepository = createContactRepository(prisma);
    const webhookRepository = createWebhookRepository(prisma);
    const fileRepository = createFileRepository(prisma);
    const agentRepository = createAgentRepository(prisma);
    const channelIntegrationRepository = createChannelIntegrationRepository(prisma);
    const secretRepository = createSecretRepository(prisma);
    const mcpServerRepository = createMCPServerRepository(prisma);
    const skillRepository = createSkillRepository(prisma);
    const skillService = createSkillService({ repository: skillRepository });

    // Encrypted secrets service (AES-256-GCM) — requires SECRETS_ENCRYPTION_KEY env var
    const secretService = createSecretService({ secretRepository });

    // Channel resolver — per-project adapter resolution from DB + secrets
    const channelResolver = createChannelResolver({
      integrationRepository: channelIntegrationRepository,
      secretService,
      logger,
    });

    // Telegram HITL — shared maps for approval tracking
    const telegramMessageApprovalMap = new Map<string, string>();
    const telegramInstructionWaitMap = new Map<string, string>();

    // Session broadcaster — bridges external approval contexts (Telegram) with dashboard WS
    const sessionBroadcaster = createSessionBroadcaster();

    // Telegram HITL notifier — resolves per-project credentials from SecretService
    const telegramNotifier = createTelegramApprovalNotifier({
      secretService,
      sessionRepository,
      logger,
      messageApprovalMap: telegramMessageApprovalMap,
    });

    // Create shared services
    const approvalGate = createApprovalGate({
      store: createPrismaApprovalStore(prisma),
      notifier: telegramNotifier,
      expirationMs: 30 * 60 * 1000, // 30 minutes — realistic for human review
    });
    const toolRegistry = createToolRegistry({
      approvalGate: async (toolId, input, context) => {
        const request = await approvalGate.requestApproval({
          projectId: context.projectId,
          sessionId: context.sessionId,
          toolCallId: `tc_${Date.now()}` as import('@/core/types.js').ToolCallId,
          toolId,
          toolInput: input,
          riskLevel: 'high',
        });
        // Return approved: false to trigger HITL flow — agent pauses until human decides
        return { approved: false, approvalId: request.id };
      },
    });
    toolRegistry.register(createCalculatorTool());
    toolRegistry.register(createDateTimeTool());
    toolRegistry.register(createJsonTransformTool());
    toolRegistry.register(createHttpRequestTool());
    toolRegistry.register(createScrapeWebpageTool());
    toolRegistry.register(createSendNotificationTool());
    toolRegistry.register(createWebSearchTool({ secretService }));
    toolRegistry.register(createSendEmailTool({ secretService }));
    toolRegistry.register(createSendChannelMessageTool({ channelResolver }));
    const taskManager = createTaskManager({ repository: scheduledTaskRepository });
    toolRegistry.register(createProposeScheduledTaskTool({ taskManager }));
    const mcpManager = createMCPManager();

    // Long-term memory (pgvector embeddings) — enabled when OPENAI_API_KEY is set
    let longTermMemoryStore: LongTermMemoryStore | null = null;
    let knowledgeService: KnowledgeService | null = null;
    const embeddingGenerator = resolveEmbeddingProvider('openai');
    if (embeddingGenerator) {
      longTermMemoryStore = createPrismaMemoryStore(prisma, embeddingGenerator);
      toolRegistry.register(createKnowledgeSearchTool({ store: longTermMemoryStore }));
      toolRegistry.register(createStoreMemoryTool({ store: longTermMemoryStore }));
      knowledgeService = createKnowledgeService({ prisma, generateEmbedding: embeddingGenerator });
      logger.info('Long-term memory enabled (pgvector + OpenAI embeddings)', { component: 'main' });
    } else {
      // Knowledge service still available for list/delete (no embedding generation)
      knowledgeService = createKnowledgeService({ prisma });
      logger.info('Long-term memory disabled (no embedding API key)', { component: 'main' });
    }

    // Shared deps for prepareChatRun (same subset used by chat routes and task-executor)
    // agentRegistry is injected below after creation (search: "chatSetupDeps.agentRegistry")
    const chatSetupDeps = {
      projectRepository,
      sessionRepository,
      promptLayerRepository,
      toolRegistry,
      mcpManager,
      longTermMemoryStore,
      skillService,
      prisma,
      logger,
      agentRegistry: undefined as RouteDependencies['agentRegistry'] | undefined,
    };

    // Real runAgent — runs the full agent loop for inbound channels and webhooks
    const runAgent = async (params: {
      projectId: ProjectId;
      sessionId: string;
      agentId?: string;
      sourceChannel?: string;
      contactRole?: string;
      userMessage: string;
    }): Promise<{ response: string }> => {
      const setupResult = await prepareChatRun(
        {
          projectId: params.projectId,
          sessionId: params.sessionId,
          agentId: params.agentId,
          sourceChannel: params.sourceChannel,
          contactRole: params.contactRole,
          message: params.userMessage,
        },
        chatSetupDeps,
      );

      if (!setupResult.ok) {
        logger.error(`runAgent setup failed: [${setupResult.error.code}] ${setupResult.error.message}`, {
          component: 'main',
          projectId: params.projectId,
          sessionId: params.sessionId,
        });
        return { response: `Setup error: ${setupResult.error.message}` };
      }

      const setup = setupResult.value;

      const agentRunner = createAgentRunner({
        provider: setup.provider,
        fallbackProvider: setup.fallbackProvider,
        toolRegistry,
        memoryManager: setup.memoryManager,
        costGuard: setup.costGuard,
        logger,
      });

      const abortController = new AbortController();
      const timeoutMs = 60_000;
      const timeoutId = setTimeout(() => { abortController.abort(); }, timeoutMs);

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
          logger.error('runAgent execution failed', {
            component: 'main',
            projectId: params.projectId,
            sessionId: params.sessionId,
            error: result.error.message,
            code: result.error.code,
          });
          return { response: `Agent error: ${result.error.message}` };
        }

        const trace = result.value;

        // Persist execution trace
        await executionTraceRepository.save(trace);

        // Persist messages to session
        await sessionRepository.addMessage(
          setup.sessionId,
          { role: 'user', content: setup.sanitizedMessage },
          trace.id,
        );

        let assistantText = extractAssistantResponse(trace.events);

        // When escalation is pending and the LLM didn't include text, send a
        // user-friendly holding message instead of an empty response.
        if (!assistantText && trace.status === 'human_approval_pending') {
          assistantText = 'Tu consulta fue derivada a un responsable. Te responderemos a la brevedad.';
        }

        await sessionRepository.addMessage(
          setup.sessionId,
          { role: 'assistant', content: assistantText },
          trace.id,
        );

        logger.info('runAgent completed', {
          component: 'main',
          projectId: params.projectId,
          sessionId: params.sessionId,
          traceId: trace.id,
          tokensUsed: trace.totalTokensUsed,
          status: trace.status,
        });

        return { response: assistantText };
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Auto-resume after human approval — runs the agent to continue the conversation
    const resumeAfterApproval = async (params: {
      approvalId: string;
      decision: 'approved' | 'denied';
      resolvedBy: string;
      note?: string;
    }): Promise<void> => {
      const approval = await approvalGate.get(params.approvalId as import('@/core/types.js').ApprovalId);
      if (!approval) {
        logger.warn('resumeAfterApproval: approval not found', { component: 'main', approvalId: params.approvalId });
        return;
      }

      const session = await sessionRepository.findById(approval.sessionId);
      if (!session) {
        logger.warn('resumeAfterApproval: session not found', { component: 'main', sessionId: approval.sessionId });
        return;
      }

      // Build a synthetic message that the LLM will interpret as manager instructions.
      // IMPORTANT: The agent must NOT call send-channel-message or any channel tool —
      // delivery is handled automatically by resumeAfterApproval via proactiveMessenger.
      const deliveryNote = `IMPORTANTE: Respondé SOLO con texto. NO uses herramientas de envío (send-channel-message, send-email, etc). El mensaje se entrega automáticamente al cliente.`;

      let syntheticMessage: string;
      if (params.decision === 'denied') {
        // Owner rejected — agent should ask customer how to continue
        syntheticMessage = [
          `[DECISIÓN DEL GERENTE]`,
          `Decisión: RECHAZADA`,
          params.note ? `Motivo: ${params.note}` : '',
          ``,
          `El gerente decidió no proceder con esta solicitud.`,
          `Informá al cliente de manera amable y profesional, y preguntale cómo quiere seguir.`,
          `Ofrecele alternativas razonables basadas en la conversación.`,
          ``,
          deliveryNote,
        ].filter(Boolean).join('\n');
      } else if (params.note) {
        // Owner replied with specific instructions
        syntheticMessage = [
          `[INSTRUCCIONES DEL GERENTE]`,
          `Instrucciones: ${params.note}`,
          ``,
          `Responde al cliente siguiendo estas instrucciones al pie de la letra.`,
          ``,
          deliveryNote,
        ].join('\n');
      } else {
        // Approved without instructions (fallback — shouldn't happen with new UX)
        syntheticMessage = `[Respuesta del gerente: APROBADO] Informa al cliente que su solicitud fue aprobada. ${deliveryNote}`;
      }

      const agentId = session.metadata?.['agentId'] as string | undefined;
      const result = await runAgent({
        projectId: session.projectId,
        sessionId: approval.sessionId,
        agentId,
        userMessage: syntheticMessage,
      });

      logger.info('resumeAfterApproval completed', {
        component: 'main',
        approvalId: params.approvalId,
        decision: params.decision,
        responsePreview: result.response.slice(0, 100),
      });

      // Broadcast to connected dashboard WebSocket clients watching this session
      sessionBroadcaster.broadcast(approval.sessionId, {
        type: 'approval.resolved',
        approvalId: params.approvalId,
        decision: params.decision,
        resolvedBy: params.resolvedBy,
      });
      sessionBroadcaster.broadcast(approval.sessionId, {
        type: 'message.new',
        role: 'assistant',
        content: result.response,
      });

      // Proactively send the agent's response if the session came from a channel
      const channelType = session.metadata?.['channel'] as string | undefined;
      const recipientIdentifier = session.metadata?.['recipientIdentifier'] as string | undefined;

      if (channelType && recipientIdentifier && proactiveMessenger && result.response) {
        const contactId = (session.metadata?.['contactId'] as ContactId | undefined)
          ?? ('system' as unknown as ContactId);
        await proactiveMessenger.send({
          projectId: session.projectId,
          contactId,
          channel: channelType as import('@/channels/types.js').ChannelType,
          recipientIdentifier,
          content: result.response,
        });
      }
    };

    // Agent-channel router — resolves which agent handles a channel message
    const agentChannelRouter = createAgentChannelRouter({ agentRepository, logger });

    const inboundProcessor = createInboundProcessor({
      channelResolver,
      contactRepository,
      sessionRepository,
      logger,
      agentChannelRouter,
      runAgent,
    });

    // Webhook system
    const webhookProcessor = createWebhookProcessor({
      webhookRepository,
      sessionRepository,
      logger,
      runAgent,
    });

    // File system
    const fileStoragePath = process.env['FILE_STORAGE_PATH'] ?? './data/files';
    const fileStorage = createLocalStorage({ basePath: fileStoragePath });
    const fileService = createFileService({
      storage: fileStorage,
      repository: fileRepository,
      logger,
    });
    toolRegistry.register(createReadFileTool({ fileService }));

    // Shared memory tools (for internal mode — query customer conversations)
    toolRegistry.register(createQuerySessionsTool({ prisma }));
    toolRegistry.register(createReadSessionHistoryTool({ sessionRepository }));

    // Catalog tools — vertical-specific tools for product search and ordering
    toolRegistry.register(createCatalogSearchTool());
    toolRegistry.register(createCatalogOrderTool());

    // Vertical tools — industry-specific capabilities
    toolRegistry.register(createVehicleLeadScoreTool());
    toolRegistry.register(createVehicleCheckFollowupTool());
    toolRegistry.register(createWholesaleUpdateStockTool());
    toolRegistry.register(createWholesaleOrderHistoryTool());
    toolRegistry.register(createHotelDetectLanguageTool());
    toolRegistry.register(createHotelSeasonalPricingTool());

    // Multi-agent system
    const agentRegistry = createAgentRegistry({ agentRepository, logger });
    const agentComms = createAgentComms({ logger });

    // Inject agentRegistry into chatSetupDeps (deferred — created after chatSetupDeps)
    chatSetupDeps.agentRegistry = agentRegistry;

    toolRegistry.register(createEscalateToHumanTool());

    // runSubAgent — runs a subagent's full loop and returns its response.
    // Used by the delegate-to-agent tool to execute tasks on behalf of the manager.
    const runSubAgent = async (params: {
      projectId: string;
      agentName: string;
      task: string;
      context?: string;
      timeoutMs?: number;
    }): Promise<{ response: string }> => {
      // Look up the subagent by name
      const subAgent = await agentRegistry.getByName(params.projectId, params.agentName);
      if (!subAgent) {
        throw new Error(`Agent "${params.agentName}" not found in project "${params.projectId}"`);
      }

      // Create a fresh session for this delegation (tracked separately in DB)
      const delegationSession = await sessionRepository.create({
        projectId: params.projectId as ProjectId,
        metadata: { isDelegated: true, parentTask: params.task.slice(0, 200) },
      });

      const task = params.context
        ? `${params.task}\n\nAdditional context: ${params.context}`
        : params.task;

      return runAgent({
        projectId: params.projectId as ProjectId,
        sessionId: delegationSession.id,
        agentId: subAgent.id,
        userMessage: task,
      });
    };

    toolRegistry.register(createDelegateToAgentTool({ agentRegistry, runSubAgent }));
    toolRegistry.register(createListProjectAgentsTool({ agentRegistry }));

    // Manager monitoring tools
    toolRegistry.register(createGetOperationsSummaryTool({ prisma }));
    toolRegistry.register(createGetAgentPerformanceTool({ prisma, agentRegistry }));
    toolRegistry.register(createReviewAgentActivityTool({ prisma, agentRegistry }));

    // Handoff manager (Chatwoot human escalation)
    const handoffManager = createHandoffManager({
      config: DEFAULT_HANDOFF_CONFIG,
      logger,
    });
    logger.info('Channel system initialized (dynamic per-project integrations)', { component: 'main' });

    // Register Fastify plugins
    const corsOrigin = process.env['CORS_ORIGIN'];
    await server.register(cors, {
      origin: corsOrigin ? corsOrigin.split(',') : true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    await server.register(helmet);
    await server.register(rateLimit, { max: 100, timeWindow: '1 minute' });
    await server.register(websocketPlugin);

    // Register global error handler
    registerErrorHandler(server);

    // Conditionally start Redis-dependent services (task runner + proactive messaging + webhook queue)
    let taskRunner: ReturnType<typeof createTaskRunner> | null = null;
    let proactiveMessenger: ProactiveMessenger | null = null;
    let webhookQueue: WebhookQueue | null = null;
    const redisUrl = process.env['REDIS_URL'];
    if (redisUrl) {
      const parsedRedis = new URL(redisUrl);
      const redisConnection = {
        host: parsedRedis.hostname,
        port: parsedRedis.port ? Number(parsedRedis.port) : 6379,
        password: parsedRedis.password || undefined,
      };

      const onExecuteTask = createTaskExecutor({
        projectRepository,
        sessionRepository,
        promptLayerRepository,
        executionTraceRepository,
        toolRegistry,
        mcpManager,
        skillService,
        prisma,
        logger,
      });

      taskRunner = createTaskRunner({
        repository: scheduledTaskRepository,
        logger,
        redisUrl,
        onExecuteTask,
      });
      await taskRunner.start();
      logger.info('Task runner started (Redis connected)', { component: 'main' });

      // Proactive messaging (scheduled outbound messages via BullMQ)
      const proactiveQueue = new Queue<ProactiveMessageJobData>(PROACTIVE_MESSAGE_QUEUE, { connection: redisConnection });
      proactiveMessenger = createProactiveMessenger({
        channelResolver,
        queue: proactiveQueue,
        logger,
      });
      logger.info('Proactive messenger enabled (Redis connected)', { component: 'main' });

      // Webhook queue (async webhook processing with retry)
      webhookQueue = createWebhookQueue({
        logger,
        redisUrl,
        resolveAdapter: async (projectId) => {
          const adapter = await channelResolver.resolveAdapter(projectId as ProjectId, 'chatwoot');
          if (!adapter) return null;
          // Chatwoot adapter has extended methods (handoffToHuman, resumeBot)
          return adapter as unknown as import('@/channels/adapters/chatwoot.js').ChatwootAdapter;
        },
        inboundProcessor,
        handoffManager,
        runAgent: async (params) => await runAgent({ ...params, projectId: params.projectId as ProjectId }),
      });
      await webhookQueue.start();
      logger.info('Webhook queue started (Redis connected)', { component: 'main' });
    }

    // Assemble route dependencies
    const deps: RouteDependencies = {
      projectRepository,
      sessionRepository,
      promptLayerRepository,
      executionTraceRepository,
      scheduledTaskRepository,
      contactRepository,
      webhookRepository,
      fileRepository,
      agentRepository,
      approvalGate,
      toolRegistry,
      taskManager,
      mcpManager,
      inboundProcessor,
      webhookProcessor,
      fileService,
      agentRegistry,
      agentComms,
      proactiveMessenger,
      longTermMemoryStore,
      secretService,
      knowledgeService,
      channelResolver,
      channelIntegrationRepository,
      mcpServerRepository,
      skillService,
      prisma,
      sessionBroadcaster,
      resumeAfterApproval,
      logger,
    };

    // Register API routes under /api/v1 prefix
    await server.register(
      async (prefixed) => {
        await prefixed.register(registerRoutes, deps);

        // Chatwoot webhook routes (separate from generic routes — needs extra deps)
        chatwootWebhookRoutes(prefixed, {
          ...deps,
          channelResolver,
          handoffManager,
          webhookQueue: webhookQueue ?? undefined, // Pass queue if Redis is available
          runAgent,
        });

        // Dynamic channel webhook routes (Telegram, WhatsApp, Slack)
        channelWebhookRoutes(prefixed, deps);

        // Telegram HITL approval webhook (credentials resolved per-project from secrets)
        telegramApprovalWebhookRoutes(prefixed, {
          approvalGate,
          secretService,
          messageApprovalMap: telegramMessageApprovalMap,
          instructionWaitMap: telegramInstructionWaitMap,
          onResolved: resumeAfterApproval,
        });
        logger.info('Telegram HITL approval webhook registered at POST /api/v1/webhooks/telegram-approval', { component: 'main' });

        // Onboarding routes
        onboardingRoutes(prefixed, {
          ...deps,
          channelIntegrationRepository,
        });
      },
      { prefix: '/api/v1' },
    );

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down...', { component: 'main' });
      await mcpManager.disconnectAll();
      if (taskRunner) {
        await taskRunner.stop();
      }
      if (webhookQueue) {
        await webhookQueue.stop();
      }
      await server.close();
      await db.disconnect();
    };

    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());

    await server.listen({ port, host });
    logger.info(`Server listening on ${host}:${port}`, { component: 'main' });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('STARTUP ERROR:', err);
    logger.fatal('Failed to start server', {
      component: 'main',
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

void start();
```

---
## src/config/types.ts
```typescript
import type { AgentConfig } from '@/core/types.js';

// ─── Project Configuration ──────────────────────────────────────

/**
 * Full project configuration as stored in the database.
 * The `agentConfig` field maps directly to AgentConfig.
 */
export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  environment: 'production' | 'staging' | 'development';
  owner: string;
  tags: string[];
  agentConfig: AgentConfig;
  status: 'active' | 'paused' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}
```

---
## src/config/schema.ts
```typescript
/**
 * Zod schemas for validating project configuration files.
 * These schemas mirror the TypeScript interfaces in core/types.ts
 * and config/types.ts, providing runtime validation.
 */
import { z } from 'zod';

// ─── LLM Provider Config ────────────────────────────────────────

/**
 * Schema for LLM provider configuration.
 * Validates provider type, model, and optional settings.
 */
export const llmProviderConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama']),
  model: z.string().min(1, 'Model identifier cannot be empty'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  baseUrl: z.string().url('Invalid base URL format').optional(),
});

// ─── Failover Config ────────────────────────────────────────────

/**
 * Schema for failover behavior configuration.
 * Controls when and how the system switches to fallback providers.
 */
export const failoverConfigSchema = z.object({
  onRateLimit: z.boolean(),
  onServerError: z.boolean(),
  onTimeout: z.boolean(),
  timeoutMs: z.number().int().positive('Timeout must be a positive integer'),
  maxRetries: z.number().int().min(0).max(10, 'Max retries cannot exceed 10'),
});

// ─── Memory Config ──────────────────────────────────────────────

/**
 * Schema for memory configuration including long-term storage
 * and context window management.
 */
export const memoryConfigSchema = z.object({
  longTerm: z.object({
    enabled: z.boolean(),
    maxEntries: z.number().int().positive('Max entries must be a positive integer'),
    retrievalTopK: z.number().int().positive('Retrieval top-k must be a positive integer'),
    embeddingProvider: z.string().min(1, 'Embedding provider cannot be empty'),
    decayEnabled: z.boolean(),
    decayHalfLifeDays: z.number().positive('Decay half-life must be positive'),
  }),
  contextWindow: z.object({
    reserveTokens: z.number().int().positive('Reserve tokens must be a positive integer'),
    pruningStrategy: z.enum(['turn-based', 'token-based']),
    maxTurnsInContext: z.number().int().positive('Max turns in context must be a positive integer'),
    compaction: z.object({
      enabled: z.boolean(),
      memoryFlushBeforeCompaction: z.boolean(),
    }),
  }),
});

// ─── Cost Config ────────────────────────────────────────────────

/**
 * Schema for cost and rate limiting configuration.
 * Enforces budget limits and request throttling.
 */
export const costConfigSchema = z.object({
  dailyBudgetUSD: z.number().positive('Daily budget must be positive'),
  monthlyBudgetUSD: z.number().positive('Monthly budget must be positive'),
  maxTokensPerTurn: z.number().int().positive('Max tokens per turn must be a positive integer'),
  maxTurnsPerSession: z.number().int().positive('Max turns per session must be a positive integer'),
  maxToolCallsPerTurn: z.number().int().positive('Max tool calls per turn must be a positive integer'),
  alertThresholdPercent: z.number().min(0).max(100, 'Alert threshold must be between 0 and 100'),
  hardLimitPercent: z.number().min(0).max(200, 'Hard limit must be between 0 and 200'),
  maxRequestsPerMinute: z.number().int().positive('Max requests per minute must be a positive integer'),
  maxRequestsPerHour: z.number().int().positive('Max requests per hour must be a positive integer'),
});

// ─── MCP Server Config ─────────────────────────────────────────

/**
 * Schema for a single MCP server connection configuration.
 * Validates transport-specific required fields via refinement.
 */
export const mcpServerConfigSchema = z
  .object({
    name: z.string().min(1, 'MCP server name cannot be empty'),
    transport: z.enum(['stdio', 'sse']),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url('Invalid MCP server URL').optional(),
    toolPrefix: z.string().min(1).optional(),
  })
  .refine(
    (data) => data.transport !== 'stdio' || data.command !== undefined,
    { message: 'stdio transport requires a "command" field', path: ['command'] },
  )
  .refine(
    (data) => data.transport !== 'sse' || data.url !== undefined,
    { message: 'sse transport requires a "url" field', path: ['url'] },
  );

// ─── Agent Config ───────────────────────────────────────────────

/**
 * Schema for agent configuration.
 * Includes provider settings, failover, memory, and cost controls.
 */
export const agentConfigSchema = z.object({
  projectId: z.string().min(1, 'Project ID cannot be empty'),
  agentRole: z.string().min(1, 'Agent role cannot be empty'),
  provider: llmProviderConfigSchema,
  fallbackProvider: llmProviderConfigSchema.optional(),
  failover: failoverConfigSchema,
  allowedTools: z.array(z.string().min(1, 'Tool ID cannot be empty')),
  mcpServers: z.array(mcpServerConfigSchema).optional(),
  memoryConfig: memoryConfigSchema,
  costConfig: costConfigSchema,
  maxTurnsPerSession: z.number().int().positive('Max turns per session must be a positive integer'),
  maxConcurrentSessions: z.number().int().positive('Max concurrent sessions must be a positive integer'),
});

// ─── Project Config File ────────────────────────────────────────

/**
 * Schema for project configuration files (JSON).
 * Note: `status`, `createdAt`, and `updatedAt` are added by the system,
 * not included in the config file.
 */
export const projectConfigFileSchema = z
  .object({
    id: z.string().min(1, 'Project ID cannot be empty'),
    name: z.string().min(1, 'Project name cannot be empty').max(100, 'Project name cannot exceed 100 characters'),
    description: z.string().max(500, 'Description cannot exceed 500 characters').optional(),
    environment: z.enum(['production', 'staging', 'development']),
    owner: z.string().min(1, 'Owner cannot be empty'),
    tags: z.array(z.string()),
    agentConfig: agentConfigSchema,
  })
  .refine((data) => data.id === data.agentConfig.projectId, {
    message: 'Project ID must match agentConfig.projectId',
    path: ['agentConfig', 'projectId'],
  });

// ─── Inferred Types ─────────────────────────────────────────────

/** Inferred type from llmProviderConfigSchema */
export type LLMProviderConfigInput = z.infer<typeof llmProviderConfigSchema>;

/** Inferred type from failoverConfigSchema */
export type FailoverConfigInput = z.infer<typeof failoverConfigSchema>;

/** Inferred type from memoryConfigSchema */
export type MemoryConfigInput = z.infer<typeof memoryConfigSchema>;

/** Inferred type from costConfigSchema */
export type CostConfigInput = z.infer<typeof costConfigSchema>;

/** Inferred type from mcpServerConfigSchema */
export type MCPServerConfigInput = z.infer<typeof mcpServerConfigSchema>;

/** Inferred type from agentConfigSchema */
export type AgentConfigInput = z.infer<typeof agentConfigSchema>;

/** Inferred type from projectConfigFileSchema (before refinement) */
export type ProjectConfigFileInput = z.infer<typeof projectConfigFileSchema>;
```

---
## src/config/loader.ts
```typescript
/**
 * Configuration loader — reads JSON config files, validates with Zod,
 * and resolves environment variable placeholders.
 */
import { readFile } from 'node:fs/promises';

import type { z } from 'zod';

import { NexusError } from '@/core/errors.js';
import type { Result } from '@/core/result.js';
import { err, ok } from '@/core/result.js';

import { projectConfigFileSchema } from './schema.js';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Project configuration as loaded from a JSON file.
 * Does not include system-managed fields (status, createdAt, updatedAt).
 */
export type ProjectConfigFile = z.infer<typeof projectConfigFileSchema>;

// ─── Errors ─────────────────────────────────────────────────────

/**
 * Error thrown when configuration loading or validation fails.
 */
export class ConfigError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: 'CONFIG_ERROR',
      statusCode: 400,
      context,
    });
    this.name = 'ConfigError';
  }
}

// ─── Environment Variable Resolution ────────────────────────────

const ENV_VAR_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

/**
 * Recursively resolves environment variable placeholders in an object.
 * Replaces strings matching the pattern `${VAR_NAME}` with the value
 * of the corresponding environment variable.
 *
 * @param obj - The object to process (can be any JSON-compatible value)
 * @returns The object with all environment variables resolved
 * @throws ConfigError if a referenced environment variable is not defined
 */
export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    const match = ENV_VAR_PATTERN.exec(obj);
    const varName = match?.[1];
    if (varName !== undefined) {
      const value = process.env[varName];
      if (value === undefined) {
        throw new ConfigError(`Environment variable "${varName}" is not defined`, {
          variableName: varName,
          pattern: obj,
        });
      }
      return value;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }

  // Numbers, booleans, null — return as-is
  return obj;
}

// ─── Configuration Loader ───────────────────────────────────────

/**
 * Loads and validates a project configuration file.
 *
 * 1. Reads the JSON file from disk
 * 2. Parses the JSON content
 * 3. Resolves environment variable placeholders
 * 4. Validates against the Zod schema
 *
 * @param filePath - Path to the JSON configuration file
 * @returns A Result containing either the validated config or a ConfigError
 */
export async function loadProjectConfig(
  filePath: string,
): Promise<Result<ProjectConfigFile, ConfigError>> {
  // 1. Read the file
  let fileContent: string;
  try {
    fileContent = await readFile(filePath, 'utf-8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return err(
        new ConfigError(`Configuration file not found: ${filePath}`, {
          filePath,
          errorCode: 'ENOENT',
        }),
      );
    }
    return err(
      new ConfigError(`Failed to read configuration file: ${filePath}`, {
        filePath,
        errorCode: nodeError.code,
        errorMessage: nodeError.message,
      }),
    );
  }

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return err(
      new ConfigError('Invalid JSON in configuration file', {
        filePath,
      }),
    );
  }

  // 3. Resolve environment variables
  let resolved: unknown;
  try {
    resolved = resolveEnvVars(parsed);
  } catch (error) {
    if (error instanceof ConfigError) {
      return err(error);
    }
    return err(
      new ConfigError('Failed to resolve environment variables', {
        filePath,
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  // 4. Validate with Zod
  const validation = projectConfigFileSchema.safeParse(resolved);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return err(
      new ConfigError('Configuration validation failed', {
        filePath,
        issues,
      }),
    );
  }

  return ok(validation.data);
}
```

---
## src/config/index.ts
```typescript
// ─── Types ──────────────────────────────────────────────────────
export type { ProjectConfig } from './types.js';
export type { ProjectConfigFile } from './loader.js';

// ─── Schemas ────────────────────────────────────────────────────
export {
  agentConfigSchema,
  costConfigSchema,
  failoverConfigSchema,
  llmProviderConfigSchema,
  memoryConfigSchema,
  projectConfigFileSchema,
} from './schema.js';

// ─── Loader ─────────────────────────────────────────────────────
export { ConfigError, loadProjectConfig, resolveEnvVars } from './loader.js';
```

---
## src/observability/logger.ts
```typescript
import pino from 'pino';
import type { LogContext } from './types.js';

/** Structured logger interface for Nexus Core. */
export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  fatal(msg: string, context?: LogContext): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Create a structured pino logger instance. */
export function createLogger(options?: { level?: string; name?: string }): Logger {
  const pinoInstance = pino({
    name: options?.name ?? 'nexus-core',
    level: options?.level ?? process.env['LOG_LEVEL'] ?? 'info',
    transport:
      process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: [
        'apiKey',
        'authorization',
        'password',
        'secret',
        '*.apiKey',
        '*.password',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  });

  return pinoInstance as unknown as Logger;
}
```

---
## src/observability/index.ts
```typescript
// ExecutionTrace + structured logging
export type {
  ExecutionStatus,
  ExecutionTrace,
  LogContext,
  LogLevel,
  TraceEvent,
  TraceEventType,
} from './types.js';

export type { Logger } from './logger.js';
export { createLogger } from './logger.js';
```

---
## src/infrastructure/database.ts
```typescript
/**
 * Prisma client singleton with connection lifecycle management.
 * Provides a centralized database client for all repositories and stores.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'database' });

/** Options for creating the Prisma client. */
export interface DatabaseOptions {
  /** Override DATABASE_URL from env. */
  url?: string;
  /** Log Prisma queries (recommended only in development). */
  logQueries?: boolean;
}

/** Wrapper around PrismaClient with lifecycle hooks. */
export interface Database {
  /** The raw PrismaClient instance. */
  client: PrismaClient;
  /** Establish the database connection. */
  connect(): Promise<void>;
  /** Gracefully close the database connection. */
  disconnect(): Promise<void>;
}

let instance: Database | undefined;

/**
 * Create a Database wrapper around PrismaClient.
 * Stores the instance as a singleton — calling twice throws.
 */
export function createDatabase(options?: DatabaseOptions): Database {
  if (instance) {
    throw new Error('Database already initialized. Call disconnect() first or use getDatabase().');
  }

  const client = new PrismaClient({
    datasourceUrl: options?.url,
    log: options?.logQueries
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });

  if (options?.logQueries) {
     
    client.$on('query' as never, (e: unknown) => {
      const event = e as { query: string; duration: number };
      logger.debug('Prisma query', {
        component: 'database',
        query: event.query,
        durationMs: event.duration,
      });
    });
  }

   
  client.$on('error' as never, (e: unknown) => {
    const event = e as { message: string };
    logger.error('Prisma error', {
      component: 'database',
      message: event.message,
    });
  });

  const db: Database = {
    client,

    async connect(): Promise<void> {
      await client.$connect();
      logger.info('Database connected', { component: 'database' });
    },

    async disconnect(): Promise<void> {
      await client.$disconnect();
      instance = undefined;
      logger.info('Database disconnected', { component: 'database' });
    },
  };

  instance = db;
  return db;
}

/**
 * Get the existing Database singleton.
 * Throws if `createDatabase()` hasn't been called yet.
 */
export function getDatabase(): Database {
  if (!instance) {
    throw new Error('Database not initialized. Call createDatabase() first.');
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 * Does NOT disconnect — caller is responsible for cleanup.
 */
export function resetDatabaseSingleton(): void {
  instance = undefined;
}
```

---
## src/infrastructure/repositories/project-repository.ts
```typescript
/**
 * Project repository — CRUD operations for the projects table.
 * Maps between Prisma records and typed application models.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { AgentConfig, ProjectId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  environment: string;
  owner: string;
  tags: string[];
  config: AgentConfig;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  environment?: string;
  owner: string;
  tags?: string[];
  config: AgentConfig;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  environment?: string;
  tags?: string[];
  config?: AgentConfig;
  status?: string;
}

export interface ProjectFilters {
  owner?: string;
  status?: string;
  tags?: string[];
}

// ─── Repository ─────────────────────────────────────────────────

export interface ProjectRepository {
  create(input: ProjectCreateInput): Promise<Project>;
  findById(id: ProjectId): Promise<Project | null>;
  update(id: ProjectId, input: ProjectUpdateInput): Promise<Project | null>;
  delete(id: ProjectId): Promise<boolean>;
  list(filters?: ProjectFilters): Promise<Project[]>;
}

/** Map a Prisma project record to the app's Project type. */
function toAppModel(record: {
  id: string;
  name: string;
  description: string | null;
  environment: string;
  owner: string;
  tags: string[];
  configJson: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Project {
  return {
    id: record.id as ProjectId,
    name: record.name,
    description: record.description ?? undefined,
    environment: record.environment,
    owner: record.owner,
    tags: record.tags,
    config: record.configJson as AgentConfig,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create a ProjectRepository backed by Prisma.
 */
export function createProjectRepository(prisma: PrismaClient): ProjectRepository {
  return {
    async create(input: ProjectCreateInput): Promise<Project> {
      const record = await prisma.project.create({
        data: {
          id: nanoid(),
          name: input.name,
          description: input.description ?? null,
          environment: input.environment ?? 'development',
          owner: input.owner,
          tags: input.tags ?? [],
          configJson: input.config as unknown as Prisma.InputJsonValue,
          status: 'active',
        },
      });
      return toAppModel(record);
    },

    async findById(id: ProjectId): Promise<Project | null> {
      const record = await prisma.project.findUnique({ where: { id } });
      if (!record) return null;
      return toAppModel(record);
    },

    async update(id: ProjectId, input: ProjectUpdateInput): Promise<Project | null> {
      try {
        const record = await prisma.project.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.environment !== undefined && { environment: input.environment }),
            ...(input.tags !== undefined && { tags: input.tags }),
            ...(input.config !== undefined && {
              configJson: input.config as unknown as Prisma.InputJsonValue,
            }),
            ...(input.status !== undefined && { status: input.status }),
          },
        });
        return toAppModel(record);
      } catch {
        return null;
      }
    },

    async delete(id: ProjectId): Promise<boolean> {
      try {
        await prisma.project.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },

    async list(filters?: ProjectFilters): Promise<Project[]> {
      const records = await prisma.project.findMany({
        where: {
          ...(filters?.owner && { owner: filters.owner }),
          ...(filters?.status && { status: filters.status }),
          ...(filters?.tags && { tags: { hasSome: filters.tags } }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
```

---
## src/infrastructure/repositories/session-repository.ts
```typescript
/**
 * Session repository — CRUD for sessions and message persistence.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface SessionCreateInput {
  projectId: ProjectId;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface StoredMessage {
  id: string;
  sessionId: SessionId;
  role: string;
  content: string;
  toolCalls?: unknown;
  usage?: unknown;
  traceId?: string;
  createdAt: Date;
}

// ─── Repository ─────────────────────────────────────────────────

export interface SessionRepository {
  create(input: SessionCreateInput): Promise<Session>;
  findById(id: SessionId): Promise<Session | null>;
  findByContactId(projectId: ProjectId, contactId: string): Promise<Session | null>;
  updateStatus(id: SessionId, status: string): Promise<boolean>;
  updateMetadata(id: SessionId, metadata: Record<string, unknown>): Promise<boolean>;
  listByProject(projectId: ProjectId, status?: string): Promise<Session[]>;
  addMessage(sessionId: SessionId, message: { role: string; content: string; toolCalls?: unknown; usage?: unknown }, traceId?: string): Promise<StoredMessage>;
  getMessages(sessionId: SessionId): Promise<StoredMessage[]>;
}

/** Map a Prisma session record to the app's Session type. */
function toSessionModel(record: {
  id: string;
  projectId: string;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}): Session {
  return {
    id: record.id as SessionId,
    projectId: record.projectId as ProjectId,
    status: record.status,
    metadata: (record.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt ?? undefined,
  };
}

/**
 * Create a SessionRepository backed by Prisma.
 */
export function createSessionRepository(prisma: PrismaClient): SessionRepository {
  return {
    async create(input: SessionCreateInput): Promise<Session> {
      const record = await prisma.session.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          status: 'active',
          metadata: input.metadata as Prisma.InputJsonValue,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return toSessionModel(record);
    },

    async findById(id: SessionId): Promise<Session | null> {
      const record = await prisma.session.findUnique({ where: { id } });
      if (!record) return null;
      return toSessionModel(record);
    },

    async findByContactId(projectId: ProjectId, contactId: string): Promise<Session | null> {
      const record = await prisma.session.findFirst({
        where: {
          projectId,
          status: 'active',
          metadata: {
            path: ['contactId'],
            equals: contactId,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!record) return null;
      return toSessionModel(record);
    },

    async updateStatus(id: SessionId, status: string): Promise<boolean> {
      try {
        await prisma.session.update({
          where: { id },
          data: { status },
        });
        return true;
      } catch {
        return false;
      }
    },

    async updateMetadata(id: SessionId, metadata: Record<string, unknown>): Promise<boolean> {
      try {
        await prisma.session.update({
          where: { id },
          data: { metadata: metadata as Prisma.InputJsonValue },
        });
        return true;
      } catch {
        return false;
      }
    },

    async listByProject(projectId: ProjectId, status?: string): Promise<Session[]> {
      const records = await prisma.session.findMany({
        where: {
          projectId,
          ...(status && { status }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toSessionModel);
    },

    async addMessage(
      sessionId: SessionId,
      message: { role: string; content: string; toolCalls?: unknown; usage?: unknown },
      traceId?: string,
    ): Promise<StoredMessage> {
      const record = await prisma.message.create({
        data: {
          id: nanoid(),
          sessionId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls as Prisma.InputJsonValue,
          usage: message.usage as Prisma.InputJsonValue,
          traceId: traceId ?? null,
        },
      });
      return {
        id: record.id,
        sessionId: record.sessionId as SessionId,
        role: record.role,
        content: record.content,
        toolCalls: record.toolCalls ?? undefined,
        usage: record.usage ?? undefined,
        traceId: record.traceId ?? undefined,
        createdAt: record.createdAt,
      };
    },

    async getMessages(sessionId: SessionId): Promise<StoredMessage[]> {
      const records = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });
      return records.map((r) => ({
        id: r.id,
        sessionId: r.sessionId as SessionId,
        role: r.role,
        content: r.content,
        toolCalls: r.toolCalls ?? undefined,
        usage: r.usage ?? undefined,
        traceId: r.traceId ?? undefined,
        createdAt: r.createdAt,
      }));
    },
  };
}
```

---
## src/infrastructure/repositories/prompt-layer-repository.ts
```typescript
/**
 * PromptLayer repository — independently-versioned prompt layers with activation control.
 *
 * Each project has 3 layer types (identity, instructions, safety).
 * Layers are immutable. Rollback = deactivate current, activate previous.
 * Only one layer per (project, layerType) can be active at a time.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import type { PromptLayer, PromptLayerType } from '@/prompts/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface PromptLayerCreateInput {
  projectId: ProjectId;
  layerType: PromptLayerType;
  content: string;
  createdBy: string;
  changeReason: string;
  performanceNotes?: string;
  metadata?: Record<string, unknown>;
}

// ─── Repository ─────────────────────────────────────────────────

export interface PromptLayerRepository {
  /** Create a new immutable prompt layer. Auto-increments version per (project, layerType). */
  create(input: PromptLayerCreateInput): Promise<PromptLayer>;
  /** Find a layer by ID. */
  findById(id: PromptLayerId): Promise<PromptLayer | null>;
  /** Get the currently active layer for a project + layer type. */
  getActiveLayer(projectId: ProjectId, layerType: PromptLayerType): Promise<PromptLayer | null>;
  /** Activate a layer (deactivates others of the same project + layerType). */
  activate(id: PromptLayerId): Promise<boolean>;
  /** List all layers for a project, optionally filtered by layer type, newest first. */
  listByProject(projectId: ProjectId, layerType?: PromptLayerType): Promise<PromptLayer[]>;
}

/** Map a Prisma record to the app type. */
function toAppModel(record: {
  id: string;
  projectId: string;
  layerType: string;
  version: number;
  content: string;
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  changeReason: string;
  performanceNotes: string | null;
  metadata: unknown;
}): PromptLayer {
  return {
    id: record.id as PromptLayerId,
    projectId: record.projectId as ProjectId,
    layerType: record.layerType as PromptLayerType,
    version: record.version,
    content: record.content,
    isActive: record.isActive,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    changeReason: record.changeReason,
    performanceNotes: record.performanceNotes ?? undefined,
    metadata: record.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Create a PromptLayerRepository backed by Prisma.
 */
export function createPromptLayerRepository(prisma: PrismaClient): PromptLayerRepository {
  return {
    async create(input: PromptLayerCreateInput): Promise<PromptLayer> {
      // Get next version number for this (project, layerType)
      const latest = await prisma.promptLayer.findFirst({
        where: { projectId: input.projectId, layerType: input.layerType },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      const record = await prisma.promptLayer.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          layerType: input.layerType,
          version: nextVersion,
          content: input.content,
          isActive: false,
          createdBy: input.createdBy,
          changeReason: input.changeReason,
          performanceNotes: input.performanceNotes ?? null,
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      });
      return toAppModel(record);
    },

    async findById(id: PromptLayerId): Promise<PromptLayer | null> {
      const record = await prisma.promptLayer.findUnique({ where: { id } });
      if (!record) return null;
      return toAppModel(record);
    },

    async getActiveLayer(
      projectId: ProjectId,
      layerType: PromptLayerType,
    ): Promise<PromptLayer | null> {
      const record = await prisma.promptLayer.findFirst({
        where: { projectId, layerType, isActive: true },
      });
      if (!record) return null;
      return toAppModel(record);
    },

    async activate(id: PromptLayerId): Promise<boolean> {
      try {
        const layer = await prisma.promptLayer.findUnique({
          where: { id },
          select: { projectId: true, layerType: true },
        });
        if (!layer) return false;

        // Transaction: deactivate same (project, layerType) → activate target
        await prisma.$transaction([
          prisma.promptLayer.updateMany({
            where: {
              projectId: layer.projectId,
              layerType: layer.layerType,
            },
            data: { isActive: false },
          }),
          prisma.promptLayer.update({
            where: { id },
            data: { isActive: true },
          }),
        ]);

        return true;
      } catch {
        return false;
      }
    },

    async listByProject(
      projectId: ProjectId,
      layerType?: PromptLayerType,
    ): Promise<PromptLayer[]> {
      const where: Prisma.PromptLayerWhereInput = { projectId };
      if (layerType) {
        where.layerType = layerType;
      }

      const records = await prisma.promptLayer.findMany({
        where,
        orderBy: { version: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
```

---
## src/infrastructure/repositories/execution-trace-repository.ts
```typescript
/**
 * ExecutionTrace repository — trace lifecycle and event persistence.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type {
  ExecutionStatus,
  ExecutionTrace,
  ProjectId,
  PromptSnapshot,
  SessionId,
  TraceEvent,
  TraceId,
} from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TraceCreateInput {
  projectId: ProjectId;
  sessionId: SessionId;
  promptSnapshot: PromptSnapshot;
}

export interface TraceUpdateInput {
  totalDurationMs?: number;
  totalTokensUsed?: number;
  totalCostUsd?: number;
  turnCount?: number;
  status?: ExecutionStatus;
  completedAt?: Date;
}

// ─── Repository ─────────────────────────────────────────────────

export interface ExecutionTraceRepository {
  create(input: TraceCreateInput): Promise<ExecutionTrace>;
  /** Persist a completed trace (with its existing ID, events, and totals). */
  save(trace: ExecutionTrace): Promise<void>;
  findById(id: TraceId): Promise<ExecutionTrace | null>;
  update(id: TraceId, input: TraceUpdateInput): Promise<boolean>;
  /** Append events to an existing trace's event array. */
  addEvents(id: TraceId, events: TraceEvent[]): Promise<boolean>;
  listBySession(sessionId: SessionId): Promise<ExecutionTrace[]>;
}

/** Map a Prisma record to the app type. */
function toAppModel(record: {
  id: string;
  projectId: string;
  sessionId: string;
  promptSnapshot: unknown;
  events: unknown;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  turnCount: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
}): ExecutionTrace {
  return {
    id: record.id as TraceId,
    projectId: record.projectId as ProjectId,
    sessionId: record.sessionId as SessionId,
    promptSnapshot: record.promptSnapshot as PromptSnapshot,
    events: record.events as TraceEvent[],
    totalDurationMs: record.totalDurationMs,
    totalTokensUsed: record.totalTokensUsed,
    totalCostUSD: record.totalCostUsd,
    turnCount: record.turnCount,
    status: record.status as ExecutionStatus,
    createdAt: record.createdAt,
    completedAt: record.completedAt ?? undefined,
  };
}

/**
 * Create an ExecutionTraceRepository backed by Prisma.
 */
export function createExecutionTraceRepository(prisma: PrismaClient): ExecutionTraceRepository {
  return {
    async create(input: TraceCreateInput): Promise<ExecutionTrace> {
      const record = await prisma.executionTrace.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          sessionId: input.sessionId,
          promptSnapshot: input.promptSnapshot as unknown as Prisma.InputJsonValue,
          events: [] as Prisma.InputJsonValue,
          totalDurationMs: 0,
          totalTokensUsed: 0,
          totalCostUsd: 0,
          turnCount: 0,
          status: 'running',
        },
      });
      return toAppModel(record);
    },

    async save(trace: ExecutionTrace): Promise<void> {
      await prisma.executionTrace.upsert({
        where: { id: trace.id },
        create: {
          id: trace.id,
          projectId: trace.projectId,
          sessionId: trace.sessionId,
          promptSnapshot: trace.promptSnapshot as unknown as Prisma.InputJsonValue,
          events: trace.events as unknown as Prisma.InputJsonValue,
          totalDurationMs: trace.totalDurationMs,
          totalTokensUsed: trace.totalTokensUsed,
          totalCostUsd: trace.totalCostUSD,
          turnCount: trace.turnCount,
          status: trace.status,
          createdAt: trace.createdAt,
          completedAt: trace.completedAt ?? null,
        },
        update: {
          events: trace.events as unknown as Prisma.InputJsonValue,
          totalDurationMs: trace.totalDurationMs,
          totalTokensUsed: trace.totalTokensUsed,
          totalCostUsd: trace.totalCostUSD,
          turnCount: trace.turnCount,
          status: trace.status,
          completedAt: trace.completedAt ?? null,
        },
      });
    },

    async findById(id: TraceId): Promise<ExecutionTrace | null> {
      const record = await prisma.executionTrace.findUnique({ where: { id } });
      if (!record) return null;
      return toAppModel(record);
    },

    async update(id: TraceId, input: TraceUpdateInput): Promise<boolean> {
      try {
        await prisma.executionTrace.update({
          where: { id },
          data: {
            ...(input.totalDurationMs !== undefined && { totalDurationMs: input.totalDurationMs }),
            ...(input.totalTokensUsed !== undefined && { totalTokensUsed: input.totalTokensUsed }),
            ...(input.totalCostUsd !== undefined && { totalCostUsd: input.totalCostUsd }),
            ...(input.turnCount !== undefined && { turnCount: input.turnCount }),
            ...(input.status !== undefined && { status: input.status }),
            ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
          },
        });
        return true;
      } catch {
        return false;
      }
    },

    async addEvents(id: TraceId, events: TraceEvent[]): Promise<boolean> {
      try {
        const trace = await prisma.executionTrace.findUnique({
          where: { id },
          select: { events: true },
        });
        if (!trace) return false;

        const existingEvents = trace.events as unknown[];
        const mergedEvents = [...existingEvents, ...events] as Prisma.InputJsonValue;

        await prisma.executionTrace.update({
          where: { id },
          data: { events: mergedEvents },
        });

        return true;
      } catch {
        return false;
      }
    },

    async listBySession(sessionId: SessionId): Promise<ExecutionTrace[]> {
      const records = await prisma.executionTrace.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
```

---
## src/infrastructure/repositories/scheduled-task-repository.ts
```typescript
/**
 * ScheduledTask repository — CRUD + scheduling queries for scheduled tasks and runs.
 *
 * Prisma-backed. Supports querying tasks due for execution by checking
 * nextRunAt <= now && status === 'active'.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, ScheduledTaskId, ScheduledTaskRunId, TraceId } from '@/core/types.js';
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskCreateInput,
  ScheduledTaskRunCreateInput,
  ScheduledTaskStatus,
  ScheduledTaskOrigin,
  TaskPayload,
  ScheduledTaskRunStatus,
} from '@/scheduling/types.js';

// ─── Repository Interface ───────────────────────────────────────

export interface ScheduledTaskRepository {
  /** Create a new scheduled task. */
  create(input: ScheduledTaskCreateInput): Promise<ScheduledTask>;
  /** Find a task by ID. */
  findById(id: ScheduledTaskId): Promise<ScheduledTask | null>;
  /** Update task fields. */
  update(id: ScheduledTaskId, data: ScheduledTaskUpdateInput): Promise<ScheduledTask | null>;
  /** List tasks for a project, optionally filtered by status. */
  listByProject(projectId: ProjectId, status?: ScheduledTaskStatus): Promise<ScheduledTask[]>;
  /** Get all active tasks that are due for execution (nextRunAt <= now). */
  getTasksDueForExecution(now: Date): Promise<ScheduledTask[]>;
  /** Create a new run record for a task. */
  createRun(input: ScheduledTaskRunCreateInput): Promise<ScheduledTaskRun>;
  /** Update a run record. */
  updateRun(id: ScheduledTaskRunId, data: ScheduledTaskRunUpdateInput): Promise<ScheduledTaskRun | null>;
  /** List runs for a task, newest first. */
  listRuns(taskId: ScheduledTaskId, limit?: number): Promise<ScheduledTaskRun[]>;
}

// ─── Update Inputs ──────────────────────────────────────────────

export interface ScheduledTaskUpdateInput {
  status?: ScheduledTaskStatus;
  approvedBy?: string;
  lastRunAt?: Date;
  nextRunAt?: Date | null;
  runCount?: number;
}

export interface ScheduledTaskRunUpdateInput {
  status?: ScheduledTaskRunStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  traceId?: TraceId;
  result?: Record<string, unknown>;
  errorMessage?: string;
  retryCount?: number;
}

// ─── Mappers ────────────────────────────────────────────────────

function toTaskAppModel(record: {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  cronExpression: string;
  taskPayload: unknown;
  origin: string;
  status: string;
  proposedBy: string | null;
  approvedBy: string | null;
  maxRetries: number;
  timeoutMs: number;
  budgetPerRunUsd: number;
  maxDurationMinutes: number;
  maxTurns: number;
  maxRuns: number | null;
  runCount: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ScheduledTask {
  return {
    id: record.id as ScheduledTaskId,
    projectId: record.projectId as ProjectId,
    name: record.name,
    description: record.description ?? undefined,
    cronExpression: record.cronExpression,
    taskPayload: record.taskPayload as TaskPayload,
    origin: record.origin as ScheduledTaskOrigin,
    status: record.status as ScheduledTaskStatus,
    proposedBy: record.proposedBy ?? undefined,
    approvedBy: record.approvedBy ?? undefined,
    maxRetries: record.maxRetries,
    timeoutMs: record.timeoutMs,
    budgetPerRunUSD: record.budgetPerRunUsd,
    maxDurationMinutes: record.maxDurationMinutes,
    maxTurns: record.maxTurns,
    maxRuns: record.maxRuns ?? undefined,
    runCount: record.runCount,
    lastRunAt: record.lastRunAt ?? undefined,
    nextRunAt: record.nextRunAt ?? undefined,
    expiresAt: record.expiresAt ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRunAppModel(record: {
  id: string;
  taskId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  traceId: string | null;
  result: unknown;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
}): ScheduledTaskRun {
  return {
    id: record.id as ScheduledTaskRunId,
    taskId: record.taskId as ScheduledTaskId,
    status: record.status as ScheduledTaskRunStatus,
    startedAt: record.startedAt ?? undefined,
    completedAt: record.completedAt ?? undefined,
    durationMs: record.durationMs ?? undefined,
    tokensUsed: record.tokensUsed ?? undefined,
    costUsd: record.costUsd ?? undefined,
    traceId: record.traceId ? (record.traceId as TraceId) : undefined,
    result: record.result as Record<string, unknown> | undefined,
    errorMessage: record.errorMessage ?? undefined,
    retryCount: record.retryCount,
    createdAt: record.createdAt,
  };
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a ScheduledTaskRepository backed by Prisma. */
export function createScheduledTaskRepository(prisma: PrismaClient): ScheduledTaskRepository {
  return {
    async create(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
      const record = await prisma.scheduledTask.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? null,
          cronExpression: input.cronExpression,
          taskPayload: input.taskPayload as unknown as Prisma.InputJsonValue,
          origin: input.origin,
          status: input.origin === 'agent_proposed' ? 'proposed' : 'active',
          proposedBy: input.proposedBy ?? null,
          maxRetries: input.maxRetries ?? 2,
          timeoutMs: input.timeoutMs ?? 300_000,
          budgetPerRunUsd: input.budgetPerRunUSD ?? 1.0,
          maxDurationMinutes: input.maxDurationMinutes ?? 30,
          maxTurns: input.maxTurns ?? 10,
          maxRuns: input.maxRuns ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return toTaskAppModel(record);
    },

    async findById(id: ScheduledTaskId): Promise<ScheduledTask | null> {
      const record = await prisma.scheduledTask.findUnique({ where: { id } });
      if (!record) return null;
      return toTaskAppModel(record);
    },

    async update(id: ScheduledTaskId, data: ScheduledTaskUpdateInput): Promise<ScheduledTask | null> {
      try {
        const record = await prisma.scheduledTask.update({
          where: { id },
          data: {
            status: data.status,
            approvedBy: data.approvedBy,
            lastRunAt: data.lastRunAt,
            nextRunAt: data.nextRunAt,
            runCount: data.runCount,
          },
        });
        return toTaskAppModel(record);
      } catch {
        return null;
      }
    },

    async listByProject(
      projectId: ProjectId,
      status?: ScheduledTaskStatus,
    ): Promise<ScheduledTask[]> {
      const where: Prisma.ScheduledTaskWhereInput = { projectId };
      if (status) {
        where.status = status;
      }

      const records = await prisma.scheduledTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toTaskAppModel);
    },

    async getTasksDueForExecution(now: Date): Promise<ScheduledTask[]> {
      const records = await prisma.scheduledTask.findMany({
        where: {
          status: 'active',
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: 'asc' },
      });
      return records.map(toTaskAppModel);
    },

    async createRun(input: ScheduledTaskRunCreateInput): Promise<ScheduledTaskRun> {
      const record = await prisma.scheduledTaskRun.create({
        data: {
          id: nanoid(),
          taskId: input.taskId,
          traceId: input.traceId ?? null,
          status: 'pending',
        },
      });
      return toRunAppModel(record);
    },

    async updateRun(
      id: ScheduledTaskRunId,
      data: ScheduledTaskRunUpdateInput,
    ): Promise<ScheduledTaskRun | null> {
      try {
        const record = await prisma.scheduledTaskRun.update({
          where: { id },
          data: {
            status: data.status,
            startedAt: data.startedAt,
            completedAt: data.completedAt,
            durationMs: data.durationMs,
            tokensUsed: data.tokensUsed,
            costUsd: data.costUsd,
            traceId: data.traceId,
            result: data.result as unknown as Prisma.InputJsonValue,
            errorMessage: data.errorMessage,
            retryCount: data.retryCount,
          },
        });
        return toRunAppModel(record);
      } catch {
        return null;
      }
    },

    async listRuns(taskId: ScheduledTaskId, limit = 50): Promise<ScheduledTaskRun[]> {
      const records = await prisma.scheduledTaskRun.findMany({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return records.map(toRunAppModel);
    },
  };
}
```

---
## src/infrastructure/repositories/contact-repository.ts
```typescript
/**
 * Contact repository — CRUD for contacts.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  Contact,
  ContactId,
  ContactRepository,
  CreateContactInput,
  UpdateContactInput,
  ChannelIdentifier,
  ContactListOptions,
} from '@/contacts/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toContactModel(record: {
  id: string;
  projectId: string;
  name: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  telegramId: string | null;
  slackId: string | null;
  timezone: string | null;
  language: string;
  role: string | null;
  tags: string[];
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Contact {
  return {
    id: record.id,
    projectId: record.projectId as ProjectId,
    name: record.name,
    displayName: record.displayName ?? undefined,
    phone: record.phone ?? undefined,
    email: record.email ?? undefined,
    telegramId: record.telegramId ?? undefined,
    slackId: record.slackId ?? undefined,
    timezone: record.timezone ?? undefined,
    language: record.language,
    role: record.role ?? undefined,
    tags: record.tags,
    metadata: (record.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a ContactRepository backed by Prisma.
 */
export function createContactRepository(prisma: PrismaClient): ContactRepository {
  return {
    async create(input: CreateContactInput): Promise<Contact> {
      const record = await prisma.contact.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          displayName: input.displayName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          telegramId: input.telegramId ?? null,
          slackId: input.slackId ?? null,
          timezone: input.timezone ?? null,
          language: input.language ?? 'es',
          role: input.role ?? null,
          tags: input.tags ?? [],
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      });
      return toContactModel(record);
    },

    async findById(id: ContactId): Promise<Contact | null> {
      const record = await prisma.contact.findUnique({ where: { id } });
      if (!record) return null;
      return toContactModel(record);
    },

    async findByChannel(
      projectId: ProjectId,
      identifier: ChannelIdentifier,
    ): Promise<Contact | null> {
      let record = null;

      switch (identifier.type) {
        case 'phone':
          record = await prisma.contact.findUnique({
            where: { projectId_phone: { projectId, phone: identifier.value } },
          });
          break;
        case 'email':
          record = await prisma.contact.findUnique({
            where: { projectId_email: { projectId, email: identifier.value } },
          });
          break;
        case 'telegramId':
          record = await prisma.contact.findUnique({
            where: { projectId_telegramId: { projectId, telegramId: identifier.value } },
          });
          break;
        case 'slackId':
          record = await prisma.contact.findUnique({
            where: { projectId_slackId: { projectId, slackId: identifier.value } },
          });
          break;
      }

      if (!record) return null;
      return toContactModel(record);
    },

    async update(id: ContactId, input: UpdateContactInput): Promise<Contact> {
      const record = await prisma.contact.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.displayName !== undefined && { displayName: input.displayName }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.telegramId !== undefined && { telegramId: input.telegramId }),
          ...(input.slackId !== undefined && { slackId: input.slackId }),
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.language !== undefined && { language: input.language }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.metadata !== undefined && { metadata: input.metadata as Prisma.InputJsonValue }),
        },
      });
      return toContactModel(record);
    },

    async delete(id: ContactId): Promise<void> {
      await prisma.contact.delete({ where: { id } });
    },

    async list(projectId: ProjectId, options?: ContactListOptions): Promise<Contact[]> {
      const records = await prisma.contact.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: options?.limit,
        skip: options?.offset,
      });
      return records.map(toContactModel);
    },
  };
}
```

---
## src/infrastructure/repositories/webhook-repository.ts
```typescript
/**
 * Webhook repository — CRUD for webhooks.
 */
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  Webhook,
  WebhookId,
  WebhookRepository,
  CreateWebhookInput,
  UpdateWebhookInput,
} from '@/webhooks/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toWebhookModel(record: {
  id: string;
  projectId: string;
  agentId: string | null;
  name: string;
  description: string | null;
  triggerPrompt: string;
  secretEnvVar: string | null;
  allowedIps: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Webhook {
  return {
    id: record.id,
    projectId: record.projectId as ProjectId,
    agentId: record.agentId ?? undefined,
    name: record.name,
    description: record.description ?? undefined,
    triggerPrompt: record.triggerPrompt,
    secretEnvVar: record.secretEnvVar ?? undefined,
    allowedIps: record.allowedIps.length > 0 ? record.allowedIps : undefined,
    status: record.status as 'active' | 'paused',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a WebhookRepository backed by Prisma.
 */
export function createWebhookRepository(prisma: PrismaClient): WebhookRepository {
  return {
    async create(input: CreateWebhookInput): Promise<Webhook> {
      const record = await prisma.webhook.create({
        data: {
          projectId: input.projectId,
          agentId: input.agentId ?? null,
          name: input.name,
          description: input.description ?? null,
          triggerPrompt: input.triggerPrompt,
          secretEnvVar: input.secretEnvVar ?? null,
          allowedIps: input.allowedIps ?? [],
          status: input.status ?? 'active',
        },
      });
      return toWebhookModel(record);
    },

    async findById(id: WebhookId): Promise<Webhook | null> {
      const record = await prisma.webhook.findUnique({ where: { id } });
      if (!record) return null;
      return toWebhookModel(record);
    },

    async update(id: WebhookId, input: UpdateWebhookInput): Promise<Webhook> {
      const record = await prisma.webhook.update({
        where: { id },
        data: {
          ...(input.agentId !== undefined && { agentId: input.agentId }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.triggerPrompt !== undefined && { triggerPrompt: input.triggerPrompt }),
          ...(input.secretEnvVar !== undefined && { secretEnvVar: input.secretEnvVar }),
          ...(input.allowedIps !== undefined && { allowedIps: input.allowedIps }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      return toWebhookModel(record);
    },

    async delete(id: WebhookId): Promise<void> {
      await prisma.webhook.delete({ where: { id } });
    },

    async list(projectId: ProjectId): Promise<Webhook[]> {
      const records = await prisma.webhook.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toWebhookModel);
    },

    async listActive(projectId: ProjectId): Promise<Webhook[]> {
      const records = await prisma.webhook.findMany({
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toWebhookModel);
    },
  };
}
```

---
## src/infrastructure/repositories/file-repository.ts
```typescript
/**
 * File repository — CRUD for file metadata.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  StoredFile,
  FileId,
  FileRepository,
  StorageProvider,
} from '@/files/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toFileModel(record: {
  id: string;
  projectId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storagePath: string;
  publicUrl: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;
  expiresAt: Date | null;
  metadata: unknown;
}): StoredFile {
  return {
    id: record.id,
    projectId: record.projectId as ProjectId,
    filename: record.filename,
    originalFilename: record.originalFilename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    storageProvider: record.storageProvider as StorageProvider,
    storagePath: record.storagePath,
    publicUrl: record.publicUrl ?? undefined,
    uploadedBy: record.uploadedBy ?? undefined,
    uploadedAt: record.uploadedAt,
    expiresAt: record.expiresAt ?? undefined,
    metadata: (record.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a FileRepository backed by Prisma.
 */
export function createFileRepository(prisma: PrismaClient): FileRepository {
  return {
    async create(file: Omit<StoredFile, 'id' | 'uploadedAt'>): Promise<StoredFile> {
      const record = await prisma.file.create({
        data: {
          projectId: file.projectId,
          filename: file.filename,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageProvider: file.storageProvider,
          storagePath: file.storagePath,
          publicUrl: file.publicUrl ?? null,
          uploadedBy: file.uploadedBy ?? null,
          expiresAt: file.expiresAt ?? null,
          metadata: file.metadata as Prisma.InputJsonValue,
        },
      });
      return toFileModel(record);
    },

    async findById(id: FileId): Promise<StoredFile | null> {
      const record = await prisma.file.findUnique({ where: { id } });
      if (!record) return null;
      return toFileModel(record);
    },

    async findByProject(
      projectId: ProjectId,
      options?: { limit?: number; offset?: number },
    ): Promise<StoredFile[]> {
      const records = await prisma.file.findMany({
        where: { projectId },
        orderBy: { uploadedAt: 'desc' },
        take: options?.limit,
        skip: options?.offset,
      });
      return records.map(toFileModel);
    },

    async delete(id: FileId): Promise<void> {
      await prisma.file.delete({ where: { id } });
    },

    async updateMetadata(id: FileId, metadata: Record<string, unknown>): Promise<StoredFile> {
      const record = await prisma.file.update({
        where: { id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
      return toFileModel(record);
    },
  };
}
```

---
## src/infrastructure/repositories/agent-repository.ts
```typescript
/**
 * Agent repository — CRUD for agents.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  AgentId,
  AgentConfig,
  AgentRepository,
  CreateAgentInput,
  UpdateAgentInput,
  AgentPromptConfig,
  AgentLLMConfig,
  MCPServerConfig,
  ChannelConfig,
  AgentMode,
  AgentLimits,
  AgentStatus,
  AgentOperatingMode,
} from '@/agents/types.js';

// ─── Default Values ─────────────────────────────────────────────

const DEFAULT_LIMITS: AgentLimits = {
  maxTurns: 10,
  maxTokensPerTurn: 4000,
  budgetPerDayUsd: 10.0,
};

const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  allowedChannels: [],
  defaultChannel: undefined,
};

// ─── Mapper ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type AgentRecord = Awaited<ReturnType<PrismaClient['agent']['findUniqueOrThrow']>>;

function toAgentConfig(record: AgentRecord): AgentConfig {
  const rec = record as AgentRecord & { llmConfig?: unknown; modes?: unknown };
  return {
    id: rec.id as AgentId,
    projectId: rec.projectId as ProjectId,
    name: rec.name,
    description: rec.description ?? undefined,
    promptConfig: rec.promptConfig as unknown as AgentPromptConfig,
    llmConfig: (rec.llmConfig as AgentLLMConfig | null | undefined) ?? undefined,
    toolAllowlist: rec.toolAllowlist,
    mcpServers: (rec.mcpServers as MCPServerConfig[] | null) ?? [],
    channelConfig: (rec.channelConfig as ChannelConfig | null) ?? DEFAULT_CHANNEL_CONFIG,
    modes: (rec.modes as AgentMode[] | null) ?? [],
    operatingMode: ((rec as AgentRecord & { operatingMode?: string }).operatingMode ?? 'customer-facing') as AgentOperatingMode,
    skillIds: (rec as AgentRecord & { skillIds?: string[] }).skillIds ?? [],
    limits: {
      maxTurns: rec.maxTurns,
      maxTokensPerTurn: rec.maxTokensPerTurn,
      budgetPerDayUsd: rec.budgetPerDayUsd,
    },
    status: rec.status as AgentStatus,
    managerAgentId: rec.managerAgentId,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create an AgentRepository backed by Prisma.
 */
export function createAgentRepository(prisma: PrismaClient): AgentRepository {
  return {
    async create(input: CreateAgentInput): Promise<AgentConfig> {
      const limits = { ...DEFAULT_LIMITS, ...input.limits };
      const channelConfig = input.channelConfig ?? DEFAULT_CHANNEL_CONFIG;

      // Note: llmConfig requires `prisma generate` after migration. Cast to bypass
      // type checking until the Prisma client is regenerated.
      const createData = {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        promptConfig: input.promptConfig as unknown as Prisma.InputJsonValue,
        llmConfig: input.llmConfig
          ? (input.llmConfig as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        toolAllowlist: input.toolAllowlist ?? [],
        mcpServers: (input.mcpServers ?? []) as unknown as Prisma.InputJsonValue,
        channelConfig: channelConfig as unknown as Prisma.InputJsonValue,
        modes: input.modes && input.modes.length > 0
          ? (input.modes as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        operatingMode: input.operatingMode ?? 'customer-facing',
        skillIds: input.skillIds ?? [],
        maxTurns: limits.maxTurns,
        maxTokensPerTurn: limits.maxTokensPerTurn,
        budgetPerDayUsd: limits.budgetPerDayUsd,
        status: 'active',
        managerAgentId: input.managerAgentId ?? null,
        metadata: input.metadata ? (input.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      } as Prisma.AgentUncheckedCreateInput;

      const record = await prisma.agent.create({ data: createData });

      return toAgentConfig(record);
    },

    async findById(id: AgentId): Promise<AgentConfig | null> {
      const record = await prisma.agent.findUnique({ where: { id } });
      if (!record) return null;
      return toAgentConfig(record);
    },

    async findByName(projectId: string, name: string): Promise<AgentConfig | null> {
      const record = await prisma.agent.findUnique({
        where: {
          projectId_name: { projectId, name },
        },
      });
      if (!record) return null;
      return toAgentConfig(record);
    },

    async update(id: AgentId, input: UpdateAgentInput): Promise<AgentConfig> {
      const updateData: Prisma.AgentUpdateInput = {};

      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.promptConfig !== undefined) {
        updateData.promptConfig = input.promptConfig as unknown as Prisma.InputJsonValue;
      }
      if (input.toolAllowlist !== undefined) {
        updateData.toolAllowlist = input.toolAllowlist;
      }
      if (input.mcpServers !== undefined) {
        updateData.mcpServers = input.mcpServers as unknown as Prisma.InputJsonValue;
      }
      if (input.channelConfig !== undefined) {
        updateData.channelConfig = input.channelConfig as unknown as Prisma.InputJsonValue;
      }
      if (input.status !== undefined) {
        updateData.status = input.status;
      }
      if (input.managerAgentId !== undefined) {
        if (input.managerAgentId === null) {
          updateData.managerAgent = { disconnect: true };
        } else {
          updateData.managerAgent = { connect: { id: input.managerAgentId } };
        }
      }
      if (input.operatingMode !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { operatingMode: unknown };
        extended.operatingMode = input.operatingMode;
      }
      if (input.skillIds !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { skillIds: unknown };
        extended.skillIds = input.skillIds;
      }
      if (input.metadata !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { metadata: unknown };
        extended.metadata = input.metadata as unknown as Prisma.InputJsonValue;
      }
      if (input.limits !== undefined) {
        if (input.limits.maxTurns !== undefined) {
          updateData.maxTurns = input.limits.maxTurns;
        }
        if (input.limits.maxTokensPerTurn !== undefined) {
          updateData.maxTokensPerTurn = input.limits.maxTokensPerTurn;
        }
        if (input.limits.budgetPerDayUsd !== undefined) {
          updateData.budgetPerDayUsd = input.limits.budgetPerDayUsd;
        }
      }

      // llmConfig + modes require `prisma generate` — cast to add them to updateData
      if (input.llmConfig !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { llmConfig: unknown };
        extended.llmConfig = input.llmConfig
          ? (input.llmConfig as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      if (input.modes !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { modes: unknown };
        extended.modes = input.modes.length > 0
          ? (input.modes as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }

      const record = await prisma.agent.update({
        where: { id },
        data: updateData,
      });

      return toAgentConfig(record);
    },

    async delete(id: AgentId): Promise<void> {
      await prisma.agent.delete({ where: { id } });
    },

    async list(projectId: string): Promise<AgentConfig[]> {
      const records = await prisma.agent.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAgentConfig);
    },

    async listActive(projectId: string): Promise<AgentConfig[]> {
      const records = await prisma.agent.findMany({
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAgentConfig);
    },

    async listAll(): Promise<AgentConfig[]> {
      const records = await prisma.agent.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAgentConfig);
    },
  };
}
```

---
## src/infrastructure/repositories/secret-repository.ts
```typescript
/**
 * Secret repository — Prisma-backed CRUD for the secrets table.
 * Values are always stored encrypted; this repository never handles plaintext.
 */
import type { PrismaClient } from '@prisma/client';
import type { SecretRepository, SecretMetadata, SecretRecord } from '@/secrets/types.js';

/** Map a Prisma secret record to SecretMetadata (no encrypted bytes). */
function toMetadata(record: {
  id: string;
  projectId: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SecretMetadata {
  return {
    id: record.id,
    projectId: record.projectId,
    key: record.key,
    description: record.description ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Map a Prisma secret record to SecretRecord (includes encrypted bytes for decryption). */
function toRecord(record: {
  id: string;
  projectId: string;
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SecretRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    key: record.key,
    encryptedValue: record.encryptedValue,
    iv: record.iv,
    authTag: record.authTag,
    description: record.description ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create a SecretRepository backed by Prisma.
 */
export function createSecretRepository(prisma: PrismaClient): SecretRepository {
  return {
    async upsert(input): Promise<SecretMetadata> {
      const record = await prisma.secret.upsert({
        where: { projectId_key: { projectId: input.projectId, key: input.key } },
        create: {
          projectId: input.projectId,
          key: input.key,
          encryptedValue: input.encryptedValue,
          iv: input.iv,
          authTag: input.authTag,
          description: input.description ?? null,
        },
        update: {
          encryptedValue: input.encryptedValue,
          iv: input.iv,
          authTag: input.authTag,
          description: input.description,
        },
      });
      return toMetadata(record);
    },

    async findEncrypted(projectId: string, key: string): Promise<SecretRecord | null> {
      const record = await prisma.secret.findUnique({
        where: { projectId_key: { projectId, key } },
      });
      if (!record) return null;
      return toRecord(record);
    },

    async listMetadata(projectId: string): Promise<SecretMetadata[]> {
      const records = await prisma.secret.findMany({
        where: { projectId },
        orderBy: { key: 'asc' },
        select: {
          id: true,
          projectId: true,
          key: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return records.map(toMetadata);
    },

    async delete(projectId: string, key: string): Promise<boolean> {
      try {
        await prisma.secret.delete({
          where: { projectId_key: { projectId, key } },
        });
        return true;
      } catch {
        return false;
      }
    },

    async exists(projectId: string, key: string): Promise<boolean> {
      const count = await prisma.secret.count({
        where: { projectId, key },
      });
      return count > 0;
    },
  };
}
```

---
## src/infrastructure/repositories/index.ts
```typescript
// Entity repositories
export { createProjectRepository } from './project-repository.js';
export type { Project, ProjectCreateInput, ProjectUpdateInput, ProjectFilters, ProjectRepository } from './project-repository.js';

export { createSessionRepository } from './session-repository.js';
export type { Session, SessionCreateInput, StoredMessage, SessionRepository } from './session-repository.js';

export { createPromptLayerRepository } from './prompt-layer-repository.js';
export type { PromptLayerCreateInput, PromptLayerRepository } from './prompt-layer-repository.js';

export { createExecutionTraceRepository } from './execution-trace-repository.js';
export type { TraceCreateInput, TraceUpdateInput, ExecutionTraceRepository } from './execution-trace-repository.js';

export { createScheduledTaskRepository } from './scheduled-task-repository.js';
export type { ScheduledTaskRepository, ScheduledTaskUpdateInput, ScheduledTaskRunUpdateInput } from './scheduled-task-repository.js';

export { createContactRepository } from './contact-repository.js';
export type { ContactRepository } from '@/contacts/types.js';

export { createWebhookRepository } from './webhook-repository.js';
export type { WebhookRepository } from '@/webhooks/types.js';

export { createFileRepository } from './file-repository.js';
export type { FileRepository } from '@/files/types.js';

export { createAgentRepository } from './agent-repository.js';
export type { AgentRepository } from '@/agents/types.js';

export { createChannelIntegrationRepository } from './channel-integration-repository.js';
export type { ChannelIntegrationRepository } from '@/channels/types.js';
```

---
## src/secrets/types.ts
```typescript
/**
 * Types for the encrypted secrets store.
 * Secrets are AES-256-GCM encrypted per-project credentials stored in the DB.
 * The plaintext value is NEVER returned by the repository — only by the service layer
 * after decryption, and NEVER surfaced to API responses.
 */

// ─── Domain Types ────────────────────────────────────────────────

/** Metadata about a stored secret (no value, no encrypted bytes). */
export interface SecretMetadata {
  id: string;
  projectId: string;
  key: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw encrypted record as stored in DB (no plaintext). */
export interface SecretRecord {
  id: string;
  projectId: string;
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Repository Interface ────────────────────────────────────────

export interface SecretRepository {
  /** Store or overwrite an encrypted secret for a project. */
  upsert(input: {
    projectId: string;
    key: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
    description?: string;
  }): Promise<SecretMetadata>;

  /** Find the encrypted record for a project+key. Returns null if not found. */
  findEncrypted(projectId: string, key: string): Promise<SecretRecord | null>;

  /** List secret metadata for a project (no values). */
  listMetadata(projectId: string): Promise<SecretMetadata[]>;

  /** Delete a secret. Returns true if deleted, false if not found. */
  delete(projectId: string, key: string): Promise<boolean>;

  /** Check if a secret key exists for a project. */
  exists(projectId: string, key: string): Promise<boolean>;
}

// ─── Service Interface ───────────────────────────────────────────

export interface SecretService {
  /** Encrypt and store a secret value. Overwrites if key already exists. */
  set(projectId: string, key: string, value: string, description?: string): Promise<SecretMetadata>;

  /** Retrieve and decrypt a secret value. Throws SecretNotFoundError if absent. */
  get(projectId: string, key: string): Promise<string>;

  /** List secret metadata for a project (keys + descriptions, no values). */
  list(projectId: string): Promise<SecretMetadata[]>;

  /** Delete a secret. Returns true if deleted, false if not found. */
  delete(projectId: string, key: string): Promise<boolean>;

  /** Check if a secret key exists for a project. */
  exists(projectId: string, key: string): Promise<boolean>;
}
```

---
## src/secrets/crypto.ts
```typescript
/**
 * AES-256-GCM encryption/decryption for secret values.
 * Uses Node.js built-in `crypto` module — no external dependencies.
 *
 * Master key is sourced from SECRETS_ENCRYPTION_KEY env var (must be 64 hex chars = 32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit tag

/**
 * Retrieve the master encryption key from env.
 * Throws at startup if SECRETS_ENCRYPTION_KEY is missing or malformed.
 */
export function getMasterKey(): Buffer {
  const hex = process.env['SECRETS_ENCRYPTION_KEY'];
  if (!hex) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY environment variable is required for the secrets store. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${hex.length.toString()} characters.`,
    );
  }
  return Buffer.from(hex, 'hex');
}

export interface EncryptedPayload {
  encryptedValue: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns hex-encoded ciphertext, IV, and auth tag.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt a hex-encoded AES-256-GCM ciphertext.
 * Throws if the auth tag is invalid (tampered or wrong key).
 */
export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const encryptedBuffer = Buffer.from(payload.encryptedValue, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  return decrypted.toString('utf8');
}
```

---
## src/secrets/secret-service.ts
```typescript
/**
 * SecretService — business logic for encrypted project secrets.
 * Wraps the repository with encrypt/decrypt logic using the master key.
 */
import { SecretNotFoundError } from '@/core/errors.js';
import { encrypt, decrypt, getMasterKey } from './crypto.js';
import type { SecretRepository, SecretService, SecretMetadata } from './types.js';

interface SecretServiceDeps {
  secretRepository: SecretRepository;
}

/**
 * Create a SecretService backed by the given repository.
 * The master key is resolved from SECRETS_ENCRYPTION_KEY at first use.
 */
export function createSecretService(deps: SecretServiceDeps): SecretService {
  const { secretRepository } = deps;

  // Lazy-load master key so tests can set the env var before calling service methods
  let masterKey: Buffer | null = null;
  function getKey(): Buffer {
    masterKey ??= getMasterKey();
    return masterKey;
  }

  return {
    async set(
      projectId: string,
      key: string,
      value: string,
      description?: string,
    ): Promise<SecretMetadata> {
      const payload = encrypt(value, getKey());
      return secretRepository.upsert({
        projectId,
        key,
        encryptedValue: payload.encryptedValue,
        iv: payload.iv,
        authTag: payload.authTag,
        description,
      });
    },

    async get(projectId: string, key: string): Promise<string> {
      const record = await secretRepository.findEncrypted(projectId, key);
      if (!record) {
        throw new SecretNotFoundError(projectId, key);
      }
      return decrypt(
        { encryptedValue: record.encryptedValue, iv: record.iv, authTag: record.authTag },
        getKey(),
      );
    },

    async list(projectId: string): Promise<SecretMetadata[]> {
      return secretRepository.listMetadata(projectId);
    },

    async delete(projectId: string, key: string): Promise<boolean> {
      return secretRepository.delete(projectId, key);
    },

    async exists(projectId: string, key: string): Promise<boolean> {
      return secretRepository.exists(projectId, key);
    },
  };
}
```

---
## src/secrets/index.ts
```typescript
/**
 * Secrets module — encrypted per-project credential store.
 * @module secrets
 */
export type { SecretMetadata, SecretRecord, SecretRepository, SecretService } from './types.js';
export { createSecretService } from './secret-service.js';
export { getMasterKey, encrypt, decrypt } from './crypto.js';
export type { EncryptedPayload } from './crypto.js';
```

---
## src/knowledge/types.ts
```typescript
/**
 * Knowledge base types — CRUD management API for per-project memory entries.
 * Wraps the memory_entries table with a simpler, UI-friendly interface.
 */
import type { MemoryCategory } from '@/memory/types.js';

// ─── Knowledge Entry ────────────────────────────────────────────

/** A knowledge base entry as returned by the API (no embedding vector). */
export interface KnowledgeEntry {
  id: string;
  projectId: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ─── List Params ────────────────────────────────────────────────

export interface ListKnowledgeParams {
  projectId: string;
  page?: number;
  limit?: number;
  category?: MemoryCategory;
}

// ─── Bulk Import ─────────────────────────────────────────────────

export interface BulkImportItem {
  content: string;
  category?: MemoryCategory;
  importance?: number;
  metadata?: Record<string, unknown>;
}

// ─── Service Interface ──────────────────────────────────────────

/** Service for managing knowledge base entries (UI-facing CRUD). */
export interface KnowledgeService {
  /**
   * Add a knowledge entry. Generates an embedding if the embedding generator
   * is configured; otherwise stores as text-only (no semantic search).
   */
  add(params: {
    projectId: string;
    content: string;
    category?: MemoryCategory;
    importance?: number;
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgeEntry>;

  /**
   * List knowledge entries with pagination and optional category filter.
   * Embeddings are NOT returned.
   */
  list(params: ListKnowledgeParams): Promise<{
    entries: KnowledgeEntry[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }>;

  /** Delete a knowledge entry by ID. Returns true if deleted, false if not found. */
  delete(id: string): Promise<boolean>;

  /**
   * Bulk import knowledge entries.
   * Processes in batches of 20 to avoid overloading the embedding API.
   */
  bulkImport(params: {
    projectId: string;
    items: BulkImportItem[];
  }): Promise<{ imported: number; failed: number; errors: string[] }>;
}
```

---
## src/knowledge/knowledge-service.ts
```typescript
/**
 * KnowledgeService — UI-facing CRUD for per-project knowledge base entries.
 *
 * Wraps the memory_entries table. Uses raw SQL for list (pgvector Unsupported field
 * cannot be selected via standard Prisma). Embedding generation is optional —
 * when no generator is provided, entries are stored with NULL embedding (text-only,
 * no semantic search, but still listable/deletable).
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import { createLogger } from '@/observability/logger.js';
import type { EmbeddingGenerator } from '@/memory/prisma-memory-store.js';
import type { MemoryCategory } from '@/memory/types.js';
import type {
  KnowledgeEntry,
  KnowledgeService,
  ListKnowledgeParams,
  BulkImportItem,
} from './types.js';

const logger = createLogger({ name: 'knowledge-service' });

/** Batch size for bulk import embedding generation. */
const BULK_BATCH_SIZE = 20;

/** Default importance for entries without an explicit value. */
const DEFAULT_IMPORTANCE = 0.5;

/** Default category for entries without an explicit category. */
const DEFAULT_CATEGORY: MemoryCategory = 'fact';

// ─── Raw DB Row ─────────────────────────────────────────────────

interface RawKnowledgeRow {
  id: string;
  project_id: string;
  category: string;
  content: string;
  importance: number;
  access_count: number;
  last_accessed_at: Date;
  created_at: Date;
  expires_at: Date | null;
  metadata: unknown;
  total_count: string; // bigint comes as string in pg
}

// ─── Mapper ─────────────────────────────────────────────────────

function toEntry(row: RawKnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category as MemoryCategory,
    content: row.content,
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
  };
}

// ─── Factory ─────────────────────────────────────────────────────

export interface KnowledgeServiceOptions {
  prisma: PrismaClient;
  /** Optional embedding generator. If omitted, entries are stored without embeddings. */
  generateEmbedding?: EmbeddingGenerator;
}

/** Create a KnowledgeService backed by Prisma + pgvector. */
export function createKnowledgeService(options: KnowledgeServiceOptions): KnowledgeService {
  const { prisma, generateEmbedding } = options;

  async function insertWithEmbedding(
    id: string,
    projectId: string,
    content: string,
    category: MemoryCategory,
    importance: number,
    now: Date,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!generateEmbedding) {
      // No embedding generator — store as text-only (embedding column stays NULL)
      await prisma.$executeRaw`
        INSERT INTO memory_entries (
          id, project_id, session_id, category, content, embedding,
          importance, access_count, last_accessed_at, created_at, expires_at, metadata
        ) VALUES (
          ${id},
          ${projectId},
          NULL,
          ${category},
          ${content},
          NULL,
          ${importance},
          0,
          ${now},
          ${now},
          NULL,
          ${metadata ? JSON.stringify(metadata) : null}::jsonb
        )
      `;
      return;
    }

    const vector = await generateEmbedding(content);
    const vectorLiteral = `[${vector.join(',')}]`;

    await prisma.$executeRaw`
      INSERT INTO memory_entries (
        id, project_id, session_id, category, content, embedding,
        importance, access_count, last_accessed_at, created_at, expires_at, metadata
      ) VALUES (
        ${id},
        ${projectId},
        NULL,
        ${category},
        ${content},
        ${vectorLiteral}::vector(1536),
        ${importance},
        0,
        ${now},
        ${now},
        NULL,
        ${metadata ? JSON.stringify(metadata) : null}::jsonb
      )
    `;
  }

  return {
    async add(params) {
      const id = nanoid();
      const now = new Date();
      const category = params.category ?? DEFAULT_CATEGORY;
      const importance = params.importance ?? DEFAULT_IMPORTANCE;

      await insertWithEmbedding(id, params.projectId, params.content, category, importance, now, params.metadata);

      logger.info('Knowledge entry added', {
        component: 'knowledge-service',
        id,
        projectId: params.projectId,
        category,
        hasEmbedding: generateEmbedding !== undefined,
      });

      return {
        id,
        projectId: params.projectId,
        category,
        content: params.content,
        importance,
        accessCount: 0,
        lastAccessedAt: now,
        createdAt: now,
        metadata: params.metadata,
      };
    },

    async list(params: ListKnowledgeParams) {
      const page = params.page ?? 1;
      const limit = Math.min(params.limit ?? 20, 100);
      const offset = (page - 1) * limit;

      const conditions: Prisma.Sql[] = [
        Prisma.sql`project_id = ${params.projectId}`,
      ];

      if (params.category) {
        conditions.push(Prisma.sql`category = ${params.category}`);
      }

      const whereClause = Prisma.join(conditions, ' AND ');

      const rows = await prisma.$queryRaw<RawKnowledgeRow[]>`
        SELECT
          id, project_id, category, content, importance,
          access_count, last_accessed_at, created_at, expires_at, metadata,
          COUNT(*) OVER() AS total_count
        FROM memory_entries
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const total = rows.length > 0 ? parseInt(rows[0]?.total_count ?? '0', 10) : 0;

      return {
        entries: rows.map(toEntry),
        total,
        page,
        limit,
        hasMore: offset + rows.length < total,
      };
    },

    async delete(id: string): Promise<boolean> {
      try {
        await prisma.memoryEntry.delete({ where: { id } });
        logger.info('Knowledge entry deleted', { component: 'knowledge-service', id });
        return true;
      } catch {
        return false;
      }
    },

    async bulkImport(params: { projectId: string; items: BulkImportItem[] }) {
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      // Process in batches of BULK_BATCH_SIZE
      for (let i = 0; i < params.items.length; i += BULK_BATCH_SIZE) {
        const batch = params.items.slice(i, i + BULK_BATCH_SIZE);

        await Promise.all(
          batch.map(async (item, batchIdx) => {
            const globalIdx = i + batchIdx;
            try {
              const id = nanoid();
              const now = new Date();
              const category = item.category ?? DEFAULT_CATEGORY;
              const importance = item.importance ?? DEFAULT_IMPORTANCE;

              await insertWithEmbedding(id, params.projectId, item.content, category, importance, now, item.metadata);
              imported++;
            } catch (err) {
              failed++;
              errors.push(`Item ${globalIdx}: ${err instanceof Error ? err.message : String(err)}`);
              logger.warn('Bulk import item failed', {
                component: 'knowledge-service',
                projectId: params.projectId,
                itemIndex: globalIdx,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
      }

      logger.info('Bulk knowledge import complete', {
        component: 'knowledge-service',
        projectId: params.projectId,
        imported,
        failed,
      });

      return { imported, failed, errors };
    },
  };
}
```

---
## src/knowledge/index.ts
```typescript
/**
 * Knowledge base module — per-project CRUD for memory entries.
 */
export type {
  KnowledgeEntry,
  KnowledgeService,
  ListKnowledgeParams,
  BulkImportItem,
} from './types.js';

export { createKnowledgeService } from './knowledge-service.js';
export type { KnowledgeServiceOptions } from './knowledge-service.js';
```

---
## src/files/types.ts
```typescript
import type { ProjectId } from '@/core/types.js';

// ─── File ID ────────────────────────────────────────────────────

export type FileId = string;

// ─── Storage Provider ───────────────────────────────────────────

export type StorageProvider = 'local' | 's3';

// ─── Stored File ────────────────────────────────────────────────

export interface StoredFile {
  id: FileId;
  projectId: ProjectId;

  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;

  storageProvider: StorageProvider;
  storagePath: string;

  /** Optional: public URL if accessible */
  publicUrl?: string;

  uploadedBy?: string;
  uploadedAt: Date;
  expiresAt?: Date;

  metadata?: Record<string, unknown>;
}

// ─── Upload Input ───────────────────────────────────────────────

export interface UploadFileInput {
  projectId: ProjectId;
  filename: string;
  mimeType: string;
  content: Buffer;
  uploadedBy?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ─── File Repository ────────────────────────────────────────────

export interface FileRepository {
  create(file: Omit<StoredFile, 'id' | 'uploadedAt'>): Promise<StoredFile>;
  findById(id: FileId): Promise<StoredFile | null>;
  findByProject(projectId: ProjectId, options?: { limit?: number; offset?: number }): Promise<StoredFile[]>;
  delete(id: FileId): Promise<void>;
  updateMetadata(id: FileId, metadata: Record<string, unknown>): Promise<StoredFile>;
}

// ─── File Storage Interface ─────────────────────────────────────

export interface FileStorage {
  /** Storage provider type */
  readonly provider: StorageProvider;

  /** Upload a file and return the storage path */
  upload(input: UploadFileInput): Promise<{ storagePath: string; publicUrl?: string }>;

  /** Download a file by storage path */
  download(storagePath: string): Promise<Buffer>;

  /** Delete a file by storage path */
  delete(storagePath: string): Promise<void>;

  /** Get a signed URL for temporary access (if supported) */
  getSignedUrl?(storagePath: string, expiresInSeconds: number): Promise<string>;

  /** Check if a file exists */
  exists(storagePath: string): Promise<boolean>;
}
```

---
## src/files/storage-local.ts
```typescript
/**
 * Local File Storage — stores files on the local filesystem.
 */
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { FileStorage, UploadFileInput } from './types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface LocalStorageConfig {
  /** Base directory for file storage */
  basePath: string;
  /** Optional: base URL for public access */
  baseUrl?: string;
}

// ─── Helper: Generate Storage Path ──────────────────────────────

function generateStoragePath(projectId: string, filename: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const uuid = randomUUID();
  
  // Extract extension from filename
  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const storageName = ext ? `${uuid}.${ext}` : uuid;
  
  // Path: projectId/year/month/day/uuid.ext (always forward slashes for portability)
  return [projectId, year.toString(), month, day, storageName].join('/');
}

// ─── Storage Factory ────────────────────────────────────────────

/**
 * Create a local file storage instance.
 */
export function createLocalStorage(config: LocalStorageConfig): FileStorage {
  const { basePath, baseUrl } = config;

  return {
    provider: 'local',

    async upload(input: UploadFileInput): Promise<{ storagePath: string; publicUrl?: string }> {
      const storagePath = generateStoragePath(input.projectId, input.filename);
      const fullPath = join(basePath, storagePath);

      // Ensure directory exists
      await mkdir(dirname(fullPath), { recursive: true });

      // Write file
      await writeFile(fullPath, input.content);

      // Generate public URL if base URL is configured
      const publicUrl = baseUrl ? `${baseUrl}/${storagePath}` : undefined;

      return { storagePath, publicUrl };
    },

    async download(storagePath: string): Promise<Buffer> {
      const fullPath = join(basePath, storagePath);
      return readFile(fullPath);
    },

    async delete(storagePath: string): Promise<void> {
      const fullPath = join(basePath, storagePath);
      try {
        await unlink(fullPath);
      } catch (error) {
        // Ignore if file doesn't exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    },

    async exists(storagePath: string): Promise<boolean> {
      const fullPath = join(basePath, storagePath);
      try {
        await access(fullPath);
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

---
## src/files/file-service.ts
```typescript
/**
 * File Service — combines storage and repository for complete file operations.
 */
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type {
  FileId,
  FileRepository,
  FileStorage,
  StoredFile,
  UploadFileInput,
} from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface FileServiceDeps {
  storage: FileStorage;
  repository: FileRepository;
  logger: Logger;
}

export interface FileService {
  /** Upload a file (stores in storage + creates DB record) */
  upload(input: UploadFileInput): Promise<StoredFile>;

  /** Download a file by ID */
  download(id: FileId): Promise<{ file: StoredFile; content: Buffer }>;

  /** Get file metadata by ID */
  getById(id: FileId): Promise<StoredFile | null>;

  /** Delete a file (removes from storage + DB) */
  delete(id: FileId): Promise<void>;

  /** Get a temporary URL for accessing a file (if supported) */
  getTemporaryUrl(id: FileId, expiresInSeconds?: number): Promise<string | null>;

  /** List all files for a project */
  listByProject(projectId: ProjectId, options?: { limit?: number }): Promise<StoredFile[]>;
}

// ─── Service Factory ────────────────────────────────────────────

/**
 * Create a FileService instance.
 */
export function createFileService(deps: FileServiceDeps): FileService {
  const { storage, repository, logger } = deps;

  return {
    async upload(input: UploadFileInput): Promise<StoredFile> {
      logger.info('Uploading file', {
        component: 'file-service',
        projectId: input.projectId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
      });

      // 1. Upload to storage
      const { storagePath, publicUrl } = await storage.upload(input);

      // 2. Create DB record
      const file = await repository.create({
        projectId: input.projectId,
        filename: storagePath.split('/').pop() ?? input.filename,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
        storageProvider: storage.provider,
        storagePath,
        publicUrl,
        uploadedBy: input.uploadedBy,
        expiresAt: input.expiresAt,
        metadata: input.metadata,
      });

      logger.info('File uploaded', {
        component: 'file-service',
        fileId: file.id,
        storagePath,
      });

      return file;
    },

    async download(id: FileId): Promise<{ file: StoredFile; content: Buffer }> {
      const file = await repository.findById(id);

      if (!file) {
        throw new Error(`File not found: ${id}`);
      }

      logger.debug('Downloading file', {
        component: 'file-service',
        fileId: id,
        storagePath: file.storagePath,
      });

      const content = await storage.download(file.storagePath);

      return { file, content };
    },

    async getById(id: FileId): Promise<StoredFile | null> {
      return repository.findById(id);
    },

    async delete(id: FileId): Promise<void> {
      const file = await repository.findById(id);

      if (!file) {
        throw new Error(`File not found: ${id}`);
      }

      logger.info('Deleting file', {
        component: 'file-service',
        fileId: id,
        storagePath: file.storagePath,
      });

      // 1. Delete from storage
      await storage.delete(file.storagePath);

      // 2. Delete DB record
      await repository.delete(id);

      logger.info('File deleted', {
        component: 'file-service',
        fileId: id,
      });
    },

    async listByProject(projectId: ProjectId, options?: { limit?: number }): Promise<StoredFile[]> {
      return repository.findByProject(projectId, options);
    },

    async getTemporaryUrl(id: FileId, expiresInSeconds = 3600): Promise<string | null> {
      const file = await repository.findById(id);

      if (!file) {
        return null;
      }

      // If file has a public URL, return it
      if (file.publicUrl) {
        return file.publicUrl;
      }

      // If storage supports signed URLs, use that
      if (storage.getSignedUrl) {
        return storage.getSignedUrl(file.storagePath, expiresInSeconds);
      }

      return null;
    },
  };
}
```

---
## src/files/index.ts
```typescript
// Types
export * from './types.js';

// Storage implementations
export { createLocalStorage } from './storage-local.js';
export type { LocalStorageConfig } from './storage-local.js';

// File Service
export { createFileService } from './file-service.js';
export type { FileService, FileServiceDeps } from './file-service.js';
```

---
## src/contacts/types.ts
```typescript
import type { ProjectId } from '@/core/types.js';

// ─── Contact ID ─────────────────────────────────────────────────

export type ContactId = string;

// ─── Contact ────────────────────────────────────────────────────

export interface Contact {
  id: ContactId;
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language: string;
  /** Contact role — e.g. 'owner', 'staff', 'customer', or undefined for default. */
  role?: string;
  /** Arbitrary labels — e.g. ["vip", "wholesale", "prospect"]. */
  tags: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Create/Update Inputs ───────────────────────────────────────

export interface CreateContactInput {
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language?: string;
  role?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateContactInput {
  name?: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language?: string;
  role?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Channel Identifier ─────────────────────────────────────────

export type ChannelIdentifier =
  | { type: 'phone'; value: string }
  | { type: 'email'; value: string }
  | { type: 'telegramId'; value: string }
  | { type: 'slackId'; value: string };

// ─── List Options ───────────────────────────────────────────────

export interface ContactListOptions {
  limit?: number;
  offset?: number;
}

// ─── Repository Interface ───────────────────────────────────────

export interface ContactRepository {
  create(input: CreateContactInput): Promise<Contact>;
  findById(id: ContactId): Promise<Contact | null>;
  findByChannel(projectId: ProjectId, identifier: ChannelIdentifier): Promise<Contact | null>;
  update(id: ContactId, input: UpdateContactInput): Promise<Contact>;
  delete(id: ContactId): Promise<void>;
  list(projectId: ProjectId, options?: ContactListOptions): Promise<Contact[]>;
}
```

---
## src/contacts/index.ts
```typescript
export * from './types.js';
```

---
## src/webhooks/types.ts
```typescript
import type { ProjectId } from '@/core/types.js';

// ─── Webhook ID ─────────────────────────────────────────────────

export type WebhookId = string;

// ─── Webhook Config ─────────────────────────────────────────────

export interface Webhook {
  id: WebhookId;
  projectId: ProjectId;
  agentId?: string;

  name: string;
  description?: string;

  /**
   * Template for the message to send to the agent.
   * Uses Mustache-style placeholders: {{field.path}}
   * Example: "New lead received: {{name}} ({{email}})"
   */
  triggerPrompt: string;

  /** Secret for HMAC validation (optional) */
  secretEnvVar?: string;

  /** Allowed IP addresses (optional, empty = allow all) */
  allowedIps?: string[];

  status: 'active' | 'paused';

  createdAt: Date;
  updatedAt: Date;
}

// ─── Create/Update Inputs ───────────────────────────────────────

export interface CreateWebhookInput {
  projectId: ProjectId;
  agentId?: string;
  name: string;
  description?: string;
  triggerPrompt: string;
  secretEnvVar?: string;
  allowedIps?: string[];
  status?: 'active' | 'paused';
}

export interface UpdateWebhookInput {
  agentId?: string;
  name?: string;
  description?: string;
  triggerPrompt?: string;
  secretEnvVar?: string;
  allowedIps?: string[];
  status?: 'active' | 'paused';
}

// ─── Webhook Event ──────────────────────────────────────────────

export interface WebhookEvent {
  webhookId: WebhookId;
  payload: unknown;
  headers: Record<string, string>;
  sourceIp?: string;
  receivedAt: Date;
}

// ─── Webhook Execution Result ───────────────────────────────────

export interface WebhookExecutionResult {
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: string;
  durationMs: number;
}

// ─── Repository Interface ───────────────────────────────────────

export interface WebhookRepository {
  create(input: CreateWebhookInput): Promise<Webhook>;
  findById(id: WebhookId): Promise<Webhook | null>;
  update(id: WebhookId, input: UpdateWebhookInput): Promise<Webhook>;
  delete(id: WebhookId): Promise<void>;
  list(projectId: ProjectId): Promise<Webhook[]>;
  listActive(projectId: ProjectId): Promise<Webhook[]>;
}
```

---
## src/webhooks/webhook-processor.ts
```typescript
/**
 * Webhook Processor — validates and processes incoming webhook events.
 *
 * Responsibilities:
 * 1. Validate webhook exists and is active
 * 2. Validate HMAC signature (if configured)
 * 3. Validate source IP (if configured)
 * 4. Parse the trigger prompt template with payload data
 * 5. Run the agent with the generated prompt
 */
import { createHmac } from 'crypto';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type {
  Webhook,
  WebhookEvent,
  WebhookExecutionResult,
  WebhookRepository,
} from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface WebhookProcessorDeps {
  webhookRepository: WebhookRepository;
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Function to run the agent and get a response */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

export interface WebhookProcessor {
  /** Process a webhook event */
  process(event: WebhookEvent): Promise<WebhookExecutionResult>;

  /** Validate HMAC signature */
  validateSignature(
    webhook: Webhook,
    payload: string,
    signature: string,
  ): boolean;
}

// ─── Template Parsing ───────────────────────────────────────────

/**
 * Parse a Mustache-style template with the given data.
 * Supports nested paths: {{user.name}}, {{data.items.0.id}}
 */
function parseTemplate(template: string, data: unknown): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const value = getNestedValue(data, path.trim());
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ─── Processor Factory ──────────────────────────────────────────

/**
 * Create a WebhookProcessor.
 */
export function createWebhookProcessor(deps: WebhookProcessorDeps): WebhookProcessor {
  const { webhookRepository, sessionRepository, logger, runAgent } = deps;

  return {
    async process(event: WebhookEvent): Promise<WebhookExecutionResult> {
      const startTime = Date.now();

      logger.info('Processing webhook event', {
        component: 'webhook-processor',
        webhookId: event.webhookId,
      });

      try {
        // 1. Validate webhook exists
        const webhook = await webhookRepository.findById(event.webhookId);

        if (!webhook) {
          logger.warn('Webhook not found', {
            component: 'webhook-processor',
            webhookId: event.webhookId,
          });
          return {
            success: false,
            error: 'Webhook not found',
            durationMs: Date.now() - startTime,
          };
        }

        // 2. Check if webhook is active
        if (webhook.status !== 'active') {
          logger.warn('Webhook is not active', {
            component: 'webhook-processor',
            webhookId: event.webhookId,
            status: webhook.status,
          });
          return {
            success: false,
            error: 'Webhook is paused',
            durationMs: Date.now() - startTime,
          };
        }

        // 3. Validate IP if configured
        if (webhook.allowedIps && webhook.allowedIps.length > 0 && event.sourceIp) {
          if (!webhook.allowedIps.includes(event.sourceIp)) {
            logger.warn('IP not allowed', {
              component: 'webhook-processor',
              webhookId: event.webhookId,
              sourceIp: event.sourceIp,
            });
            return {
              success: false,
              error: 'IP not allowed',
              durationMs: Date.now() - startTime,
            };
          }
        }

        // 4. Validate HMAC if configured
        if (webhook.secretEnvVar) {
          const signature = event.headers['x-webhook-signature'] ??
                           event.headers['x-hub-signature-256'] ??
                           event.headers['x-signature'];

          if (!signature) {
            logger.warn('Missing signature', {
              component: 'webhook-processor',
              webhookId: event.webhookId,
            });
            return {
              success: false,
              error: 'Missing signature',
              durationMs: Date.now() - startTime,
            };
          }

          const payloadString = typeof event.payload === 'string'
            ? event.payload
            : JSON.stringify(event.payload);

          if (!this.validateSignature(webhook, payloadString, signature)) {
            logger.warn('Invalid signature', {
              component: 'webhook-processor',
              webhookId: event.webhookId,
            });
            return {
              success: false,
              error: 'Invalid signature',
              durationMs: Date.now() - startTime,
            };
          }
        }

        // 5. Parse the trigger prompt template
        const prompt = parseTemplate(webhook.triggerPrompt, event.payload);

        logger.debug('Parsed webhook prompt', {
          component: 'webhook-processor',
          webhookId: event.webhookId,
          prompt,
        });

        // 6. Create a new session for this webhook event
        const session = await sessionRepository.create({
          projectId: webhook.projectId,
          metadata: {
            source: 'webhook',
            webhookId: webhook.id,
            webhookName: webhook.name,
          },
        });

        // 7. Run the agent
        const agentResult = await runAgent({
          projectId: webhook.projectId,
          sessionId: session.id,
          userMessage: prompt,
        });

        const durationMs = Date.now() - startTime;

        logger.info('Webhook processed successfully', {
          component: 'webhook-processor',
          webhookId: event.webhookId,
          sessionId: session.id,
          durationMs,
        });

        return {
          success: true,
          sessionId: session.id,
          response: agentResult.response,
          durationMs,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error('Failed to process webhook', {
          component: 'webhook-processor',
          webhookId: event.webhookId,
          error: errorMessage,
        });

        return {
          success: false,
          error: errorMessage,
          durationMs: Date.now() - startTime,
        };
      }
    },

    validateSignature(
      webhook: Webhook,
      payload: string,
      signature: string,
    ): boolean {
      if (!webhook.secretEnvVar) return true;

      const secret = process.env[webhook.secretEnvVar];
      if (!secret) {
        logger.warn('Webhook secret env var not set', {
          component: 'webhook-processor',
          webhookId: webhook.id,
          secretEnvVar: webhook.secretEnvVar,
        });
        return false;
      }

      // Support both raw and prefixed signatures
      const signatureValue = signature.startsWith('sha256=')
        ? signature.slice(7)
        : signature;

      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Constant-time comparison
      if (signatureValue.length !== expectedSignature.length) {
        return false;
      }

      let result = 0;
      for (let i = 0; i < signatureValue.length; i++) {
        result |= signatureValue.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
      }

      return result === 0;
    },
  };
}
```

---
## src/webhooks/index.ts
```typescript
// Types
export * from './types.js';

// Processor
export { createWebhookProcessor } from './webhook-processor.js';
export type { WebhookProcessor, WebhookProcessorDeps } from './webhook-processor.js';
```

---
## src/skills/types.ts
```typescript
/**
 * Skill System Types
 *
 * Skills are composable capability packages (instructions + tools + MCP + parameters)
 * that can be assigned to agents. Layer 1 = always-active capabilities.
 */

// ─── Skill Template ──────────────────────────────────────────

/** Global skill template (reusable across projects). */
export interface SkillTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: SkillCategory;

  /** Instructions fragment appended to the agent's Instructions prompt layer. */
  instructionsFragment: string;
  /** Tool IDs this skill requires. */
  requiredTools: string[];
  /** MCP server names this skill requires (optional). */
  requiredMcpServers: string[];

  /** JSON Schema for customizable parameters (rendered as form in dashboard). */
  parametersSchema: Record<string, unknown> | null;

  tags: string[];
  /** Lucide icon name for dashboard display. */
  icon: string | null;
  isOfficial: boolean;
  version: number;
  status: SkillTemplateStatus;

  createdAt: Date;
  updatedAt: Date;
}

/** Per-project skill instance (created from template or custom). */
export interface SkillInstance {
  id: string;
  projectId: string;
  templateId: string | null;
  name: string;
  displayName: string;
  description: string | null;

  /** Instructions fragment (can override template). */
  instructionsFragment: string;
  /** Tool IDs (can override template). */
  requiredTools: string[];
  /** MCP server names (can override template). */
  requiredMcpServers: string[];

  /** Resolved parameter values (user-filled). */
  parameters: Record<string, unknown> | null;

  status: SkillInstanceStatus;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Enums ──────────────────────────────────────────────────

export type SkillCategory = 'sales' | 'support' | 'operations' | 'communication';
export type SkillTemplateStatus = 'draft' | 'published' | 'deprecated';
export type SkillInstanceStatus = 'active' | 'disabled';

// ─── Composition Result ─────────────────────────────────────

/** Result of composing all skills assigned to an agent. */
export interface SkillComposition {
  /** Concatenated instructions fragments with section headers. */
  mergedInstructions: string;
  /** Union of all required tool IDs (deduplicated). */
  mergedTools: string[];
  /** Union of all required MCP server names (deduplicated). */
  mergedMcpServers: string[];
}

// ─── Inputs ─────────────────────────────────────────────────

/** Input for creating a skill instance. */
export interface CreateSkillInstanceInput {
  projectId: string;
  templateId?: string;
  name: string;
  displayName: string;
  description?: string;
  instructionsFragment: string;
  requiredTools?: string[];
  requiredMcpServers?: string[];
  parameters?: Record<string, unknown>;
}

/** Input for updating a skill instance. */
export interface UpdateSkillInstanceInput {
  name?: string;
  displayName?: string;
  description?: string;
  instructionsFragment?: string;
  requiredTools?: string[];
  requiredMcpServers?: string[];
  parameters?: Record<string, unknown>;
  status?: SkillInstanceStatus;
}

// ─── Repository Interface ───────────────────────────────────

/** Repository for skill template and instance CRUD. */
export interface SkillRepository {
  // Templates
  listTemplates(category?: SkillCategory): Promise<SkillTemplate[]>;
  getTemplate(id: string): Promise<SkillTemplate | null>;

  // Instances
  listInstances(projectId: string): Promise<SkillInstance[]>;
  getInstance(id: string): Promise<SkillInstance | null>;
  getInstancesByIds(ids: string[]): Promise<SkillInstance[]>;
  createInstance(input: CreateSkillInstanceInput): Promise<SkillInstance>;
  updateInstance(id: string, input: UpdateSkillInstanceInput): Promise<SkillInstance>;
  deleteInstance(id: string): Promise<void>;
}
```

---
## src/skills/index.ts
```typescript
/**
 * Skills Module — Public API
 */
export type {
  SkillTemplate,
  SkillInstance,
  SkillCategory,
  SkillTemplateStatus,
  SkillInstanceStatus,
  SkillComposition,
  SkillRepository,
  CreateSkillInstanceInput,
  UpdateSkillInstanceInput,
} from './types.js';

export { createSkillRepository } from './skill-repository.js';
export { createSkillService } from './skill-service.js';
export type { SkillService } from './skill-service.js';
```

