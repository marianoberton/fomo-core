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

    // Calculate costs from usage records
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Query usage records using Prisma
    const { prisma } = deps;
    const [todayUsage, weekUsage] = await Promise.all([
      prisma.usageRecord.aggregate({
        where: { timestamp: { gte: today } },
        _sum: { costUsd: true },
      }),
      prisma.usageRecord.aggregate({
        where: { timestamp: { gte: weekAgo } },
        _sum: { costUsd: true },
      }),
    ]);

    return sendSuccess(reply, {
      projectsCount: projects.length,
      activeAgentsCount: agents.filter((a) => a.status === 'active').length,
      activeSessionsCount,
      pendingApprovalsCount: pendingApprovals.length,
      todayCostUsd: todayUsage._sum?.costUsd ?? 0,
      weekCostUsd: weekUsage._sum?.costUsd ?? 0,
    });
  });
}
