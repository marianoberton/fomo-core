/**
 * Platform Bridge routes — endpoints consumed by the external Workforce + Copilot dashboard.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';

// ─── Schemas ────────────────────────────────────────────────────

const projectIdQuerySchema = z.object({
  projectId: z.string().min(1),
});

const conversationsQuerySchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const escalateBodySchema = z.object({
  reason: z.string().optional(),
});

const copilotChatBodySchema = z.object({
  projectId: z.string().min(1),
  managerId: z.string().min(1),
  message: z.string().min(1),
  sessionId: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register platform bridge routes (prefixed with /platform externally). */
export function platformBridgeRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;

  // ────────────────────────────────────────────────────────────────
  // 1. GET /agents — list agents with today's metrics
  // ────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { projectId: string } }>(
    '/agents',
    async (request, reply) => {
      const { projectId } = projectIdQuerySchema.parse(request.query);

      const agents = await prisma.agent.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const agentData = await Promise.all(
        agents.map(async (agent) => {
          const [sessionsToday, costRow] = await Promise.all([
            prisma.session.count({
              where: { agentId: agent.id, createdAt: { gte: startOfDay } },
            }),
            prisma.usageRecord.aggregate({
              where: { agentId: agent.id, timestamp: { gte: startOfDay } },
              _sum: { costUsd: true },
            }),
          ]);

          return {
            id: agent.id,
            name: agent.name,
            role: agent.operatingMode,
            status: agent.status,
            model: (agent.llmConfig as Record<string, unknown> | null)?.['model'] ?? null,
            createdAt: agent.createdAt.toISOString(),
            metrics: {
              sessionsToday,
              costToday: costRow._sum.costUsd ?? 0,
              avgResponseTimeMs: 0,
            },
          };
        }),
      );

      return sendSuccess(reply, { agents: agentData });
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 2. GET /agents/:agentId/detail — agent detail + recent sessions
  // ────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/detail',
    async (request, reply) => {
      const { agentId } = request.params;

      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      const [sessions, knowledgeCount] = await Promise.all([
        prisma.session.findMany({
          where: { agentId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            metadata: true,
          },
        }),
        prisma.memoryEntry.count({
          where: { agentId, category: 'knowledge' },
        }),
      ]);

      return sendSuccess(reply, {
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          role: agent.operatingMode,
          status: agent.status,
          model: (agent.llmConfig as Record<string, unknown> | null)?.['model'] ?? null,
          toolAllowlist: agent.toolAllowlist,
          maxTurns: agent.maxTurns,
          budgetPerDayUsd: agent.budgetPerDayUsd,
          createdAt: agent.createdAt.toISOString(),
          updatedAt: agent.updatedAt.toISOString(),
        },
        sessions: sessions.map((s) => ({
          id: s.id,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        knowledgeCount,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 3. GET /conversations — paginated conversation list
  // ────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: Record<string, unknown> }>(
    '/conversations',
    async (request, reply) => {
      const query = conversationsQuerySchema.parse(request.query);
      const { projectId, agentId, status, limit, offset } = query;

      const where: Record<string, unknown> = { projectId };
      if (agentId) where['agentId'] = agentId;
      if (status) where['status'] = status;

      const [sessions, total] = await Promise.all([
        prisma.session.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            agent: { select: { name: true } },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { content: true, createdAt: true },
            },
            _count: { select: { messages: true } },
          },
        }),
        prisma.session.count({ where }),
      ]);

      const conversations = sessions.map((s) => ({
        id: s.id,
        agentId: s.agentId,
        agentName: s.agent?.name ?? null,
        lastMessage: s.messages[0]?.content ?? null,
        lastMessageAt: s.messages[0]?.createdAt.toISOString() ?? null,
        status: s.status,
        messageCount: s._count.messages,
      }));

      return sendSuccess(reply, { conversations, total });
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 4. GET /conversations/:sessionId/messages — all messages
  // ────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { sessionId: string } }>(
    '/conversations/:sessionId/messages',
    async (request, reply) => {
      const { sessionId } = request.params;

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, agentId: true },
      });
      if (!session) {
        return sendNotFound(reply, 'Session', sessionId);
      }

      const messages = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
      });

      return sendSuccess(reply, {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
        session: {
          id: session.id,
          status: session.status,
          agentId: session.agentId,
        },
      });
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 5. POST /conversations/:sessionId/escalate — mark as escalated
  // ────────────────────────────────────────────────────────────────
  fastify.post<{ Params: { sessionId: string } }>(
    '/conversations/:sessionId/escalate',
    async (request, reply) => {
      const { sessionId } = request.params;
      const body = escalateBodySchema.parse(request.body);

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true, metadata: true },
      });
      if (!session) {
        return sendNotFound(reply, 'Session', sessionId);
      }

      const existingMeta = (session.metadata as Record<string, unknown> | null) ?? {};

      await prisma.session.update({
        where: { id: sessionId },
        data: {
          metadata: {
            ...existingMeta,
            escalated: true,
            escalatedAt: new Date().toISOString(),
            escalationReason: body.reason ?? null,
          },
        },
      });

      return sendSuccess(reply, { success: true });
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 6. GET /stats — project-level aggregate stats
  // ────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { projectId: string } }>(
    '/stats',
    async (request, reply) => {
      const { projectId } = projectIdQuerySchema.parse(request.query);

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [activeAgents, openConversations, leadsToday, costRow] = await Promise.all([
        prisma.agent.count({ where: { projectId, status: 'active' } }),
        prisma.session.count({ where: { projectId, status: 'active' } }),
        prisma.contact.count({ where: { projectId, createdAt: { gte: startOfDay } } }),
        prisma.usageRecord.aggregate({
          where: { projectId, timestamp: { gte: startOfMonth } },
          _sum: { costUsd: true },
        }),
      ]);

      return sendSuccess(reply, {
        stats: {
          activeAgents,
          openConversations,
          leadsToday,
          costThisMonth: costRow._sum.costUsd ?? 0,
        },
      });
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 7. POST /copilot/chat — send a message to the manager agent
  // ────────────────────────────────────────────────────────────────
  fastify.post(
    '/copilot/chat',
    async (request, reply) => {
      const body = copilotChatBodySchema.parse(request.body);
      const { projectId, managerId, message, sessionId: requestedSessionId } = body;

      // Verify agent exists
      const agent = await prisma.agent.findUnique({ where: { id: managerId } });
      if (!agent) {
        return sendNotFound(reply, 'Agent', managerId);
      }

      // Use the internal chat endpoint via inject (Fastify light-my-request)
      // This reuses all existing chat logic (session creation, agent runner, etc.)
      let sessionId = requestedSessionId;

      // If no sessionId provided, create a new session
      if (!sessionId) {
        const newSession = await prisma.session.create({
          data: {
            id: `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            projectId,
            agentId: managerId,
            status: 'active',
          },
        });
        sessionId = newSession.id;
      }

      try {
        const injectResult = await fastify.inject({
          method: 'POST',
          url: '/chat',
          payload: {
            projectId,
            agentId: managerId,
            sessionId,
            message,
          },
        });

        const parsed = JSON.parse(injectResult.body) as {
          success: boolean;
          data?: { response: string; sessionId: string };
          error?: { message: string };
        };

        if (!parsed.success || !parsed.data) {
          logger.warn('Copilot chat inject failed', {
            component: 'platform-bridge',
            status: injectResult.statusCode,
            body: injectResult.body,
          });
          await sendError(
            reply,
            'COPILOT_CHAT_FAILED',
            parsed.error?.message ?? 'Failed to process copilot message',
            500,
          );
          return;
        }

        await sendSuccess(reply, {
          response: parsed.data.response,
          sessionId: parsed.data.sessionId,
        });
        return;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('Copilot chat error', {
          component: 'platform-bridge',
          error: errMsg,
        });
        return sendError(reply, 'COPILOT_CHAT_ERROR', errMsg, 500);
      }
    },
  );

  // ────────────────────────────────────────────────────────────────
  // 8. GET /copilot/agents-status — all agents with status info
  // ────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { projectId: string } }>(
    '/copilot/agents-status',
    async (request, reply) => {
      const { projectId } = projectIdQuerySchema.parse(request.query);

      const agents = await prisma.agent.findMany({
        where: { projectId },
        orderBy: { name: 'asc' },
      });

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const agentsStatus = await Promise.all(
        agents.map(async (agent) => {
          const sessionsToday = await prisma.session.count({
            where: { agentId: agent.id, createdAt: { gte: startOfDay } },
          });

          return {
            id: agent.id,
            name: agent.name,
            role: agent.operatingMode,
            status: agent.status,
            sessionsToday,
            lastActiveAt: agent.updatedAt.toISOString(),
          };
        }),
      );

      return sendSuccess(reply, { agents: agentsStatus });
    },
  );
}
