import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStoreMemoryTool } from './store-memory.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';
import type { MemoryEntry } from '@/memory/types.js';

// ─── Types ──────────────────────────────────────────────────────

interface StoreMemoryOutput {
  stored: boolean;
  memoryId?: string;
  category: string;
  importance: number;
  sessionScoped: boolean;
  dryRun?: boolean;
  previewContent?: string;
}

// ─── Mocks ──────────────────────────────────────────────────────

const mockStore = vi.fn();
const mockRetrieve = vi.fn();
const mockFindSimilarExact = vi.fn();
const mockUpdateContent = vi.fn();
const mockDelete = vi.fn();

const mockMemoryStore: { [K in keyof LongTermMemoryStore]: ReturnType<typeof vi.fn> } = {
  store: mockStore,
  retrieve: mockRetrieve,
  findSimilarExact: mockFindSimilarExact,
  updateContent: mockUpdateContent,
  delete: mockDelete,
};

const mockContext: ExecutionContext = {
  projectId: 'proj_test' as ProjectId,
  agentId: 'agent_test',
  sessionId: 'sess_test' as SessionId,
  traceId: 'trace_test' as TraceId,
  agentConfig: {
    projectId: 'proj_test' as ProjectId,
    agentRole: 'agent',
    provider: { provider: 'openai', model: 'gpt-4o-mini' },
    failover: { onRateLimit: true, onServerError: true, onTimeout: true, timeoutMs: 30000, maxRetries: 2 },
    allowedTools: ['store-memory'],
    memoryConfig: {
      longTerm: { enabled: true, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'openai', decayEnabled: false, decayHalfLifeDays: 30 },
      contextWindow: { reserveTokens: 2000, pruningStrategy: 'turn-based', maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } },
    },
    costConfig: {
      dailyBudgetUSD: 10, monthlyBudgetUSD: 100, maxTokensPerTurn: 4096,
      maxTurnsPerSession: 50, maxToolCallsPerTurn: 10, alertThresholdPercent: 80,
      hardLimitPercent: 100, maxRequestsPerMinute: 60, maxRequestsPerHour: 1000,
    },
    maxTurnsPerSession: 50,
    maxConcurrentSessions: 5,
  },
  permissions: { allowedTools: new Set(['store-memory']) },
  abortSignal: new AbortController().signal,
};

const storedEntry: MemoryEntry = {
  id: 'mem_123',
  projectId: 'proj_test' as ProjectId,
  scope: 'agent',
  category: 'preference',
  content: 'Client prefers installment payments',
  embedding: [0.1, 0.2, 0.3],
  importance: 0.8,
  accessCount: 0,
  lastAccessedAt: new Date(),
  createdAt: new Date(),
};

// ─── Tests ──────────────────────────────────────────────────────

