/**
 * Calibration runner for the Analysis Engine.
 *
 * Runs a mock analyzer against the ground truth dataset and reports quality
 * metrics. Used to validate whether prompt changes or model updates maintain
 * acceptable accuracy before release.
 *
 * Targets (from NEXUS_INTELLIGENCE_PLAN.md §Calibración del Analyzer):
 *   - exact-match estimatedLlm ≥ 70%
 *   - exact-match booleans (hasRag, hasFunctionCalling, hasCrossSessionMemory) ≥ 85%
 *   - score MAE per dimension ≤ 1.0
 *   - score Pearson r per dimension ≥ 0.7
 *   - Jaccard keyStrengths/keyWeaknesses ≥ 0.5
 */
import type { ParsedAnalysis } from './response-parser.js';
import type { GroundTruthEntry } from './ground-truth.js';
import type { AnalysisPromptInput, TranscriptTurn } from './prompt-builder.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Synchronous or async analyzer function injected for calibration. */
export type MockAnalyzer = (
  input: AnalysisPromptInput,
) => ParsedAnalysis | Promise<ParsedAnalysis>;

/** Per-dimension score metrics. */
export interface DimensionMetrics {
  /** Mean absolute error (predicted vs ground truth score). */
  mae: number;
  /** Pearson correlation coefficient. NaN when variance is zero. */
  pearsonR: number;
  /** Number of entries where this dimension had both predicted and ground truth scores. */
  n: number;
}

/** Exact-match counts for key boolean fields. */
export interface BooleanMatchMetrics {
  hasRag: { correct: number; total: number; rate: number };
  hasFunctionCalling: { correct: number; total: number; rate: number };
  hasCrossSessionMemory: { correct: number; total: number; rate: number };
  /** Average match rate across the three booleans. */
  avg: number;
}

/** Jaccard overlap on top-K string lists. */
export interface JaccardMetrics {
  keyStrengths: number;
  keyWeaknesses: number;
  avg: number;
}

/** Full calibration result returned by `runCalibration`. */
export interface CalibrationResult {
  /** Total entries evaluated. */
  total: number;
  /** Entries where estimatedLlm matched exactly (null-null counts as match). */
  llmExactMatch: { correct: number; total: number; rate: number };
  booleans: BooleanMatchMetrics;
  scoresByDimension: Record<string, DimensionMetrics>;
  jaccard: JaccardMetrics;
  /** True if all targets from the plan are met. */
  meetsTargets: {
    llmExactMatch: boolean;
    booleans: boolean;
    scoreMAE: boolean;
    scorePearsonR: boolean;
    jaccard: boolean;
    /** All five targets met. */
    all: boolean;
  };
  /**
   * Per-entry detail — useful for finding which entries the analyzer
   * consistently gets wrong (candidates for few-shot examples).
   */
  perEntry: PerEntryResult[];
}

export interface PerEntryResult {
  id: string;
  verticalSlug: string;
  level: string;
  llmMatch: boolean | null;
  boolMatch: { hasRag: boolean | null; hasFunctionCalling: boolean | null; hasCrossSessionMemory: boolean | null };
  scoreDelta: Record<string, number | null>;
  strengthsJaccard: number;
  weaknessesJaccard: number;
  degraded: boolean;
}

// ─── Statistical helpers ─────────────────────────────────────────────────────

/**
 * Pearson r between two equal-length numeric arrays.
 * Returns NaN when one or both arrays have zero variance.
 */
export function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return NaN;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i]!, 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (den === 0) return NaN;
  return num / den;
}

/**
 * Mean absolute error between two equal-length numeric arrays.
 * Returns NaN for empty arrays.
 */
export function mae(predicted: number[], actual: number[]): number {
  const n = predicted.length;
  if (n === 0) return NaN;
  const sumAbsErr = predicted.reduce((acc, p, i) => acc + Math.abs(p - actual[i]!), 0);
  return sumAbsErr / n;
}

/**
 * Jaccard similarity between two string sets (exact string matching).
 *
 * When embedding-based similarity is available, the caller can pre-map
 * items to canonical cluster labels before passing them here.
 * Returns 0 for two empty sets (no overlap, no union — not 1).
 */
