/**
 * Prisma-backed LongTermMemoryStore with pgvector similarity search.
 * Uses $queryRaw/$executeRaw for vector operations since Prisma's
 * `Unsupported("vector(1536)")` type doesn't support standard CRUD.
 *
 * Supports two scopes:
 * - `'agent'`  — memories belong to a specific agent within a project.
 * - `'project'` — memories are shared across all agents in the project.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { AgentId } from '@/agents/types.js';
import { NexusError } from '@/core/errors.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { createLogger } from '@/observability/logger.js';
import type { LongTermMemoryStore } from './memory-manager.js';
import type { MemoryCategory, MemoryEntry, MemoryRetrieval, MemoryScope, RetrievedMemory } from './types.js';

const logger = createLogger({ name: 'prisma-memory-store' });

/** Callback to generate an embedding vector from text. */
export type EmbeddingGenerator = (text: string) => Promise<number[]>;

/** Raw row shape returned by pgvector similarity queries. */
interface RawMemoryRow {
  id: string;
  project_id: string;
  agent_id: string | null;
  session_id: string | null;
  scope: string;
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

/** Map a raw DB row to the domain RetrievedMemory shape. */
function rowToRetrievedMemory(row: RawMemoryRow): RetrievedMemory {
  return {
    id: row.id,
    projectId: row.project_id as ProjectId,
    agentId: (row.agent_id as AgentId | undefined) ?? undefined,
    sessionId: (row.session_id as SessionId | undefined) ?? undefined,
    scope: (row.scope as MemoryScope) || 'agent',
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
  };
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
      const scope: MemoryScope = entry.scope || 'agent';
      // Auto-generate embedding from content when the caller provides an empty array.
      // This allows callers (e.g. store-memory tool, auto-store) to skip pre-generating embeddings.
      const resolvedEmbedding =
        entry.embedding.length > 0 ? entry.embedding : await generateEmbedding(entry.content);
      const vectorLiteral = toVectorLiteral(resolvedEmbedding);

      await prisma.$executeRaw`
        INSERT INTO memory_entries (
          id, project_id, agent_id, session_id, scope, category, content, embedding,
          importance, access_count, last_accessed_at, created_at, expires_at, metadata
        ) VALUES (
          ${id},
          ${entry.projectId},
          ${entry.agentId ?? null},
          ${entry.sessionId ?? null},
          ${scope},
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
        scope,
        agentId: entry.agentId,
        category: entry.category,
        importance: entry.importance,
      });

      return {
        id,
        projectId: entry.projectId,
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        scope,
        category: entry.category,
        content: entry.content,
        embedding: resolvedEmbedding,
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

      // ── Scope filtering ──────────────────────────────────────
      // 'agent'  → only this agent's memories (requires agentId)
      // 'project'→ only project-scoped shared memories
      // undefined→ return both agent-specific (for agentId) + project-scoped
      if (query.scope === 'agent' && query.agentId) {
        conditions.push(Prisma.sql`agent_id = ${query.agentId}`);
        conditions.push(Prisma.sql`scope = 'agent'`);
      } else if (query.scope === 'project') {
        conditions.push(Prisma.sql`scope = 'project'`);
      } else if (query.agentId) {
        // No explicit scope — return this agent's memories + project-scoped
        conditions.push(
          Prisma.sql`(agent_id = ${query.agentId} OR scope = 'project')`,
        );
      }
      // If neither scope nor agentId → return everything for the project (no extra filter)

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

      // Build score expression — apply temporal decay when configured.
      // Decay formula: score = cosine_similarity * EXP(-λ * age_days)
      // where λ = ln(2) / half_life_days (score halves every half_life_days days).
      let scoreExpr: Prisma.Sql;
      let orderExpr: Prisma.Sql;

      if (query.decayHalfLifeDays && query.decayHalfLifeDays > 0) {
        const lambda = Math.log(2) / query.decayHalfLifeDays;
        // EXP(-λ * age_days) where age_days = seconds_since_created / 86400
        const decayExpr = Prisma.sql`EXP(${-lambda}::float8 * EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0)`;
        const cosineSimilarity = Prisma.sql`(1 - (embedding <=> ${vectorLiteral}::vector(1536)))`;
        scoreExpr = Prisma.sql`${cosineSimilarity} * ${decayExpr}`;
        orderExpr = Prisma.sql`${cosineSimilarity} * ${decayExpr} DESC`;
      } else {
        scoreExpr = Prisma.sql`1 - (embedding <=> ${vectorLiteral}::vector(1536))`;
        orderExpr = Prisma.sql`embedding <=> ${vectorLiteral}::vector(1536)`;
      }

      const results = await prisma.$queryRaw<RawMemoryRow[]>`
        SELECT
          id, project_id, agent_id, session_id, scope, category, content,
          importance, access_count,
          last_accessed_at, created_at, expires_at, metadata,
          ${scoreExpr} AS similarity_score
        FROM memory_entries
        WHERE ${whereClause}
        ORDER BY ${orderExpr}
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
        scope: query.scope,
        agentId: query.agentId,
        topK: query.topK,
        resultsCount: results.length,
      });

      return results.map(rowToRetrievedMemory);
    },

    async findSimilarExact(
      projectId: string,
      embedding: number[],
      similarityThreshold: number,
    ): Promise<Result<RetrievedMemory[], NexusError>> {
      try {
        const vectorLiteral = toVectorLiteral(embedding);

        const results = await prisma.$queryRaw<RawMemoryRow[]>`
          SELECT
            id, project_id, agent_id, session_id, scope, category, content,
            importance, access_count,
            last_accessed_at, created_at, expires_at, metadata,
            (1 - (embedding <=> ${vectorLiteral}::vector(1536))) AS similarity_score
          FROM memory_entries
          WHERE project_id = ${projectId}
            AND embedding IS NOT NULL
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (1 - (embedding <=> ${vectorLiteral}::vector(1536))) >= ${similarityThreshold}
          ORDER BY embedding <=> ${vectorLiteral}::vector(1536)
          LIMIT 5
        `;

        logger.debug('findSimilarExact search', {
          component: 'prisma-memory-store',
          projectId,
          threshold: similarityThreshold,
          resultsCount: results.length,
        });

        return ok(results.map(rowToRetrievedMemory));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('findSimilarExact failed', {
          component: 'prisma-memory-store',
          projectId,
          error: message,
        });
        return err(
          new NexusError({
            message: `Failed to search similar memories: ${message}`,
            code: 'MEMORY_SEARCH_ERROR',
            statusCode: 500,
            context: { projectId, similarityThreshold },
          }),
        );
      }
    },

    async updateContent(id: string, content: string, embedding: number[]): Promise<Result<void, NexusError>> {
      try {
        const vectorLiteral = toVectorLiteral(embedding);
        await prisma.$executeRaw`
          UPDATE memory_entries
          SET content = ${content},
              embedding = ${vectorLiteral}::vector(1536),
              last_accessed_at = NOW()
          WHERE id = ${id}
        `;

        logger.debug('Updated memory content', {
          component: 'prisma-memory-store',
          id,
        });

        return ok(undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('updateContent failed', {
          component: 'prisma-memory-store',
          id,
          error: message,
        });
        return err(
          new NexusError({
            message: `Failed to update memory content: ${message}`,
            code: 'MEMORY_UPDATE_ERROR',
            statusCode: 500,
            context: { memoryId: id },
          }),
        );
      }
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