describe('store-memory', () => {
  let tool: ReturnType<typeof createStoreMemoryTool>;

  beforeEach(() => {
    mockStore.mockClear();
    mockRetrieve.mockClear();
    mockDelete.mockClear();
    mockStore.mockResolvedValue(storedEntry);

    tool = createStoreMemoryTool({
      store: mockMemoryStore as unknown as LongTermMemoryStore,
    });
  });

  // ─── Schema Validation ───────────────────────────────────────

  describe('schema validation', () => {
    it('rejects empty content', () => {
      const result = tool.inputSchema.safeParse({ content: '', category: 'fact' });
      expect(result.success).toBe(false);
    });

    it('rejects content over 2000 chars', () => {
      const result = tool.inputSchema.safeParse({ content: 'x'.repeat(2001), category: 'fact' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid category', () => {
      const result = tool.inputSchema.safeParse({ content: 'some fact', category: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('accepts valid categories', () => {
      for (const cat of ['fact', 'decision', 'preference', 'task_context', 'learning']) {
        const result = tool.inputSchema.safeParse({ content: 'test', category: cat });
        expect(result.success).toBe(true);
      }
    });

    it('rejects importance outside 0-1', () => {
      expect(tool.inputSchema.safeParse({ content: 'test', category: 'fact', importance: -0.1 }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ content: 'test', category: 'fact', importance: 1.1 }).success).toBe(false);
    });

    it('defaults importance to 0.7', () => {
      const result = tool.inputSchema.safeParse({ content: 'test', category: 'fact' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.importance).toBe(0.7);
      }
    });

    it('defaults sessionScoped to false', () => {
      const result = tool.inputSchema.safeParse({ content: 'test', category: 'fact' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sessionScoped).toBe(false);
      }
    });

    it('requires content and category', () => {
      expect(tool.inputSchema.safeParse({}).success).toBe(false);
      expect(tool.inputSchema.safeParse({ content: 'test' }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ category: 'fact' }).success).toBe(false);
    });
  });

  // ─── Tool Metadata ──────────────────────────────────────────

  describe('metadata', () => {
    it('has correct id and category', () => {
      expect(tool.id).toBe('store-memory');
      expect(tool.category).toBe('memory');
    });

    it('is low risk and does not require approval', () => {
      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
    });

    it('supports dry run', () => {
      expect(tool.supportsDryRun).toBe(true);
    });
  });

  // ─── Dry Run ─────────────────────────────────────────────────

  describe('dryRun', () => {
    it('returns preview without calling store', async () => {
      const result = await tool.dryRun(
        { content: 'Client prefers installment payments', category: 'preference', importance: 0.8, sessionScoped: false },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.value.output as StoreMemoryOutput).stored).toBe(false);
        expect((result.value.output as StoreMemoryOutput).dryRun).toBe(true);
        expect((result.value.output as StoreMemoryOutput).category).toBe('preference');
        expect((result.value.output as StoreMemoryOutput).importance).toBe(0.8);
      }
      expect(mockStore).not.toHaveBeenCalled();
    });

    it('truncates preview content at 100 chars', async () => {
      const longContent = 'a'.repeat(200);
      const result = await tool.dryRun(
        { content: longContent, category: 'fact', importance: 0.5, sessionScoped: false },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.value.output as StoreMemoryOutput).previewContent).toHaveLength(100);
      }
    });
  });

  // ─── Execute ─────────────────────────────────────────────────

  describe('execute', () => {
    it('stores memory and returns success', async () => {
      const result = await tool.execute(
        { content: 'Client prefers installment payments', category: 'preference', importance: 0.8, sessionScoped: false },
        mockContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.value.output as StoreMemoryOutput).stored).toBe(true);
        expect((result.value.output as StoreMemoryOutput).memoryId).toBe('mem_123');
        expect((result.value.output as StoreMemoryOutput).category).toBe('preference');
        expect((result.value.output as StoreMemoryOutput).importance).toBe(0.8);
        expect((result.value.output as StoreMemoryOutput).sessionScoped).toBe(false);
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('passes projectId and empty embedding to store', async () => {
      await tool.execute(
        { content: 'A fact', category: 'fact', importance: 0.5, sessionScoped: false },
        mockContext,
      );

      expect(mockStore).toHaveBeenCalledWith({
        projectId: 'proj_test',
        agentId: 'agent_test',
        sessionId: undefined,
        scope: 'agent',
        category: 'fact',
        content: 'A fact',
        embedding: [],
        importance: 0.5,
      });
    });

    it('passes sessionId when sessionScoped is true', async () => {
      await tool.execute(
        { content: 'Session fact', category: 'task_context', importance: 0.6, sessionScoped: true },
        mockContext,
      );

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess_test' }),
      );
    });

    it('passes undefined sessionId when sessionScoped is false', async () => {
      await tool.execute(
        { content: 'Global fact', category: 'fact', importance: 0.7, sessionScoped: false },
        mockContext,
      );

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: undefined }),
      );
    });

    it('returns error when store throws', async () => {
      mockStore.mockRejectedValue(new Error('DB connection failed'));

      const result = await tool.execute(
        { content: 'test', category: 'fact', importance: 0.7, sessionScoped: false },
        mockContext,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('DB connection failed');
      }
    });
  });
});
