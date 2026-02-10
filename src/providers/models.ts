/**
 * Model metadata registry.
 * Maps model identifiers to their capabilities (context window, pricing, features).
 *
 * MAINTENANCE:
 * - Update this registry monthly or when new models are released
 * - Check pricing docs:
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - OpenAI: https://openai.com/api/pricing/
 *   - Google: https://ai.google.dev/pricing
 *
 * LAST UPDATED: 2026-02-10
 */

export interface ModelMeta {
  /** Context window size in tokens. */
  contextWindow: number;
  /** Maximum output tokens supported. */
  maxOutputTokens: number;
  /** Whether the model supports tool/function calling. */
  supportsTools: boolean;
  /** Cost per 1M input tokens in USD. */
  inputPricePer1M: number;
  /** Cost per 1M output tokens in USD. */
  outputPricePer1M: number;
}

/**
 * Known model metadata.
 * Used for context window limits and cost normalization.
 * Models not in this registry fall back to conservative defaults.
 */
const MODEL_REGISTRY: Record<string, ModelMeta> = {
  // ─── Anthropic ──────────────────────────────────────────────
  // Claude 4.6 (released Feb 5, 2026 - most capable)
  'claude-opus-4-6': {
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 5,
    outputPricePer1M: 25,
  },

  // Claude 4.5 series (current flagship, Feb 2026)
  'claude-sonnet-4-5': {
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
  },
  'claude-sonnet-4-5-20250929': {
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
  },
  'claude-haiku-4-5': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 1,
    outputPricePer1M: 5,
  },

  // Claude 3.5 (previous gen)
  'claude-3-5-sonnet-20241022': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
  },
  'claude-3-5-haiku-20241022': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.8,
    outputPricePer1M: 4,
  },

  // Claude 3 (legacy)
  'claude-3-opus-20240229': {
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    inputPricePer1M: 15,
    outputPricePer1M: 75,
  },
  'claude-3-sonnet-20240229': {
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
  },
  'claude-3-haiku-20240307': {
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.25,
  },

  // ─── OpenAI ─────────────────────────────────────────────────
  // GPT-5 (new as of 2026)
  'gpt-5': {
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
  },

  // GPT-4o (current flagship)
  'gpt-4o': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10,
  },
  'gpt-4o-2024-11-20': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10,
  },
  'gpt-4o-mini': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
  },
  'gpt-4o-mini-2024-07-18': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
  },

  // GPT-4.1
  'gpt-4.1': {
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    supportsTools: true,
    inputPricePer1M: 2,
    outputPricePer1M: 8,
  },
  'gpt-4.1-mini': {
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    supportsTools: true,
    inputPricePer1M: 0.4,
    outputPricePer1M: 1.6,
  },

  // GPT-4 Turbo (legacy)
  'gpt-4-turbo': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    inputPricePer1M: 10,
    outputPricePer1M: 30,
  },
  'gpt-4-turbo-2024-04-09': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsTools: true,
    inputPricePer1M: 10,
    outputPricePer1M: 30,
  },

  // o1 reasoning models
  'o1-preview': {
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    supportsTools: false, // o1 doesn't support function calling yet
    inputPricePer1M: 15,
    outputPricePer1M: 60,
  },
  'o1-mini': {
    contextWindow: 128_000,
    maxOutputTokens: 65_536,
    supportsTools: false,
    inputPricePer1M: 3,
    outputPricePer1M: 12,
  },

  // ─── Google ─────────────────────────────────────────────────
  // Gemini 3 (new as of 2026)
  'gemini-3-pro-preview': {
    contextWindow: 2_097_152,
    maxOutputTokens: 16_384,
    supportsTools: true,
    inputPricePer1M: 2,
    outputPricePer1M: 12,
  },
  'gemini-3-flash-preview': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.5,
    outputPricePer1M: 3,
  },

  // Gemini 2.5
  'gemini-2.5-pro': {
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
  },
  'gemini-2.5-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.3,
    outputPricePer1M: 2.5,
  },

  // Gemini 2.0
  'gemini-2.0-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
  },
  'gemini-2.0-flash-exp': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0, // Free during preview
    outputPricePer1M: 0,
  },

  // Gemini 1.5 (legacy)
  'gemini-1.5-pro': {
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 1.25,
    outputPricePer1M: 5,
  },
  'gemini-1.5-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.075,
    outputPricePer1M: 0.3,
  },
  'gemini-1.5-flash-8b': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.0375,
    outputPricePer1M: 0.15,
  },

  // Gemini Flash-Lite (ultra-cheap)
  'gemini-flash-lite': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
  },
};

/** Conservative defaults for models not in the registry. */
const DEFAULT_META: ModelMeta = {
  contextWindow: 8_192,
  maxOutputTokens: 4_096,
  supportsTools: true,
  inputPricePer1M: 10,
  outputPricePer1M: 30,
};

/**
 * Look up metadata for a model.
 * Returns conservative defaults for unrecognized models.
 */
export function getModelMeta(model: string): ModelMeta {
  return MODEL_REGISTRY[model] ?? DEFAULT_META;
}

/**
 * Calculate the cost in USD for a given token usage.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const meta = getModelMeta(model);
  return (inputTokens * meta.inputPricePer1M + outputTokens * meta.outputPricePer1M) / 1_000_000;
}
