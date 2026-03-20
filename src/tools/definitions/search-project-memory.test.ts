import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSearchProjectMemoryTool } from './search-project-memory.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { ExecutionContext } from '@/core/types.js';
import type { AgentId } from '@/agents/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';
import type { RetrievedMemory } from '@/memory/types.js';
import { ok } from '@/core/result.js';

// ─── Types ──────────────────────────────────────────────────────

interface SearchOutput {
  results: {
    id: string;
    content: string;
    category: string;
    importance: number;
    scope: string;
    agentId: string | null;
    similarityScore: number;
    createdAt: string;
  }[];
  totalResults: number;
  dryRun?: boolean;
  previewQuery?: string;
}

// ─── Mocks ──────────────────────────────────────────────────────

const mockStore = vi.fn();
const mockRetrieve = vi.fn();
const mockDelete = vi.fn();
const mockFindSimilarExact = vi.fn();
const mockUpdateContent = vi.fn();

const mockMemoryStore: { [K in keyof LongTermMemoryStore]: ReturnType<typeof vi.fn> } = {
  store: mockStore,
  retrieve: mockRetrieve,
  delete: mockDelete,
  findSimilarExact: mockFindSimilarExact,
  updateContent: mockUpdateContent,
};

const mockContext: ExecutionContext = {
  projectId: 'proj_test' as ProjectId,
  sessionId: 'sess_test' as SessionId,
  traceId: 'trace_test' as TraceId,
  agentConfig: {
    projectId: 'proj_test' as ProjectId,
    agentRole: 'agent',
    provider: { provider: 'openai', model: 'gpt-4o-mini' },
    failover: { onRateLimit: true, onServerError: true, onTimeout: true, timeoutMs: 30000, maxRetries: 2 },
    allowedTools: ['search-project-memory'],
    memoryConfig: { longTerm: { enabled: false, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'openai', decayEnabled: false, decayHalfLifeDays: 30 }, contextWindow: { reserveTokens: 2000, pruningStrategy: 'turn-based', maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } } },
    costConfig: { dailyBudgetUSD: 10, monthlyBudgetUSD: 100, maxTokensPerTurn: 4096, maxTurnsPerSession: 50, maxToolCallsPerTurn: 10, alertThresholdPercent: 80, hardLimitPercent: 100, maxRequestsPerMinute: 60, maxRequestsPerHour: 1000 },
    maxTurnsPerSession: 50,
    maxConcurrentSessions: 5,
  },
  permissions: { allowedTools: new Set(['search-project-memory']) },
  abortSignal: new AbortController().signal,
};

const sampleMemory: RetrievedMemory = {
  id: 'mem_001',
  projectId: 'proj_test' as ProjectId,
  agentId: 'agent_sales' as AgentId,
  scope: 'agent',
  category: 'fact',
  content: 'Client prefers installment payments',
  embedding: [],
  importance: 0.8,
  accessCount: 3,
  lastAccessedAt: new Date('2026-03-01T09:00:00Z'),
  createdAt: new Date('2026-02-28T14:30:00Z'),
  similarityScore: 0.95,
};

const sharedMemory: RetrievedMemory = {
  id: 'mem_002',
  projectId: 'proj_test' as ProjectId,
  scope: 'project',
  category: 'decision',
  content: 'Company policy: 10% discount for orders above $1000',
  embedding: [],
  importance: 0.9,
  accessCount: 12,
  lastAccessedAt: new Date('2026-03-01T10:00:00Z'),
  createdAt: new Date('2026-02-25T08:00:00Z'),
  similarityScore: 0.88,
};

// ─── Tests ──────────────────────────────────────────────────────

