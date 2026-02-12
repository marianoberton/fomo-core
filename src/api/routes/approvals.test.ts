import { describe, it, expect } from 'vitest';
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
});
