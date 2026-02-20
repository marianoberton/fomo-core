/**
 * Query Sessions Tool — lists sessions with optional filtering.
 * Intended for "internal" mode so the agent can review customer conversations.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  contactId: z.string().min(1).optional()
    .describe('Filter by contact ID'),
  contactName: z.string().min(1).optional()
    .describe('Search contacts by name (partial match)'),
  channel: z.string().min(1).optional()
    .describe('Filter by channel (e.g. "whatsapp", "telegram")'),
  status: z.enum(['active', 'closed', 'expired']).optional()
    .describe('Filter by session status (default: all)'),
  limit: z.number().int().min(1).max(50).optional()
    .describe('Maximum number of sessions to return (default: 20)'),
});

const outputSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string(),
    contactId: z.string().optional(),
    contactName: z.string().optional(),
    channel: z.string().optional(),
    status: z.string(),
    messageCount: z.number(),
    lastMessageAt: z.string().optional(),
    createdAt: z.string(),
  })),
  total: z.number(),
});

// ─── Options ────────────────────────────────────────────────────

export interface QuerySessionsToolOptions {
  prisma: PrismaClient;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a query-sessions tool for browsing conversation sessions. */
export function createQuerySessionsTool(
  options: QuerySessionsToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'query-sessions',
    name: 'Query Sessions',
    description: 'Lists conversation sessions for the current project with optional filters (contact, channel, status). Use this to find and review customer conversations. Returns session summaries with message counts.',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);
      const projectId = context.projectId as string;
      const limit = parsed.limit ?? 20;

      try {
        // Build where clause
        const where: Record<string, unknown> = { projectId };
        if (parsed.status) {
          where['status'] = parsed.status;
        }

        // Channel/contactId are stored in session metadata
        const sessions = await prisma.session.findMany({
          where: where as Parameters<typeof prisma.session.findMany>[0] extends { where?: infer W } ? W : never,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          include: {
            _count: { select: { messages: true } },
          },
        });

        // Post-filter by metadata fields and enrich with contact info
        const results: {
          sessionId: string;
          contactId?: string;
          contactName?: string;
          channel?: string;
          status: string;
          messageCount: number;
          lastMessageAt?: string;
          createdAt: string;
        }[] = [];

        for (const session of sessions) {
          const metadata = session.metadata as Record<string, unknown> | null;
          const sessionChannel = metadata?.['channel'] as string | undefined;
          const sessionContactId = metadata?.['contactId'] as string | undefined;

          // Apply channel filter
          if (parsed.channel && sessionChannel !== parsed.channel) continue;

          // Apply contactId filter
          if (parsed.contactId && sessionContactId !== parsed.contactId) continue;

          // Look up contact name if we have a contactId
          let contactName: string | undefined;
          if (sessionContactId) {
            const contact = await prisma.contact.findUnique({
              where: { id: sessionContactId },
              select: { name: true },
            });
            contactName = contact?.name;

            // Apply contactName filter (partial match)
            if (parsed.contactName && contactName && !contactName.toLowerCase().includes(parsed.contactName.toLowerCase())) {
              continue;
            }
            if (parsed.contactName && !contactName) continue;
          } else if (parsed.contactName) {
            continue; // No contact to match
          }

          // Get last message timestamp
          const lastMessage = await prisma.message.findFirst({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });

          results.push({
            sessionId: session.id,
            contactId: sessionContactId,
            contactName,
            channel: sessionChannel,
            status: session.status,
            messageCount: session._count.messages,
            lastMessageAt: lastMessage?.createdAt.toISOString(),
            createdAt: session.createdAt.toISOString(),
          });
        }

        const output = { sessions: results, total: results.length };

        return ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        return err(new ToolExecutionError(
          'query-sessions',
          error instanceof Error ? error.message : 'Unknown error querying sessions',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      return ok({
        success: true,
        output: {
          dryRun: true,
          description: 'Would query sessions',
          filters: {
            contactId: parsed.contactId,
            contactName: parsed.contactName,
            channel: parsed.channel,
            status: parsed.status,
            limit: parsed.limit ?? 20,
          },
        },
        durationMs: Date.now() - startTime,
      });
    },
  };
}
