/**
 * Approval routes — list pending approvals and resolve them.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApprovalId, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const resolveApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  resolvedBy: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register approval routes. */
export function approvalRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { approvalGate } = deps;

  // GET /projects/:projectId/approvals/pending
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/approvals/pending',
    async (request, reply) => {
      const pending = await approvalGate.listPending(
        request.params.projectId as ProjectId,
      );
      return sendSuccess(reply, pending);
    },
  );

  // GET /approvals/:id
  fastify.get<{ Params: { id: string } }>(
    '/approvals/:id',
    async (request, reply) => {
      const approval = await approvalGate.get(request.params.id as ApprovalId);
      if (!approval) return sendNotFound(reply, 'ApprovalRequest', request.params.id);
      return sendSuccess(reply, approval);
    },
  );

  // POST /approvals/:id/resolve
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/resolve',
    async (request, reply) => {
      const { decision, resolvedBy, note } = resolveApprovalSchema.parse(request.body);

      const resolved = await approvalGate.resolve(
        request.params.id as ApprovalId,
        decision,
        resolvedBy,
        note,
      );

      if (!resolved) return sendNotFound(reply, 'ApprovalRequest', request.params.id);

      // If already resolved/expired, inform the client
      if (resolved.status !== decision) {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${resolved.status}"`,
          409,
          { currentStatus: resolved.status },
        );
      }

      return sendSuccess(reply, resolved);
    },
  );
}
