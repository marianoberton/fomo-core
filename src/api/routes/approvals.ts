/**
 * Approval routes — list pending approvals and resolve them.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApprovalId, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Zod Schemas ────────────────────────────────────────────────

const resolveApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  resolvedBy: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

const decideApprovalSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(2000).optional(),
});

const approvalsFilterSchema = z.object({
  status: z.string().optional(),
  projectId: z.string().optional(),
});

// ─── Route Plugin ───────────────────────────────────────────────

/** Register approval routes. */
export function approvalRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { approvalGate } = deps;

  // GET /approvals — global list with filters and pagination
  fastify.get('/approvals', async (request, reply) => {
    const query = paginationSchema.merge(approvalsFilterSchema).parse(request.query);
    const { limit, offset, status, projectId } = query;

    // Use existing listPending for now; filter by status client-side
    let approvals;
    if (projectId) {
      approvals = await approvalGate.listPending(projectId as ProjectId);
    } else {
      approvals = await approvalGate.listAll();
    }

    // Filter by status if provided
    if (status) {
      approvals = approvals.filter((a) => a.status === status);
    }

    return sendSuccess(reply, paginate(approvals, limit, offset));
  });

  // GET /projects/:projectId/approvals/pending
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/approvals/pending',
    async (request, reply) => {
      const query = paginationSchema.parse(request.query);
      const pending = await approvalGate.listPending(
        request.params.projectId as ProjectId,
      );
      return sendSuccess(reply, paginate(pending, query.limit, query.offset));
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

  // POST /approvals/:id/resolve — original endpoint
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

  // POST /approvals/:id/decide — dashboard-compatible endpoint
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/decide',
    async (request, reply) => {
      const { approved, note } = decideApprovalSchema.parse(request.body);

      const decision = approved ? 'approved' : 'denied';
      const resolved = await approvalGate.resolve(
        request.params.id as ApprovalId,
        decision,
        'dashboard',
        note,
      );

      if (!resolved) return sendNotFound(reply, 'ApprovalRequest', request.params.id);

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
