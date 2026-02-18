/**
 * Web Search Tool — searches the web via Tavily API.
 * API key is resolved from project secrets (key: TAVILY_API_KEY).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { SecretService } from '@/secrets/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'web-search' });

// ─── Constants ──────────────────────────────────────────────────

const TAVILY_API_URL = 'https://api.tavily.com/search';
const SECRET_KEY = 'TAVILY_API_KEY';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS_LIMIT = 10;

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  query: z.string().min(1).max(2000).describe('Search query'),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(5)
    .describe('Maximum number of results to return (1-10)'),
});

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number(),
});

const outputSchema = z.object({
  results: z.array(searchResultSchema),
  query: z.string(),
});

// ─── Tavily API Response Shape ──────────────────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
}

// ─── Options ────────────────────────────────────────────────────

export interface WebSearchToolOptions {
  secretService: SecretService;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a web-search tool that queries the Tavily API. */
export function createWebSearchTool(options: WebSearchToolOptions): ExecutableTool {
  const { secretService } = options;

  return {
    id: 'web-search',
    name: 'Web Search',
    description: 'Searches the web using the Tavily API. Returns titles, URLs, content snippets, and relevance scores. Requires TAVILY_API_KEY in project secrets.',
    category: 'search',
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
        // Resolve API key from project secrets
        const apiKey = await secretService.get(context.projectId, SECRET_KEY);

        const response = await fetch(TAVILY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: parsed.query,
            max_results: parsed.maxResults,
            include_answer: false,
          }),
          signal: AbortSignal.any([
            context.abortSignal,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ]),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return err(new ToolExecutionError(
            'web-search',
            `Tavily API returned ${response.status}: ${errorText}`,
          ));
        }

        const data = await response.json() as TavilyResponse;

        const results = data.results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
        }));

        logger.info('Web search completed', {
          component: 'web-search',
          projectId: context.projectId,
          traceId: context.traceId,
          query: parsed.query,
          resultsCount: results.length,
        });

        return ok({
          success: true,
          output: { results, query: parsed.query },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('web-search', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      try {
        // Verify the API key exists (without revealing it)
        const exists = await secretService.exists(context.projectId, SECRET_KEY);

        return await Promise.resolve(ok({
          success: true,
          output: {
            dryRun: true,
            query: parsed.query,
            maxResults: parsed.maxResults,
            apiKeyConfigured: exists,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return await Promise.resolve(err(new ToolExecutionError('web-search', message)));
      }
    },
  };
}
