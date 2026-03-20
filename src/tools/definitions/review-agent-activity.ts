/**
 * Review Agent Activity Tool — recent activity feed for a specific agent.
 * Returns last sessions, tool executions with previews, and errors.
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
    .describe('The name of the agent to review recent activity for.'),
  limit: z.number().int().min(1).max(50).default(20)
    .describe('Maximum number of recent items to return. Default: 20.'),
});

const outputSchema = z.object({
  agentName: z.string(),
  agentId: z.string(),
  recentSessions: z.array(z.object({
    sessionId: z.string(),
    contactName: z.string().optional(),
    channel: z.string().optional(),
    status: z.string(),
    messageCount: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })),
  recentToolExecutions: z.array(z.object({
    traceId: z.string(),
    sessionId: z.string(),
    toolName: z.string(),
    success: z.boolean(),
    durationMs: z.number().optional(),
    timestamp: z.string(),
    inputPreview: z.string().optional(),
    outputPreview: z.string().optional(),
    error: z.string().optional(),
  })),
  errors: z.array(z.object({
    traceId: z.string(),
    sessionId: z.string(),
    type: z.string(),
    message: z.string(),
    timestamp: z.string(),
  })),
});

// ─── Options ────────────────────────────────────────────────────

/** Dependencies for the review-agent-activity tool. */
export interface ReviewAgentActivityToolOptions {
  prisma: PrismaClient;
  agentRegistry: AgentRegistry;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Trace event shape from ExecutionTrace.events JSON. */
interface TraceEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

/** Truncate a string to maxLen characters, appending '...' if trimmed. */
function truncate(value: unknown, maxLen: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a review-agent-activity tool for inspecting recent agent behavior. */
export function createReviewAgentActivityTool(
  options: ReviewAgentActivityToolOptions,
): ExecutableTool {
  const { prisma, agentRegistry } = options;

  return {
    id: 'review-agent-activity',
    name: 'Review Agent Activity',
    description:
      'Review an agent\'s recent activity: last sessions with contacts, tool executions with inputs/outputs, and any errors. Use this to investigate what an agent has been doing or debug issues.',
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
      const data = inputSchema.parse(input) as { agentName: string; limit: number };
      const projectId = context.projectId as string;

      try {
        // 1. Resolve agent
        const agent = await agentRegistry.getByName(projectId, data.agentName);
        if (!agent) {
          return err(new ToolExecutionError(
            'review-agent-activity',
            `Agent "${data.agentName}" not found in project`,
          ));
        }

        const agentId = agent.id as string;

        // 2. Recent sessions
        const sessions = await prisma.session.findMany({
          where: { projectId, agentId },
          orderBy: { updatedAt: 'desc' },
          take: data.limit,
          include: {
            _count: { select: { messages: true } },
            contact: { select: { name: true } },
          },
        });

        const recentSessions = sessions.map((s) => {
          const metadata = s.metadata as Record<string, unknown> | null;
          return {
            sessionId: s.id,
            contactName: (s.contact as { name: string } | null)?.name,
            channel: metadata?.['channel'] as string | undefined,
            status: s.status,
            messageCount: s._count.messages,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          };
        });

        // 3. Recent execution traces
        const sessionIds = sessions.map((s) => s.id);
        const toolExecutions: {
          traceId: string;
          sessionId: string;
          toolName: string;
          success: boolean;
          durationMs?: number;
          timestamp: string;
          inputPreview?: string;
          outputPreview?: string;
          error?: string;
        }[] = [];

        const errors: {
          traceId: string;
          sessionId: string;
          type: string;
          message: string;
          timestamp: string;
        }[] = [];

        if (sessionIds.length > 0) {
          const traces = await prisma.executionTrace.findMany({
            where: { sessionId: { in: sessionIds } },
            orderBy: { createdAt: 'desc' },
            take: data.limit,
            select: { id: true, sessionId: true, events: true, createdAt: true },
          });

          for (const trace of traces) {
            const events = trace.events as unknown as TraceEvent[];
            if (!Array.isArray(events)) continue;

            // Build a map of tool_call -> tool_result by toolCallId
            const resultMap = new Map<string, TraceEvent>();
            for (const event of events) {
              if (event.type === 'tool_result' && event.data['toolCallId']) {
                resultMap.set(event.data['toolCallId'] as string, event);
              }
            }

            for (const event of events) {
              if (event.type === 'tool_call') {
                const toolCallId = event.data['toolCallId'] as string | undefined;
                const resultEvent = toolCallId ? resultMap.get(toolCallId) : undefined;

                toolExecutions.push({
                  traceId: trace.id,
                  sessionId: trace.sessionId,
                  toolName: (event.data['toolId'] as string | undefined) ?? 'unknown',
                  success: resultEvent ? resultEvent.data['success'] as boolean : true,
                  durationMs: resultEvent?.data['durationMs'] as number | undefined,
                  timestamp: event.timestamp ?? trace.createdAt.toISOString(),
                  inputPreview: truncate(event.data['input'], 200),
                  outputPreview: resultEvent ? truncate(resultEvent.data['output'], 200) : undefined,
                  error: resultEvent?.data['error'] as string | undefined,
                });
              }

              if (event.type === 'error') {
                errors.push({
                  traceId: trace.id,
                  sessionId: trace.sessionId,
                  type: 'error',
                  message: (event.data['message'] as string | undefined) ?? 'Unknown error',
                  timestamp: event.timestamp ?? trace.createdAt.toISOString(),
                });
              }
            }
          }
        }

        // Trim to limit
        toolExecutions.splice(data.limit);
        errors.splice(data.limit);

        const output = {
          agentName: agent.name,
          agentId,
          recentSessions,
          recentToolExecutions: toolExecutions,
          errors,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'review-agent-activity',
          error instanceof Error ? error.message : 'Unknown error reviewing agent activity',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as { agentName: string; limit: number };

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would review recent activity for agent "${data.agentName}"`,
          limit: data.limit,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
