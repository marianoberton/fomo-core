/**
 * Inbox routes — conversation inbox for the dashboard.
 *
 * Provides paginated session lists with contact info, last message, and
 * message counts, plus a detail endpoint with full message history.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Schemas ────────────────────────────────────────────────────

const inboxQuerySchema = z.object({
  agentId: z.string().optional(),
  status: z.string().optional(),
  channel: z.string().optional(),
  contactId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Route Registration ─────────────────────────────────────────

export function inboxRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;

  // ─── List Inbox Sessions ─────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/inbox',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = inboxQuerySchema.parse(request.query);

      // Build Prisma where clause
      const where: Record<string, unknown> = { projectId };
      if (query.status) {
        where['status'] = query.status;
      }

      // Fetch sessions with message count
      const sessions = await prisma.session.findMany({
        where: where as Parameters<typeof prisma.session.findMany>[0] extends { where?: infer W } ? W : never,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { messages: true } },
        },
      });

      // Post-filter and enrich with contact info + last message
      const enriched: {
        sessionId: string;
        status: string;
        contactId?: string;
        contactName?: string;
        contactRole?: string;
        agentId?: string;
        channel?: string;
        messageCount: number;
        lastMessage?: { role: string; content: string; createdAt: string };
        createdAt: string;
        updatedAt: string;
      }[] = [];

      for (const session of sessions) {
        const metadata = session.metadata as Record<string, unknown> | null;
        const sessionChannel = metadata?.['channel'] as string | undefined;
        const sessionContactId = metadata?.['contactId'] as string | undefined;
        const sessionAgentId = metadata?.['agentId'] as string | undefined;

        // Apply filters
        if (query.channel && sessionChannel !== query.channel) continue;
        if (query.contactId && sessionContactId !== query.contactId) continue;
        if (query.agentId && sessionAgentId !== query.agentId) continue;

        // Resolve contact name
        let contactName: string | undefined;
        let contactRole: string | undefined;
        if (sessionContactId) {
          const contact = await prisma.contact.findUnique({
            where: { id: sessionContactId },
            select: { name: true, role: true },
          });
          contactName = contact?.name;
          contactRole = contact?.role ?? undefined;

          // Apply search filter (partial name match)
          if (query.search && contactName && !contactName.toLowerCase().includes(query.search.toLowerCase())) {
            continue;
          }
          if (query.search && !contactName) continue;
        } else if (query.search) {
          continue;
        }

        // Get last message
        const lastMsg = await prisma.message.findFirst({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'desc' },
          select: { role: true, content: true, createdAt: true },
        });

        enriched.push({
          sessionId: session.id,
          status: session.status,
          contactId: sessionContactId,
          contactName,
          contactRole,
          agentId: sessionAgentId,
          channel: sessionChannel,
          messageCount: session._count.messages,
          lastMessage: lastMsg
            ? { role: lastMsg.role, content: lastMsg.content, createdAt: lastMsg.createdAt.toISOString() }
            : undefined,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        });
      }

      // Apply offset + limit
      const total = enriched.length;
      const items = enriched.slice(query.offset, query.offset + query.limit);

      return sendSuccess(reply, { items, total, limit: query.limit, offset: query.offset });
    },
  );

  // ─── Get Inbox Session Detail ────────────────────────────────────

  fastify.get(
    '/projects/:projectId/inbox/:sessionId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, sessionId } = request.params as { projectId: string; sessionId: string };

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          _count: { select: { messages: true } },
        },
      });

      if (!session || session.projectId !== projectId) {
        return sendNotFound(reply, 'Session', sessionId);
      }

      const metadata = session.metadata as Record<string, unknown> | null;
      const contactId = metadata?.['contactId'] as string | undefined;
      const channel = metadata?.['channel'] as string | undefined;
      const agentId = metadata?.['agentId'] as string | undefined;

      // Load contact info
      let contact: { id: string; name: string; role?: string; phone?: string; email?: string } | undefined;
      if (contactId) {
        const c = await prisma.contact.findUnique({
          where: { id: contactId },
          select: { id: true, name: true, role: true, phone: true, email: true },
        });
        if (c) {
          contact = {
            id: c.id,
            name: c.name,
            role: c.role ?? undefined,
            phone: c.phone ?? undefined,
            email: c.email ?? undefined,
          };
        }
      }

      // Load full message history
      const messages = await prisma.message.findMany({
        where: { sessionId: sessionId as string & SessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
      });

      // Load execution traces for this session
      const traces = await prisma.executionTrace.findMany({
        where: { sessionId: sessionId as string & SessionId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          completedAt: true,
          totalTokensUsed: true,
          totalCostUsd: true,
        },
      });

      return sendSuccess(reply, {
        sessionId: session.id,
        projectId: session.projectId as ProjectId,
        status: session.status,
        channel,
        agentId,
        contact,
        messageCount: session._count.messages,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          createdAt: m.createdAt.toISOString(),
        })),
        traces: traces.map((t) => ({
          id: t.id,
          createdAt: t.createdAt.toISOString(),
          completedAt: t.completedAt?.toISOString(),
          totalTokensUsed: t.totalTokensUsed,
          totalCostUsd: t.totalCostUsd,
        })),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      });
    },
  );
}
