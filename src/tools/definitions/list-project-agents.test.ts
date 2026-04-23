import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createListProjectAgentsTool } from './list-project-agents.js';
import type { AgentRegistry, AgentConfig } from '@/agents/types.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockList = vi.fn();
const mockAgentRegistry: { [K in keyof AgentRegistry]: ReturnType<typeof vi.fn> } = {
  get: vi.fn(),
  getByName: vi.fn(),
  list: mockList,
  refresh: vi.fn(),
  invalidate: vi.fn(),
};

const mockContext: ExecutionContext = {
  projectId: 'proj_test' as ProjectId,
  sessionId: 'sess_test' as SessionId,
  traceId: 'trace_test' as TraceId,
  agentConfig: {
    projectId: 'proj_test' as ProjectId,
    agentRole: 'manager',
    provider: { provider: 'openai', model: 'gpt-4o' },
    failover: { onRateLimit: true, onServerError: true, onTimeout: true, timeoutMs: 30000, maxRetries: 2 },
    allowedTools: ['list-project-agents'],
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
  permissions: { allowedTools: new Set(['list-project-agents']) },
  abortSignal: new AbortController().signal,
};

const makeAgent = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'agent_1' as AgentConfig['id'],
  projectId: 'proj_test' as ProjectId,
  name: 'ventas',
  description: 'Sales agent',
  promptConfig: { identity: '', instructions: '', safety: '' },
  toolAllowlist: ['catalog-search', 'catalog-order', 'send-channel-message'],
  mcpServers: [],
  skillIds: [],
  channelConfig: { allowedChannels: ['whatsapp'] },
  modes: [],
  type: 'conversational',
  limits: { maxTurns: 10, maxTokensPerTurn: 4000, budgetPerDayUsd: 10 },
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────

describe('list-project-agents', () => {
  let tool: ReturnType<typeof createListProjectAgentsTool>;

  beforeEach(() => {
    mockList.mockClear();
    mockList.mockResolvedValue([]);

    tool = createListProjectAgentsTool({
      agentRegistry: mockAgentRegistry as unknown as AgentRegistry,
    });
  });

  // ─── 1. Schema ─────────────────────────────────────────────────

  describe('schema validation', () => {
    it('accepts empty object', () => {
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts extra keys (passthrough not set — ignored)', () => {
      // Zod strips unknown keys by default
      const result = tool.inputSchema.safeParse({ unexpected: 'key' });
      expect(result.success).toBe(true);
    });
  });

  // ─── 2. Dry Run / Execute ───────────────────────────────────────

  describe('execute', () => {
    it('returns empty list when project has no agents', async () => {
      mockList.mockResolvedValue([]);
      const result = await tool.execute({}, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { agents: unknown[] };
        expect(output.agents).toHaveLength(0);
      }
    });

    it('returns correct shape for each agent', async () => {
      mockList.mockResolvedValue([
        makeAgent({ name: 'ventas', type: 'conversational', status: 'active' }),
        makeAgent({ name: 'gerente', type: 'backoffice', status: 'active', toolAllowlist: ['delegate-to-agent', 'list-project-agents'] }),
      ]);

      const result = await tool.execute({}, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { agents: { name: string; type: string; status: string; toolCount: number }[] };
        expect(output.agents).toHaveLength(2);

        const ventas = output.agents.find((a) => a.name === 'ventas');
        expect(ventas).toBeDefined();
        expect(ventas?.type).toBe('conversational');
        expect(ventas?.toolCount).toBe(3);

        const gerente = output.agents.find((a) => a.name === 'gerente');
        expect(gerente?.type).toBe('backoffice');
        expect(gerente?.toolCount).toBe(2);
      }
    });

    it('queries agents using context.projectId', async () => {
      mockList.mockResolvedValue([]);
      await tool.execute({}, mockContext);

       
      expect(mockAgentRegistry.list).toHaveBeenCalledWith('proj_test');
    });

    it('dryRun returns same result as execute', async () => {
      const agents = [makeAgent()];
      mockList.mockResolvedValue(agents);

      const executeResult = await tool.execute({}, mockContext);
      const dryRunResult = await tool.dryRun({}, mockContext);

      expect(executeResult.ok).toBe(dryRunResult.ok);
      if (executeResult.ok && dryRunResult.ok) {
        expect(executeResult.value.output).toEqual(dryRunResult.value.output);
      }
    });
  });

  // ─── 3. Integration ────────────────────────────────────────────

  describe('integration', () => {
    it.skip('lists real agents from a seeded project', async () => {
      // Requires: Docker (DB), seeded project with agents
    });
  });
});