describe('search-project-memory', () => {
  let tool: ReturnType<typeof createSearchProjectMemoryTool>;

  beforeEach(() => {
    mockStore.mockClear();
    mockRetrieve.mockClear();
    mockDelete.mockClear();
    mockFindSimilarExact.mockClear();
    mockUpdateContent.mockClear();
    mockRetrieve.mockResolvedValue([sampleMemory, sharedMemory]);

    tool = createSearchProjectMemoryTool({
      store: mockMemoryStore as unknown as LongTermMemoryStore,
    });
  });

  // ─── Schema Validation ───────────────────────────────────────

  describe('schema validation', () => {
    it('rejects empty query', () => {
      const result = tool.inputSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('rejects query over 500 chars', () => {
      const result = tool.inputSchema.safeParse({ query: 'x'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('accepts valid query with defaults', () => {
      const result = tool.inputSchema.safeParse({ query: 'client preferences' });
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as { query: string; topK: number };
        expect(data.topK).toBe(10);
      }
    });

    it('rejects topK below 1 or above 50', () => {
      expect(tool.inputSchema.safeParse({ query: 'test', topK: 0 }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ query: 'test', topK: 51 }).success).toBe(false);
    });

    it('accepts valid topK', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', topK: 25 });
      expect(result.success).toBe(true);
    });

    it('rejects invalid categories', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', categories: ['invalid'] });
      expect(result.success).toBe(false);
    });

    it('accepts valid categories', () => {
      const result = tool.inputSchema.safeParse({
        query: 'test',
        categories: ['fact', 'preference'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects minImportance outside 0-1', () => {
      expect(tool.inputSchema.safeParse({ query: 'test', minImportance: -0.1 }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ query: 'test', minImportance: 1.1 }).success).toBe(false);
    });

    it('requires query field', () => {
      expect(tool.inputSchema.safeParse({}).success).toBe(false);
    });
  });

  // ─── Tool Metadata ──────────────────────────────────────────

  describe('metadata', () => {
    it('has correct id and category', () => {
      expect(tool.id).toBe('search-project-memory');
      expect(tool.category).toBe('memory');
    });

    it('is low risk and does not require approval', () => {
      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
    });

    it('has no side effects', () => {
      expect(tool.sideEffects).toBe(false);
    });

    it('supports dry run', () => {
      expect(tool.supportsDryRun).toBe(true);
    });
  });

  // ─── Dry Run ─────────────────────────────────────────────────

  describe('dryRun', () => {
    it('returns empty results without calling store', async () => {
      const result = await tool.dryRun(
        { query: 'client preferences' },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as SearchOutput;
        expect(output.results).toEqual([]);
        expect(output.totalResults).toBe(0);
        expect(output.dryRun).toBe(true);
        expect(output.previewQuery).toBe('client preferences');
      }
      expect(mockRetrieve).not.toHaveBeenCalled();
    });

    it('truncates preview query at 100 chars', async () => {
      const longQuery = 'a'.repeat(200);
      const result = await tool.dryRun(
        { query: longQuery },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.value.output as SearchOutput).previewQuery).toHaveLength(100);
      }
    });
  });

  // ─── Execute ─────────────────────────────────────────────────

  describe('execute', () => {
    it('returns memories from project-wide search', async () => {
      const result = await tool.execute(
        { query: 'client payment preferences' },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as SearchOutput;
        expect(output.totalResults).toBe(2);
        expect(output.results).toHaveLength(2);
        expect(output.results[0]?.content).toBe('Client prefers installment payments');
        expect(output.results[0]?.scope).toBe('agent');
        expect(output.results[0]?.agentId).toBe('agent_sales');
        expect(output.results[1]?.scope).toBe('project');
        expect(output.results[1]?.agentId).toBeNull();
      }
    });

    it('calls store.retrieve with scope "project"', async () => {
      await tool.execute(
        { query: 'test query' },
        mockContext,
      );

      expect(mockRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test query',
          scope: 'project',
          topK: 10,
        }),
      );
    });

    it('passes optional filters to retrieve', async () => {
      await tool.execute(
        {
          query: 'test',
          topK: 5,
          categories: ['fact', 'decision'],
          minImportance: 0.7,
        },
        mockContext,
      );

      expect(mockRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          topK: 5,
          categories: ['fact', 'decision'],
          minImportance: 0.7,
        }),
      );
    });

    it('rounds similarity scores to 3 decimal places', async () => {
      mockRetrieve.mockResolvedValue([
        { ...sampleMemory, similarityScore: 0.95123456 },
      ]);

      const result = await tool.execute(
        { query: 'test' },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as SearchOutput;
        expect(output.results[0]?.similarityScore).toBe(0.951);
      }
    });

    it('returns empty results when no memories match', async () => {
      mockRetrieve.mockResolvedValue([]);

      const result = await tool.execute(
        { query: 'something obscure' },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as SearchOutput;
        expect(output.totalResults).toBe(0);
        expect(output.results).toEqual([]);
      }
    });

    it('returns error when store throws', async () => {
      mockRetrieve.mockRejectedValue(new Error('DB connection failed'));

      const result = await tool.execute(
        { query: 'test' },
        mockContext,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('DB connection failed');
      }
    });
  });
});
