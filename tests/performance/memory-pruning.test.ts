/**
 * Performance tests for memory pruning strategies.
 * Measures throughput and latency for context window management.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Message } from '@/providers/types.js';
import { createMemoryManager } from '@/memory/memory-manager.js';
import type { MemoryConfig } from '@/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function createTestMessage(content: string): Message {
  return { role: 'user', content };
}

function createLargeConversation(messageCount: number): Message[] {
  return Array.from({ length: messageCount }, (_, i) =>
    createTestMessage(`Message ${i}: ${'x'.repeat(100)}`),
  );
}

const mockTokenCounter = async (messages: Message[]): Promise<number> => {
  // Simulate 4 chars per token
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return sum + Math.ceil(content.length / 4);
  }, 0);
};

const baseMemoryConfig: MemoryConfig = {
  longTerm: {
    enabled: false,
    maxEntries: 100,
    retrievalTopK: 5,
    embeddingProvider: 'openai',
    decayEnabled: false,
    decayHalfLifeDays: 7,
  },
  contextWindow: {
    reserveTokens: 1000,
    pruningStrategy: 'turn-based',
    maxTurnsInContext: 20,
    compaction: {
      enabled: false,
      memoryFlushBeforeCompaction: false,
    },
  },
};

// ─── Performance Benchmarks ─────────────────────────────────────

describe('Memory Pruning Performance', () => {
  describe('Turn-based Pruning', () => {
    it('prunes 1000 messages in <50ms', async () => {
      const memoryManager = createMemoryManager({
        memoryConfig: {
          ...baseMemoryConfig,
          contextWindow: {
            ...baseMemoryConfig.contextWindow,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 20,
          },
        },
        contextWindowSize: 10_000,
        tokenCounter: mockTokenCounter,
      });

      const messages = createLargeConversation(1000);

      const start = performance.now();
      const pruned = await memoryManager.fitToContextWindow(messages);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
      expect(pruned.length).toBeLessThanOrEqual(20);
    });

    it('handles 10k messages in <200ms', async () => {
      const memoryManager = createMemoryManager({
        memoryConfig: {
          ...baseMemoryConfig,
          contextWindow: {
            ...baseMemoryConfig.contextWindow,
            pruningStrategy: 'turn-based',
            maxTurnsInContext: 50,
          },
        },
        contextWindowSize: 50_000,
        tokenCounter: mockTokenCounter,
      });

      const messages = createLargeConversation(10_000);

      const start = performance.now();
      const pruned = await memoryManager.fitToContextWindow(messages);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(200);
      expect(pruned.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Token-based Pruning', () => {
    it('prunes 1000 messages in <100ms', async () => {
      const memoryManager = createMemoryManager({
        memoryConfig: {
          ...baseMemoryConfig,
          contextWindow: {
            ...baseMemoryConfig.contextWindow,
            pruningStrategy: 'token-based',
            maxTurnsInContext: 20,
          },
        },
        contextWindowSize: 5000,
        tokenCounter: mockTokenCounter,
      });

      const messages = createLargeConversation(1000);

      const start = performance.now();
      const pruned = await memoryManager.fitToContextWindow(messages);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(pruned.length).toBeGreaterThan(0);
    });

    it('respects token budget within 5% tolerance', async () => {
      const memoryManager = createMemoryManager({
        memoryConfig: {
          ...baseMemoryConfig,
          contextWindow: {
            ...baseMemoryConfig.contextWindow,
            pruningStrategy: 'token-based',
            maxTurnsInContext: 100,
          },
        },
        contextWindowSize: 10_000,
        tokenCounter: mockTokenCounter,
      });

      const messages = createLargeConversation(500);
      const pruned = await memoryManager.fitToContextWindow(messages);
      const prunedTokens = await mockTokenCounter(pruned);

      // Reserve 1000, so available = 9000
      expect(prunedTokens).toBeLessThanOrEqual(9000);
      expect(prunedTokens).toBeGreaterThan(8500); // Within 5% of budget
    });
  });

  describe('No Pruning Needed', () => {
    it('returns messages unchanged when under budget in <5ms', async () => {
      const memoryManager = createMemoryManager({
        memoryConfig: baseMemoryConfig,
        contextWindowSize: 200_000,
        tokenCounter: mockTokenCounter,
      });

      const messages = createLargeConversation(10);

      const start = performance.now();
      const result = await memoryManager.fitToContextWindow(messages);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(5);
      expect(result).toHaveLength(messages.length);
    });
  });

  describe('Throughput', () => {
    it('processes 100 pruning operations in <1000ms', async () => {
      const memoryManager = createMemoryManager({
        memoryConfig: baseMemoryConfig,
        contextWindowSize: 10_000,
        tokenCounter: mockTokenCounter,
      });

      const messages = createLargeConversation(100);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await memoryManager.fitToContextWindow(messages);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1000);
      const operationsPerSec = 100 / (duration / 1000);
      expect(operationsPerSec).toBeGreaterThan(100); // At least 100 ops/sec
    });
  });
});
