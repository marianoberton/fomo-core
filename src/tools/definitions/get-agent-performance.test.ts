import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGetAgentPerformanceTool } from './get-agent-performance.js';
import type { ProjectId } from '@/core/types.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { AgentRegistry, AgentConfig, AgentId } from '@/agents/types.js';

// ─── Mocks ──────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    session: { findMany: vi.fn() },
    message: { groupBy: vi.fn() },
    executionTrace: { findMany: vi.fn() },
    usageRecord: { aggregate: vi.fn() },
    approvalRequest: { count: vi.fn() },
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

describe('get-agent-performance', () => {
  let mockPrisma: MockPrisma;
  let mockRegistry: ReturnType<typeof makeMockRegistry>;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    mockRegistry = makeMockRegistry();
  });

  // ─── Schema Tests ───────────────────────────────────────────

  describe('schema', () => {
    it('has correct metadata', () => {
      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });
      expect(tool.id).toBe('get-agent-performance');
      expect(tool.category).toBe('orchestration');
      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
    });

    it('rejects empty agentName', async () => {
      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });
      await expect(tool.execute({ agentName: '' }, makeContext())).rejects.toThrow();
    });
  });

  // ─── Dry Run Tests ──────────────────────────────────────────

  describe('dryRun', () => {
    it('returns preview without calling prisma', async () => {
      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.dryRun({ agentName: 'Sales' }, makeContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output as { dryRun: boolean; description: string; timeRange: string };
      expect(output.dryRun).toBe(true);
      expect(output.description).toContain('Sales');
      expect(output.timeRange).toBe('Last 7 days');

      expect(mockPrisma.session.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Execute Tests ──────────────────────────────────────────

  describe('execute', () => {
    it('returns correct metrics for agent with sessions', async () => {
      const agent = makeAgent();
      mockRegistry.getByName.mockResolvedValue(agent);

      mockPrisma.session.findMany.mockResolvedValue([
        { id: 's1', status: 'active' },
        { id: 's2', status: 'closed' },
        { id: 's3', status: 'closed' },
      ]);

      mockPrisma.message.groupBy.mockResolvedValue([
        { role: 'user', _count: 15 },
        { role: 'assistant', _count: 12 },
      ]);

      mockPrisma.executionTrace.findMany.mockResolvedValue([
        {
          events: [
            { type: 'tool_call', data: { toolId: 'calculator' } },
            { type: 'tool_result', data: { success: true } },
            { type: 'tool_call', data: { toolId: 'web-search' } },
            { type: 'tool_result', data: { success: false } },
            { type: 'tool_call', data: { toolId: 'calculator' } },
            { type: 'tool_result', data: { success: true } },
          ],
        },
      ]);

      mockPrisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { costUsd: 1.5 },
      });

      mockPrisma.approvalRequest.count.mockResolvedValue(1);

      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute(
        { agentName: 'Sales', timeRange: 'week' },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        agentName: string;
        sessions: { total: number; active: number; closed: number };
        messages: { total: number; fromUser: number; fromAssistant: number };
        toolCalls: { total: number; successful: number; failed: number; byTool: { toolName: string; count: number }[] };
        cost: { totalUsd: number; avgPerSessionUsd: number };
        escalations: number;
      };

      expect(output.agentName).toBe('Sales');
      expect(output.sessions.total).toBe(3);
      expect(output.sessions.active).toBe(1);
      expect(output.sessions.closed).toBe(2);
      expect(output.messages.total).toBe(27);
      expect(output.messages.fromUser).toBe(15);
      expect(output.messages.fromAssistant).toBe(12);
      expect(output.toolCalls.total).toBe(3);
      expect(output.toolCalls.successful).toBe(2);
      expect(output.toolCalls.failed).toBe(1);
      expect(output.toolCalls.byTool).toEqual([
        { toolName: 'calculator', count: 2 },
        { toolName: 'web-search', count: 1 },
      ]);
      expect(output.cost.totalUsd).toBe(1.5);
      expect(output.cost.avgPerSessionUsd).toBe(0.5);
      expect(output.escalations).toBe(1);
    });

    it('handles agent with no sessions gracefully', async () => {
      mockRegistry.getByName.mockResolvedValue(makeAgent());
      mockPrisma.session.findMany.mockResolvedValue([]);

      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute(
        { agentName: 'Sales', timeRange: 'today' },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        sessions: { total: number };
        messages: { total: number };
        toolCalls: { total: number };
        cost: { totalUsd: number; avgPerSessionUsd: number };
        escalations: number;
      };

      expect(output.sessions.total).toBe(0);
      expect(output.messages.total).toBe(0);
      expect(output.toolCalls.total).toBe(0);
      expect(output.cost.totalUsd).toBe(0);
      expect(output.cost.avgPerSessionUsd).toBe(0);
      expect(output.escalations).toBe(0);

      // Should not query messages/traces for empty session list
      expect(mockPrisma.message.groupBy).not.toHaveBeenCalled();
      expect(mockPrisma.executionTrace.findMany).not.toHaveBeenCalled();
    });

    it('returns error when agent not found', async () => {
      mockRegistry.getByName.mockResolvedValue(null);

      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute(
        { agentName: 'NonExistent', timeRange: 'week' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('NonExistent');
    });

    it('handles traces with non-array events gracefully', async () => {
      mockRegistry.getByName.mockResolvedValue(makeAgent());
      mockPrisma.session.findMany.mockResolvedValue([{ id: 's1', status: 'active' }]);
      mockPrisma.message.groupBy.mockResolvedValue([]);
      mockPrisma.executionTrace.findMany.mockResolvedValue([
        { events: 'not-an-array' },
        { events: null },
      ]);
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } });
      mockPrisma.approvalRequest.count.mockResolvedValue(0);

      const tool = createGetAgentPerformanceTool({
        prisma: mockPrisma as never,
        agentRegistry: mockRegistry as unknown as AgentRegistry,
      });

      const result = await tool.execute(
        { agentName: 'Sales', timeRange: 'week' },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output as { toolCalls: { total: number } };
      expect(output.toolCalls.total).toBe(0);
    });
  });
});
