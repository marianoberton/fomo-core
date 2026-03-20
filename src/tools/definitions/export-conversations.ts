/**
 * export-conversations tool
 * Allows the Manager Agent to export conversation summaries to the owner.
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

const inputSchema = z.object({
  startDate: z.string().describe('Start date in ISO format (YYYY-MM-DD)'),
  endDate: z.string().optional().describe('End date in ISO format, defaults to today'),
  format: z.enum(['summary', 'detailed', 'highlights']).default('summary')
    .describe('summary=key metrics, detailed=all convos, highlights=important ones only'),
  filter: z.enum(['all', 'leads', 'escalated', 'unresolved']).default('all')
    .describe('Filter conversations by type'),
});

const outputSchema = z.object({
  period: z.object({ startDate: z.string(), endDate: z.string() }),
  format: z.string(),
  filter: z.string(),
  totalSessions: z.number(),
  conversations: z.array(z.object({
    sessionId: z.string(),
    contactName: z.string().optional(),
    channel: z.string().optional(),
    status: z.string(),
    messageCount: z.number(),
    wasEscalated: z.boolean(),
    startedAt: z.string(),
    lastMessageAt: z.string(),
    firstUserMessage: z.string().optional(),
  })),
  metrics: z.object({
    totalMessages: z.number(),
    escalated: z.number(),
    unresolved: z.number(),
    avgMessagesPerSession: z.number(),
  }),
});

// ─── Options ────────────────────────────────────────────────────

export interface ExportConversationsToolOptions {
  prisma: PrismaClient;
}

// ─── Factory ────────────────────────────────────────────────────

export function createExportConversationsTool(
  options: ExportConversationsToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'export-conversations',
    name: 'Export Conversations',
    description:
      'Export conversation summaries for a date range. Use this to review what happened in the business over a period: total sessions, messages, escalations, unresolved chats, and per-conversation details. Supports summary, detailed, and highlights formats.',
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
        startDate: string;
        endDate?: string;
        format: 'summary' | 'detailed' | 'highlights';
        filter: 'all' | 'leads' | 'escalated' | 'unresolved';
      };
      const projectId = context.projectId as string;

      try {
        const start = new Date(data.startDate);
        const end = data.endDate ? new Date(data.endDate) : new Date();
        // Set end to end of day
        end.setUTCHours(23, 59, 59, 999);

        // Fetch sessions with message counts and escalation info
        const sessions = await prisma.session.findMany({
          where: {
            projectId,
            createdAt: { gte: start, lte: end },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { messages: true } },
            contact: { select: { name: true } },
            messages: {
              where: { role: 'user' },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { content: true },
            },
          },
        });

        // Check which sessions had escalations
        const sessionIds = sessions.map((s) => s.id);
        const escalatedSessionIds = new Set<string>();

        if (sessionIds.length > 0) {
          const escalations = await prisma.approvalRequest.findMany({
            where: {
              projectId,
              sessionId: { in: sessionIds },
              toolId: 'escalate-to-human',
            },
            select: { sessionId: true },
          });
          for (const e of escalations) {
            escalatedSessionIds.add(e.sessionId);
          }
        }

        // Apply filter
        let filtered = sessions;
        if (data.filter === 'escalated') {
          filtered = sessions.filter((s) => escalatedSessionIds.has(s.id));
        } else if (data.filter === 'unresolved') {
          filtered = sessions.filter((s) => s.status !== 'closed' && s.status !== 'resolved');
        }

        // For highlights: only sessions with escalations OR high message count
        if (data.format === 'highlights') {
          filtered = filtered.filter(
            (s) => escalatedSessionIds.has(s.id) || s._count.messages > 10,
          );
        }

        const conversations = filtered.map((s) => {
          const metadata = s.metadata as Record<string, unknown> | null;
          const firstMsg = (s.messages as { content: unknown }[])[0];
          const firstContent = firstMsg
            ? typeof firstMsg.content === 'string'
              ? firstMsg.content.slice(0, 200)
              : JSON.stringify(firstMsg.content).slice(0, 200)
            : undefined;

          return {
            sessionId: s.id,
            contactName: (s.contact as { name: string } | null)?.name,
            channel: metadata?.['channel'] as string | undefined,
            status: s.status,
            messageCount: s._count.messages,
            wasEscalated: escalatedSessionIds.has(s.id),
            startedAt: s.createdAt.toISOString(),
            lastMessageAt: s.updatedAt.toISOString(),
            firstUserMessage: firstContent,
          };
        });

        const totalMessages = conversations.reduce((sum, c) => sum + c.messageCount, 0);
        const escalatedCount = conversations.filter((c) => c.wasEscalated).length;
        const unresolvedCount = sessions.filter(
          (s) => s.status !== 'closed' && s.status !== 'resolved',
        ).length;

        // For summary format, omit per-conversation details
        const conversationList =
          data.format === 'summary' ? [] : conversations;

        const output = {
          period: {
            startDate: start.toISOString().split('T')[0] ?? data.startDate,
            endDate: end.toISOString().split('T')[0] ?? (data.endDate ?? new Date().toISOString().split('T')[0] ?? ''),
          },
          format: data.format,
          filter: data.filter,
          totalSessions: sessions.length,
          conversations: conversationList,
          metrics: {
            totalMessages,
            escalated: escalatedCount,
            unresolved: unresolvedCount,
            avgMessagesPerSession:
              sessions.length > 0
                ? Math.round((totalMessages / sessions.length) * 10) / 10
                : 0,
          },
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'export-conversations',
          error instanceof Error ? error.message : 'Unknown error exporting conversations',
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
        startDate: string;
        endDate?: string;
        format: string;
        filter: string;
      };

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would export ${data.filter} conversations from ${data.startDate} to ${data.endDate ?? 'today'} in ${data.format} format`,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
