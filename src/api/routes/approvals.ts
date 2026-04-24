/**
 * Approval routes — list pending approvals and resolve them.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApprovalId, ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';
import { createLogger } from '@/observability/logger.js';
import {
  requireApprovalAccess,
  ProjectAccessDeniedError,
  ResourceNotFoundError,
} from '../middleware/require-project-access.js';
import { buildApprovalContext } from '@/notifiers/approval-context.js';

const logger = createLogger({ name: 'approval-routes' });

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

const approveBodySchema = z.object({
  resolvedBy: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

const rejectBodySchema = z.object({
  resolvedBy: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
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
  const { approvalGate, resumeAfterApproval, prisma } = deps;

  function isGuardError(e: unknown): boolean {
    return e instanceof ProjectAccessDeniedError || e instanceof ResourceNotFoundError;
  }

  async function enrichApproval(
    approval: Awaited<ReturnType<typeof approvalGate.get>>,
  ): Promise<Record<string, unknown> | null> {
    if (!approval) return null;
    const context = await buildApprovalContext(prisma, approval);
    return {
      id: approval.id,
      projectId: approval.projectId,
      agentId: context.agentId,
      agentName: context.agentName,
      actionProposed: {
        tool: approval.toolId,
        input: approval.toolInput,
        rationale: approval.resolutionNote ?? null,
      },
      context: {
        contactName: context.leadName,
        contactId: context.contactId,
        leadInfo: context.leadContact,
        sessionId: approval.sessionId,
        conversationId: approval.sessionId,
        projectName: context.projectName,
      },
      riskLevel: approval.riskLevel,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
      status: approval.status,
      resolvedAt: approval.resolvedAt ?? null,
      resolvedBy: approval.resolvedBy ?? null,
      resolution: approval.resolutionNote ?? null,
      actionSummary: context.actionSummary,
    };
  }

  // GET /approvals — global list with filters and pagination
  fastify.get('/approvals', async (request, reply) => {
    const query = paginationSchema.merge(approvalsFilterSchema).parse(request.query);
    const { limit, offset, status, projectId } = query;

    let approvals = await approvalGate.listAll();

    // Filter by project if provided
    if (projectId) {
      approvals = approvals.filter((a) => a.projectId === projectId);
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
      try {
        await requireApprovalAccess(request, reply, request.params.id, prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }
      const approval = await approvalGate.get(request.params.id as ApprovalId);
      if (!approval) return sendNotFound(reply, 'ApprovalRequest', request.params.id);
      return sendSuccess(reply, approval);
    },
  );

  // POST /approvals/:id/resolve — original endpoint
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/resolve',
    async (request, reply) => {
      try {
        await requireApprovalAccess(request, reply, request.params.id, prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }
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

      // Fire-and-forget: resume agent execution with the decision
      resumeAfterApproval({ approvalId: request.params.id, decision, resolvedBy, note })
        .catch((err: unknown) => { logger.error('Failed to resume after approval', {
          component: 'approval-routes',
          approvalId: request.params.id,
          error: err instanceof Error ? err.message : String(err),
        }); });

      return sendSuccess(reply, resolved);
    },
  );

  // POST /approvals/:id/decide — dashboard-compatible endpoint
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/decide',
    async (request, reply) => {
      try {
        await requireApprovalAccess(request, reply, request.params.id, prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }
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

      // Fire-and-forget: resume agent execution with the decision
      resumeAfterApproval({ approvalId: request.params.id, decision, resolvedBy: 'dashboard', note })
        .catch((err: unknown) => { logger.error('Failed to resume after approval', {
          component: 'approval-routes',
          approvalId: request.params.id,
          error: err instanceof Error ? err.message : String(err),
        }); });

      return sendSuccess(reply, resolved);
    },
  );

  // ─── Project-scoped approval detail + approve/reject ──────────
  //
  // Powers the dashboard approval view that Telegram + in-app
  // notifications link to. The enriched shape bundles the agent name,
  // contact, and action summary so the operator can decide with the
  // full context in one request.

  async function assertApprovalInProject(
    reply: Parameters<typeof sendError>[0],
    approvalId: string,
    projectId: string,
  ): Promise<boolean> {
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      select: { projectId: true },
    });
    if (!approval) {
      await sendNotFound(reply, 'ApprovalRequest', approvalId);
      return false;
    }
    if (approval.projectId !== projectId) {
      await sendError(
        reply,
        'NOT_IN_PROJECT',
        `ApprovalRequest "${approvalId}" does not belong to project "${projectId}"`,
        404,
      );
      return false;
    }
    return true;
  }

  // GET /projects/:projectId/approvals/:approvalId
  fastify.get<{ Params: { projectId: string; approvalId: string } }>(
    '/projects/:projectId/approvals/:approvalId',
    async (request, reply) => {
      const { projectId, approvalId } = request.params;
      if (!(await assertApprovalInProject(reply, approvalId, projectId))) return;

      const approval = await approvalGate.get(approvalId as ApprovalId);
      if (!approval) return sendNotFound(reply, 'ApprovalRequest', approvalId);

      const enriched = await enrichApproval(approval);
      return sendSuccess(reply, enriched);
    },
  );

  // POST /projects/:projectId/approvals/:approvalId/approve
  fastify.post<{ Params: { projectId: string; approvalId: string } }>(
    '/projects/:projectId/approvals/:approvalId/approve',
    async (request, reply) => {
      const { projectId, approvalId } = request.params;
      if (!(await assertApprovalInProject(reply, approvalId, projectId))) return;

      const { resolvedBy, note } = approveBodySchema.parse(request.body);

      // Idempotency — explicit pre-check so we can return the richer
      // "currentStatus" context the dashboard uses to update its view.
      const existing = await approvalGate.get(approvalId as ApprovalId);
      if (!existing) return sendNotFound(reply, 'ApprovalRequest', approvalId);
      if (existing.status !== 'pending') {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${existing.status}"`,
          409,
          { currentStatus: existing.status },
        );
      }

      const resolved = await approvalGate.resolve(
        approvalId as ApprovalId,
        'approved',
        resolvedBy,
        note,
      );
      if (!resolved) return sendNotFound(reply, 'ApprovalRequest', approvalId);
      if (resolved.status !== 'approved') {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${resolved.status}"`,
          409,
          { currentStatus: resolved.status },
        );
      }

      resumeAfterApproval({ approvalId, decision: 'approved', resolvedBy, note })
        .catch((err: unknown) => { logger.error('Failed to resume after approval', {
          component: 'approval-routes',
          approvalId,
          error: err instanceof Error ? err.message : String(err),
        }); });

      const enriched = await enrichApproval(resolved);
      return sendSuccess(reply, enriched);
    },
  );

  // POST /projects/:projectId/approvals/:approvalId/reject
  fastify.post<{ Params: { projectId: string; approvalId: string } }>(
    '/projects/:projectId/approvals/:approvalId/reject',
    async (request, reply) => {
      const { projectId, approvalId } = request.params;
      if (!(await assertApprovalInProject(reply, approvalId, projectId))) return;

      const { resolvedBy, reason } = rejectBodySchema.parse(request.body);

      const existing = await approvalGate.get(approvalId as ApprovalId);
      if (!existing) return sendNotFound(reply, 'ApprovalRequest', approvalId);
      if (existing.status !== 'pending') {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${existing.status}"`,
          409,
          { currentStatus: existing.status },
        );
      }

      const resolved = await approvalGate.resolve(
        approvalId as ApprovalId,
        'denied',
        resolvedBy,
        reason,
      );
      if (!resolved) return sendNotFound(reply, 'ApprovalRequest', approvalId);
      if (resolved.status !== 'denied') {
        return sendError(
          reply,
          'APPROVAL_NOT_PENDING',
          `Approval is already "${resolved.status}"`,
          409,
          { currentStatus: resolved.status },
        );
      }

      resumeAfterApproval({ approvalId, decision: 'denied', resolvedBy, note: reason })
        .catch((err: unknown) => { logger.error('Failed to resume after approval', {
          component: 'approval-routes',
          approvalId,
          error: err instanceof Error ? err.message : String(err),
        }); });

      const enriched = await enrichApproval(resolved);
      return sendSuccess(reply, enriched);
    },
  );
}
