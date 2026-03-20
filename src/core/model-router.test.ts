/**
 * model-router.test.ts
 *
 * Tests for ModelRouter: classification accuracy, fallback behaviour,
 * disabled mode, and the getModel helper.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createModelRouter,
  buildModelRouterConfig,
  DEFAULT_MODEL_MAP,
  type MessageComplexity,
  type ModelRouterConfig,
} from './model-router.js';
import type { LLMProvider } from '@/providers/types.js';

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Create a mock LLMProvider whose .chat() stream returns a single text_delta.
 */
function mockProvider(response: string): LLMProvider {
  return {
    id: 'mock',
    supportsToolUse: () => false,
    formatTools: (t: unknown[]) => t,
    chat: vi.fn(() => {
      async function* gen() {
        yield { type: 'text_delta' as const, text: response };
      }
      return gen();
    }),
  } as unknown as LLMProvider;
}

const defaultConfig: ModelRouterConfig = buildModelRouterConfig();

// ─── Classification tests ────────────────────────────────────────

describe('ModelRouter.classify', () => {
  const cases: { message: string; expected: MessageComplexity; llmReply: string }[] = [
    { message: 'Hola', expected: 'simple', llmReply: 'SIMPLE' },
    { message: 'Gracias!', expected: 'simple', llmReply: 'SIMPLE' },
    { message: 'Cuánto cuesta el producto X?', expected: 'standard', llmReply: 'STANDARD' },
    { message: 'Necesito agendar una demo para mi equipo de 50 personas', expected: 'standard', llmReply: 'STANDARD' },
    {
      message: 'Estoy muy enojado porque me cobraron de más y quiero hablar con un supervisor',
      expected: 'complex',
      llmReply: 'COMPLEX',
    },
    {
      message: 'Comparame las opciones A, B y C considerando precio, features y soporte',
      expected: 'complex',
      llmReply: 'COMPLEX',
    },
  ];

  for (const { message, expected, llmReply } of cases) {
    it(`classifies "${message.slice(0, 40)}" as ${expected}`, async () => {
      const provider = mockProvider(llmReply);
      const router = createModelRouter(defaultConfig, provider);

      const decision = await router.classify(message);

      expect(decision.complexity).toBe(expected);
      expect(decision.recommendedModel).toBe(DEFAULT_MODEL_MAP[expected]);
      expect(decision.confidence).toBeGreaterThan(0.8);
    });
  }
});

// ─── Disabled mode ───────────────────────────────────────────────

describe('ModelRouter disabled', () => {
  it('always returns standard when enabled=false', async () => {
    const config = buildModelRouterConfig({ enabled: false });
    const provider = mockProvider('SIMPLE');
    const router = createModelRouter(config, provider);

    const decision = await router.classify('Hola');

    expect(decision.complexity).toBe('standard');
    expect(decision.recommendedModel).toBe(DEFAULT_MODEL_MAP.standard);
    expect(decision.confidence).toBe(1.0);
    // Should NOT call the provider
    expect(provider.chat).not.toHaveBeenCalled();
  });
});

// ─── Fallback on error ───────────────────────────────────────────

describe('ModelRouter error fallback', () => {
  it('returns standard when the classifier throws', async () => {
    const brokenProvider = {
      id: 'broken',
      supportsToolUse: () => false,
      formatTools: (t: unknown) => t,
      chat: vi.fn(() => {
        async function* gen() {
          throw new Error('network error');
           
          yield { type: 'text_delta' as const, text: '' };
        }
        return gen();
      }),
    } as unknown as LLMProvider;

    const router = createModelRouter(defaultConfig, brokenProvider);
    const decision = await router.classify('Hola');

    expect(decision.complexity).toBe('standard');
    expect(decision.confidence).toBe(0.0);
    expect(decision.reason).toContain('error');
  });
});

// ─── getModel helper ─────────────────────────────────────────────

describe('ModelRouter.getModel', () => {
  it('returns correct model per complexity level', () => {
    const customConfig = buildModelRouterConfig({
      modelMap: {
        simple: 'gemini-2.0-flash',
        standard: 'claude-haiku-4-5',
        complex: 'claude-sonnet-4-5',
      },
    });
    const router = createModelRouter(customConfig, mockProvider('SIMPLE'));

    expect(router.getModel('simple')).toBe('gemini-2.0-flash');
    expect(router.getModel('standard')).toBe('claude-haiku-4-5');
    expect(router.getModel('complex')).toBe('claude-sonnet-4-5');
  });
});

// ─── buildModelRouterConfig defaults ────────────────────────────

describe('buildModelRouterConfig', () => {
  it('applies sensible defaults', () => {
    const config = buildModelRouterConfig();
    expect(config.enabled).toBe(true);
    expect(config.classifierModel).toBe('gemini-2.0-flash');
    expect(config.modelMap.simple).toBe('gemini-2.0-flash');
    expect(config.modelMap.standard).toBe('claude-haiku-4-5');
    expect(config.modelMap.complex).toBe('claude-sonnet-4-5');
  });

  it('allows partial overrides', () => {
    const config = buildModelRouterConfig({ enabled: false });
    expect(config.enabled).toBe(false);
    expect(config.classifierModel).toBe('gemini-2.0-flash'); // default preserved
  });
});
