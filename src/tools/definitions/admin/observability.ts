/**
 * Admin observability read-only tools.
 *
 * - admin-query-traces: search execution traces with filters
 * - admin-get-trace: get full trace detail by ID
 * - admin-get-cost-report: cost breakdown by project/agent/period
 * - admin-get-agent-health: health summary for an agent
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-tools-observability' });

// ─── Options ───────────────────────────────────────────────────────

/** DI options for observability admin tools. */
export interface AdminObservabilityToolOptions {
  prisma: PrismaClient;
}

// ─── admin-query-traces ────────────────────────────────────────────

const queryTracesInput = z.object({
  projectId: z.string().optional().describe('Filter by project ID.'),
  agentId: z.string().optional().describe('Filter by agent ID.'),
  sessionId: z.string().optional().describe('Filter by session ID.'),
  status: z
    .enum(['running', 'completed', 'error', 'timeout'])
    .optional()
    .describe('Filter by trace status.'),
  since: z.string().optional().describe('ISO date — only traces after this timestamp.'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20).'),
});

const queryTracesOutput = z.object({
  traces: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      sessionId: z.string(),
      status: z.string(),
      turnCount: z.number(),
      totalTokensUsed: z.number(),
      totalCostUSD: z.number(),
      totalDurationMs: z.number(),
      createdAt: z.string(),
    }),
  ),
  total: z.number(),
});

/**
 * Create the admin-query-traces tool.
 *
 * Searches execution traces across projects with flexible filters.
 */
