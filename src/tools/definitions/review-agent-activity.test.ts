import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReviewAgentActivityTool } from './review-agent-activity.js';
import type { ProjectId } from '@/core/types.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { AgentRegistry, AgentConfig, AgentId } from '@/agents/types.js';

// ─── Mocks ──────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    session: { findMany: vi.fn() },
    executionTrace: { findMany: vi.fn() },
  };
}

type MockPrisma = ReturnType<typeof makeMockPrisma>;

function makeMockRegistry(): { [K in keyof AgentRegistry]: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(),
    getByName: vi.fn(),
    list: vi.fn(),
    refresh: vi.fn(),
    invalidate: vi.fn(),
  };
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1' as AgentId,
    projectId: 'proj-1' as ProjectId,
    name: 'Sales',
    description: 'Sales agent',
    promptConfig: { identity: '', instructions: '', safety: '' },
    toolAllowlist: [],
    mcpServers: [],
    channelConfig: { allowedChannels: [] },
    modes: [],
    type: 'conversational',
    skillIds: [],
    limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeContext(projectId = 'proj-1') {
  return createTestContext({ projectId });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('review-agent-activity', () => {
  let mockPrisma: MockPrisma;
  let mockRegistry: ReturnType<typeof makeMockRegistry>;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    mockRegistry = makeMockRegistry();
  });

  // ─── Schema Tests ───────────────────────────────────────────

  describe('schema', () => {
    it('has correct metadata', () => {
      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });
      expect(tool.id).toBe('review-agent-activity');
      expect(tool.category).toBe('orchestration');
      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
    });

    it('rejects empty agentName', async () => {
      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });
      await expect(tool.execute({ agentName: '' }, makeContext())).rejects.toThrow();
    });
  });

  // ─── Dry Run Tests ──────────────────────────────────────────

  describe('dryRun', () => {
    it('returns preview without DB calls', async () => {
      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.dryRun({ agentName: 'Sales' }, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output as { dryRun: boolean; limit: number };
      expect(output.dryRun).toBe(true);
      expect(output.limit).toBe(20);

      expect(mockPrisma.session.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Execute Tests ──────────────────────────────────────────

  describe('execute', () => {
    it('returns recent sessions and tool executions', async () => {
      mockRegistry.getByName.mockResolvedValue(makeAgent());

      mockPrisma.session.findMany.mockResolvedValue([
        {
          id: 's1',
          status: 'active',
          metadata: { channel: 'whatsapp' },
          contact: { name: 'Juan Pérez' },
          _count: { messages: 8 },
          createdAt: new Date('2026-02-27T08:00:00Z'),
          updatedAt: new Date('2026-02-27T09:30:00Z'),
        },
        {
          id: 's2',
          status: 'closed',
          metadata: null,
          contact: null,
          _count: { messages: 3 },
          createdAt: new Date('2026-02-26T14:00:00Z'),
          updatedAt: new Date('2026-02-26T14:15:00Z'),
        },
      ]);

      mockPrisma.executionTrace.findMany.mockResolvedValue([
        {
          id: 't1',
          sessionId: 's1',
          createdAt: new Date('2026-02-27T09:00:00Z'),
          events: [
            {
              type: 'tool_call',
              data: { toolCallId: 'tc1', toolId: 'calculator', input: { expression: '2+2' } },
              timestamp: '2026-02-27T09:00:01Z',
            },
            {
              type: 'tool_result',
              data: { toolCallId: 'tc1', success: true, output: { result: 4 }, durationMs: 5 },
              timestamp: '2026-02-27T09:00:02Z',
            },
            {
              type: 'error',
              data: { message: 'Rate limit hit' },
              timestamp: '2026-02-27T09:01:00Z',
            },
          ],
        },
      ]);

      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute({ agentName: 'Sales', limit: 10 }, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        agentName: string;
        recentSessions: {
          sessionId: string;
          contactName?: string;
          channel?: string;
          messageCount: number;
        }[];
        recentToolExecutions: {
          toolName: string;
          success: boolean;
          durationMs?: number;
          inputPreview?: string;
          outputPreview?: string;
        }[];
        errors: { message: string }[];
      };

      expect(output.agentName).toBe('Sales');

      // Sessions
      expect(output.recentSessions).toHaveLength(2);
      expect(output.recentSessions[0]?.contactName).toBe('Juan Pérez');
      expect(output.recentSessions[0]?.channel).toBe('whatsapp');
      expect(output.recentSessions[0]?.messageCount).toBe(8);
      expect(output.recentSessions[1]?.contactName).toBeUndefined();

      // Tool executions
      expect(output.recentToolExecutions).toHaveLength(1);
      expect(output.recentToolExecutions[0]?.toolName).toBe('calculator');
      expect(output.recentToolExecutions[0]?.success).toBe(true);
      expect(output.recentToolExecutions[0]?.durationMs).toBe(5);
      expect(output.recentToolExecutions[0]?.inputPreview).toContain('2+2');
      expect(output.recentToolExecutions[0]?.outputPreview).toContain('4');

      // Errors
      expect(output.errors).toHaveLength(1);
      expect(output.errors[0]?.message).toBe('Rate limit hit');
    });

    it('handles agent with no activity', async () => {
      mockRegistry.getByName.mockResolvedValue(makeAgent());
      mockPrisma.session.findMany.mockResolvedValue([]);

      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute({ agentName: 'Sales' }, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        recentSessions: unknown[];
        recentToolExecutions: unknown[];
        errors: unknown[];
      };

      expect(output.recentSessions).toHaveLength(0);
      expect(output.recentToolExecutions).toHaveLength(0);
      expect(output.errors).toHaveLength(0);

      // Should not query traces for empty sessions
      expect(mockPrisma.executionTrace.findMany).not.toHaveBeenCalled();
    });

    it('returns error when agent not found', async () => {
      mockRegistry.getByName.mockResolvedValue(null);

      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute({ agentName: 'Ghost' }, makeContext());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Ghost');
    });

    it('truncates long input/output previews', async () => {
      mockRegistry.getByName.mockResolvedValue(makeAgent());
      mockPrisma.session.findMany.mockResolvedValue([
        {
          id: 's1',
          status: 'active',
          metadata: null,
          contact: null,
          _count: { messages: 1 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const longInput = { data: 'x'.repeat(300) };
      mockPrisma.executionTrace.findMany.mockResolvedValue([
        {
          id: 't1',
          sessionId: 's1',
          createdAt: new Date(),
          events: [
            {
              type: 'tool_call',
              data: { toolCallId: 'tc1', toolId: 'http-request', input: longInput },
            },
            {
              type: 'tool_result',
              data: { toolCallId: 'tc1', success: true, output: { body: 'y'.repeat(300) } },
            },
          ],
        },
      ]);

      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute({ agentName: 'Sales' }, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        recentToolExecutions: { inputPreview?: string; outputPreview?: string }[];
      };

      // Truncated to 200 + "..."
      expect(output.recentToolExecutions[0]?.inputPreview?.length).toBeLessThanOrEqual(203);
      expect(output.recentToolExecutions[0]?.outputPreview?.length).toBeLessThanOrEqual(203);
    });

    it('handles traces with non-array events gracefully', async () => {
      mockRegistry.getByName.mockResolvedValue(makeAgent());
      mockPrisma.session.findMany.mockResolvedValue([
        {
          id: 's1',
          status: 'active',
          metadata: null,
          contact: null,
          _count: { messages: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.executionTrace.findMany.mockResolvedValue([
        { id: 't1', sessionId: 's1', createdAt: new Date(), events: null },
      ]);

      const tool = createReviewAgentActivityTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute({ agentName: 'Sales' }, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output as { recentToolExecutions: unknown[] };
      expect(output.recentToolExecutions).toHaveLength(0);
    });
  });
});
