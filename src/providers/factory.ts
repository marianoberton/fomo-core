/**
 * Provider factory.
 * Resolves an LLMProviderConfig into a concrete LLMProvider instance.
 * Handles API key resolution from environment variables.
 */
import type { LLMProviderConfig } from '@/core/types.js';
import { ProviderError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

const logger = createLogger({ name: 'provider-factory' });

/**
 * Resolve an API key from an environment variable name.
 * Never logs or returns the actual key value — only whether it was found.
 */
function resolveApiKey(envVar: string | undefined, provider: string): string {
  if (!envVar) {
    throw new ProviderError(provider, 'No apiKeyEnvVar configured');
  }
  const key = process.env[envVar];
  if (!key) {
    throw new ProviderError(
      provider,
      `Environment variable "${envVar}" is not set or empty`,
    );
  }
  return key;
}

/**
 * Create an LLMProvider from a configuration object.
 * API keys are resolved from environment variables at construction time — the raw
 * key is never stored in config files or passed through the agent loop.
 */
export function createProvider(config: LLMProviderConfig): LLMProvider {
  logger.info('Creating LLM provider', {
    component: 'provider-factory',
    provider: config.provider,
    model: config.model,
  });

  switch (config.provider) {
    case 'anthropic': {
      const apiKey = resolveApiKey(config.apiKeyEnvVar, 'anthropic');
      return createAnthropicProvider({
        apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      });
    }

    case 'openai': {
      const apiKey = resolveApiKey(config.apiKeyEnvVar, 'openai');
      return createOpenAIProvider({
        apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        providerLabel: 'openai',
      });
    }

    case 'google': {
      const apiKey = resolveApiKey(config.apiKeyEnvVar, 'google');
      return createOpenAIProvider({
        apiKey,
        model: config.model,
        baseUrl: config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
        providerLabel: 'google',
      });
    }

    case 'ollama': {
      // Ollama doesn't need an API key, but uses OpenAI-compatible API
      return createOpenAIProvider({
        apiKey: 'ollama',
        model: config.model,
        baseUrl: config.baseUrl ?? 'http://localhost:11434/v1',
        providerLabel: 'ollama',
      });
    }

    default: {
      // Exhaustiveness check — TypeScript narrows to `never`
      const _exhaustive: never = config.provider;
      throw new ProviderError(
        String(_exhaustive),
        `Unknown provider: ${String(_exhaustive)}`,
      );
    }
  }
}