export function createAdminQueryTracesTool(
  options: AdminObservabilityToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-query-traces',
    name: 'Admin Query Traces',
    description:
      'Search execution traces across projects. Filter by project, agent, session, status, or date range. ' +
      'Returns summary metrics for each trace.',
    category: 'admin',
    inputSchema: queryTracesInput,
    outputSchema: queryTracesOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = queryTracesInput.parse(input) as {
        projectId?: string;
        agentId?: string;
        sessionId?: string;
        status?: string;
        since?: string;
        limit?: number;
      };

      logger.info('Querying traces', { component: 'admin-query-traces' });

      try {
        const where: Record<string, unknown> = {};
        if (parsed.projectId) where['projectId'] = parsed.projectId;
        if (parsed.sessionId) where['sessionId'] = parsed.sessionId;
        if (parsed.status) where['status'] = parsed.status;
        if (parsed.since) where['createdAt'] = { gte: new Date(parsed.since) };

        const limit = parsed.limit ?? 20;

        const [traces, total] = await Promise.all([
          prisma.executionTrace.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
          prisma.executionTrace.count({ where }),
        ]);

        return ok({
          success: true,
          output: {
            traces: traces.map((t) => ({
              id: t.id,
              projectId: t.projectId,
              sessionId: t.sessionId,
              status: t.status,
              turnCount: t.turnCount,
              totalTokensUsed: t.totalTokensUsed,
              totalCostUSD: t.totalCostUsd,
              totalDurationMs: t.totalDurationMs,
              createdAt: t.createdAt.toISOString(),
            })),
            total,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-query-traces',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── admin-get-trace ───────────────────────────────────────────────

const getTraceInput = z.object({
  traceId: z.string().describe('Execution trace ID.'),
});

const getTraceOutput = z.object({
  trace: z.object({
    id: z.string(),
    projectId: z.string(),
    sessionId: z.string(),
    status: z.string(),
    turnCount: z.number(),
    totalTokensUsed: z.number(),
    totalCostUSD: z.number(),
    totalDurationMs: z.number(),
    events: z.array(z.record(z.unknown())),
    promptSnapshot: z.record(z.unknown()).nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  }),
});

/**
 * Create the admin-get-trace tool.
 *
 * Returns full trace detail including events and prompt snapshot.
 */
export function createAdminGetTraceTool(
  options: AdminObservabilityToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-get-trace',
    name: 'Admin Get Trace',
    description:
      'Get full detail of an execution trace by ID, including all events ' +
      '(LLM calls, tool calls, errors) and the prompt snapshot used.',
    category: 'admin',
    inputSchema: getTraceInput,
    outputSchema: getTraceOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = getTraceInput.parse(input) as { traceId: string };

      logger.info('Getting trace detail', {
        component: 'admin-get-trace',
        traceId: parsed.traceId,
      });

      try {
        const trace = await prisma.executionTrace.findUnique({
          where: { id: parsed.traceId },
        });

        if (!trace) {
          return err(
            new ToolExecutionError('admin-get-trace', `Trace not found: ${parsed.traceId}`),
          );
        }

        return ok({
          success: true,
          output: {
            trace: {
              id: trace.id,
              projectId: trace.projectId,
              sessionId: trace.sessionId,
              status: trace.status,
              turnCount: trace.turnCount,
              totalTokensUsed: trace.totalTokensUsed,
              totalCostUSD: trace.totalCostUsd,
              totalDurationMs: trace.totalDurationMs,
              events: trace.events as Record<string, unknown>[],
              promptSnapshot: trace.promptSnapshot as Record<string, unknown> | null,
              createdAt: trace.createdAt.toISOString(),
              completedAt: trace.completedAt?.toISOString() ?? null,
            },
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-get-trace',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── admin-get-cost-report ─────────────────────────────────────────

const costReportInput = z.object({
  projectId: z.string().optional().describe('Filter by project. Omit for platform-wide.'),
  agentId: z.string().optional().describe('Filter by agent.'),
  period: z
    .enum(['today', '7d', '30d', 'all'])
    .optional()
    .describe('Time period (default: 7d).'),
});

const costReportOutput = z.object({
  totalCostUSD: z.number(),
  totalTokens: z.number(),
  traceCount: z.number(),
  breakdown: z.array(
    z.object({
      projectId: z.string(),
      costUSD: z.number(),
      tokens: z.number(),
      traces: z.number(),
    }),
  ),
});

/**
 * Create the admin-get-cost-report tool.
 *
 * Aggregates cost data across projects, agents, and time periods.
 */
export function createAdminGetCostReportTool(
  options: AdminObservabilityToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-get-cost-report',
    name: 'Admin Get Cost Report',
    description:
      'Get cost breakdown by project and/or agent for a given time period. ' +
      'Returns total cost, tokens used, and trace count with per-project breakdown.',
    category: 'admin',
    inputSchema: costReportInput,
    outputSchema: costReportOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = costReportInput.parse(input) as {
        projectId?: string;
        agentId?: string;
        period?: string;
      };

      const period = parsed.period ?? '7d';
      logger.info('Generating cost report', {
        component: 'admin-get-cost-report',
        period,
      });

      try {
        const since = periodToDate(period);
        const where: Record<string, unknown> = {};
        if (parsed.projectId) where['projectId'] = parsed.projectId;
        if (since) where['createdAt'] = { gte: since };

        const traces = await prisma.executionTrace.findMany({
          where,
          select: {
            projectId: true,
            totalCostUsd: true,
            totalTokensUsed: true,
          },
        });

        const byProject = new Map<
          string,
          { costUSD: number; tokens: number; traces: number }
        >();

        let totalCostUSD = 0;
        let totalTokens = 0;

        for (const t of traces) {
          totalCostUSD += t.totalCostUsd;
          totalTokens += t.totalTokensUsed;

          const existing = byProject.get(t.projectId) ?? {
            costUSD: 0,
            tokens: 0,
            traces: 0,
          };
          existing.costUSD += t.totalCostUsd;
          existing.tokens += t.totalTokensUsed;
          existing.traces += 1;
          byProject.set(t.projectId, existing);
        }

        return ok({
          success: true,
          output: {
            totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
            totalTokens,
            traceCount: traces.length,
            breakdown: [...byProject.entries()].map(([projectId, data]) => ({
              projectId,
              costUSD: Math.round(data.costUSD * 10000) / 10000,
              tokens: data.tokens,
              traces: data.traces,
            })),
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-get-cost-report',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── admin-get-agent-health ────────────────────────────────────────

const agentHealthInput = z.object({
  agentId: z.string().describe('Agent ID to check health for.'),
  period: z
    .enum(['today', '7d', '30d'])
    .optional()
    .describe('Time period (default: 7d).'),
});

const agentHealthOutput = z.object({
  agentId: z.string(),
  agentName: z.string(),
  status: z.string(),
  period: z.string(),
  traceCount: z.number(),
  errorCount: z.number(),
  errorRate: z.number(),
  avgDurationMs: z.number(),
  avgTokensPerTrace: z.number(),
  totalCostUSD: z.number(),
});

/**
 * Create the admin-get-agent-health tool.
 *
 * Returns health metrics for a specific agent over a time period.
 */
export function createAdminGetAgentHealthTool(
  options: AdminObservabilityToolOptions & {
    agentRepository: import('@/agents/types.js').AgentRepository;
  },
): ExecutableTool {
  const { prisma, agentRepository } = options;

  return {
    id: 'admin-get-agent-health',
    name: 'Admin Get Agent Health',
    description:
      'Get health metrics for a specific agent: error rate, avg duration, ' +
      'token usage, and cost over a time period.',
    category: 'admin',
    inputSchema: agentHealthInput,
    outputSchema: agentHealthOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = agentHealthInput.parse(input) as {
        agentId: string;
        period?: string;
      };

      const period = parsed.period ?? '7d';
      logger.info('Getting agent health', {
        component: 'admin-get-agent-health',
        agentId: parsed.agentId,
        period,
      });

      try {
        const agent = await agentRepository.findById(
          parsed.agentId as import('@/agents/types.js').AgentId,
        );
        if (!agent) {
          return err(
            new ToolExecutionError(
              'admin-get-agent-health',
              `Agent not found: ${parsed.agentId}`,
            ),
          );
        }

        const since = periodToDate(period);
        const where: Record<string, unknown> = {
          // Traces don't have agentId directly; filter by sessions belonging to this agent
          session: { agentId: parsed.agentId },
        };
        if (since) where['createdAt'] = { gte: since };

        const traces = await prisma.executionTrace.findMany({
          where,
          select: {
            status: true,
            totalDurationMs: true,
            totalTokensUsed: true,
            totalCostUsd: true,
          },
        });

        const traceCount = traces.length;
        const errorCount = traces.filter((t) => t.status === 'error').length;
        const totalDuration = traces.reduce((sum, t) => sum + t.totalDurationMs, 0);
        const totalTokens = traces.reduce((sum, t) => sum + t.totalTokensUsed, 0);
        const totalCost = traces.reduce((sum, t) => sum + t.totalCostUsd, 0);

        return ok({
          success: true,
          output: {
            agentId: agent.id,
            agentName: agent.name,
            status: agent.status,
            period,
            traceCount,
            errorCount,
            errorRate: traceCount > 0 ? Math.round((errorCount / traceCount) * 10000) / 10000 : 0,
            avgDurationMs: traceCount > 0 ? Math.round(totalDuration / traceCount) : 0,
            avgTokensPerTrace: traceCount > 0 ? Math.round(totalTokens / traceCount) : 0,
            totalCostUSD: Math.round(totalCost * 10000) / 10000,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-get-agent-health',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Convert a period string to a Date for filtering. */
function periodToDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}
