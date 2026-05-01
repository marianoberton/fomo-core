/**
 * Models route — exposes the model registry for the platform UI.
 * GET /models — returns all available models with metadata.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';
import { getModelMeta, type ModelMeta } from '@/providers/models.js';

/** Model entry for the platform UI. */
interface ModelEntry {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

/** Curated list of models to expose to clients (no legacy/dated variants). */
const EXPOSED_MODELS: { id: string; provider: string }[] = [
  // Anthropic
  { id: 'claude-opus-4-6', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-6', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-5', provider: 'Anthropic' },
  { id: 'claude-haiku-4-5', provider: 'Anthropic' },
  // OpenAI
  { id: 'gpt-5', provider: 'OpenAI' },
  { id: 'gpt-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', provider: 'OpenAI' },
  { id: 'gpt-4.1', provider: 'OpenAI' },
  { id: 'gpt-4.1-mini', provider: 'OpenAI' },
  // Google
  { id: 'gemini-3-pro-preview', provider: 'Google' },
  { id: 'gemini-3-flash-preview', provider: 'Google' },
  { id: 'gemini-2.5-pro', provider: 'Google' },
  { id: 'gemini-2.5-flash', provider: 'Google' },
  // OpenRouter — Meta Llama (open-source)
  { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'Meta (OpenRouter)' },
  { id: 'meta-llama/llama-3.1-8b-instruct', provider: 'Meta (OpenRouter)' },
  // OpenRouter — DeepSeek
  { id: 'deepseek/deepseek-chat', provider: 'DeepSeek (OpenRouter)' },
  { id: 'deepseek/deepseek-r1', provider: 'DeepSeek (OpenRouter)' },
  // OpenRouter — Mistral
  { id: 'mistralai/mistral-large-2411', provider: 'Mistral (OpenRouter)' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct', provider: 'Mistral (OpenRouter)' },
  // OpenRouter — Google
  { id: 'google/gemini-2.5-pro-preview', provider: 'Google (OpenRouter)' },
  { id: 'google/gemini-2.0-flash-lite', provider: 'Google (OpenRouter)' },
  // OpenRouter — Anthropic
  { id: 'anthropic/claude-sonnet-4-6', provider: 'Anthropic (OpenRouter)' },
  // OpenRouter — Qwen
  { id: 'qwen/qwen3-235b-a22b', provider: 'Qwen (OpenRouter)' },
  { id: 'qwen/qwen3-30b-a3b', provider: 'Qwen (OpenRouter)' },
  { id: 'qwen/qwen-2.5-72b-instruct', provider: 'Qwen (OpenRouter)' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', provider: 'Qwen (OpenRouter)' },
  // OpenRouter — DeepSeek (extended)
  { id: 'deepseek/deepseek-r1-distill-qwen-32b', provider: 'DeepSeek (OpenRouter)' },
  // OpenRouter — Moonshot Kimi
  { id: 'moonshotai/kimi-k2.5', provider: 'Moonshot (OpenRouter)' },
];

/** Build the full model entry from the curated list. */
function buildModelEntries(): ModelEntry[] {
  return EXPOSED_MODELS.map(({ id, provider }) => {
    const meta: ModelMeta = getModelMeta(id);
    return {
      id,
      provider,
      contextWindow: meta.contextWindow,
      maxOutputTokens: meta.maxOutputTokens,
      supportsTools: meta.supportsTools,
      inputPricePer1M: meta.inputPricePer1M,
      outputPricePer1M: meta.outputPricePer1M,
    };
  });
}

/** Register model routes. */
export function modelRoutes(
  fastify: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps: RouteDependencies,
): void {
  fastify.get(
    '/models',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const models = buildModelEntries();
      await sendSuccess(reply, models);
    },
  );
}
