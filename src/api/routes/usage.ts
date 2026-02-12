/**
 * Usage routes — cost and token usage aggregation for the dashboard.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';

// ─── Schemas ────────────────────────────────────────────────────

const usageQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('day'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  agentId: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register usage/cost routes. */
export function usageRoutes(
  fastify: FastifyInstance,
  _deps: RouteDependencies,
): void {
  // GET /projects/:projectId/usage — usage summary for a project
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/usage',
    async (request, reply) => {
      const query = usageQuerySchema.parse(request.query);

      // TODO: Wire to UsageStore aggregate queries once available in RouteDependencies.
      // For now, return a valid but empty summary so the dashboard renders correctly.
      return sendSuccess(reply, {
        period: query.period,
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalSessions: 0,
        dailyBreakdown: [],
      });
    },
  );

  // GET /projects/:projectId/usage/by-agent — usage breakdown per agent
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/usage/by-agent',
    async (_request, reply) => {
      // TODO: Wire to UsageStore per-agent aggregation
      return sendSuccess(reply, {});
    },
  );

  // GET /cost-alerts — cost alerts (budget threshold warnings)
  fastify.get('/cost-alerts', async (_request, reply) => {
    // TODO: Wire to CostGuard budget status
    return sendSuccess(reply, []);
  });

  // POST /cost-alerts/:id/acknowledge — acknowledge a cost alert
  fastify.post<{ Params: { id: string } }>(
    '/cost-alerts/:id/acknowledge',
    async (_request, reply) => {
      // TODO: Wire to CostGuard alert acknowledgement
      return sendSuccess(reply, { id: _request.params.id, acknowledged: true });
    },
  );
}
