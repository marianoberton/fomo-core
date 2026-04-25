import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { approvalRoutes } from './approvals.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';

const sampleApproval = {
  id: 'appr-1' as ApprovalId,
  projectId: 'proj-1' as ProjectId,
  sessionId: 'sess-1' as SessionId,
  toolCallId: 'tc-1' as ToolCallId,
  toolId: 'http-request',
  toolInput: { url: 'https://example.com' },
  riskLevel: 'high' as const,
  status: 'pending' as const,
  requestedAt: new Date('2025-01-01'),
  expiresAt: new Date('2025-01-02'),
};

function createApp(): { app: FastifyInstance; deps: ReturnType<typeof createMockDeps> } {
  const deps = createMockDeps();
  const app = Fastify();
  app.addHook('onRequest', async (request) => { request.apiKeyProjectId = null; });
  registerErrorHandler(app);
  approvalRoutes(app, deps);
  return { app, deps };
}

describe('approvalRoutes', () => {
  describe('GET /projects/:projectId/approvals/pending', () => {
    it('returns pending approvals for a project', async () => {
      const { app, deps } = createApp();

      deps.approvalGate.listPending.mockResolvedValue([sampleApproval]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/approvals/pending',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { items: unknown[]; total: number; limit: number; offset: number } }>();
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(1);

       
      expect(deps.approvalGate.listPending).toHaveBeenCalledWith('proj-1' as ProjectId);
    });
  });

  describe('GET /approvals/:id', () => {
    it('returns an approval by id', async () => {
      const { app, deps } = createApp();

      deps.approvalGate.get.mockResolvedValue(sampleApproval);

      const response = await app.inject({
        method: 'GET',
        url: '/approvals/appr-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { id: string } }>();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('appr-1');
    });

    it('returns 404 when approval is not found', async () => {
      const { app, deps } = createApp();

      deps.approvalGate.get.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/approvals/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('nonexistent');
    });
  });

  describe('POST /approvals/:id/resolve', () => {
    it('resolves an approval and returns it', async () => {
      const { app, deps } = createApp();
      const resolved = { ...sampleApproval, status: 'approved' as const };

      deps.approvalGate.resolve.mockResolvedValue(resolved);

      const response = await app.inject({
        method: 'POST',
        url: '/approvals/appr-1/resolve',
        payload: {
          decision: 'approved',
          resolvedBy: 'admin-user',
          note: 'Looks good',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { id: string; status: string } }>();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('approved');

       
      expect(deps.approvalGate.resolve).toHaveBeenCalledWith(
        'appr-1' as ApprovalId,
        'approved',
        'admin-user',
        'Looks good',
      );
    });

    it('returns 404 when approval is not found', async () => {
      const { app, deps } = createApp();

      deps.approvalGate.resolve.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/approvals/nonexistent/resolve',
        payload: {
          decision: 'approved',
          resolvedBy: 'admin-user',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('nonexistent');
    });

    it('returns 409 when approval is already resolved', async () => {
      const { app, deps } = createApp();
      const alreadyDenied = { ...sampleApproval, status: 'denied' as const };

      deps.approvalGate.resolve.mockResolvedValue(alreadyDenied);

      const response = await app.inject({
        method: 'POST',
        url: '/approvals/appr-1/resolve',
        payload: {
          decision: 'approved',
          resolvedBy: 'admin-user',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json<{
        success: boolean;
        error: { code: string; message: string; details: { currentStatus: string } };
      }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('APPROVAL_NOT_PENDING');
      expect(body.error.details.currentStatus).toBe('denied');
    });

    it('returns 400 for invalid body', async () => {
      const { app } = createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/approvals/appr-1/resolve',
        payload: {
          decision: 'maybe',
          resolvedBy: '',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ success: boolean; error: { code: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Project-scoped approval view (dashboard + notifiers) ────

  describe('GET /projects/:projectId/approvals/:approvalId', () => {
    function stubPrismaForEnrichment(
      deps: ReturnType<typeof createMockDeps>,
      projectIdOnApproval: string,
    ): void {
      // approvalRequest.findUnique is used by assertApprovalInProject.
      (deps.prisma.approvalRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        projectId: projectIdOnApproval,
      });
      // session.findUnique is called by buildApprovalContext for the enriched shape.
      (deps.prisma as unknown as { session: unknown }).session = {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-1',
          projectId: projectIdOnApproval,
          contact: {
            id: 'ct-1',
            name: 'Juan Pérez',
            displayName: 'Juan Pérez',
            phone: '+54 11 1234-5678',
            email: null,
          },
          agent: { id: 'agt-1', name: 'Reactivadora' },
          project: { name: 'Market Paper' },
        }),
      };
    }

    it('returns an enriched approval detail with agent + contact + action context', async () => {
      const { app, deps } = createApp();
      stubPrismaForEnrichment(deps, 'proj-1');

      deps.approvalGate.get.mockResolvedValue({
        ...sampleApproval,
        toolId: 'send-channel-message',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/approvals/appr-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: {
          id: string;
          agentId: string;
          agentName: string;
          actionProposed: { tool: string; input: unknown };
          context: {
            contactName: string;
            contactId: string;
            leadInfo: string;
            conversationId: string;
            projectName: string;
          };
          riskLevel: string;
          status: string;
          actionSummary: string;
        };
      }>();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('appr-1');
      expect(body.data.agentName).toBe('Reactivadora');
      expect(body.data.agentId).toBe('agt-1');
      expect(body.data.actionProposed.tool).toBe('send-channel-message');
      expect(body.data.context.contactName).toBe('Juan Pérez');
      expect(body.data.context.leadInfo).toBe('+54 11 1234-5678');
      expect(body.data.context.conversationId).toBe('sess-1');
      expect(body.data.context.projectName).toBe('Market Paper');
      expect(body.data.riskLevel).toBe('high');
      expect(body.data.actionSummary).toBe('Enviar mensaje al cliente');
    });

    it('returns 404 when approval does not exist in the given project', async () => {
      const { app, deps } = createApp();
      (deps.prisma.approvalRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/approvals/missing',
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when approval belongs to a different project', async () => {
      const { app, deps } = createApp();
      (deps.prisma.approvalRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        projectId: 'proj-other',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/approvals/appr-1',
      });
      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string } }>();
      expect(body.error.code).toBe('NOT_IN_PROJECT');
    });
  });

  describe('POST /projects/:projectId/approvals/:approvalId/approve', () => {
    function stubPrismaScoped(deps: ReturnType<typeof createMockDeps>): void {
      (deps.prisma.approvalRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        projectId: 'proj-1',
      });
      (deps.prisma as unknown as { session: unknown }).session = {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-1',
          projectId: 'proj-1',
          contact: null,
          agent: null,
          project: { name: 'Proj' },
        }),
      };
    }

    it('approves when pending and returns enriched shape', async () => {
      const { app, deps } = createApp();
      stubPrismaScoped(deps);

      deps.approvalGate.get.mockResolvedValueOnce(sampleApproval);
      deps.approvalGate.resolve.mockResolvedValueOnce({
        ...sampleApproval,
        status: 'approved',
        resolvedAt: new Date('2026-04-24T10:05:00Z'),
        resolvedBy: 'op@fomo.app',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/approvals/appr-1/approve',
        payload: { resolvedBy: 'op@fomo.app', note: 'OK' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { status: string; resolvedBy: string } }>();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('approved');
      expect(body.data.resolvedBy).toBe('op@fomo.app');

      expect(deps.approvalGate.resolve).toHaveBeenCalledWith(
        'appr-1' as ApprovalId,
        'approved',
        'op@fomo.app',
        'OK',
      );
    });

    it('is idempotent — approving an already-approved request returns 409', async () => {
      const { app, deps } = createApp();
      stubPrismaScoped(deps);

      deps.approvalGate.get.mockResolvedValueOnce({
        ...sampleApproval,
        status: 'approved',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/approvals/appr-1/approve',
        payload: { resolvedBy: 'op@fomo.app' },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json<{
        success: boolean;
        error: { code: string; details: { currentStatus: string } };
      }>();
      expect(body.error.code).toBe('APPROVAL_NOT_PENDING');
      expect(body.error.details.currentStatus).toBe('approved');
      // Second call must NOT have invoked resolve() — the pre-check short-circuits.
      expect(deps.approvalGate.resolve).not.toHaveBeenCalled();
    });

    it('returns 400 when resolvedBy is missing', async () => {
      const { app, deps } = createApp();
      stubPrismaScoped(deps);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/approvals/appr-1/approve',
        payload: { note: 'x' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /projects/:projectId/approvals/:approvalId/reject', () => {
    function stubPrismaScoped(deps: ReturnType<typeof createMockDeps>): void {
      (deps.prisma.approvalRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        projectId: 'proj-1',
      });
      (deps.prisma as unknown as { session: unknown }).session = {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-1',
          projectId: 'proj-1',
          contact: null,
          agent: null,
          project: { name: 'Proj' },
        }),
      };
    }

    it('rejects when pending with required reason', async () => {
      const { app, deps } = createApp();
      stubPrismaScoped(deps);

      deps.approvalGate.get.mockResolvedValueOnce(sampleApproval);
      deps.approvalGate.resolve.mockResolvedValueOnce({
        ...sampleApproval,
        status: 'denied',
        resolvedAt: new Date(),
        resolvedBy: 'op@fomo.app',
        resolutionNote: 'Lead ya no está interesado',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/approvals/appr-1/reject',
        payload: { resolvedBy: 'op@fomo.app', reason: 'Lead ya no está interesado' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { status: string; resolution: string | null } }>();
      expect(body.data.status).toBe('denied');
      expect(body.data.resolution).toBe('Lead ya no está interesado');

      expect(deps.approvalGate.resolve).toHaveBeenCalledWith(
        'appr-1' as ApprovalId,
        'denied',
        'op@fomo.app',
        'Lead ya no está interesado',
      );
    });

    it('returns 400 when reason is missing', async () => {
      const { app, deps } = createApp();
      stubPrismaScoped(deps);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/approvals/appr-1/reject',
        payload: { resolvedBy: 'op@fomo.app' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ success: boolean; error: { code: string } }>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('is idempotent — rejecting a denied request returns 409', async () => {
      const { app, deps } = createApp();
      stubPrismaScoped(deps);

      deps.approvalGate.get.mockResolvedValueOnce({ ...sampleApproval, status: 'denied' });

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/approvals/appr-1/reject',
        payload: { resolvedBy: 'op@fomo.app', reason: 'x' },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json<{ success: boolean; error: { code: string } }>();
      expect(body.error.code).toBe('APPROVAL_NOT_PENDING');
    });
  });
});
