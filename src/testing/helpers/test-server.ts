/**
 * Test server helper for E2E tests.
 * Creates a Fastify server with all routes and dependencies.
 */
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { createLogger } from '@/observability/logger.js';
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
} from '@/tools/definitions/index.js';
import { createTaskManager } from '@/scheduling/task-manager.js';
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

/** Options for creating test server. */
export interface TestServerOptions {
  /** Prisma client for database access. */
  prisma: PrismaClient;
  /** Redis client for BullMQ/caching. */
  redis?: Redis;
  /** Whether to use mock LLM providers (default: true). */
  mockProviders?: boolean;
}

/**
 * Create a test server with all routes and dependencies.
 * Useful for E2E testing with full request/response cycle.
 *
 * @param options - Test server options.
 * @returns Fastify server instance.
 */
export async function createTestServer(options: TestServerOptions): Promise<FastifyInstance> {
  const { prisma, redis, mockProviders = true } = options;

  const logger = createLogger();

  const server = Fastify({
    logger: false, // Suppress Fastify logs in tests
  });

  // Register plugins
  await server.register(cors);
  await server.register(websocketPlugin);

  // Health check endpoint
  server.get('/health', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

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

  // Channel system
  const channelRouter = createChannelRouter({ logger });

  // File system
  const fileStorage = createLocalStorage({
    baseDir: './test-storage',
  });
  const fileService = createFileService({
    storage: fileStorage,
    repository: fileRepository,
  });

  // Agent system
  const agentRegistry = createAgentRegistry({
    repository: agentRepository,
    cacheTTLMs: 60000,
  });
  const agentComms = createAgentComms();

  // Inbound processor (for channels)
  const inboundProcessor = createInboundProcessor({
    projectRepository,
    sessionRepository,
    contactRepository,
    logger,
    runAgent: async () => {
      // Placeholder for tests
      return { response: 'Test agent response.' };
    },
  });

  // Webhook processor
  const webhookProcessor = createWebhookProcessor({
    repository: webhookRepository,
    sessionRepository,
    logger,
    runAgent: async () => {
      // Placeholder for tests
      return { response: 'Test webhook response.' };
    },
  });

  // Assemble dependencies
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
    longTermMemoryStore: null,
    logger,
  };

  // Register error handler
  registerErrorHandler(server);

  // Register routes under /api/v1 prefix (matches production setup)
  await server.register(
    async (prefixed) => {
      await prefixed.register(registerRoutes, deps);
    },
    { prefix: '/api/v1' },
  );

  // Start server on random port for tests
  await server.listen({ port: 0, host: '127.0.0.1' });

  return server;
}
