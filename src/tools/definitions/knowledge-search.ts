/**
 * Knowledge search tool — semantic search over the long-term memory store.
 *
 * Wraps the existing LongTermMemoryStore interface to expose vector search
 * as a tool the agent can invoke during execution.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { MemoryCategory } from '@/memory/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'knowledge-search' });

export interface KnowledgeSearchToolOptions {
  /** The long-term memory store to search against. */
  store: LongTermMemoryStore;
}

const categorySchema = z.enum(['fact', 'decision', 'preference', 'task_context', 'learning']);

const inputSchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional().default(5),
  minImportance: z.number().min(0).max(1).optional(),
  categories: z.array(categorySchema).optional(),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      content: z.string(),
      category: z.string(),
      importance: z.number(),
      similarity: z.number(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  totalFound: z.number(),
});

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a knowledge search tool backed by the long-term memory store. */
export function createKnowledgeSearchTool(options: KnowledgeSearchToolOptions): ExecutableTool {
  const { store } = options;

  return {
    id: 'knowledge-search',
    name: 'Knowledge Search',
    description:
      'Search the knowledge base for relevant information using semantic similarity. ' +
      'Returns matching entries ranked by relevance. Filter by importance score (0-1) ' +
      'and categories (fact, decision, preference, task_context, learning).',
    category: 'memory',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const retrieved = await store.retrieve({
          query: parsed.query,
          topK: parsed.topK,
          minImportance: parsed.minImportance,
          categories: parsed.categories as MemoryCategory[] | undefined,
        });

        const results = retrieved.map((entry) => ({
          content: entry.content,
          category: entry.category,
          importance: entry.importance,
          similarity: entry.similarityScore,
          metadata: entry.metadata,
        }));

        logger.debug('Knowledge search completed', {
          component: 'knowledge-search',
          projectId: context.projectId,
          traceId: context.traceId,
          query: parsed.query,
          topK: parsed.topK,
          resultsCount: results.length,
        });

        return ok({
          success: true,
          output: { results, totalFound: results.length },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Knowledge search failed', {
          component: 'knowledge-search',
          projectId: context.projectId,
          traceId: context.traceId,
          error: message,
        });
        return err(new ToolExecutionError('knowledge-search', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      return Promise.resolve(ok({
        success: true,
        output: {
          query: parsed.query,
          topK: parsed.topK,
          minImportance: parsed.minImportance,
          categories: parsed.categories,
          dryRun: true,
        },
        durationMs: 0,
      }));
    },
  };
}
