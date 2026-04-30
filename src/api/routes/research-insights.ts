/**
 * Research Insights routes (super_admin only).
 *
 * GET    /research/insights          — list with filters: vertical, category, status
 * GET    /research/insights/:id      — detail
 * PATCH  /research/insights/:id/approve — approve + audit log
 * PATCH  /research/insights/:id/reject  — reject + audit log
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createInsightRepository } from '@/research/repositories/insight-repository.js';
import { createResearchAuditLogRepository } from '@/research/repositories/audit-log-repository.js';

// ─── Schemas ─────────────────────────────────────────────────────

const listQuerySchema = z.object({
  vertical: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'superseded']).optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

export function researchInsightsRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;
  const insightRepo = createInsightRepository(prisma);
  const auditRepo = createResearchAuditLogRepository(prisma);

  fastify.addHook('preHandler', requireSuperAdmin({ logger }));

  // GET /research/insights
  fastify.get(
    '/research/insights',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { vertical, category, status } = parsed.data;

      const items = await insightRepo.list({
        ...(vertical !== undefined && { verticalSlug: vertical }),
        ...(category !== undefined && { category }),
        ...(status !== undefined && { status }),
      });

      await sendSuccess(reply, { items, total: items.length });
    },
  );

  // GET /research/insights/:id
  fastify.get(
    '/research/insights/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const insight = await insightRepo.findById(id as never);
      if (!insight) {
        await sendNotFound(reply, 'IntelligenceInsight', id);
        return;
      }
      await sendSuccess(reply, { insight });
    },
  );

  // PATCH /research/insights/:id/approve
  fastify.patch(
    '/research/insights/:id/approve',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const actor = request.superAdminEmail ?? 'api-key';

      const existing = await insightRepo.findById(id as never);
      if (!existing) {
        await sendNotFound(reply, 'IntelligenceInsight', id);
        return;
      }

      const insight = await insightRepo.markApproved(id as never, actor);

      await auditRepo.log({
        actorEmail: actor,
        action: 'insight.approve',
        entityType: 'IntelligenceInsight',
        entityId: id,
        payload: { verticalSlug: existing.verticalSlug, category: existing.category },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: insight approved', {
        component: 'research-insights',
        insightId: id,
        actor,
      });

      await sendSuccess(reply, { insight });
    },
  );

  // PATCH /research/insights/:id/reject
  fastify.patch(
    '/research/insights/:id/reject',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const actor = request.superAdminEmail ?? 'api-key';

      const bodyParsed = rejectBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.message, 400);
        return;
      }

      const existing = await insightRepo.findById(id as never);
      if (!existing) {
        await sendNotFound(reply, 'IntelligenceInsight', id);
        return;
      }

      const insight = await insightRepo.markRejected(id as never, actor, bodyParsed.data.reason);

      await auditRepo.log({
        actorEmail: actor,
        action: 'insight.reject',
        entityType: 'IntelligenceInsight',
        entityId: id,
        payload: { reason: bodyParsed.data.reason },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: insight rejected', {
        component: 'research-insights',
        insightId: id,
        actor,
      });

      await sendSuccess(reply, { insight });
    },
  );
}
