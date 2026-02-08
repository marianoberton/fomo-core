/**
 * Prisma-backed LongTermMemoryStore with pgvector similarity search.
 * Uses $queryRaw/$executeRaw for vector operations since Prisma's
 * `Unsupported("vector(1536)")` type doesn't support standard CRUD.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId } from '@/core/types.js';
import { createLogger } from '@/observability/logger.js';
import type { LongTermMemoryStore } from './memory-manager.js';
import type { MemoryCategory, MemoryEntry, MemoryRetrieval, RetrievedMemory } from './types.js';

const logger = createLogger({ name: 'prisma-memory-store' });

/** Callback to generate an embedding vector from text. */
export type EmbeddingGenerator = (text: string) => Promise<number[]>;

/** Raw row shape returned by pgvector similarity queries. */
interface RawMemoryRow {
  id: string;
  project_id: string;
  session_id: string | null;
  category: string;
  content: string;
  importance: number;
  access_count: number;
  last_accessed_at: Date;
  created_at: Date;
  expires_at: Date | null;
  metadata: unknown;
  similarity_score: number;
}

/**
 * Create a Prisma-backed LongTermMemoryStore with pgvector.
 * Requires an embedding generator callback for text → vector conversion.
 */
export function createPrismaMemoryStore(
  prisma: PrismaClient,
  generateEmbedding: EmbeddingGenerator,
): LongTermMemoryStore {
  /** Format a number[] as a pgvector literal string: '[0.1,0.2,...]'. */
  function toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  return {
    async store(
      entry: Omit<MemoryEntry, 'id' | 'accessCount' | 'lastAccessedAt' | 'createdAt'>,
    ): Promise<MemoryEntry> {
      const id = nanoid();
      const now = new Date();
      const vectorLiteral = toVectorLiteral(entry.embedding);

      await prisma.$executeRaw`
        INSERT INTO memory_entries (
          id, project_id, session_id, category, content, embedding,
          importance, access_count, last_accessed_at, created_at, expires_at, metadata
        ) VALUES (
          ${id},
          ${entry.projectId},
          ${entry.sessionId ?? null},
          ${entry.category},
          ${entry.content},
          ${vectorLiteral}::vector(1536),
          ${entry.importance},
          0,
          ${now},
          ${now},
          ${entry.expiresAt ?? null},
          ${entry.metadata ? JSON.stringify(entry.metadata) : null}::jsonb
        )
      `;

      logger.debug('Stored memory entry', {
        component: 'prisma-memory-store',
        id,
        category: entry.category,
        importance: entry.importance,
      });

      return {
        id,
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        category: entry.category,
        content: entry.content,
        embedding: entry.embedding,
        importance: entry.importance,
        accessCount: 0,
        lastAccessedAt: now,
        createdAt: now,
        expiresAt: entry.expiresAt,
        metadata: entry.metadata,
      };
    },

    async retrieve(query: MemoryRetrieval): Promise<RetrievedMemory[]> {
      const queryEmbedding = await generateEmbedding(query.query);
      const vectorLiteral = toVectorLiteral(queryEmbedding);

      // Build dynamic WHERE conditions
      const conditions: Prisma.Sql[] = [
        Prisma.sql`embedding IS NOT NULL`,
        Prisma.sql`(expires_at IS NULL OR expires_at > NOW())`,
      ];

      if (query.sessionScope) {
        conditions.push(Prisma.sql`session_id = ${query.sessionScope}`);
      }

      if (query.minImportance !== undefined) {
        conditions.push(Prisma.sql`importance >= ${query.minImportance}`);
      }

      if (query.categories && query.categories.length > 0) {
        conditions.push(
          Prisma.sql`category = ANY(${query.categories}::text[])`,
        );
      }

      const whereClause = Prisma.join(conditions, ' AND ');

      const results = await prisma.$queryRaw<RawMemoryRow[]>`
        SELECT
          id, project_id, session_id, category, content,
          importance, access_count,
          last_accessed_at, created_at, expires_at, metadata,
          1 - (embedding <=> ${vectorLiteral}::vector(1536)) AS similarity_score
        FROM memory_entries
        WHERE ${whereClause}
        ORDER BY embedding <=> ${vectorLiteral}::vector(1536)
        LIMIT ${query.topK}
      `;

      // Update access counts for retrieved memories
      if (results.length > 0) {
        const ids = results.map((r) => r.id);
        await prisma.$executeRaw`
          UPDATE memory_entries
          SET access_count = access_count + 1,
              last_accessed_at = NOW()
          WHERE id = ANY(${ids}::text[])
        `;
      }

      logger.debug('Retrieved memories', {
        component: 'prisma-memory-store',
        query: query.query,
        topK: query.topK,
        resultsCount: results.length,
      });

      return results.map((row) => ({
        id: row.id,
        projectId: row.project_id as ProjectId,
        sessionId: (row.session_id as SessionId | undefined) ?? undefined,
        category: row.category as MemoryCategory,
        content: row.content,
        embedding: [], // Embeddings not returned in search results for efficiency
        importance: row.importance,
        accessCount: row.access_count,
        lastAccessedAt: row.last_accessed_at,
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
        similarityScore: row.similarity_score,
      }));
    },

    async delete(id: string): Promise<boolean> {
      try {
        await prisma.memoryEntry.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },
  };
}
