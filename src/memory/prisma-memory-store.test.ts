import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { MemoryCategory } from './types.js';
import { createPrismaMemoryStore } from './prisma-memory-store.js';
import type { EmbeddingGenerator } from './prisma-memory-store.js';

const PROJECT_ID = 'proj_test' as ProjectId;
const SESSION_ID = 'sess_test' as SessionId;

const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);

function createMockPrisma() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    memoryEntry: {
      delete: vi.fn(),
    },
  } as unknown as PrismaClient;
}

function createMockEmbeddingGenerator(): EmbeddingGenerator {
  return vi.fn().mockResolvedValue(mockEmbedding);
}

describe('PrismaLongTermMemoryStore', () => {
  let mockPrisma: PrismaClient;
  let mockEmbGen: EmbeddingGenerator;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockEmbGen = createMockEmbeddingGenerator();
    vi.clearAllMocks();
  });

  describe('store', () => {
    it('inserts a memory entry with embedding via $executeRaw', async () => {
      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);

      const result = await store.store({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        category: 'fact',
        content: 'The sky is blue',
        embedding: mockEmbedding,
        importance: 0.8,
        metadata: { source: 'observation' },
      });

      expect(result.id).toBeDefined();
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.category).toBe('fact');
      expect(result.content).toBe('The sky is blue');
      expect(result.embedding).toBe(mockEmbedding);
      expect(result.importance).toBe(0.8);
      expect(result.accessCount).toBe(0);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.metadata).toEqual({ source: 'observation' });

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it('handles entries without optional fields', async () => {
      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);

      const result = await store.store({
        projectId: PROJECT_ID,
        category: 'decision',
        content: 'Use PostgreSQL',
        embedding: mockEmbedding,
        importance: 0.9,
      });

      expect(result.sessionId).toBeUndefined();
      expect(result.expiresAt).toBeUndefined();
      expect(result.metadata).toBeUndefined();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    });
  });

  describe('retrieve', () => {
    it('generates an embedding for the query and searches via $queryRaw', async () => {
      const rawRows = [
        {
          id: 'mem_1',
          project_id: PROJECT_ID,
          session_id: null,
          category: 'fact',
          content: 'The sky is blue',
          importance: 0.8,
          access_count: 3,
          last_accessed_at: new Date(),
          created_at: new Date(),
          expires_at: null,
          metadata: null,
          similarity_score: 0.95,
        },
      ];
      vi.mocked(mockPrisma.$queryRaw).mockResolvedValue(rawRows);

      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);
      const results = await store.retrieve({
        query: 'What color is the sky?',
        topK: 5,
      });

      expect(mockEmbGen).toHaveBeenCalledWith('What color is the sky?');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('The sky is blue');
      expect(results[0]?.similarityScore).toBe(0.95);
      expect(results[0]?.projectId).toBe(PROJECT_ID);
    });

    it('updates access counts for retrieved memories', async () => {
      const rawRows = [
        {
          id: 'mem_1',
          project_id: PROJECT_ID,
          session_id: null,
          category: 'fact',
          content: 'Hello',
          importance: 0.5,
          access_count: 0,
          last_accessed_at: new Date(),
          created_at: new Date(),
          expires_at: null,
          metadata: null,
          similarity_score: 0.8,
        },
      ];
      vi.mocked(mockPrisma.$queryRaw).mockResolvedValue(rawRows);

      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);
      await store.retrieve({ query: 'greeting', topK: 10 });

      // $executeRaw called for access count update
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it('returns empty array when no results', async () => {
      vi.mocked(mockPrisma.$queryRaw).mockResolvedValue([]);

      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);
      const results = await store.retrieve({ query: 'nothing', topK: 5 });

      expect(results).toHaveLength(0);
      // No access count update when no results
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('passes filter parameters to the query', async () => {
      vi.mocked(mockPrisma.$queryRaw).mockResolvedValue([]);

      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);
      await store.retrieve({
        query: 'test',
        topK: 3,
        minImportance: 0.7,
        categories: ['fact', 'decision'] as MemoryCategory[],
        sessionScope: SESSION_ID,
      });

      expect(mockEmbGen).toHaveBeenCalledWith('test');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledOnce();
    });
  });

  describe('delete', () => {
    it('deletes a memory entry by ID', async () => {
      vi.mocked(mockPrisma.memoryEntry.delete).mockResolvedValue({} as never);

      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);
      const result = await store.delete('mem_1');

      expect(result).toBe(true);
      expect(mockPrisma.memoryEntry.delete).toHaveBeenCalledWith({
        where: { id: 'mem_1' },
      });
    });

    it('returns false when entry not found', async () => {
      vi.mocked(mockPrisma.memoryEntry.delete).mockRejectedValue(
        new Error('Record not found'),
      );

      const store = createPrismaMemoryStore(mockPrisma, mockEmbGen);
      const result = await store.delete('nope');

      expect(result).toBe(false);
    });
  });
});
