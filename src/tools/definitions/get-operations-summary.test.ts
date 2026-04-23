import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGetOperationsSummaryTool } from './get-operations-summary.js';
import { createTestContext } from '@/testing/fixtures/context.js';

// ─── Mocks ──────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    agent: {
      findMany: vi.fn(),
    },
    session: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    message: {
      count: vi.fn(),
    },
    approvalRequest: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    usageRecord: {
      aggregate: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof makeMockPrisma>;

function makeContext(projectId = 'proj-1') {
  return createTestContext({ projectId });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('get-operations-summary', () => {
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
  });

  // ─── Schema Tests ───────────────────────────────────────────

  describe('schema', () => {
    it('accepts empty input', () => {
      const tool = createGetOperationsSummaryTool({
        prisma: mockPrisma as never,
      });
      // inputSchema is ZodObject with no required fields
      expect(tool.id).toBe('get-operations-summary');
      expect(tool.category).toBe('orchestration');
      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
      expect(tool.sideEffects).toBe(false);
      expect(tool.supportsDryRun).toBe(true);
    });
  });

  // ─── Dry Run Tests ──────────────────────────────────────────

  describe('dryRun', () => {
    it('returns preview without calling prisma', async () => {
      const tool = createGetOperationsSummaryTool({
        prisma: mockPrisma as never,
      });

      const result = await tool.dryRun({}, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.success).toBe(true);
      const output = result.value.output as { dryRun: boolean; sections: string[] };
      expect(output.dryRun).toBe(true);
      expect(output.sections).toContain('agents');
      expect(output.sections).toContain('cost');

      // No prisma calls
      expect(mockPrisma.agent.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Execute Tests ──────────────────────────────────────────

  describe('execute', () => {
    it('returns correct summary for a populated project', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([
        { id: 'a1', name: 'Sales', status: 'active', type: 'conversational' },
        { id: 'a2', name: 'Support', status: 'paused', type: 'conversational' },
        { id: 'a3', name: 'Manager', status: 'active', type: 'backoffice' },
      ]);
      mockPrisma.session.groupBy.mockResolvedValue([
        { agentId: 'a1', _count: 5 },
        { agentId: 'a3', _count: 1 },
      ]);
      mockPrisma.session.count
        .mockResolvedValueOnce(6)  // active
        .mockResolvedValueOnce(20); // total
      mockPrisma.message.count
        .mockResolvedValueOnce(42)  // today
        .mockResolvedValueOnce(180); // week
      mockPrisma.approvalRequest.count.mockResolvedValue(3);
      mockPrisma.usageRecord.aggregate
        .mockResolvedValueOnce({ _sum: { costUsd: 2.5 } })   // today
        .mockResolvedValueOnce({ _sum: { costUsd: 12.75 } }); // week
      mockPrisma.approvalRequest.findMany.mockResolvedValue([
        { sessionId: 's1', toolId: 'escalate-to-human', status: 'pending', requestedAt: new Date('2026-02-27T10:00:00Z') },
      ]);

      const tool = createGetOperationsSummaryTool({ prisma: mockPrisma as never });
      const result = await tool.execute({}, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        agents: { total: number; active: number; paused: number; disabled: number; list: { name: string; activeSessions: number }[] };
        sessions: { active: number; total: number };
        messages: { today: number; thisWeek: number };
        approvals: { pending: number };
        cost: { todayUsd: number; thisWeekUsd: number };
        escalations: { recent: { sessionId: string }[]; totalPending: number };
      };

      expect(output.agents.total).toBe(3);
      expect(output.agents.active).toBe(2);
      expect(output.agents.paused).toBe(1);
      expect(output.agents.disabled).toBe(0);
      expect(output.agents.list).toHaveLength(3);
      expect(output.agents.list[0]).toEqual({
        name: 'Sales',
        status: 'active',
        type: 'conversational',
        activeSessions: 5,
      });

      expect(output.sessions.active).toBe(6);
      expect(output.sessions.total).toBe(20);
      expect(output.messages.today).toBe(42);
      expect(output.messages.thisWeek).toBe(180);
      expect(output.approvals.pending).toBe(3);
      expect(output.cost.todayUsd).toBe(2.5);
      expect(output.cost.thisWeekUsd).toBe(12.75);
      expect(output.escalations.recent).toHaveLength(1);
      expect(output.escalations.totalPending).toBe(1);
    });

    it('handles empty project gracefully', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([]);
      mockPrisma.session.groupBy.mockResolvedValue([]);
      mockPrisma.session.count.mockResolvedValue(0);
      mockPrisma.message.count.mockResolvedValue(0);
      mockPrisma.approvalRequest.count.mockResolvedValue(0);
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { costUsd: null } });
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);

      const tool = createGetOperationsSummaryTool({ prisma: mockPrisma as never });
      const result = await tool.execute({}, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        agents: { total: number; list: unknown[] };
        sessions: { active: number; total: number };
        cost: { todayUsd: number; thisWeekUsd: number };
      };

      expect(output.agents.total).toBe(0);
      expect(output.agents.list).toHaveLength(0);
      expect(output.sessions.active).toBe(0);
      expect(output.sessions.total).toBe(0);
      expect(output.cost.todayUsd).toBe(0);
      expect(output.cost.thisWeekUsd).toBe(0);
    });

    it('returns error on prisma failure', async () => {
      mockPrisma.agent.findMany.mockRejectedValue(new Error('DB connection lost'));

      const tool = createGetOperationsSummaryTool({ prisma: mockPrisma as never });
      const result = await tool.execute({}, makeContext());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('DB connection lost');
    });
  });
});
