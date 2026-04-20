/**
 * Admin audit log route.
 *
 * GET /admin/audit — query the admin audit log with filters.
 * Protected by master-key auth (admin-auth hook).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';
import { createAdminAuthHook } from '../admin-auth.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-audit-route' });

const querySchema = z.object({
  actor: z.string().optional(),
  toolId: z.string().optional(),
  outcome: z.enum(['success', 'error', 'denied']).optional(),
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Register admin audit routes.
 *
 * All routes require master-key authentication.
 */
export function adminAuditRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  fastify.addHook('preHandler', createAdminAuthHook(deps.apiKeyService));

  fastify.get(
    '/admin/audit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = querySchema.parse(request.query);

      logger.info('Querying admin audit log', {
        component: 'admin-audit',
        actor: query.actor,
      });

      const where: Record<string, unknown> = {};
      if (query.actor) where['actor'] = query.actor;
      if (query.toolId) where['toolId'] = query.toolId;
      if (query.outcome) where['outcome'] = query.outcome;
      if (query.since) where['createdAt'] = { gte: new Date(query.since) };

      const limit = query.limit ?? 50;

      const [entries, total] = await Promise.all([
        deps.prisma.adminAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        deps.prisma.adminAuditLog.count({ where }),
      ]);

      await sendSuccess(reply, {
        entries: entries.map((e) => ({
          id: e.id,
          actor: e.actor,
          sessionId: e.sessionId,
          agentId: e.agentId,
          toolId: e.toolId,
          inputRedacted: e.inputRedacted,
          approvedBy: e.approvedBy,
          outcome: e.outcome,
          traceId: e.traceId,
          createdAt: e.createdAt.toISOString(),
        })),
        total,
      });
    },
  );
}
