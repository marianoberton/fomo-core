import { describe, it, expect, vi } from 'vitest';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import { createApprovalGate } from './approval-gate.js';

const PROJECT_ID = 'proj-1' as ProjectId;
const SESSION_ID = 'sess-1' as SessionId;

function makeParams(toolId = 'dangerous-action'): {
  projectId: ProjectId;
  sessionId: SessionId;
  toolCallId: ToolCallId;
  toolId: string;
  toolInput: Record<string, unknown>;
  riskLevel: 'high' | 'critical';
} {
  return {
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    toolCallId: 'tc-1' as ToolCallId,
    toolId,
    toolInput: { target: 'production-db' },
    riskLevel: 'high',
  };
}

describe('ApprovalGate', () => {
  describe('requestApproval', () => {
    it('creates a pending approval request', async () => {
      const gate = createApprovalGate();
      const request = await gate.requestApproval(makeParams());

      expect(request.status).toBe('pending');
      expect(request.toolId).toBe('dangerous-action');
      expect(request.riskLevel).toBe('high');
      expect(request.projectId).toBe(PROJECT_ID);
    });

    it('calls notifier when provided', async () => {
      const notifier = vi.fn().mockResolvedValue(undefined);
      const gate = createApprovalGate({ notifier });

      const request = await gate.requestApproval(makeParams());

      expect(notifier).toHaveBeenCalledWith(request);
    });
  });

  describe('resolve', () => {
    it('approves a pending request', async () => {
      const gate = createApprovalGate();
      const request = await gate.requestApproval(makeParams());

      const resolved = await gate.resolve(request.id, 'approved', 'admin', 'Looks safe');

      expect(resolved).not.toBeNull();
      expect(resolved?.status).toBe('approved');
      expect(resolved?.resolvedBy).toBe('admin');
      expect(resolved?.resolutionNote).toBe('Looks safe');
      expect(resolved?.resolvedAt).toBeInstanceOf(Date);
    });

    it('denies a pending request', async () => {
      const gate = createApprovalGate();
      const request = await gate.requestApproval(makeParams());

      const resolved = await gate.resolve(request.id, 'denied', 'admin');

      expect(resolved?.status).toBe('denied');
    });

    it('returns null for non-existent approval', async () => {
      const gate = createApprovalGate();
      const result = await gate.resolve('nope' as ApprovalId, 'approved', 'admin');
      expect(result).toBeNull();
    });
  });

  describe('isApproved', () => {
    it('returns true for approved requests', async () => {
      const gate = createApprovalGate();
      const request = await gate.requestApproval(makeParams());
      await gate.resolve(request.id, 'approved', 'admin');

      expect(await gate.isApproved(request.id)).toBe(true);
    });

    it('returns false for pending requests', async () => {
      const gate = createApprovalGate();
      const request = await gate.requestApproval(makeParams());

      expect(await gate.isApproved(request.id)).toBe(false);
    });

    it('returns false for denied requests', async () => {
      const gate = createApprovalGate();
      const request = await gate.requestApproval(makeParams());
      await gate.resolve(request.id, 'denied', 'admin');

      expect(await gate.isApproved(request.id)).toBe(false);
    });

    it('returns false for expired requests', async () => {
      const gate = createApprovalGate({ expirationMs: 1 }); // 1ms expiration
      const request = await gate.requestApproval(makeParams());

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 10));

      expect(await gate.isApproved(request.id)).toBe(false);
      const fetched = await gate.get(request.id);
      expect(fetched?.status).toBe('expired');
    });
  });

  describe('listPending', () => {
    it('returns only pending requests for the given project', async () => {
      const gate = createApprovalGate();
      const r1 = await gate.requestApproval(makeParams('tool-a'));
      await gate.requestApproval(makeParams('tool-b'));
      await gate.resolve(r1.id, 'approved', 'admin');

      const pending = await gate.listPending(PROJECT_ID);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.toolId).toBe('tool-b');
    });

    it('returns empty for different project', async () => {
      const gate = createApprovalGate();
      await gate.requestApproval(makeParams());

      const pending = await gate.listPending('other-project' as ProjectId);
      expect(pending).toHaveLength(0);
    });
  });
});
