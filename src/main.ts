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
import { createToolRegistry } from '@/tools/registry/tool-registry.js';
import {
  createCalculatorTool,
  createDateTimeTool,
  createJsonTransformTool,
  createKnowledgeSearchTool,
} from '@/tools/definitions/index.js';
import { resolveEmbeddingProvider } from '@/providers/embeddings.js';
import { createPrismaMemoryStore } from '@/memory/prisma-memory-store.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import { createTaskManager } from '@/scheduling/task-manager.js';
import { createTaskRunner } from '@/scheduling/task-runner.js';
import { createTaskExecutor } from '@/scheduling/task-executor.js';
import { createMCPManager } from '@/mcp/mcp-manager.js';
import { createChannelRouter } from '@/channels/channel-router.js';
import { createInboundProcessor } from '@/channels/inbound-processor.js';
import { createWebhookProcessor } from '@/webhooks/webhook-processor.js';
import { createFileService } from '@/files/file-service.js';
import { createLocalStorage } from '@/files/storage-local.js';
import { createAgentRegistry } from '@/agents/agent-registry.js';
import { createAgentComms } from '@/agents/agent-comms.js';
import { registerErrorHandler } from '@/api/error-handler.js';
import { registerRoutes } from '@/api/routes/index.js';
import type { RouteDependencies } from '@/api/types.js';
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

    // Create shared services
    const approvalGate = createApprovalGate();
    const toolRegistry = createToolRegistry();
    toolRegistry.register(createCalculatorTool());
    toolRegistry.register(createDateTimeTool());
    toolRegistry.register(createJsonTransformTool());
    const taskManager = createTaskManager({ repository: scheduledTaskRepository });
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

    // Placeholder runAgent — full agent loop integration is wired via the chat route
    const runAgent = (params: {
      projectId: ProjectId;
      sessionId: string;
      userMessage: string;
    }): Promise<{ response: string }> => {
      void params;
      logger.warn('runAgent placeholder called — wire full agent loop for production', {
        component: 'main',
      });
      return Promise.resolve({ response: 'Agent loop not yet wired for inbound processing.' });
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
      longTermMemoryStore,
      logger,
    };

    // Register API routes under /api/v1 prefix
    await server.register(
      async (prefixed) => {
        await prefixed.register(registerRoutes, deps);
      },
      { prefix: '/api/v1' },
    );

    // Conditionally start task runner if Redis is configured
    let taskRunner: ReturnType<typeof createTaskRunner> | null = null;
    const redisUrl = process.env['REDIS_URL'];
    if (redisUrl) {
      const onExecuteTask = createTaskExecutor({
        projectRepository,
        sessionRepository,
        promptLayerRepository,
        toolRegistry,
        mcpManager,
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
    }

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down...', { component: 'main' });
      await mcpManager.disconnectAll();
      if (taskRunner) {
        await taskRunner.stop();
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
