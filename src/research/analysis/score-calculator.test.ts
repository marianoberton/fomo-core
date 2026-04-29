import { describe, it, expect } from 'vitest';
import { calculateWeightedScore, validateRubricWeights } from './score-calculator.js';
import type { ScoringRubric } from '../types.js';
import type { ScoreDimensionResult } from './score-calculator.js';

const rubricEqual: ScoringRubric = {
  dimensions: [
    { key: 'tone', label: 'Tono', weight: 0.25 },
    { key: 'speed', label: 'Velocidad', weight: 0.25 },
    { key: 'accuracy', label: 'Precisión', weight: 0.25 },
    { key: 'helpfulness', label: 'Utilidad', weight: 0.25 },
  ],
};

const rubricUnequal: ScoringRubric = {
  dimensions: [
    { key: 'tone', label: 'Tono', weight: 0.4 },
    { key: 'speed', label: 'Velocidad', weight: 0.3 },
    { key: 'accuracy', label: 'Precisión', weight: 0.3 },
  ],
};

const makeScores = (map: Record<string, number>): Record<string, ScoreDimensionResult> =>
  Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, { score: v, justification: 'test' }]),
  );

describe('calculateWeightedScore', () => {
  it('returns simple average when all weights are equal', () => {
    const scores = makeScores({ tone: 8, speed: 6, accuracy: 7, helpfulness: 5 });
    const result = calculateWeightedScore(scores, rubricEqual);
    expect(result).toBeCloseTo(6.5, 5);
  });

  it('applies unequal weights correctly', () => {
    const scores = makeScores({ tone: 10, speed: 5, accuracy: 5 });
    // 0.4*10 + 0.3*5 + 0.3*5 = 4 + 1.5 + 1.5 = 7 / 1.0 = 7
    const result = calculateWeightedScore(scores, rubricUnequal);
    expect(result).toBeCloseTo(7, 5);
  });

  it('re-normalizes when some dimensions are missing', () => {
    const scores = makeScores({ tone: 10, speed: 10 });
    // Both present weight=0.25, total=0.5, sum=5, result=5/0.5=10
    const result = calculateWeightedScore(scores, rubricEqual);
    expect(result).toBeCloseTo(10, 5);
  });

  it('returns 0 when no rubric dimensions are present in scores', () => {
    const scores = makeScores({ unknown_key: 8 });
    const result = calculateWeightedScore(scores, rubricEqual);
    expect(result).toBe(0);
  });

  it('returns 0 for empty scores', () => {
    const result = calculateWeightedScore({}, rubricEqual);
    expect(result).toBe(0);
  });

  it('handles scores at boundary values (1 and 10)', () => {
    const scores = makeScores({ tone: 1, speed: 10, accuracy: 1, helpfulness: 10 });
    const result = calculateWeightedScore(scores, rubricEqual);
    expect(result).toBeCloseTo(5.5, 5);
  });

  it('ignores extra score dimensions not in rubric', () => {
    const scores = makeScores({ tone: 8, speed: 8, accuracy: 8, helpfulness: 8, extra: 1 });
    const result = calculateWeightedScore(scores, rubricEqual);
    expect(result).toBeCloseTo(8, 5);
  });
});

describe('validateRubricWeights', () => {
  it('returns valid for weights summing exactly to 1', () => {
    const result = validateRubricWeights(rubricEqual);
    expect(result.valid).toBe(true);
    expect(result.sum).toBeCloseTo(1.0, 5);
  });

  it('returns valid for weights summing to 1 with float precision', () => {
    const rubric: ScoringRubric = {
      dimensions: [
        { key: 'a', label: 'A', weight: 1 / 3 },
        { key: 'b', label: 'B', weight: 1 / 3 },
        { key: 'c', label: 'C', weight: 1 / 3 },
      ],
    };
    const result = validateRubricWeights(rubric);
    expect(result.valid).toBe(true);
  });

  it('returns invalid for weights summing to >1', () => {
    const rubric: ScoringRubric = {
      dimensions: [
        { key: 'a', label: 'A', weight: 0.6 },
        { key: 'b', label: 'B', weight: 0.6 },
      ],
    };
    const result = validateRubricWeights(rubric);
    expect(result.valid).toBe(false);
    expect(result.deviation).toBeGreaterThan(0.001);
  });

  it('returns invalid for empty dimensions', () => {
    const result = validateRubricWeights({ dimensions: [] });
    expect(result.valid).toBe(false);
    expect(result.sum).toBe(0);
  });
});
