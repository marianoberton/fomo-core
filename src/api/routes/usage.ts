/**
 * Usage routes — cost and token usage aggregation for the dashboard.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const usageQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('day'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  agentId: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────

/** Get the start date for a given period. */
function periodStart(period: 'day' | 'week' | 'month'): Date {
  const now = new Date();
  switch (period) {
    case 'day': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'month': {
      const d = new Date(now);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register usage/cost routes. */
export function usageRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;

  // GET /projects/:projectId/usage — usage summary for a project
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/usage',
    async (request, reply) => {
      const { projectId } = request.params;
      const query = usageQuerySchema.parse(request.query);
      const since = periodStart(query.period);

      const result = await prisma.usageRecord.aggregate({
        where: {
          projectId: projectId as ProjectId,
          timestamp: { gte: since },
        },
        _sum: {
          costUsd: true,
          inputTokens: true,
          outputTokens: true,
        },
        _count: true,
      });

      // Count distinct sessions
      const sessionCount = await prisma.usageRecord.groupBy({
        by: ['sessionId'],
        where: {
          projectId: projectId as ProjectId,
          timestamp: { gte: since },
        },
      });

      return sendSuccess(reply, {
        period: query.period,
        totalCostUsd: result._sum.costUsd ?? 0,
        totalTokensIn: result._sum.inputTokens ?? 0,
        totalTokensOut: result._sum.outputTokens ?? 0,
        totalSessions: sessionCount.length,
        totalRequests: result._count,
      });
    },
  );

  // GET /projects/:projectId/usage/by-agent — usage breakdown per model (proxy for agent)
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/usage/by-agent',
    async (request, reply) => {
      const { projectId } = request.params;
      const query = usageQuerySchema.parse(request.query);
      const since = periodStart(query.period);

      const groups = await prisma.usageRecord.groupBy({
        by: ['model'],
        where: {
          projectId: projectId as ProjectId,
          timestamp: { gte: since },
        },
        _sum: {
          costUsd: true,
          inputTokens: true,
          outputTokens: true,
        },
        _count: true,
      });

      const byModel = groups.map((g) => ({
        model: g.model,
        totalCostUsd: g._sum.costUsd ?? 0,
        totalTokensIn: g._sum.inputTokens ?? 0,
        totalTokensOut: g._sum.outputTokens ?? 0,
        requestCount: g._count,
      }));

      return sendSuccess(reply, byModel);
    },
  );

  // GET /cost-alerts — cost alerts (budget threshold warnings)
  fastify.get('/cost-alerts', async (_request, reply) => {
    // No persistent alert storage yet — return empty
    return sendSuccess(reply, []);
  });

  // POST /cost-alerts/:id/acknowledge — acknowledge a cost alert
  fastify.post<{ Params: { id: string } }>(
    '/cost-alerts/:id/acknowledge',
    async (request, reply) => {
      return sendSuccess(reply, { id: request.params.id, acknowledged: true });
    },
  );
}
