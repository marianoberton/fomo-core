/**
 * Model metadata registry.
 * Maps model identifiers to their capabilities (context window, pricing, features).
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
  'claude-opus-4-20250514': {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsTools: true,
    inputPricePer1M: 15,
    outputPricePer1M: 75,
  },
  'claude-sonnet-4-20250514': {
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsTools: true,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
  },
  'claude-sonnet-4-5-20250929': {
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsTools: true,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
  },
  'claude-haiku-3-5-20241022': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    inputPricePer1M: 0.8,
    outputPricePer1M: 4,
  },

  // ─── OpenAI ─────────────────────────────────────────────────
  'gpt-4o': {
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
  'gpt-4.1-nano': {
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    supportsTools: true,
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
  },

  // ─── Google ─────────────────────────────────────────────────
  'gemini-2.5-pro': {
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
  },
  'gemini-2.5-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
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
