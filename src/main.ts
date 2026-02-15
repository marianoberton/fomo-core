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
} from '@/tools/definitions/index.js';
import { resolveEmbeddingProvider } from '@/providers/embeddings.js';
import { createPrismaMemoryStore } from '@/memory/prisma-memory-store.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import { createTaskManager } from '@/scheduling/task-manager.js';
import { createTaskRunner } from '@/scheduling/task-runner.js';
import { createTaskExecutor } from '@/scheduling/task-executor.js';
import { createMCPManager } from '@/mcp/mcp-manager.js';
import { Queue } from 'bullmq';
import { createChannelRouter } from '@/channels/channel-router.js';
import { createProactiveMessenger, PROACTIVE_MESSAGE_QUEUE } from '@/channels/proactive.js';
import type { ProactiveMessenger } from '@/channels/proactive.js';
import { createTelegramAdapter } from '@/channels/adapters/telegram.js';
import { createWhatsAppAdapter } from '@/channels/adapters/whatsapp.js';
import { createSlackAdapter } from '@/channels/adapters/slack.js';
import { createInboundProcessor } from '@/channels/inbound-processor.js';
import { createWebhookProcessor } from '@/webhooks/webhook-processor.js';
import { createFileService } from '@/files/file-service.js';
import { createLocalStorage } from '@/files/storage-local.js';
import { createAgentRegistry } from '@/agents/agent-registry.js';
import { createAgentComms } from '@/agents/agent-comms.js';
import { createChannelIntegrationRepository } from '@/infrastructure/repositories/channel-integration-repository.js';
import { createChannelResolver } from '@/channels/channel-resolver.js';
import { createHandoffManager, DEFAULT_HANDOFF_CONFIG } from '@/channels/handoff.js';
import { registerErrorHandler } from '@/api/error-handler.js';
import { registerRoutes } from '@/api/routes/index.js';
import { chatwootWebhookRoutes } from '@/api/routes/chatwoot-webhook.js';
import { createWebhookQueue } from '@/channels/webhook-queue.js';
import type { WebhookQueue } from '@/channels/webhook-queue.js';
import { onboardingRoutes } from '@/api/routes/onboarding.js';
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

    // Create shared services
    const approvalGate = createApprovalGate({ store: createPrismaApprovalStore(prisma) });
    const toolRegistry = createToolRegistry();
    toolRegistry.register(createCalculatorTool());
    toolRegistry.register(createDateTimeTool());
    toolRegistry.register(createJsonTransformTool());
    toolRegistry.register(createHttpRequestTool());
    toolRegistry.register(createSendNotificationTool());
    const taskManager = createTaskManager({ repository: scheduledTaskRepository });
    toolRegistry.register(createProposeScheduledTaskTool({ taskManager }));
    const mcpManager = createMCPManager();

    // Long-term memory (pgvector embeddings) — enabled when OPENAI_API_KEY is set
    let longTermMemoryStore: LongTermMemoryStore | null = null;
    const embeddingGenerator = resolveEmbeddingProvider('openai');
    if (embeddingGenerator) {
      longTermMemoryStore = createPrismaMemoryStore(prisma, embeddingGenerator);
      toolRegistry.register(createKnowledgeSearchTool({ store: longTermMemoryStore }));
      logger.info('Long-term memory enabled (pgvector + OpenAI embeddings)', { component: 'main' });
    } else {
      logger.info('Long-term memory disabled (no embedding API key)', { component: 'main' });
    }

    // Channel system
    const channelRouter = createChannelRouter({ logger });

    // Register channel adapters (conditional on env vars)
    if (process.env['TELEGRAM_BOT_TOKEN']) {
      channelRouter.registerAdapter(createTelegramAdapter({
        botTokenEnvVar: 'TELEGRAM_BOT_TOKEN',
      }));
      logger.info('Telegram adapter registered', { component: 'main' });
    }

    if (process.env['WHATSAPP_ACCESS_TOKEN']) {
      channelRouter.registerAdapter(createWhatsAppAdapter({
        accessTokenEnvVar: 'WHATSAPP_ACCESS_TOKEN',
        phoneNumberId: process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
      }));
      logger.info('WhatsApp adapter registered', { component: 'main' });
    }

    if (process.env['SLACK_BOT_TOKEN']) {
      channelRouter.registerAdapter(createSlackAdapter({
        botTokenEnvVar: 'SLACK_BOT_TOKEN',
        signingSecretEnvVar: 'SLACK_SIGNING_SECRET',
      }));
      logger.info('Slack adapter registered', { component: 'main' });
    }

    // Shared deps for prepareChatRun (same subset used by chat routes and task-executor)
    const chatSetupDeps = {
      projectRepository,
      sessionRepository,
      promptLayerRepository,
      toolRegistry,
      mcpManager,
      longTermMemoryStore,
      prisma,
      logger,
    };

    // Real runAgent — runs the full agent loop for inbound channels and webhooks
    const runAgent = async (params: {
      projectId: ProjectId;
      sessionId: string;
      userMessage: string;
    }): Promise<{ response: string }> => {
      const setupResult = await prepareChatRun(
        { projectId: params.projectId, sessionId: params.sessionId, message: params.userMessage },
        chatSetupDeps,
      );

      if (!setupResult.ok) {
        logger.error('runAgent setup failed', {
          component: 'main',
          projectId: params.projectId,
          sessionId: params.sessionId,
          error: setupResult.error.message,
          code: setupResult.error.code,
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

        const assistantText = extractAssistantResponse(trace.events);

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
        });

        return { response: assistantText };
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const defaultProjectId = (process.env['DEFAULT_PROJECT_ID'] ?? 'default') as ProjectId;

    const inboundProcessor = createInboundProcessor({
      channelRouter,
      contactRepository,
      sessionRepository,
      logger,
      defaultProjectId,
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

    // Multi-agent system
    const agentRegistry = createAgentRegistry({ agentRepository, logger });
    const agentComms = createAgentComms({ logger });

    // Chatwoot integration (channel resolver + handoff)
    const channelResolver = createChannelResolver({
      integrationRepository: channelIntegrationRepository,
      logger,
    });
    const handoffManager = createHandoffManager({
      config: DEFAULT_HANDOFF_CONFIG,
      logger,
    });
    logger.info('Chatwoot integration initialized', { component: 'main' });

    // Register Fastify plugins
    const corsOrigin = process.env['CORS_ORIGIN'];
    await server.register(cors, {
      origin: corsOrigin ? corsOrigin.split(',') : true,
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
      const proactiveQueue = new Queue(PROACTIVE_MESSAGE_QUEUE, { connection: redisConnection });
      proactiveMessenger = createProactiveMessenger({
        channelRouter,
        queue: proactiveQueue,
        logger,
      });
      logger.info('Proactive messenger enabled (Redis connected)', { component: 'main' });

      // Webhook queue (async webhook processing with retry)
      webhookQueue = createWebhookQueue({
        logger,
        redisUrl,
        resolveAdapter: async (projectId) => await channelResolver.resolveAdapter(projectId),
        inboundProcessor,
        handoffManager,
        runAgent,
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
      channelRouter,
      inboundProcessor,
      webhookProcessor,
      fileService,
      agentRegistry,
      agentComms,
      proactiveMessenger,
      longTermMemoryStore,
      prisma,
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
