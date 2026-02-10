import { describe, it, expect } from 'vitest';
import { getModelMeta, calculateCost } from './models.js';

describe('getModelMeta', () => {
  it('returns metadata for known Anthropic models', () => {
    const meta = getModelMeta('claude-sonnet-4-5-20250929');
    expect(meta.contextWindow).toBe(1_000_000);
    expect(meta.supportsTools).toBe(true);
    expect(meta.inputPricePer1M).toBe(3);
  });

  it('returns metadata for known OpenAI models', () => {
    const meta = getModelMeta('gpt-4o');
    expect(meta.contextWindow).toBe(128_000);
    expect(meta.supportsTools).toBe(true);
  });

  it('returns metadata for known Google models', () => {
    const meta = getModelMeta('gemini-2.5-pro');
    expect(meta.contextWindow).toBe(2_097_152);
  });

  it('returns conservative defaults for unknown models', () => {
    const meta = getModelMeta('some-unknown-model-v99');
    expect(meta.contextWindow).toBe(8_192);
    expect(meta.maxOutputTokens).toBe(4_096);
    expect(meta.supportsTools).toBe(true);
    // Defaults are conservative (higher pricing)
    expect(meta.inputPricePer1M).toBe(10);
    expect(meta.outputPricePer1M).toBe(30);
  });
});

describe('calculateCost', () => {
  it('calculates cost correctly for known models', () => {
    // gpt-4o: $2.5 / 1M input, $10 / 1M output
    const cost = calculateCost('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12.5);
  });

  it('returns 0 for zero tokens', () => {
    expect(calculateCost('gpt-4o', 0, 0)).toBe(0);
  });

  it('calculates fractional costs correctly', () => {
    // 1000 input tokens on gpt-4o: $2.5 * 1000 / 1M = $0.0025
    const cost = calculateCost('gpt-4o', 1000, 0);
    expect(cost).toBeCloseTo(0.0025);
  });
});
