/**
 * Dashboard routes — aggregation endpoints for the web dashboard.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';

// ─── Route Plugin ───────────────────────────────────────────────

/** Register dashboard aggregation routes. */
export function dashboardRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { projectRepository, agentRepository, sessionRepository, approvalGate } = deps;

  // GET /dashboard/overview — aggregate counts for dashboard home
  fastify.get('/dashboard/overview', async (_request, reply) => {
    const [projects, agents, approvals] = await Promise.all([
      projectRepository.list({}),
      agentRepository.listAll(),
      approvalGate.listAll(),
    ]);

    // Count active sessions across all projects
    const sessionCounts = await Promise.all(
      projects.map((p) => sessionRepository.listByProject(p.id, 'active')),
    );
    const activeSessionsCount = sessionCounts.reduce(
      (sum, sessions) => sum + sessions.length,
      0,
    );

    const pendingApprovals = approvals.filter((a) => a.status === 'pending');

    return sendSuccess(reply, {
      projectsCount: projects.length,
      activeAgentsCount: agents.filter((a) => a.status === 'active').length,
      activeSessionsCount,
      pendingApprovalsCount: pendingApprovals.length,
      todayCostUsd: 0, // TODO: wire UsageStore aggregate
      weekCostUsd: 0, // TODO: wire UsageStore aggregate
    });
  });
}
