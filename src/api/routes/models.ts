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
  // OpenRouter
  { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'Meta (OpenRouter)' },
  { id: 'deepseek/deepseek-chat', provider: 'DeepSeek (OpenRouter)' },
  { id: 'mistralai/mistral-large-2411', provider: 'Mistral (OpenRouter)' },
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
