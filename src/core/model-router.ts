/**
 * ModelRouter - Routes messages to the optimal model based on complexity.
 * Reduces costs by 50-70% by using cheap models for simple tasks.
 *
 * Routing tiers:
 *   simple   → gemini-2.0-flash   (~$0.001/conv) - greetings, FAQ, yes/no
 *   standard → claude-haiku-4-5   (~$0.08/conv)  - sales, scheduling, product Qs
 *   complex  → claude-sonnet-4-5  (~$0.30/conv)  - complaints, negotiations, analysis
 */

import type { LLMProvider } from '@/providers/types.js';

// ─── Types ──────────────────────────────────────────────────────

export type MessageComplexity = 'simple' | 'standard' | 'complex';

export interface RoutingDecision {
  complexity: MessageComplexity;
  recommendedModel: string;
  confidence: number;
  reason: string;
}

export interface ModelRouterConfig {
  /** Model to use for classification (should be ultra-cheap, e.g. gemini-flash). */
  classifierModel: string;
  /** Model mappings per complexity level. */
  modelMap: {
    simple: string;   // e.g. 'gemini-2.0-flash'
    standard: string; // e.g. 'claude-haiku-4-5'
    complex: string;  // e.g. 'claude-sonnet-4-5'
  };
  /** Whether routing is active. When false, always returns 'standard'. */
  enabled: boolean;
}

export interface ModelRouter {
  /** Classify a message and return a routing decision. */
  classify(message: string, context?: string): Promise<RoutingDecision>;

  /** Get the configured model name for a given complexity level. */
  getModel(complexity: MessageComplexity): string;
}

// ─── Classification prompt ──────────────────────────────────────

const CLASSIFIER_SYSTEM = `You are a message complexity classifier. Your only job is to classify customer messages into one of three categories.

Rules:
- SIMPLE: Greetings, thanks, FAQ, yes/no questions, simple information requests (price checks, hours, etc.)
- STANDARD: Sales inquiries, scheduling requests, product questions that require context, lead qualification
- COMPLEX: Complaints, negotiations, multi-step problems, comparisons requiring analysis, requests for supervisors

Reply with EXACTLY one word: SIMPLE, STANDARD, or COMPLEX`;

function buildClassifierPrompt(message: string, context?: string): string {
  const contextPart = context ? `\nContext: ${context}` : '';
  return `Classify this customer message:${contextPart}\n\nMessage: "${message}"`;
}

// ─── Parser ─────────────────────────────────────────────────────

function parseComplexity(raw: string): { complexity: MessageComplexity; confidence: number } {
  const upper = raw.trim().toUpperCase();

  if (upper.startsWith('SIMPLE')) return { complexity: 'simple', confidence: 0.95 };
  if (upper.startsWith('COMPLEX')) return { complexity: 'complex', confidence: 0.95 };
  if (upper.startsWith('STANDARD')) return { complexity: 'standard', confidence: 0.95 };

  // Fallback: scan for keywords
  if (upper.includes('SIMPLE')) return { complexity: 'simple', confidence: 0.7 };
  if (upper.includes('COMPLEX')) return { complexity: 'complex', confidence: 0.7 };

  // Default to standard when uncertain
  return { complexity: 'standard', confidence: 0.5 };
}

// ─── Factory ────────────────────────────────────────────────────

/**
 * Create a ModelRouter backed by any LLMProvider for classification.
 *
 * @param config   Router configuration (model map, enabled flag, etc.)
 * @param provider LLM provider used for classification calls
 */
export function createModelRouter(config: ModelRouterConfig, provider: LLMProvider): ModelRouter {
  return {
    async classify(message: string, context?: string): Promise<RoutingDecision> {
      // When disabled, always route to standard
      if (!config.enabled) {
        return {
          complexity: 'standard',
          recommendedModel: config.modelMap.standard,
          confidence: 1.0,
          reason: 'Model routing disabled – using standard model',
        };
      }

      try {
        const userPrompt = buildClassifierPrompt(message, context);

        // Use a minimal chat call for classification
        let rawResponse = '';
        const stream = provider.chat({
          systemPrompt: CLASSIFIER_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
          tools: [],
          maxTokens: 10,
          temperature: 0,
        } as any);

        for await (const event of stream) {
          if ((event as { type: string; text?: string }).type === 'text_delta') {
            rawResponse += (event as { type: string; text?: string }).text ?? '';
          }
        }

        const { complexity, confidence } = parseComplexity(rawResponse);

        return {
          complexity,
          recommendedModel: config.modelMap[complexity],
          confidence,
          reason: `Classifier returned "${rawResponse.trim()}" for complexity="${complexity}"`,
        };
      } catch (err) {
        // On classifier failure, fall back to standard to avoid blocking
        return {
          complexity: 'standard',
          recommendedModel: config.modelMap.standard,
          confidence: 0.0,
          reason: `Classifier error – falling back to standard. Error: ${String(err)}`,
        };
      }
    },

    getModel(complexity: MessageComplexity): string {
      return config.modelMap[complexity];
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Default model map with sensible cost-optimized defaults.
 */
export const DEFAULT_MODEL_MAP: ModelRouterConfig['modelMap'] = {
  simple: 'gemini-2.0-flash',
  standard: 'claude-haiku-4-5',
  complex: 'claude-sonnet-4-5',
};

/**
 * Build a ModelRouterConfig with defaults, overridable per field.
 */
export function buildModelRouterConfig(
  overrides: Partial<ModelRouterConfig> = {},
): ModelRouterConfig {
  return {
    classifierModel: 'gemini-2.0-flash',
    modelMap: DEFAULT_MODEL_MAP,
    enabled: true,
    ...overrides,
  };
}
