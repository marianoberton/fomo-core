/**
 * Get Agent Performance Tool — detailed metrics for a specific agent.
 * Returns sessions handled, message counts, tool call success rates,
 * costs, and escalation counts over a configurable time range.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  agentName: z.string().min(1)
    .describe('The name of the agent to get performance metrics for.'),
  timeRange: z.enum(['today', 'week', 'month', 'custom']).default('week')
    .describe('Time range for the metrics. Default: week.'),
  customStartDate: z.string().optional()
    .describe('ISO 8601 date string for custom range start (required if timeRange is "custom").'),
  customEndDate: z.string().optional()
    .describe('ISO 8601 date string for custom range end (required if timeRange is "custom").'),
});

const outputSchema = z.object({
  agentName: z.string(),
  agentId: z.string(),
  operatingMode: z.string(),
  status: z.string(),
  timeRange: z.object({
    label: z.string(),
    start: z.string(),
    end: z.string(),
  }),
  sessions: z.object({
    total: z.number(),
    active: z.number(),
    closed: z.number(),
  }),
  messages: z.object({
    total: z.number(),
    fromUser: z.number(),
    fromAssistant: z.number(),
  }),
  toolCalls: z.object({
    total: z.number(),
    successful: z.number(),
    failed: z.number(),
    byTool: z.array(z.object({
      toolName: z.string(),
      count: z.number(),
    })),
  }),
  cost: z.object({
    totalUsd: z.number(),
    avgPerSessionUsd: z.number(),
  }),
  escalations: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

/** Dependencies for the get-agent-performance tool. */
export interface GetAgentPerformanceToolOptions {
  prisma: PrismaClient;
  agentRegistry: AgentRegistry;
}

// ─── Helpers ────────────────────────────────────────────────────

interface TimeRange {
  label: string;
  start: Date;
  end: Date;
}

/** Resolve a named time range to concrete dates. */
function resolveTimeRange(
  range: 'today' | 'week' | 'month' | 'custom',
  customStart?: string,
  customEnd?: string,
): TimeRange {
  const now = new Date();

  switch (range) {
    case 'today': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { start, end: now, label: 'Today' };
    }
    case 'week': {
      const start = new Date(now.getTime() - 7 * 86_400_000);
      return { start, end: now, label: 'Last 7 days' };
    }
    case 'month': {
      const start = new Date(now.getTime() - 30 * 86_400_000);
      return { start, end: now, label: 'Last 30 days' };
    }
    case 'custom': {
      const start = customStart ? new Date(customStart) : new Date(now.getTime() - 7 * 86_400_000);
      const end = customEnd ? new Date(customEnd) : now;
      return {
        start,
        end,
        label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
      };
    }
  }
}

