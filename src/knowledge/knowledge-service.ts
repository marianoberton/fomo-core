/**
 * KnowledgeService — UI-facing CRUD for per-project knowledge base entries.
 *
 * Wraps the memory_entries table. Uses raw SQL for list (pgvector Unsupported field
 * cannot be selected via standard Prisma). Embedding generation is optional —
 * when no generator is provided, entries are stored with NULL embedding (text-only,
 * no semantic search, but still listable/deletable).
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import { createLogger } from '@/observability/logger.js';
import type { EmbeddingGenerator } from '@/memory/prisma-memory-store.js';
import type { MemoryCategory } from '@/memory/types.js';
import type {
  KnowledgeEntry,
  KnowledgeService,
  ListKnowledgeParams,
  BulkImportItem,
} from './types.js';

const logger = createLogger({ name: 'knowledge-service' });

/** Batch size for bulk import embedding generation. */
const BULK_BATCH_SIZE = 20;

/** Default importance for entries without an explicit value. */
const DEFAULT_IMPORTANCE = 0.5;

/** Default category for entries without an explicit category. */
const DEFAULT_CATEGORY: MemoryCategory = 'fact';

// ─── Raw DB Row ─────────────────────────────────────────────────

interface RawKnowledgeRow {
  id: string;
  project_id: string;
  category: string;
  content: string;
  importance: number;
  access_count: number;
  last_accessed_at: Date;
  created_at: Date;
  expires_at: Date | null;
  metadata: unknown;
  total_count: string; // bigint comes as string in pg
}

// ─── Mapper ─────────────────────────────────────────────────────

function toEntry(row: RawKnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category as MemoryCategory,
    content: row.content,
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
  };
}

// ─── Factory ─────────────────────────────────────────────────────

export interface KnowledgeServiceOptions {
  prisma: PrismaClient;
  /** Optional embedding generator. If omitted, entries are stored without embeddings. */
  generateEmbedding?: EmbeddingGenerator;
}

/** Create a KnowledgeService backed by Prisma + pgvector. */
export function createKnowledgeService(options: KnowledgeServiceOptions): KnowledgeService {
  const { prisma, generateEmbedding } = options;

  async function insertWithEmbedding(
    id: string,
    projectId: string,
    content: string,
    category: MemoryCategory,
    importance: number,
    now: Date,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!generateEmbedding) {
      // No embedding generator — store as text-only (embedding column stays NULL)
      await prisma.$executeRaw`
        INSERT INTO memory_entries (
          id, project_id, session_id, category, content, embedding,
          importance, access_count, last_accessed_at, created_at, expires_at, metadata
        ) VALUES (
          ${id},
          ${projectId},
          NULL,
          ${category},
          ${content},
          NULL,
          ${importance},
          0,
          ${now},
          ${now},
          NULL,
          ${metadata ? JSON.stringify(metadata) : null}::jsonb
        )
      `;
      return;
    }

    const vector = await generateEmbedding(content);
    const vectorLiteral = `[${vector.join(',')}]`;

    await prisma.$executeRaw`
      INSERT INTO memory_entries (
        id, project_id, session_id, category, content, embedding,
        importance, access_count, last_accessed_at, created_at, expires_at, metadata
      ) VALUES (
        ${id},
        ${projectId},
        NULL,
        ${category},
        ${content},
        ${vectorLiteral}::vector(1536),
        ${importance},
        0,
        ${now},
        ${now},
        NULL,
        ${metadata ? JSON.stringify(metadata) : null}::jsonb
      )
    `;
  }

  return {
    async add(params) {
      const id = nanoid();
      const now = new Date();
      const category = params.category ?? DEFAULT_CATEGORY;
      const importance = params.importance ?? DEFAULT_IMPORTANCE;

      await insertWithEmbedding(id, params.projectId, params.content, category, importance, now, params.metadata);

      logger.info('Knowledge entry added', {
        component: 'knowledge-service',
        id,
        projectId: params.projectId,
        category,
        hasEmbedding: generateEmbedding !== undefined,
      });

      return {
        id,
        projectId: params.projectId,
        category,
        content: params.content,
        importance,
        accessCount: 0,
        lastAccessedAt: now,
        createdAt: now,
        metadata: params.metadata,
      };
    },

    async list(params: ListKnowledgeParams) {
      const page = params.page ?? 1;
      const limit = Math.min(params.limit ?? 20, 100);
      const offset = (page - 1) * limit;

      const conditions: Prisma.Sql[] = [
        Prisma.sql`project_id = ${params.projectId}`,
      ];

      if (params.category) {
        conditions.push(Prisma.sql`category = ${params.category}`);
      }

      const whereClause = Prisma.join(conditions, ' AND ');

      const rows = await prisma.$queryRaw<RawKnowledgeRow[]>`
        SELECT
          id, project_id, category, content, importance,
          access_count, last_accessed_at, created_at, expires_at, metadata,
          COUNT(*) OVER() AS total_count
        FROM memory_entries
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const total = rows.length > 0 ? parseInt(rows[0]?.total_count ?? '0', 10) : 0;

      return {
        entries: rows.map(toEntry),
        total,
        page,
        limit,
        hasMore: offset + rows.length < total,
      };
    },

    async delete(id: string): Promise<boolean> {
      try {
        await prisma.memoryEntry.delete({ where: { id } });
        logger.info('Knowledge entry deleted', { component: 'knowledge-service', id });
        return true;
      } catch {
        return false;
      }
    },

    async bulkImport(params: { projectId: string; items: BulkImportItem[] }) {
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      // Process in batches of BULK_BATCH_SIZE
      for (let i = 0; i < params.items.length; i += BULK_BATCH_SIZE) {
        const batch = params.items.slice(i, i + BULK_BATCH_SIZE);

        await Promise.all(
          batch.map(async (item, batchIdx) => {
            const globalIdx = i + batchIdx;
            try {
              const id = nanoid();
              const now = new Date();
              const category = item.category ?? DEFAULT_CATEGORY;
              const importance = item.importance ?? DEFAULT_IMPORTANCE;

              await insertWithEmbedding(id, params.projectId, item.content, category, importance, now, item.metadata);
              imported++;
            } catch (err) {
              failed++;
              errors.push(`Item ${globalIdx}: ${err instanceof Error ? err.message : String(err)}`);
              logger.warn('Bulk import item failed', {
                component: 'knowledge-service',
                projectId: params.projectId,
                itemIndex: globalIdx,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
      }

      logger.info('Bulk knowledge import complete', {
        component: 'knowledge-service',
        projectId: params.projectId,
        imported,
        failed,
      });

      return { imported, failed, errors };
    },
  };
}