export function jaccardStrings(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  const setA = new Set(a.map((s) => s.toLowerCase().trim()));
  const setB = new Set(b.map((s) => s.toLowerCase().trim()));

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Jaccard on the top-K elements of each list.
 * Uses the first K items (order matters — top-K as ranked by the model).
 */
export function jaccardTopK(a: string[], b: string[], k = 3): number {
  return jaccardStrings(a.slice(0, k), b.slice(0, k));
}

// ─── Ground truth → AnalysisPromptInput adapter ─────────────────────────────

function entryToPromptInput(entry: GroundTruthEntry): AnalysisPromptInput {
  const turns: TranscriptTurn[] = entry.turns.map((t) => ({
    ...t,
    timestamp: new Date(), // calibration doesn't need real timestamps
  }));

  return {
    turns,
    vertical: {
      slug: entry.verticalSlug,
      name: entry.verticalName,
      analysisInstructions: `Analyze ${entry.verticalName} agent for calibration purposes.`,
      scoringRubric: entry.scoringRubric,
    },
    level: entry.level,
  };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

/**
 * Runs `analyzer` over every entry in `groundTruth` and computes quality metrics.
 *
 * The `analyzer` receives an `AnalysisPromptInput` and returns a `ParsedAnalysis`.
 * In production this is the real LLM-backed analyzer; in tests it's a deterministic mock.
 *
 * @example
 * ```ts
 * const result = await runCalibration(mockAnalyzer, GROUND_TRUTH);
 * expect(result.meetsTargets.all).toBe(true);
 * ```
 */
export async function runCalibration(
  analyzer: MockAnalyzer,
  groundTruth: GroundTruthEntry[],
): Promise<CalibrationResult> {
  // Accumulators for dimension-level metrics
  const dimPredicted: Record<string, number[]> = {};
  const dimActual: Record<string, number[]> = {};

  // Accumulators for exact-match metrics
  let llmCorrect = 0;
  let llmTotal = 0;
  const boolCounts = {
    hasRag: { correct: 0, total: 0 },
    hasFunctionCalling: { correct: 0, total: 0 },
    hasCrossSessionMemory: { correct: 0, total: 0 },
  };

  // Jaccard accumulators
  const strengthJaccards: number[] = [];
  const weaknessJaccards: number[] = [];

  const perEntry: PerEntryResult[] = [];

  // Run analyzer over all entries
  for (const entry of groundTruth) {
    const input = entryToPromptInput(entry);
    const predicted = await analyzer(input);

    // ── LLM exact match ────────────────────────────────────────────────────
    let llmMatch: boolean | null = null;
    if (entry.labels.estimatedLlm !== null || predicted.estimatedLlm !== null) {
      const match = predicted.estimatedLlm === entry.labels.estimatedLlm;
      llmMatch = match;
      llmCorrect += match ? 1 : 0;
      llmTotal++;
    }
    // Both null → skip (not applicable at this level)

    // ── Boolean exact match ────────────────────────────────────────────────
    const boolMatch: PerEntryResult['boolMatch'] = {
      hasRag: null,
      hasFunctionCalling: null,
      hasCrossSessionMemory: null,
    };

    for (const field of ['hasRag', 'hasFunctionCalling', 'hasCrossSessionMemory'] as const) {
      const gtVal = entry.labels[field];
      const predVal = predicted[field];
      if (gtVal !== null && predVal !== null) {
        const match = predVal === gtVal;
        boolCounts[field].correct += match ? 1 : 0;
        boolCounts[field].total++;
        boolMatch[field] = match;
      }
    }

    // ── Score MAE + Pearson ────────────────────────────────────────────────
    const scoreDelta: Record<string, number | null> = {};
    for (const [dimKey, gtScore] of Object.entries(entry.labels.scores)) {
      const predScore = predicted.scores?.[dimKey]?.score ?? null;
      if (predScore !== null) {
        if (!dimPredicted[dimKey]) {
          dimPredicted[dimKey] = [];
          dimActual[dimKey] = [];
        }
        dimPredicted[dimKey]!.push(predScore);
        dimActual[dimKey]!.push(gtScore);
        scoreDelta[dimKey] = Math.abs(predScore - gtScore);
      } else {
        scoreDelta[dimKey] = null;
      }
    }

    // ── Jaccard ────────────────────────────────────────────────────────────
    const strengthJacc = jaccardTopK(predicted.keyStrengths, entry.labels.keyStrengths);
    const weaknessJacc = jaccardTopK(predicted.keyWeaknesses, entry.labels.keyWeaknesses);
    strengthJaccards.push(strengthJacc);
    weaknessJaccards.push(weaknessJacc);

    perEntry.push({
      id: entry.id,
      verticalSlug: entry.verticalSlug,
      level: entry.level,
      llmMatch,
      boolMatch,
      scoreDelta,
      strengthsJaccard: strengthJacc,
      weaknessesJaccard: weaknessJacc,
      degraded: predicted._degraded === true,
    });
  }

  // ── Aggregate metrics ──────────────────────────────────────────────────────

  const scoresByDimension: Record<string, DimensionMetrics> = {};
  for (const [dimKey, predicted] of Object.entries(dimPredicted)) {
    const actual = dimActual[dimKey]!;
    scoresByDimension[dimKey] = {
      mae: mae(predicted, actual),
      pearsonR: pearsonR(predicted, actual),
      n: predicted.length,
    };
  }

  const boolAvg =
    [boolCounts.hasRag, boolCounts.hasFunctionCalling, boolCounts.hasCrossSessionMemory]
      .filter((c) => c.total > 0)
      .reduce((acc, c, _i, arr) => acc + c.correct / c.total / arr.length, 0);

  const avgStrengthJacc =
    strengthJaccards.length > 0
      ? strengthJaccards.reduce((a, b) => a + b, 0) / strengthJaccards.length
      : 0;
  const avgWeaknessJacc =
    weaknessJaccards.length > 0
      ? weaknessJaccards.reduce((a, b) => a + b, 0) / weaknessJaccards.length
      : 0;

  const llmRate = llmTotal > 0 ? llmCorrect / llmTotal : 0;

  // ── Targets check ──────────────────────────────────────────────────────────

  const TARGETS = {
    llmExactMatch: 0.7,
    booleans: 0.85,
    scoreMAE: 1.0,
    scorePearsonR: 0.7,
    jaccard: 0.5,
  };

  const allMAEMet = Object.values(scoresByDimension).every(
    (d) => isNaN(d.mae) || d.mae <= TARGETS.scoreMAE,
  );
  const allPearsonMet = Object.values(scoresByDimension).every(
    (d) => isNaN(d.pearsonR) || d.pearsonR >= TARGETS.scorePearsonR,
  );

  const llmTargetMet = llmTotal === 0 || llmRate >= TARGETS.llmExactMatch;
  const boolTargetMet = boolAvg >= TARGETS.booleans;
  const jaccardTargetMet =
    (avgStrengthJacc + avgWeaknessJacc) / 2 >= TARGETS.jaccard;

  const meetsTargets = {
    llmExactMatch: llmTargetMet,
    booleans: boolTargetMet,
    scoreMAE: allMAEMet,
    scorePearsonR: allPearsonMet,
    jaccard: jaccardTargetMet,
    all: llmTargetMet && boolTargetMet && allMAEMet && allPearsonMet && jaccardTargetMet,
  };

  return {
    total: groundTruth.length,
    llmExactMatch: { correct: llmCorrect, total: llmTotal, rate: llmRate },
    booleans: {
      hasRag: { ...boolCounts.hasRag, rate: boolCounts.hasRag.total > 0 ? boolCounts.hasRag.correct / boolCounts.hasRag.total : 0 },
      hasFunctionCalling: { ...boolCounts.hasFunctionCalling, rate: boolCounts.hasFunctionCalling.total > 0 ? boolCounts.hasFunctionCalling.correct / boolCounts.hasFunctionCalling.total : 0 },
      hasCrossSessionMemory: { ...boolCounts.hasCrossSessionMemory, rate: boolCounts.hasCrossSessionMemory.total > 0 ? boolCounts.hasCrossSessionMemory.correct / boolCounts.hasCrossSessionMemory.total : 0 },
      avg: boolAvg,
    },
    scoresByDimension,
    jaccard: {
      keyStrengths: avgStrengthJacc,
      keyWeaknesses: avgWeaknessJacc,
      avg: (avgStrengthJacc + avgWeaknessJacc) / 2,
    },
    meetsTargets,
    perEntry,
  };
}