/** Trace event shape from ExecutionTrace.events JSON. */
interface TraceEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a get-agent-performance tool for per-agent metrics analysis. */
export function createGetAgentPerformanceTool(
  options: GetAgentPerformanceToolOptions,
): ExecutableTool {
  const { prisma, agentRegistry } = options;

  return {
    id: 'get-agent-performance',
    name: 'Get Agent Performance',
    description:
      'Get detailed performance metrics for a specific agent: sessions handled, messages processed, tool call success rates, costs, and escalation counts over a time range.',
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
      const data = inputSchema.parse(input) as {
        agentName: string;
        timeRange: 'today' | 'week' | 'month' | 'custom';
        customStartDate?: string;
        customEndDate?: string;
      };
      const projectId = context.projectId as string;

      try {
        // 1. Resolve agent
        const agent = await agentRegistry.getByName(projectId, data.agentName);
        if (!agent) {
          return err(new ToolExecutionError(
            'get-agent-performance',
            `Agent "${data.agentName}" not found in project`,
          ));
        }

        const range = resolveTimeRange(data.timeRange, data.customStartDate, data.customEndDate);
        const agentId = agent.id as string;

        // 2. Sessions in range
        const sessions = await prisma.session.findMany({
          where: {
            projectId,
            agentId,
            createdAt: { gte: range.start, lte: range.end },
          },
          select: { id: true, status: true },
        });

        const sessionIds = sessions.map((s) => s.id);
        const activeSessions = sessions.filter((s) => s.status === 'active').length;
        const closedSessions = sessions.filter((s) => s.status === 'closed').length;

        // 3. Messages (grouped by role)
        let userMessages = 0;
        let assistantMessages = 0;

        if (sessionIds.length > 0) {
          const msgGroups = await prisma.message.groupBy({
            by: ['role'],
            where: { sessionId: { in: sessionIds } },
            _count: true,
          });

          for (const group of msgGroups) {
            if (group.role === 'user') userMessages = group._count;
            else if (group.role === 'assistant') assistantMessages = group._count;
          }
        }

        // 4. Execution traces — parse tool calls from events JSON
        let totalToolCalls = 0;
        let successfulToolCalls = 0;
        let failedToolCalls = 0;
        const toolCallCounts = new Map<string, number>();

        if (sessionIds.length > 0) {
          const traces = await prisma.executionTrace.findMany({
            where: { sessionId: { in: sessionIds } },
            select: { events: true },
          });

          for (const trace of traces) {
            const events = trace.events as unknown as TraceEvent[];
            if (!Array.isArray(events)) continue;

            for (const event of events) {
              if (event.type === 'tool_call') {
                totalToolCalls++;
                const toolId = event.data['toolId'] as string | undefined;
                if (toolId) {
                  toolCallCounts.set(toolId, (toolCallCounts.get(toolId) ?? 0) + 1);
                }
              }
              if (event.type === 'tool_result') {
                const success = event.data['success'];
                if (success === false) failedToolCalls++;
                else successfulToolCalls++;
              }
            }
          }
        }

        const byTool = Array.from(toolCallCounts.entries())
          .map(([toolName, count]) => ({ toolName, count }))
          .sort((a, b) => b.count - a.count);

        // 5. Cost
        let totalCostUsd = 0;
        if (sessionIds.length > 0) {
          const costResult = await prisma.usageRecord.aggregate({
            where: { sessionId: { in: sessionIds } },
            _sum: { costUsd: true },
          });
          totalCostUsd = costResult._sum.costUsd ?? 0;
        }

        const avgPerSession = sessionIds.length > 0
          ? totalCostUsd / sessionIds.length
          : 0;

        // 6. Escalations
        let escalationCount = 0;
        if (sessionIds.length > 0) {
          escalationCount = await prisma.approvalRequest.count({
            where: { sessionId: { in: sessionIds }, toolId: 'escalate-to-human' },
          });
        }

        const output = {
          agentName: agent.name,
          agentId: agentId,
          operatingMode: agent.operatingMode,
          status: agent.status,
          timeRange: {
            label: range.label,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          },
          sessions: {
            total: sessionIds.length,
            active: activeSessions,
            closed: closedSessions,
          },
          messages: {
            total: userMessages + assistantMessages,
            fromUser: userMessages,
            fromAssistant: assistantMessages,
          },
          toolCalls: {
            total: totalToolCalls,
            successful: successfulToolCalls,
            failed: failedToolCalls,
            byTool,
          },
          cost: {
            totalUsd: Math.round(totalCostUsd * 10000) / 10000,
            avgPerSessionUsd: Math.round(avgPerSession * 10000) / 10000,
          },
          escalations: escalationCount,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'get-agent-performance',
          error instanceof Error ? error.message : 'Unknown error querying agent performance',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        agentName: string;
        timeRange: 'today' | 'week' | 'month' | 'custom';
        customStartDate?: string;
        customEndDate?: string;
      };

      const range = resolveTimeRange(data.timeRange, data.customStartDate, data.customEndDate);

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would query performance metrics for agent "${data.agentName}"`,
          timeRange: range.label,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
