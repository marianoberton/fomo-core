/**
 * Execution trace routes — read-only access to agent run traces.
 */
import type { FastifyInstance } from 'fastify';
import type { SessionId, TraceId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Route Plugin ───────────────────────────────────────────────

/** Register execution trace routes (read-only). */
export function traceRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { executionTraceRepository } = deps;

  // GET /sessions/:sessionId/traces
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/traces',
    async (request, reply) => {
      const traces = await executionTraceRepository.listBySession(
        request.params.sessionId as SessionId,
      );
      return sendSuccess(reply, traces);
    },
  );

  // GET /traces/:id
  fastify.get<{ Params: { id: string } }>('/traces/:id', async (request, reply) => {
    const trace = await executionTraceRepository.findById(request.params.id as TraceId);
    if (!trace) return sendNotFound(reply, 'ExecutionTrace', request.params.id);
    return sendSuccess(reply, trace);
  });
}
