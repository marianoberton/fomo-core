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
  createAgentRunRepository,
} from '@/infrastructure/repositories/index.js';
import { createSecretRepository } from '@/infrastructure/repositories/secret-repository.js';
import { createSecretService } from '@/secrets/secret-service.js';
import { createApiKeyService } from '@/security/api-key-service.js';
import { createDokployService } from '@/provisioning/dokploy-service.js';
import { createProvisioningService } from '@/provisioning/provisioning-service.js';
import { registerHealthRoutes } from '@/infrastructure/health.js';
import { registerMetricsRoute, recordMessage, recordLatency } from '@/infrastructure/metrics.js';
import { createClientMonitor } from '@/infrastructure/client-monitor.js';
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
  createTwentyCrmTool,
  createTwentyUpdateTool,
  createOdooGetDebtsTool,
  createOdooRegisterPaymentTool,
  createNotifyOwnerTool,
  createMpCreatePaymentLinkTool,
  createWahaSendMessageTool,
  createNotionCreateTaskTool,
  createGmailSendTool,
  createGoogleCalendarEventTool,
  createGmailReadTool,
  createGoogleCalendarReadTool,
  createLicitacionesSearchTool,
  createLicitacionesDetailTool,
  createLicitacionesDocumentTool,
  createExcelAnalyzeTool,
  createTwentyUpsertTool,
  createTwentySearchTool,
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
  createSearchProjectMemoryTool,
  createGetOperationsSummaryTool,
  createGetAgentPerformanceTool,
  createReviewAgentActivityTool,
  createExportConversationsTool,
  createAlertRuleTool,
  createControlAgentTool,
  createScrapeWebpageTool,
  createTriggerCampaignTool,
  createAdminListProjectsTool,
  createAdminListAgentsTool,
  createAdminGetAgentTool,
  createAdminListPromptLayersTool,
  createAdminGetPromptLayerTool,
  createAdminDiffPromptLayersTool,
  createAdminQueryTracesTool,
  createAdminGetTraceTool,
  createAdminGetCostReportTool,
  createAdminGetAgentHealthTool,
  createAdminListToolsTool,
  createAdminListModelsTool,
  createAdminCreateAgentTool,
  createAdminUpdateAgentTool,
  createAdminSetAgentStatusTool,
  createAdminCreateProjectTool,
  createAdminUpdateProjectTool,
  createAdminGrantToolTool,
  createAdminRevokeToolTool,
  createAdminSetAgentModelTool,
  createAdminCreatePromptLayerTool,
  createAdminActivatePromptLayerTool,
  createAdminSandboxRunTool,
  createAdminSandboxCompareTool,
  createAdminSandboxPromoteTool,
  createAdminDeleteAgentTool,
  createAdminDeleteProjectTool,
  createAdminIssueApiKeyTool,
  createAdminRevokeApiKeyTool,
  createAdminGetProvisionStatusTool,
  createAdminProvisionClientTool,
  createAdminDeprovisionClientTool,
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
import { createInMemoryDedup } from '@/channels/message-dedup.js';
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
import { registerAuthMiddleware } from '@/api/auth-middleware.js';
import { registerRoutes } from '@/api/routes/index.js';
import { chatwootWebhookRoutes } from '@/api/routes/chatwoot-webhook.js';
import { channelWebhookRoutes } from '@/api/routes/channel-webhooks.js';
import { createWebhookQueue } from '@/channels/webhook-queue.js';
import type { WebhookQueue } from '@/channels/webhook-queue.js';
import { openclawAdapterRoutes } from '@/channels/openclaw-adapter.js';
import { createTaskRegistry } from '@/channels/openclaw-task-registry.js';
import { onboardingRoutes } from '@/api/routes/onboarding.js';
import { webchatPublicRoutes } from '@/api/routes/webchat.js';
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
import { createCampaignRunner } from '@/campaigns/campaign-runner.js';
import { createNotifySlackTool } from '@/tools/definitions/notify-slack.js';
import type { CampaignRunner } from '@/campaigns/campaign-runner.js';

const logger = createLogger();

const server = Fastify({
  logger: false,
});

// Allow binary file uploads (any non-JSON content type → raw buffer)
server.addContentTypeParser(/^(?!application\/json|text\/).*/, { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});

