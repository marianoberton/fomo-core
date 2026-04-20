/**
 * Admin models read-only tool.
 *
 * - admin-list-models: list all available LLM models with metadata
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { getModelMeta } from '@/providers/models.js';
import { createLogger } from '@/observability/logger.js';

/** Curated model list — mirrors the models route. */
const CURATED_MODELS = [
  { id: 'claude-opus-4-6', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-5', provider: 'Anthropic' },
  { id: 'claude-haiku-4-5', provider: 'Anthropic' },
  { id: 'gpt-5', provider: 'OpenAI' },
  { id: 'gpt-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', provider: 'OpenAI' },
  { id: 'gpt-4.1', provider: 'OpenAI' },
  { id: 'gpt-4.1-mini', provider: 'OpenAI' },
  { id: 'gemini-3-pro-preview', provider: 'Google' },
  { id: 'gemini-3-flash-preview', provider: 'Google' },
  { id: 'gemini-2.5-pro', provider: 'Google' },
  { id: 'gemini-2.5-flash', provider: 'Google' },
  { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'Meta (OpenRouter)' },
  { id: 'deepseek/deepseek-chat', provider: 'DeepSeek (OpenRouter)' },
  { id: 'mistralai/mistral-large-2411', provider: 'Mistral (OpenRouter)' },
];

const logger = createLogger({ name: 'admin-tools-models' });

// ─── admin-list-models ─────────────────────────────────────────────

const listModelsInput = z.object({
  provider: z.string().optional().describe('Filter by provider name.'),
});

const listModelsOutput = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
      contextWindow: z.number(),
      maxOutputTokens: z.number(),
      supportsTools: z.boolean(),
      inputPricePer1M: z.number(),
      outputPricePer1M: z.number(),
    }),
  ),
  total: z.number(),
});

/**
 * Create the admin-list-models tool.
 *
 * Returns all available LLM models with pricing and capability metadata.
 */
export function createAdminListModelsTool(): ExecutableTool {
  return {
    id: 'admin-list-models',
    name: 'Admin List Models',
    description:
      'List all available LLM models with their provider, context window, pricing, ' +
      'and tool support. Useful for choosing the right model for an agent.',
    category: 'admin',
    inputSchema: listModelsInput,
    outputSchema: listModelsOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = listModelsInput.parse(input) as { provider?: string };

      logger.info('Listing models', {
        component: 'admin-list-models',
        provider: parsed.provider ?? 'all',
      });

      let entries = CURATED_MODELS;
      if (parsed.provider) {
        entries = entries.filter((m) => m.provider === parsed.provider);
      }

      const models = entries.map((entry) => {
        const meta = getModelMeta(entry.id);
        return {
          id: entry.id,
          name: entry.id,
          provider: entry.provider,
          contextWindow: meta.contextWindow,
          maxOutputTokens: meta.maxOutputTokens,
          supportsTools: meta.supportsTools,
          inputPricePer1M: meta.inputPricePer1M,
          outputPricePer1M: meta.outputPricePer1M,
        };
      });

      return Promise.resolve(
        ok({
          success: true,
          output: {
            models,
            total: models.length,
          },
          durationMs: Date.now() - startTime,
        }),
      );
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}
