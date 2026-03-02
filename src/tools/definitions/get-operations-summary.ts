/**
 * Get Operations Summary Tool — aggregate overview of the entire project.
 * Returns agent statuses, session counts, message volumes, pending approvals,
 * costs, and recent escalations.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({});

const outputSchema = z.object({
  agents: z.object({
    total: z.number(),
    active: z.number(),
    paused: z.number(),
    disabled: z.number(),
    list: z.array(z.object({
      name: z.string(),
      status: z.string(),
      operatingMode: z.string(),
      activeSessions: z.number(),
    })),
  }),
  sessions: z.object({
    active: z.number(),
    total: z.number(),
  }),
  messages: z.object({
    today: z.number(),
    thisWeek: z.number(),
  }),
  approvals: z.object({
    pending: z.number(),
  }),
  cost: z.object({
    todayUsd: z.number(),
    thisWeekUsd: z.number(),
  }),
  escalations: z.object({
    recent: z.array(z.object({
      sessionId: z.string(),
      toolId: z.string(),
      status: z.string(),
      requestedAt: z.string(),
    })),
    totalPending: z.number(),
  }),
});

// ─── Options ────────────────────────────────────────────────────

/** Dependencies for the get-operations-summary tool. */
export interface GetOperationsSummaryToolOptions {
  prisma: PrismaClient;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Get start of today (UTC). */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Get start of this week (Monday, UTC). */
function startOfThisWeek(): Date {
  const today = startOfToday();
  const day = today.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  today.setUTCDate(today.getUTCDate() - diff);
  return today;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a get-operations-summary tool for project-wide operational overview. */
export function createGetOperationsSummaryTool(
  options: GetOperationsSummaryToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'get-operations-summary',
    name: 'Get Operations Summary',
    description:
      'Get a high-level overview of the entire project: active agents, session counts, message volumes, pending approvals, costs, and recent escalations. Use this for daily reports and status checks.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      inputSchema.parse(input);
      const projectId = context.projectId as string;

      try {
        const todayStart = startOfToday();
        const weekStart = startOfThisWeek();

        // 1. Agents
        const agents = await prisma.agent.findMany({
          where: { projectId },
          select: { id: true, name: true, status: true, operatingMode: true },
        });

        // 2. Active sessions grouped by agent
        const sessionCounts = await prisma.session.groupBy({
          by: ['agentId'],
          where: { projectId, status: 'active', agentId: { not: null } },
          _count: true,
        });
        const sessionCountMap = new Map(
          sessionCounts.map((s) => [s.agentId, s._count]),
        );

        const agentList = agents.map((a) => ({
          name: a.name,
          status: a.status,
          operatingMode: a.operatingMode,
          activeSessions: sessionCountMap.get(a.id) ?? 0,
        }));

        const activeCount = agents.filter((a) => a.status === 'active').length;
        const pausedCount = agents.filter((a) => a.status === 'paused').length;
        const disabledCount = agents.filter((a) => a.status === 'disabled').length;

        // 3. Sessions
        const [activeSessions, totalSessions] = await Promise.all([
          prisma.session.count({ where: { projectId, status: 'active' } }),
          prisma.session.count({ where: { projectId } }),
        ]);

        // 4. Messages today/week
        const [messagesToday, messagesThisWeek] = await Promise.all([
          prisma.message.count({
            where: { session: { projectId }, createdAt: { gte: todayStart } },
          }),
          prisma.message.count({
            where: { session: { projectId }, createdAt: { gte: weekStart } },
          }),
        ]);

        // 5. Pending approvals
        const pendingApprovals = await prisma.approvalRequest.count({
          where: { projectId, status: 'pending' },
        });

        // 6. Cost today/week
        const [costToday, costThisWeek] = await Promise.all([
          prisma.usageRecord.aggregate({
            where: { projectId, timestamp: { gte: todayStart } },
            _sum: { costUsd: true },
          }),
          prisma.usageRecord.aggregate({
            where: { projectId, timestamp: { gte: weekStart } },
            _sum: { costUsd: true },
          }),
        ]);

        // 7. Recent escalations
        const recentEscalations = await prisma.approvalRequest.findMany({
          where: { projectId, toolId: 'escalate-to-human' },
          orderBy: { requestedAt: 'desc' },
          take: 10,
          select: { sessionId: true, toolId: true, status: true, requestedAt: true },
        });

        const pendingEscalations = recentEscalations.filter(
          (e) => e.status === 'pending',
        ).length;

        const output = {
          agents: {
            total: agents.length,
            active: activeCount,
            paused: pausedCount,
            disabled: disabledCount,
            list: agentList,
          },
          sessions: {
            active: activeSessions,
            total: totalSessions,
          },
          messages: {
            today: messagesToday,
            thisWeek: messagesThisWeek,
          },
          approvals: {
            pending: pendingApprovals,
          },
          cost: {
            todayUsd: costToday._sum.costUsd ?? 0,
            thisWeekUsd: costThisWeek._sum.costUsd ?? 0,
          },
          escalations: {
            recent: recentEscalations.map((e) => ({
              sessionId: e.sessionId,
              toolId: e.toolId,
              status: e.status,
              requestedAt: e.requestedAt.toISOString(),
            })),
            totalPending: pendingEscalations,
          },
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'get-operations-summary',
          error instanceof Error ? error.message : 'Unknown error querying operations summary',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      inputSchema.parse(input);

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: 'Would query operations summary for the project',
          sections: ['agents', 'sessions', 'messages', 'approvals', 'cost', 'escalations'],
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