// Health check routes registered after dependencies are ready (see registerHealthRoutes below)

async function start(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '0.0.0.0';

  try {
    // Initialize database
    const db = createDatabase({
      logQueries: process.env['NODE_ENV'] === 'development',
      connectionLimit: Number(process.env['DB_CONNECTION_LIMIT'] ?? 10),
      poolTimeoutSeconds: Number(process.env['DB_POOL_TIMEOUT'] ?? 10),
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
    const agentRunRepository = createAgentRunRepository(prisma);
    const secretRepository = createSecretRepository(prisma);
    const mcpServerRepository = createMCPServerRepository(prisma);
    const skillRepository = createSkillRepository(prisma);
    const skillService = createSkillService({ repository: skillRepository });

    // Encrypted secrets service (AES-256-GCM) — requires SECRETS_ENCRYPTION_KEY env var
    const secretService = createSecretService({ secretRepository });

    // API key service — per-project and master API keys
    const apiKeyService = createApiKeyService({ prisma, logger });

    // Dokploy provisioning — client application lifecycle management
    const dokployService = createDokployService({
      logger,
      dokployUrl: process.env['DOKPLOY_URL'] ?? 'https://panel.fomo.com.ar',
      dokployApiKey: process.env['DOKPLOY_API_KEY'] ?? '',
      dokployProjectId: process.env['DOKPLOY_PROJECT_ID'] ?? 'FB8vO-CROjg6mBFpnsuyU',
    });
    const provisioningService = createProvisioningService({ dokployService, logger });

    // Redis URL — read early for health checks and later for BullMQ services
    const redisUrl = process.env['REDIS_URL'];

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
    // Start the sweeper so stale pending approvals are resolved even after
    // a process restart (in-memory timeout timers are not persisted).
    approvalGate.startSweeper(60_000);
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
    toolRegistry.register(createSendNotificationTool({ requiresApproval: false }));
    toolRegistry.register(createWebSearchTool({ secretService }));
    toolRegistry.register(createSendEmailTool({ secretService, requiresApproval: false }));
    toolRegistry.register(createSendChannelMessageTool({ channelResolver, requiresApproval: false }));
    toolRegistry.register(createTwentyCrmTool({
      twentyBaseUrl: process.env['TWENTY_BASE_URL'] ?? 'https://crm.fomo.com.ar',
      secretService,
    }));
    toolRegistry.register(createTwentyUpdateTool({
      twentyBaseUrl: process.env['TWENTY_BASE_URL'] ?? 'https://crm.fomo.com.ar',
      secretService,
    }));
    toolRegistry.register(createTwentyUpsertTool({
      twentyBaseUrl: process.env['TWENTY_BASE_URL'] ?? 'https://crm.fomo.com.ar',
      secretService,
    }));
    toolRegistry.register(createTwentySearchTool({
      twentyBaseUrl: process.env['TWENTY_BASE_URL'] ?? 'https://crm.fomo.com.ar',
      secretService,
    }));
    const odooBaseUrl = process.env['ODOO_BASE_URL'] ?? 'https://odoo.fomo.com.ar';
    toolRegistry.register(createOdooGetDebtsTool({ odooBaseUrl, secretService }));
    toolRegistry.register(createOdooRegisterPaymentTool({ odooBaseUrl, secretService }));
    toolRegistry.register(createNotifyOwnerTool({ secretService }));
    toolRegistry.register(createNotifySlackTool({ secretService }));
    toolRegistry.register(createMpCreatePaymentLinkTool({
      secretService,
      coreBaseUrl: process.env['CORE_BASE_URL'] ?? 'https://core.fomo.com.ar',
    }));
    toolRegistry.register(createWahaSendMessageTool({ secretService }));
    toolRegistry.register(createNotionCreateTaskTool({ secretService }));
    toolRegistry.register(createGmailSendTool({ secretService }));
    toolRegistry.register(createGoogleCalendarEventTool({ secretService }));
    toolRegistry.register(createGmailReadTool({ secretService }));
    toolRegistry.register(createGoogleCalendarReadTool({ secretService }));
    toolRegistry.register(createLicitacionesSearchTool({ secretService }));
    toolRegistry.register(createLicitacionesDetailTool({ secretService }));
    toolRegistry.register(createLicitacionesDocumentTool({ secretService }));

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
      toolRegistry.register(createSearchProjectMemoryTool({ store: longTermMemoryStore }));
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
      mediaUrls?: string[];
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
          mediaUrls: params.mediaUrls,
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

        // Record metrics for observability
        const agentIdForMetrics = params.agentId ?? 'default';
        const channelForMetrics = params.sourceChannel ?? 'api';
        recordMessage(agentIdForMetrics, channelForMetrics);
        recordLatency(agentIdForMetrics, trace.totalDurationMs);

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

    const messageDeduplicator = createInMemoryDedup({ logger });

    const inboundProcessor = createInboundProcessor({
      channelResolver,
      contactRepository,
      sessionRepository,
      logger,
      agentChannelRouter,
      messageDeduplicator,
      sessionBroadcaster,
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
    toolRegistry.register(createExcelAnalyzeTool({ fileService }));

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
    toolRegistry.register(createExportConversationsTool({ prisma }));
    toolRegistry.register(createAlertRuleTool({ prisma }));
    toolRegistry.register(createControlAgentTool({ prisma, agentRegistry }));

    // Admin tools (fomo-admin agent)
    toolRegistry.register(createAdminListProjectsTool({ projectRepository, agentRepository }));
    toolRegistry.register(createAdminListAgentsTool({ projectRepository, agentRepository }));
    toolRegistry.register(createAdminGetAgentTool({ projectRepository, agentRepository }));
    toolRegistry.register(createAdminListPromptLayersTool({ prisma }));
    toolRegistry.register(createAdminGetPromptLayerTool({ prisma }));
    toolRegistry.register(createAdminDiffPromptLayersTool({ prisma }));
    toolRegistry.register(createAdminQueryTracesTool({ prisma }));
    toolRegistry.register(createAdminGetTraceTool({ prisma }));
    toolRegistry.register(createAdminGetCostReportTool({ prisma }));
    toolRegistry.register(createAdminGetAgentHealthTool({ prisma, agentRepository }));
    toolRegistry.register(createAdminListToolsTool({ toolRegistry }));
    toolRegistry.register(createAdminListModelsTool());
    // Admin write tools
    toolRegistry.register(createAdminCreateAgentTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminUpdateAgentTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminSetAgentStatusTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminCreateProjectTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminUpdateProjectTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminGrantToolTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminRevokeToolTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminSetAgentModelTool({ agentRepository, projectRepository }));
    toolRegistry.register(createAdminCreatePromptLayerTool({ prisma }));
    toolRegistry.register(createAdminActivatePromptLayerTool({ prisma }));
    // Admin sandbox tools
    toolRegistry.register(createAdminSandboxRunTool({ prisma }));
    toolRegistry.register(createAdminSandboxCompareTool({ prisma }));
    toolRegistry.register(createAdminSandboxPromoteTool({ prisma, agentRepository }));
    // Admin destructive tools
    toolRegistry.register(createAdminDeleteAgentTool({ agentRepository, projectRepository, apiKeyService }));
    toolRegistry.register(createAdminDeleteProjectTool({ agentRepository, projectRepository, apiKeyService }));
    toolRegistry.register(createAdminIssueApiKeyTool({ agentRepository, projectRepository, apiKeyService }));
    toolRegistry.register(createAdminRevokeApiKeyTool({ agentRepository, projectRepository, apiKeyService }));
    // Admin provisioning tools
    toolRegistry.register(createAdminGetProvisionStatusTool({ provisioningService }));
    toolRegistry.register(createAdminProvisionClientTool({ provisioningService }));
    toolRegistry.register(createAdminDeprovisionClientTool({ provisioningService }));

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

    // Health checks (replaces the simple /health stub)
    registerHealthRoutes(server, {
      prisma,
      redisUrl,
      dokployService,
      logger,
    });

    // Prometheus metrics endpoint
    registerMetricsRoute(server, { logger });

    // Client container monitor — checks provisioned containers every 30s
    const clientMonitor = createClientMonitor({
      dokployService,
      logger,
    });
    clientMonitor.start();

    // Conditionally start Redis-dependent services (task runner + proactive messaging + webhook queue)
    let taskRunner: ReturnType<typeof createTaskRunner> | null = null;
    let proactiveMessenger: ProactiveMessenger | null = null;
    let campaignRunner: CampaignRunner | null = null;
    let webhookQueue: WebhookQueue | null = null;
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

      // Campaign runner (outbound campaigns via ProactiveMessenger)
      campaignRunner = createCampaignRunner({ prisma, proactiveMessenger, logger });
      toolRegistry.register(createTriggerCampaignTool({ campaignRunner, prisma }));
      logger.info('Campaign runner enabled', { component: 'main' });

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

    // OpenClaw task registry — in-memory task lifecycle tracking (always created)
    const openclawTaskRegistry = createTaskRegistry();

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
      campaignRunner,
      longTermMemoryStore,
      secretService,
      apiKeyService,
      knowledgeService,
      channelResolver,
      channelIntegrationRepository,
      mcpServerRepository,
      skillService,
      prisma,
      sessionBroadcaster,
      resumeAfterApproval,
      provisioningService: provisioningService,
      dokployService: dokployService,
      agentRunRepository,
      taskRegistry: openclawTaskRegistry,
      logger,
    };

    // Register public webchat routes (no auth, direct on root server)
    webchatPublicRoutes(server, {
      prisma,
      sessionRepository,
      logger,
      runAgent,
    });
    logger.info('Webchat public routes registered at /webchat/*', { component: 'main' });

    // Serve widget demo page (public, no auth)
    server.get('/widget-demo', async (_request, reply) => {
      const { readFile } = await import('node:fs/promises');
      const nodePath = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
      // In production (compiled), dist/main.js → look for public/ at project root
      const candidates = [
        nodePath.resolve(__dirname, '..', 'public', 'widget-demo.html'),
        nodePath.resolve(__dirname, 'public', 'widget-demo.html'),
        nodePath.resolve(process.cwd(), 'public', 'widget-demo.html'),
      ];
      for (const p of candidates) {
        try {
          const html = await readFile(p, 'utf-8');
          return await reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
        } catch {
          // try next
        }
      }
      return reply.code(404).send('Demo page not found');
    });

    // Register API routes under /api/v1 prefix
    await server.register(
      async (prefixed) => {
        // Auth middleware — validates Bearer token on all routes except /api/v1/webhooks/*
        registerAuthMiddleware(prefixed, process.env['NEXUS_API_KEY'] ?? '', logger, apiKeyService);

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

        // OpenClaw adapter — receives inbound calls from OpenClaw Manager instances
        // Auth: Bearer token (project-scoped or master) + fallback to OPENCLAW_INTERNAL_KEY
        openclawAdapterRoutes(prefixed, {
          openclawInternalKey: process.env['OPENCLAW_INTERNAL_KEY'],
          inboundProcessor,
          runAgent,
          logger,
        });
        logger.info('OpenClaw adapter registered at POST /api/v1/openclaw/inbound', { component: 'main' });
      },
      { prefix: '/api/v1' },
    );

    // Graceful shutdown — drains in-flight work before closing connections
    let shuttingDown = false;
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return; // prevent double-shutdown
      shuttingDown = true;

      logger.info('Shutting down — draining in-flight requests...', { component: 'main' });

      // 1. Stop accepting new requests (closes the listening socket)
      await server.close();

      // 2. Stop background schedulers and sweepers
      approvalGate.stopSweeper();
      clientMonitor.stop();
      openclawTaskRegistry.shutdown();

      // 3. Drain queues (waits for in-flight jobs to finish)
      if (taskRunner) {
        await taskRunner.stop();
      }
      if (webhookQueue) {
        await webhookQueue.stop();
      }

      // 4. Close external connections
      await mcpManager.disconnectAll();

      // 5. Close database last (in-flight queries must finish first)
      await db.disconnect();

      logger.info('Shutdown complete', { component: 'main' });
    };

    // Handle both termination signals
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());

    // Catch unhandled errors to log and shutdown gracefully
    process.on('uncaughtException', (error) => {
      logger.fatal('Uncaught exception — shutting down', {
        component: 'main',
        error: error.message,
        stack: error.stack,
      });
      void shutdown().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection', {
        component: 'main',
        error: reason instanceof Error ? reason.message : String(reason),
      });
    });

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
