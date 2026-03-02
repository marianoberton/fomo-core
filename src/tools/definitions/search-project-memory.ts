/**
 * Search Project Memory tool — lets an agent (especially the Manager) search
 * memories across the entire project, crossing all agents' stored knowledge.
 *
 * Use cases:
 * - Manager reviews what agents have learned about a client
 * - Manager finds facts stored by different agents for cross-referencing
 * - Any agent searches project-level shared memories
 *
 * Risk level is low — read-only semantic search with no side effects.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'search-project-memory' });

// ─── Options ───────────────────────────────────────────────────

export interface SearchProjectMemoryToolOptions {
  /** The long-term memory store to search. */
  store: LongTermMemoryStore;
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('Natural language search query. Describe what you are looking for.'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum number of results to return. Default: 10.'),
  categories: z
    .array(z.enum(['fact', 'decision', 'preference', 'task_context', 'learning']))
    .optional()
    .describe('Filter by memory categories. Omit to search all categories.'),
  minImportance: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Minimum importance score (0.0-1.0). Omit to include all.'),
});

const outputSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    content: z.string(),
    category: z.string(),
    importance: z.number(),
    scope: z.string(),
    agentId: z.string().nullable(),
    similarityScore: z.number(),
    createdAt: z.string(),
  })),
  totalResults: z.number(),
});

// ─── Tool Factory ──────────────────────────────────────────────

/**
 * Create a search-project-memory tool for cross-agent memory search.
 * Searches all memories in the project regardless of which agent stored them.
 */
export function createSearchProjectMemoryTool(
  options: SearchProjectMemoryToolOptions,
): ExecutableTool {
  const { store } = options;

  return {
    id: 'search-project-memory',
    name: 'Search Project Memory',
    description:
      'Search memories across the entire project, including all agents\' stored knowledge. ' +
      'Returns semantically similar memories ranked by relevance. ' +
      'Use this to find facts, preferences, and decisions stored by any agent. ' +
      'Ideal for cross-referencing information, reviewing what agents know, ' +
      'and building a complete picture of a client or topic.',
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
        const memories = await store.retrieve({
          query: parsed.query,
          topK: parsed.topK,
          scope: 'project',
          categories: parsed.categories,
          minImportance: parsed.minImportance,
        });

        const results = memories.map((m) => ({
          id: m.id,
          content: m.content,
          category: m.category as string,
          importance: m.importance,
          scope: m.scope,
          agentId: m.agentId ?? null,
          similarityScore: Math.round(m.similarityScore * 1000) / 1000,
          createdAt: m.createdAt.toISOString(),
        }));

        logger.info('Project memory search completed', {
          component: 'search-project-memory',
          projectId: context.projectId,
          query: parsed.query.substring(0, 100),
          resultsCount: results.length,
        });

        return ok({
          success: true,
          output: { results, totalResults: results.length },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Project memory search failed', {
          component: 'search-project-memory',
          projectId: context.projectId,
          error: message,
        });
        return err(new ToolExecutionError('search-project-memory', message));
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
          results: [],
          totalResults: 0,
          dryRun: true,
          previewQuery: parsed.query.substring(0, 100),
          topK: parsed.topK,
          categories: parsed.categories,
        },
        durationMs: 0,
      }));
    },
  };
}
