/**
 * Execution trace routes — read-only access to agent run traces.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { SessionId, TraceId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import {
  requireSessionAccess,
  requireTraceAccess,
  ProjectAccessDeniedError,
  ResourceNotFoundError,
} from '../middleware/require-project-access.js';

const listFilterSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  toolId: z.string().optional(),
  status: z.enum(['success', 'error', 'all']).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface TraceEventRecord {
  type?: string;
  toolId?: string;
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register execution trace routes (read-only). */
export function traceRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { executionTraceRepository, prisma } = deps;

  function isGuardError(e: unknown): boolean {
    return e instanceof ProjectAccessDeniedError || e instanceof ResourceNotFoundError;
  }

  // GET /sessions/:sessionId/traces
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/traces',
    async (request, reply) => {
      try {
        await requireSessionAccess(request, reply, request.params.sessionId, prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }
      const traces = await executionTraceRepository.listBySession(
        request.params.sessionId as SessionId,
      );
      return sendSuccess(reply, traces);
    },
  );

  // GET /traces — filterable list
  fastify.get('/traces', async (request, reply) => {
    const parsed = listFilterSchema.safeParse(request.query);
    if (!parsed.success) {
      await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
      return;
    }
    const filter = parsed.data;

    const where: Prisma.ExecutionTraceWhereInput = { projectId: filter.projectId };
    if (filter.sessionId) where.sessionId = filter.sessionId;
    if (filter.status && filter.status !== 'all') {
      where.status =
        filter.status === 'success' ? { in: ['completed', 'success'] } : { in: ['error', 'failed'] };
    }
    if (filter.since || filter.until) {
      where.createdAt = {
        ...(filter.since && { gte: new Date(filter.since) }),
        ...(filter.until && { lte: new Date(filter.until) }),
      };
    }
    if (filter.agentId) {
      where.session = { agentId: filter.agentId };
    }

    const [rows, total] = await Promise.all([
      prisma.executionTrace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
        include: {
          session: { select: { agentId: true, agent: { select: { name: true } } } },
        },
      }),
      prisma.executionTrace.count({ where }),
    ]);

    const items = rows
      .filter((r) => {
        if (!filter.toolId) return true;
        const events = Array.isArray(r.events) ? (r.events as TraceEventRecord[]) : [];
        return events.some((ev) => ev?.type === 'tool_call' && ev.toolId === filter.toolId);
      })
      .map((r) => {
        const events = Array.isArray(r.events) ? (r.events as TraceEventRecord[]) : [];
        const firstTool = events.find((ev) => ev?.type === 'tool_call')?.toolId;
        return {
          id: r.id,
          sessionId: r.sessionId,
          agentId: r.session.agentId ?? undefined,
          agentName: r.session.agent?.name ?? undefined,
          toolId: firstTool,
          status: r.status,
          durationMs: r.totalDurationMs,
          costUsd: r.totalCostUsd,
          createdAt: r.createdAt.toISOString(),
        };
      });

    await sendSuccess(reply, {
      items,
      total,
      page: Math.floor(filter.offset / filter.limit),
    });
  });

  // GET /traces/:id
  fastify.get<{ Params: { id: string } }>('/traces/:id', async (request, reply) => {
    try {
      await requireTraceAccess(request, reply, request.params.id, prisma);
    } catch (e) {
      if (isGuardError(e)) return;
      throw e;
    }
    const trace = await executionTraceRepository.findById(request.params.id as TraceId);
    if (!trace) return sendNotFound(reply, 'ExecutionTrace', request.params.id);
    return sendSuccess(reply, trace);
  });
}
