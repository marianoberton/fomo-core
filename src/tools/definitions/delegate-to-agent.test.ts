import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDelegateToAgentTool } from './delegate-to-agent.js';
import type { AgentRegistry } from '@/agents/types.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockGetByName = vi.fn();
const mockAgentRegistry: { [K in keyof AgentRegistry]: ReturnType<typeof vi.fn> } = {
  get: vi.fn(),
  getByName: mockGetByName,
  list: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
};

const mockRunSubAgent = vi.fn();

const mockContext: ExecutionContext = {
  projectId: 'proj_test' as ProjectId,
  sessionId: 'sess_test' as SessionId,
  traceId: 'trace_test' as TraceId,
  agentConfig: {
    projectId: 'proj_test' as ProjectId,
    agentRole: 'manager',
    provider: { provider: 'openai', model: 'gpt-4o' },
    failover: { onRateLimit: true, onServerError: true, onTimeout: true, timeoutMs: 30000, maxRetries: 2 },
    allowedTools: ['delegate-to-agent'],
    memoryConfig: {
      longTerm: { enabled: false, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'openai', decayEnabled: false, decayHalfLifeDays: 30 },
      contextWindow: { reserveTokens: 2000, pruningStrategy: 'turn-based', maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } },
    },
    costConfig: {
      dailyBudgetUSD: 10, monthlyBudgetUSD: 100, maxTokensPerTurn: 4096,
      maxTurnsPerSession: 50, maxToolCallsPerTurn: 10, alertThresholdPercent: 80,
      hardLimitPercent: 100, maxRequestsPerMinute: 60, maxRequestsPerHour: 1000,
    },
    maxTurnsPerSession: 10,
    maxConcurrentSessions: 5,
  },
  permissions: { allowedTools: new Set(['delegate-to-agent']) },
  abortSignal: new AbortController().signal,
};

// ─── Tests ──────────────────────────────────────────────────────

describe('delegate-to-agent', () => {
  let tool: ReturnType<typeof createDelegateToAgentTool>;

  beforeEach(() => {
    mockGetByName.mockClear();
    mockRunSubAgent.mockClear();
    mockGetByName.mockResolvedValue(null);
    mockRunSubAgent.mockResolvedValue({ response: 'Subagent response here' });

    tool = createDelegateToAgentTool({
      agentRegistry: mockAgentRegistry as unknown as AgentRegistry,
      runSubAgent: mockRunSubAgent,
    });
  });

  // ─── 1. Schema ─────────────────────────────────────────────────

  describe('schema validation', () => {
    it('rejects empty agentName', () => {
      const result = tool.inputSchema.safeParse({ agentName: '', task: 'do something' });
      expect(result.success).toBe(false);
    });

    it('rejects empty task', () => {
      const result = tool.inputSchema.safeParse({ agentName: 'ventas', task: '' });
      expect(result.success).toBe(false);
    });

    it('rejects timeoutMs below 1000', () => {
      const result = tool.inputSchema.safeParse({ agentName: 'ventas', task: 'do it', timeoutMs: 500 });
      expect(result.success).toBe(false);
    });

    it('rejects timeoutMs above 120000', () => {
      const result = tool.inputSchema.safeParse({ agentName: 'ventas', task: 'do it', timeoutMs: 200_000 });
      expect(result.success).toBe(false);
    });

    it('accepts valid minimal input', () => {
      const result = tool.inputSchema.safeParse({ agentName: 'ventas', task: 'Check stock for product X' });
      expect(result.success).toBe(true);
    });

    it('accepts optional context and custom timeout', () => {
      const result = tool.inputSchema.safeParse({
        agentName: 'ventas',
        task: 'Score this lead',
        context: 'Lead is from Buenos Aires, interested in 10 units',
        timeoutMs: 30_000,
      });
      expect(result.success).toBe(true);
    });

    it('defaults timeoutMs to 60000 when not provided', () => {
      const result = tool.inputSchema.safeParse({ agentName: 'ventas', task: 'do it' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timeoutMs).toBe(60_000);
      }
    });
  });

  // ─── 2. Dry Run ─────────────────────────────────────────────────

  describe('dryRun', () => {
    it('returns error when agent not found in project', async () => {
      mockGetByName.mockResolvedValue(null);
      const result = await tool.dryRun({ agentName: 'nonexistent', task: 'do it' }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.error).toContain('"nonexistent" not found');
      }
    });

    it('returns success preview when agent exists', async () => {
      mockGetByName.mockResolvedValue({ name: 'ventas', id: 'agent_1' });
      const result = await tool.dryRun({ agentName: 'ventas', task: 'do it' }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { agentName: string; dryRun: boolean };
        expect(output.agentName).toBe('ventas');
        expect(output.dryRun).toBe(true);
      }

      // Must NOT call runSubAgent during dry run
      expect(mockRunSubAgent).not.toHaveBeenCalled();
    });

    it('uses context.projectId for agent lookup', async () => {
      mockGetByName.mockResolvedValue({ name: 'ventas', id: 'agent_1' });
      await tool.dryRun({ agentName: 'ventas', task: 'do it' }, mockContext);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockAgentRegistry.getByName).toHaveBeenCalledWith('proj_test', 'ventas');
    });
  });

  // ─── 3. Execute ─────────────────────────────────────────────────

  describe('execute', () => {
    it('calls runSubAgent with correct params', async () => {
      mockRunSubAgent.mockResolvedValue({ response: 'Stock confirmed: 42 units available' });

      await tool.execute(
        { agentName: 'ventas', task: 'Check stock for item #123', context: 'Customer needs 10 units' },
        mockContext,
      );

      expect(mockRunSubAgent).toHaveBeenCalledWith({
        projectId: 'proj_test',
        agentName: 'ventas',
        task: 'Check stock for item #123',
        context: 'Customer needs 10 units',
        timeoutMs: 60_000,
      });
    });

    it('returns subagent response on success', async () => {
      mockRunSubAgent.mockResolvedValue({ response: 'Lead score: 85/100' });

      const result = await tool.execute({ agentName: 'scoring', task: 'Score this lead' }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { agentName: string; response: string; success: boolean };
        expect(output.agentName).toBe('scoring');
        expect(output.response).toBe('Lead score: 85/100');
        expect(output.success).toBe(true);
      }
    });

    it('returns structured failure when runSubAgent throws', async () => {
      mockRunSubAgent.mockRejectedValue(new Error('Agent "ventas" not found in project'));

      const result = await tool.execute({ agentName: 'ventas', task: 'do it' }, mockContext);

      // Should NOT propagate the error — returns ok() with success: false
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.error).toContain('not found');
        const output = result.value.output as { success: boolean };
        expect(output.success).toBe(false);
      }
    });
  });

  // ─── 4. Integration (requires real DB + running agent) ───────────

  describe('integration', () => {
    it.skip('delegates a real task to a running subagent', async () => {
      // Requires: Docker (DB + Redis), seeded project with agents, API key set
    });
  });
});
