/**
 * PrismaMemoryStore integration tests.
 * Tests pgvector similarity search against real PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createPrismaMemoryStore } from './prisma-memory-store.js';
import type { EmbeddingGenerator } from './prisma-memory-store.js';

/**
 * Create a deterministic embedding for testing.
 * Returns a 1536-dim vector with the first value set to the seed.
 */
function createTestEmbedding(seed: number): number[] {
  const embedding = new Array<number>(1536).fill(0);
  embedding[0] = seed;
  // Add some variation in adjacent dimensions
  for (let i = 1; i < 10; i++) {
    embedding[i] = seed * (i / 10);
  }
  return embedding;
}

/**
 * Mock embedding generator that returns predictable vectors.
 * Uses a simple hash of the text to generate a seed value.
 */
function createMockEmbeddingGenerator(): EmbeddingGenerator {
  return async (text: string): Promise<number[]> => {
    // Simple hash: sum of char codes mod 100, normalized to [0,1]
    const sum = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const seed = (sum % 100) / 100;
    return createTestEmbedding(seed);
  };
}

describe('PrismaMemoryStore Integration', () => {
  let testDb: TestDatabase;
  let projectId: ProjectId;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('store', () => {
    it('inserts memory entry with pgvector embedding', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      const entry = await store.store({
        projectId,
        category: 'fact',
        content: 'The sky is blue.',
        embedding: createTestEmbedding(0.5),
        importance: 0.8,
      });

      expect(entry.id).toBeDefined();
      expect(entry.projectId).toBe(projectId);
      expect(entry.category).toBe('fact');
      expect(entry.content).toBe('The sky is blue.');
      expect(entry.importance).toBe(0.8);
      expect(entry.accessCount).toBe(0);
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it('stores entry with optional session and metadata', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());
      const sessionId = nanoid() as SessionId;

      // Create a session first (FK constraint)
      await testDb.prisma.session.create({
        data: { id: sessionId, projectId, status: 'active' },
      });

      const entry = await store.store({
        projectId,
        sessionId,
        category: 'preference',
        content: 'User prefers dark mode.',
        embedding: createTestEmbedding(0.3),
        importance: 0.6,
        metadata: { source: 'chat', turn: 5 },
      });

      expect(entry.sessionId).toBe(sessionId);
      expect(entry.metadata).toEqual({ source: 'chat', turn: 5 });
    });

    it('stores entry with expiresAt', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());
      const expiresAt = new Date(Date.now() + 86400_000); // 24h from now

      const entry = await store.store({
        projectId,
        category: 'task_context',
        content: 'Current sprint goal.',
        embedding: createTestEmbedding(0.7),
        importance: 0.9,
        expiresAt,
      });

      expect(entry.expiresAt).toEqual(expiresAt);
    });
  });

  describe('retrieve', () => {
    it('performs pgvector similarity search', async () => {
      const embeddingGen = createMockEmbeddingGenerator();
      const store = createPrismaMemoryStore(testDb.prisma, embeddingGen);

      // Store 3 entries with different embeddings
      await store.store({
        projectId,
        category: 'fact',
        content: 'Water boils at 100 degrees.',
        embedding: createTestEmbedding(0.1),
        importance: 0.7,
      });

      await store.store({
        projectId,
        category: 'fact',
        content: 'Water freezes at 0 degrees.',
        embedding: createTestEmbedding(0.12), // Similar to first
        importance: 0.7,
      });

      await store.store({
        projectId,
        category: 'fact',
        content: 'The sun is very far away.',
        embedding: createTestEmbedding(0.9), // Very different
        importance: 0.5,
      });

      const results = await store.retrieve({
        query: 'temperature of water', // Will generate embedding similar to 0.1
        topK: 2,
      });

      expect(results).toHaveLength(2);
      // Results should have similarity scores
      results.forEach((r) => {
        expect(r.similarityScore).toBeDefined();
        expect(typeof r.similarityScore).toBe('number');
      });
    });

    it('respects topK limit', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      for (let i = 0; i < 5; i++) {
        await store.store({
          projectId,
          category: 'fact',
          content: `Memory entry ${i}`,
          embedding: createTestEmbedding(i / 10),
          importance: 0.5,
        });
      }

      const results = await store.retrieve({ query: 'test', topK: 3 });
      expect(results).toHaveLength(3);
    });

    it('filters by minImportance', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      await store.store({
        projectId,
        category: 'fact',
        content: 'High importance fact.',
        embedding: createTestEmbedding(0.5),
        importance: 0.9,
      });

      await store.store({
        projectId,
        category: 'fact',
        content: 'Low importance fact.',
        embedding: createTestEmbedding(0.5),
        importance: 0.1,
      });

      const results = await store.retrieve({
        query: 'test',
        topK: 10,
        minImportance: 0.5,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('High importance fact.');
    });

    it('filters by category', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      await store.store({
        projectId,
        category: 'fact',
        content: 'A fact about the world.',
        embedding: createTestEmbedding(0.5),
        importance: 0.7,
      });

      await store.store({
        projectId,
        category: 'preference',
        content: 'User likes pizza.',
        embedding: createTestEmbedding(0.5),
        importance: 0.7,
      });

      const results = await store.retrieve({
        query: 'test',
        topK: 10,
        categories: ['preference'],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe('preference');
    });

    it('increments access count on retrieval', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      const entry = await store.store({
        projectId,
        category: 'fact',
        content: 'Accessed memory.',
        embedding: createTestEmbedding(0.5),
        importance: 0.7,
      });

      expect(entry.accessCount).toBe(0);

      // Retrieve it
      await store.retrieve({ query: 'test', topK: 10 });

      // Check access count was incremented via raw query
      const rows = await testDb.prisma.$queryRaw<Array<{ access_count: number }>>`
        SELECT access_count FROM memory_entries WHERE id = ${entry.id}
      `;
      expect(rows[0]?.access_count).toBe(1);
    });

    it('excludes expired entries', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      // Store an expired entry
      const pastDate = new Date(Date.now() - 86400_000);
      await store.store({
        projectId,
        category: 'fact',
        content: 'Expired memory.',
        embedding: createTestEmbedding(0.5),
        importance: 0.9,
        expiresAt: pastDate,
      });

      // Store a non-expired entry
      await store.store({
        projectId,
        category: 'fact',
        content: 'Fresh memory.',
        embedding: createTestEmbedding(0.5),
        importance: 0.5,
      });

      const results = await store.retrieve({ query: 'test', topK: 10 });

      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('Fresh memory.');
    });

    it('returns empty when no memories exist', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      const results = await store.retrieve({ query: 'test', topK: 10 });
      expect(results).toEqual([]);
    });
  });

  describe('delete', () => {
    it('deletes memory entry', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      const entry = await store.store({
        projectId,
        category: 'fact',
        content: 'To be deleted.',
        embedding: createTestEmbedding(0.5),
        importance: 0.5,
      });

      const result = await store.delete(entry.id);
      expect(result).toBe(true);

      // Verify deleted
      const count = await testDb.prisma.memoryEntry.count({ where: { id: entry.id } });
      expect(count).toBe(0);
    });

    it('returns false for non-existent entry', async () => {
      const store = createPrismaMemoryStore(testDb.prisma, createMockEmbeddingGenerator());

      const result = await store.delete('non-existent');
      expect(result).toBe(false);
    });
  });
});
