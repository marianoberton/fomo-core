/**
 * Admin invoke route — REST entry point for fomo-admin agent.
 *
 * POST /admin/invoke — send a prompt to fomo-admin (sync)
 * GET  /admin/sessions/:sessionId — get session history
 *
 * Protected by master-key auth (admin-auth hook).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import { createAdminAuthHook } from '../admin-auth.js';
import { prepareChatRun, extractAssistantResponse, extractToolCalls } from './chat-setup.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import type { SessionId } from '@/core/types.js';
import { FOMO_PROJECT_ID } from '@/agents/fomo-internal/agents.config.js';
import { createLogger } from '@/observability/logger.js';

const SENSITIVE_KEY = /key|token|secret|password|credential/i;

function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : v]),
  );
}

const logger = createLogger({ name: 'admin-invoke-route' });

const invokeBodySchema = z.object({
  prompt: z.string().min(1).max(10000),
  sessionId: z.string().optional(),
});

const sessionParamsSchema = z.object({
  sessionId: z.string(),
});

/**
 * Register admin invoke routes.
 */
export function adminInvokeRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.addHook('preHandler', createAdminAuthHook(deps.apiKeyService));

  // POST /admin/invoke — send a prompt to fomo-admin (sync)
  fastify.post(
    '/admin/invoke',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = invokeBodySchema.parse(request.body);

      const actor = request.adminAuth?.actor ?? 'unknown';
      logger.info('Admin invoke', {
        component: 'admin-invoke',
        actor,
        hasSession: !!body.sessionId,
      });

      // 1. Resolve fomo-admin agent
      const adminAgent = await deps.agentRegistry.getByName(FOMO_PROJECT_ID, 'FOMO-Admin');
      if (!adminAgent) {
        await sendError(reply, 'AGENT_NOT_FOUND', 'FOMO-Admin agent not found — run seed first.', 404);
        return;
      }

      if (adminAgent.status !== 'active') {
        await sendError(reply, 'AGENT_NOT_ACTIVE', `FOMO-Admin is ${adminAgent.status}`, 409);
        return;
      }

      // 2. Prepare chat run (sanitize, load project/session/prompts, create services)
      const setupResult = await prepareChatRun(
        {
          projectId: FOMO_PROJECT_ID,
          agentId: adminAgent.id,
          sessionId: body.sessionId,
          sourceChannel: 'dashboard',
          message: body.prompt,
          metadata: { actor, via: 'admin-invoke' },
        },
        deps,
      );

      if (!setupResult.ok) {
        await sendError(
          reply,
          setupResult.error.code,
          setupResult.error.message,
          setupResult.error.statusCode,
        );
        return;
      }

      const setup = setupResult.value;

      // 3. Abort on client disconnect
      const abortController = new AbortController();
      request.raw.on('close', () => {
        if (!request.raw.complete) abortController.abort();
      });

      // 4. Run agent
      const agentRunner = createAgentRunner({
        provider: setup.provider,
        fallbackProvider: setup.fallbackProvider,
        toolRegistry: deps.toolRegistry,
        memoryManager: setup.memoryManager,
        costGuard: setup.costGuard,
        logger,
      });

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
        logger.error('Admin agent run failed', {
          component: 'admin-invoke',
          error: result.error.message,
        });
        await sendError(reply, 'EXECUTION_FAILED', result.error.message);
        return;
      }

      const trace = result.value;

      // 5. Persist trace + messages
      await deps.executionTraceRepository.save(trace);
      await deps.sessionRepository.addMessage(setup.sessionId, { role: 'user', content: setup.sanitizedMessage }, trace.id);
      const assistantText = extractAssistantResponse(trace.events);
      await deps.sessionRepository.addMessage(setup.sessionId, { role: 'assistant', content: assistantText }, trace.id);

      // 6. Write audit log entries for every admin tool call in the trace
      const toolCallEvents = trace.events.filter(
        (e) => e.type === 'tool_call' &&
          typeof e.data['toolId'] === 'string' &&
          (e.data['toolId'] as string).startsWith('admin-'),
      );
      await Promise.all(
        toolCallEvents.map(async (callEvent) => {
          const toolCallId = callEvent.data['toolCallId'] as string;
          const toolId = callEvent.data['toolId'] as string;
          const rawInput = (callEvent.data['input'] ?? {}) as Record<string, unknown>;

          const resultEvent = trace.events.find(
            (e) => e.type === 'tool_result' && e.data['toolCallId'] === toolCallId,
          );
          if (!resultEvent) return; // approval still pending — skip for now

          const outcome = (resultEvent.data['success'] as boolean) ? 'success' : 'error';
          const inputRedacted = redactSensitiveFields(rawInput);

          await deps.prisma.adminAuditLog.create({
            data: {
              id: randomUUID(),
              actor,
              sessionId: setup.sessionId,
              agentId: adminAgent.id,
              toolId,
              inputRedacted: inputRedacted as Prisma.InputJsonValue,
              outcome,
              traceId: trace.id,
            },
          });
        }),
      );

      logger.info('Admin invoke complete', {
        component: 'admin-invoke',
        traceId: trace.id,
        sessionId: setup.sessionId,
      });

      await sendSuccess(reply, {
        sessionId: setup.sessionId,
        traceId: trace.id,
        response: assistantText,
        toolCalls: extractToolCalls(trace.events),
        timestamp: new Date().toISOString(),
        usage: {
          totalTokens: trace.totalTokensUsed,
          costUSD: trace.totalCostUSD,
        },
      });
    },
  );

  // GET /admin/sessions/:sessionId — get session history
  fastify.get(
    '/admin/sessions/:sessionId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);

      logger.info('Getting admin session', { component: 'admin-invoke', sessionId });

      const session = await deps.sessionRepository.findById(sessionId as SessionId);
      if (!session) {
        await sendError(reply, 'SESSION_NOT_FOUND', 'Session not found', 404);
        return;
      }

      const messages = await deps.sessionRepository.getMessages(sessionId as SessionId);

      await sendSuccess(reply, {
        session: {
          id: session.id,
          status: session.status,
          createdAt: session.createdAt.toISOString(),
        },
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    },
  );
}
