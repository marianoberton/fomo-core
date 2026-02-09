import { describe, it, expect, vi } from 'vitest';
import { createKnowledgeSearchTool } from './knowledge-search.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { RetrievedMemory } from '@/memory/types.js';
import type { ProjectId } from '@/core/types.js';

const context = createTestContext({ allowedTools: ['knowledge-search'] });

function createMockStore(results: RetrievedMemory[] = []): LongTermMemoryStore {
  return {
    store: vi.fn(),
    retrieve: vi.fn().mockResolvedValue(results),
    delete: vi.fn(),
  };
}

const sampleMemory: RetrievedMemory = {
  id: 'mem-1',
  projectId: 'test-project' as ProjectId,
  category: 'fact',
  content: 'The company was founded in 2020.',
  embedding: [],
  importance: 0.9,
  accessCount: 5,
  lastAccessedAt: new Date(),
  createdAt: new Date(),
  similarityScore: 0.95,
  metadata: { source: 'onboarding' },
};

describe('knowledge-search', () => {
  describe('schema validation', () => {
    const store = createMockStore();
    const tool = createKnowledgeSearchTool({ store });

    it('accepts a valid query', () => {
      const result = tool.inputSchema.safeParse({ query: 'when was the company founded?' });
      expect(result.success).toBe(true);
    });

    it('accepts optional topK and categories', () => {
      const result = tool.inputSchema.safeParse({
        query: 'search query',
        topK: 10,
        categories: ['fact', 'decision'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty query', () => {
      const result = tool.inputSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('rejects topK exceeding max', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', topK: 50 });
      expect(result.success).toBe(false);
    });

    it('rejects topK below min', () => {
      const result = tool.inputSchema.safeParse({ query: 'test', topK: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects invalid category', () => {
      const result = tool.inputSchema.safeParse({
        query: 'test',
        categories: ['invalid_category'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects minImportance out of range', () => {
      const result = tool.inputSchema.safeParse({
        query: 'test',
        minImportance: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dry run', () => {
    const store = createMockStore();
    const tool = createKnowledgeSearchTool({ store });

    it('returns query params without searching', async () => {
      const result = await tool.dryRun(
        { query: 'test query', topK: 3, categories: ['fact'] },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['query']).toBe('test query');
        expect(output['topK']).toBe(3);
      }
       
      expect(store.retrieve).not.toHaveBeenCalled();
    });
  });

  describe('execution', () => {
    it('searches the store and returns formatted results', async () => {
      const store = createMockStore([sampleMemory]);
      const tool = createKnowledgeSearchTool({ store });

      const result = await tool.execute(
        { query: 'when was the company founded?' },
        context,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as {
          results: {
            content: string;
            category: string;
            importance: number;
            similarity: number;
          }[];
          totalFound: number;
        };
        expect(output.totalFound).toBe(1);
        expect(output.results[0]?.content).toBe('The company was founded in 2020.');
        expect(output.results[0]?.similarity).toBe(0.95);
        expect(output.results[0]?.category).toBe('fact');
      }

       
      expect(store.retrieve).toHaveBeenCalledWith({
        query: 'when was the company founded?',
        topK: 5,
        minImportance: undefined,
        categories: undefined,
      });
    });

    it('returns empty results when store is empty', async () => {
      const store = createMockStore([]);
      const tool = createKnowledgeSearchTool({ store });

      const result = await tool.execute({ query: 'nothing here' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { totalFound: number };
        expect(output.totalFound).toBe(0);
      }
    });

    it('passes categories and minImportance to store', async () => {
      const store = createMockStore([]);
      const tool = createKnowledgeSearchTool({ store });

      await tool.execute(
        { query: 'test', topK: 3, minImportance: 0.8, categories: ['decision'] },
        context,
      );

       
      expect(store.retrieve).toHaveBeenCalledWith({
        query: 'test',
        topK: 3,
        minImportance: 0.8,
        categories: ['decision'],
      });
    });

    it('returns error when store throws', async () => {
      const store = createMockStore();
      (store.retrieve as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection lost'),
      );
      const tool = createKnowledgeSearchTool({ store });

      const result = await tool.execute({ query: 'test' }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Database connection lost');
      }
    });

    it('includes durationMs in result', async () => {
      const store = createMockStore([]);
      const tool = createKnowledgeSearchTool({ store });

      const result = await tool.execute({ query: 'test' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
