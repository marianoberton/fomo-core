import type { ScoringRubric } from '../types.js';

export interface ScoreDimensionResult {
  /** Score from 1 to 10. */
  score: number;
  /** Free-text justification citing evidence from the transcript. */
  justification: string;
}

/**
 * Computes the rubric-weighted score from individual dimension scores.
 *
 * Dimensions absent from `scores` are skipped and their weight redistributed
 * proportionally — so a partial analysis still yields a meaningful number
 * rather than silently biasing toward zero.
 *
 * Returns 0 if no dimension from the rubric was found in scores.
 */
export function calculateWeightedScore(
  scores: Record<string, ScoreDimensionResult>,
  rubric: ScoringRubric,
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const dim of rubric.dimensions) {
    const result = scores[dim.key];
    if (result === undefined) continue;
    weightedSum += dim.weight * result.score;
    totalWeight += dim.weight;
  }

  if (totalWeight === 0) return 0;

  // Re-normalize to handle missing dimensions without distorting the scale.
  return weightedSum / totalWeight;
}

/**
 * Validates that all dimension weights in a rubric sum to approximately 1.0.
 * Returns the deviation from 1.0 (useful in tests and assertions).
 */
export function validateRubricWeights(rubric: ScoringRubric): {
  valid: boolean;
  sum: number;
  deviation: number;
} {
  const sum = rubric.dimensions.reduce((acc, d) => acc + d.weight, 0);
  const deviation = Math.abs(sum - 1.0);
  return { valid: deviation < 0.001, sum, deviation };
}
