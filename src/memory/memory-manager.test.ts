import { describe, it, expect, vi } from 'vitest';
import { createMemoryManager } from './memory-manager.js';
import type { MemoryConfig } from '@/core/types.js';
import type { Message } from '@/providers/types.js';

function makeConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  return {
    longTerm: {
      enabled: false,
      maxEntries: 100,
      retrievalTopK: 5,
      embeddingProvider: 'test',
      decayEnabled: false,
      decayHalfLifeDays: 30,
    },
    contextWindow: {
      reserveTokens: 500,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 10,
      compaction: {
        enabled: false,
        memoryFlushBeforeCompaction: false,
      },
    },
    ...overrides,
  };
}

function msg(role: Message['role'], text: string): Message {
  return { role, content: text };
}

describe('MemoryManager', () => {
  describe('fitToContextWindow', () => {
    it('returns all messages when they fit within budget', async () => {
      const tokenCounter = vi.fn().mockResolvedValue(100);
      const mm = createMemoryManager({
        memoryConfig: makeConfig(),
        contextWindowSize: 4096,
        tokenCounter,
      });

      const messages = [msg('user', 'Hello'), msg('assistant', 'Hi there')];
      const result = await mm.fitToContextWindow(messages);

      expect(result).toEqual(messages);
    });

    it('prunes with turn-based strategy when exceeding budget', async () => {
      const tokenCounter = vi.fn().mockResolvedValue(5000);
      const mm = createMemoryManager({
        memoryConfig: makeConfig({
          contextWindow: {
            reserveTokens: 500,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 4,
            compaction: { enabled: false, memoryFlushBeforeCompaction: false },
          },
        }),
        contextWindowSize: 4096,
        tokenCounter,
      });

      const messages = [
        msg('system', 'System prompt'),
        msg('user', 'Q1'),
        msg('assistant', 'A1'),
        msg('user', 'Q2'),
        msg('assistant', 'A2'),
        msg('user', 'Q3'),
        msg('assistant', 'A3'),
        msg('user', 'Q4'),
        msg('assistant', 'A4'),
      ];

      const result = await mm.fitToContextWindow(messages);

      // maxTurnsInContext=4, so keep 2 head + 2 tail
      expect(result.length).toBe(4);
      expect(result[0]).toEqual(messages[0]); // head preserved
      expect(result[result.length - 1]).toEqual(messages[messages.length - 1]); // tail preserved
    });

    it('prunes with token-based strategy when configured', async () => {
      // First call returns over-budget, then individual messages fit
      const tokenCounter = vi.fn()
        .mockResolvedValueOnce(5000) // total check
        .mockResolvedValueOnce(100); // first message tokens
      const mm = createMemoryManager({
        memoryConfig: makeConfig({
          contextWindow: {
            reserveTokens: 500,
            pruningStrategy: 'token-based',
            maxTurnsInContext: 20,
            compaction: { enabled: false, memoryFlushBeforeCompaction: false },
          },
        }),
        contextWindowSize: 4096,
        tokenCounter,
      });

      const messages = [
        msg('system', 'System'),
        msg('user', 'Q1'),
        msg('assistant', 'A1'),
        msg('user', 'Q2'),
        msg('assistant', 'A2'),
      ];

      const result = await mm.fitToContextWindow(messages);

      // First message always kept
      expect(result[0]).toEqual(messages[0]);
      // At least some messages should be kept
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('compact', () => {
    it('compacts messages using the summarizer', async () => {
      const tokenCounter = vi.fn()
        .mockResolvedValueOnce(5000) // original
        .mockResolvedValueOnce(500); // compacted
      const summarizer = vi.fn().mockResolvedValue('Summary of conversation.');

      const mm = createMemoryManager({
        memoryConfig: makeConfig({
          contextWindow: {
            reserveTokens: 500,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 20,
            compaction: { enabled: true, memoryFlushBeforeCompaction: false },
          },
        }),
        contextWindowSize: 4096,
        tokenCounter,
        compactionSummarizer: summarizer,
      });

      const messages = [
        msg('user', 'Q1'),
        msg('assistant', 'A1'),
        msg('user', 'Q2'),
        msg('assistant', 'A2'),
        msg('user', 'Q3'),
        msg('assistant', 'A3'),
      ];

      const { messages: compacted, entry } = await mm.compact(messages, 'session-1');

      expect(summarizer).toHaveBeenCalledWith(messages);
      expect(compacted[0]?.content).toContain('Summary of conversation.');
      // Last 4 messages preserved
      expect(compacted.length).toBe(5); // 1 summary + 4 tail
      expect(entry.messagesCompacted).toBe(6);
      expect(entry.tokensRecovered).toBe(4500);
      expect(entry.sessionId).toBe('session-1');
    });

    it('throws when compaction is not enabled', async () => {
      const mm = createMemoryManager({
        memoryConfig: makeConfig(),
        contextWindowSize: 4096,
        tokenCounter: vi.fn(),
        compactionSummarizer: vi.fn(),
      });

      await expect(mm.compact([], 'session-1')).rejects.toThrow(
        'Compaction is not enabled',
      );
    });

    it('throws when no summarizer is provided', async () => {
      const mm = createMemoryManager({
        memoryConfig: makeConfig({
          contextWindow: {
            reserveTokens: 500,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 20,
            compaction: { enabled: true, memoryFlushBeforeCompaction: false },
          },
        }),
        contextWindowSize: 4096,
        tokenCounter: vi.fn(),
      });

      await expect(mm.compact([], 'session-1')).rejects.toThrow(
        'compactionSummarizer',
      );
    });
  });

  describe('long-term memory', () => {
    it('returns empty when store is not configured', async () => {
      const mm = createMemoryManager({
        memoryConfig: makeConfig(),
        contextWindowSize: 4096,
        tokenCounter: vi.fn(),
      });

      const results = await mm.retrieveMemories({
        query: 'test',
        topK: 5,
      });

      expect(results).toEqual([]);
    });

    it('returns empty when long-term is disabled', async () => {
      const store = { store: vi.fn(), retrieve: vi.fn(), delete: vi.fn() };
      const mm = createMemoryManager({
        memoryConfig: makeConfig({ longTerm: { enabled: false, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'test', decayEnabled: false, decayHalfLifeDays: 30 } }),
        contextWindowSize: 4096,
        tokenCounter: vi.fn(),
        longTermStore: store,
      });

      const results = await mm.retrieveMemories({ query: 'test', topK: 5 });
      expect(results).toEqual([]);
      expect(store.retrieve).not.toHaveBeenCalled();
    });

    it('delegates to long-term store when configured and enabled', async () => {
      const mockResults = [
        {
          id: 'mem-1',
          projectId: 'p1',
          category: 'fact' as const,
          content: 'The sky is blue',
          embedding: [],
          importance: 0.8,
          accessCount: 1,
          lastAccessedAt: new Date(),
          createdAt: new Date(),
          similarityScore: 0.95,
        },
      ];
      const store = {
        store: vi.fn(),
        retrieve: vi.fn().mockResolvedValue(mockResults),
        delete: vi.fn(),
      };

      const mm = createMemoryManager({
        memoryConfig: makeConfig({ longTerm: { enabled: true, maxEntries: 100, retrievalTopK: 5, embeddingProvider: 'test', decayEnabled: false, decayHalfLifeDays: 30 } }),
        contextWindowSize: 4096,
        tokenCounter: vi.fn(),
        longTermStore: store,
      });

      const results = await mm.retrieveMemories({ query: 'sky', topK: 3 });
      expect(results).toEqual(mockResults);
      expect(store.retrieve).toHaveBeenCalledWith({ query: 'sky', topK: 3 });
    });

    it('storeMemory returns null when store is not configured', async () => {
      const mm = createMemoryManager({
        memoryConfig: makeConfig(),
        contextWindowSize: 4096,
        tokenCounter: vi.fn(),
      });

      const result = await mm.storeMemory({
        projectId: 'p1' as never,
        category: 'fact',
        content: 'test',
        embedding: [],
        importance: 0.5,
      });

      expect(result).toBeNull();
    });
  });
});
