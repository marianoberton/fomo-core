/**
 * Embedding provider — generates vector embeddings from text.
 *
 * Uses the OpenAI embeddings API (text-embedding-3-small by default).
 * Also compatible with any OpenAI-compatible endpoint (e.g. Ollama, vLLM).
 * API key is resolved from environment variables — never stored in config.
 */
import OpenAI from 'openai';
import { createLogger } from '@/observability/logger.js';
import type { EmbeddingGenerator } from '@/memory/prisma-memory-store.js';

const logger = createLogger({ name: 'embeddings' });

/** Configuration for the embedding provider. */
export interface EmbeddingProviderOptions {
  /** API key for the embedding service. */
  apiKey: string;
  /** Model identifier (default: 'text-embedding-3-small'). */
  model?: string;
  /** Custom base URL for self-hosted providers. */
  baseUrl?: string;
  /** Expected embedding dimensions (default: 1536). */
  dimensions?: number;
}

/**
 * Create an embedding generator backed by the OpenAI embeddings API.
 *
 * Returns a function `(text: string) => Promise<number[]>` compatible
 * with the `EmbeddingGenerator` type used by `createPrismaMemoryStore`.
 */
export function createEmbeddingProvider(options: EmbeddingProviderOptions): EmbeddingGenerator {
  const model = options.model ?? 'text-embedding-3-small';
  const dimensions = options.dimensions ?? 1536;
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });

  return async (text: string): Promise<number[]> => {
    logger.debug('Generating embedding', {
      component: 'embeddings',
      model,
      textLength: text.length,
    });

    const response = await client.embeddings.create({
      model,
      input: text,
      dimensions,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('Embedding response contained no data');
    }

    logger.debug('Embedding generated', {
      component: 'embeddings',
      model,
      vectorLength: embedding.length,
    });

    return embedding;
  };
}

/**
 * Resolve an embedding provider from the agent's memory config.
 *
 * Reads the `embeddingProvider` field (e.g. "openai", "ollama") and
 * resolves the appropriate API key from environment variables.
 * Returns null if long-term memory is disabled or no key is available.
 */
export function resolveEmbeddingProvider(embeddingProvider: string): EmbeddingGenerator | null {
  switch (embeddingProvider) {
    case 'openai': {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        logger.warn('OPENAI_API_KEY not set — long-term memory disabled', {
          component: 'embeddings',
        });
        return null;
      }
      return createEmbeddingProvider({ apiKey, model: 'text-embedding-3-small' });
    }

    case 'anthropic': {
      // Anthropic doesn't have a native embeddings API — use Voyage AI via OpenAI-compatible endpoint
      const apiKey = process.env['VOYAGE_API_KEY'];
      if (!apiKey) {
        logger.warn('VOYAGE_API_KEY not set — long-term memory disabled', {
          component: 'embeddings',
        });
        return null;
      }
      return createEmbeddingProvider({
        apiKey,
        model: 'voyage-3',
        baseUrl: 'https://api.voyageai.com/v1',
      });
    }

    case 'ollama': {
      return createEmbeddingProvider({
        apiKey: 'ollama',
        model: 'nomic-embed-text',
        baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1',
        dimensions: 1536,
      });
    }

    default: {
      logger.warn(`Unknown embedding provider "${embeddingProvider}" — long-term memory disabled`, {
        component: 'embeddings',
      });
      return null;
    }
  }
}
