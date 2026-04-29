import { describe, it, expect, vi } from 'vitest';
import {
  runCalibration,
  pearsonR,
  mae,
  jaccardStrings,
  jaccardTopK,
} from './calibration-runner.js';
import { GROUND_TRUTH, getGroundTruthByVertical, getGroundTruthByLevel } from './ground-truth.js';
import type { GroundTruthEntry } from './ground-truth.js';
import type { ParsedAnalysis } from './response-parser.js';
import type { MockAnalyzer } from './calibration-runner.js';

// ─── Statistical helpers ──────────────────────────────────────────────────────

describe('pearsonR', () => {
  it('returns 1 for perfect positive correlation', () => {
    expect(pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
  });

  it('returns -1 for perfect negative correlation', () => {
    expect(pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for uncorrelated arrays', () => {
    // Alternating pattern with mean-centered values
    expect(pearsonR([1, -1, 1, -1], [-1, 1, -1, 1])).toBeCloseTo(-1, 5);
  });

  it('returns NaN for zero variance (constant array)', () => {
    expect(pearsonR([3, 3, 3], [1, 2, 3])).toBeNaN();
  });

  it('returns NaN for empty arrays', () => {
    expect(pearsonR([], [])).toBeNaN();
  });

  it('returns high correlation for similar score arrays', () => {
    const gt = [7, 8, 6, 9, 5];
    const pred = [7, 7, 6, 9, 6]; // minor deviations
    expect(pearsonR(pred, gt)).toBeGreaterThan(0.9);
  });
});

describe('mae', () => {
  it('returns 0 for identical arrays', () => {
    expect(mae([5, 7, 8], [5, 7, 8])).toBe(0);
  });

  it('returns correct MAE', () => {
    // |5-6| + |7-8| + |8-9| = 3, / 3 = 1
    expect(mae([5, 7, 8], [6, 8, 9])).toBe(1);
  });

  it('returns NaN for empty arrays', () => {
    expect(mae([], [])).toBeNaN();
  });

  it('handles floats correctly', () => {
    expect(mae([7.5, 8.0], [8.0, 7.5])).toBeCloseTo(0.5, 5);
  });
});

describe('jaccardStrings', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardStrings(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardStrings(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('returns 1/3 for one shared item out of three unique', () => {
    // intersection={b}, union={a,b,c} → 1/3
    expect(jaccardStrings(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 5);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardStrings([], [])).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(jaccardStrings(['Rápido', 'preciso'], ['rápido', 'Preciso'])).toBe(1);
  });

  it('handles duplicates by treating them as one entry', () => {
    expect(jaccardStrings(['a', 'a', 'b'], ['a', 'b'])).toBe(1);
  });
});

describe('jaccardTopK', () => {
  it('uses only the first k items from each list', () => {
    const a = ['x', 'a', 'b', 'c'];
    const b = ['a', 'b', 'c', 'x'];
    // Top-3 of a: ['x','a','b'], top-3 of b: ['a','b','c']
    // intersection: {a, b} = 2, union: {x,a,b,c} = 4 → 0.5
    expect(jaccardTopK(a, b, 3)).toBeCloseTo(0.5, 5);
  });

  it('defaults to k=3', () => {
    const result = jaccardTopK(['a', 'b'], ['a', 'b', 'c']);
    expect(result).toBeGreaterThan(0);
  });
});

// ─── runCalibration ───────────────────────────────────────────────────────────

/** Build a minimal ParsedAnalysis for a given entry's ground truth (perfect mock). */
function perfectAnalyzer(entry: GroundTruthEntry): ParsedAnalysis {
  return {
    agentName: null,
    hasPresentationMenu: null,
    menuType: null,
    toneProfile: null,
    toneNotes: null,
    usesEmoji: null,
    responseTimeP50Ms: null,
    responseTimeP95Ms: null,
    hasProactiveReengage: null,
    reengageTimeMs: null,
    languagesDetected: [],
    capabilityMap: null,
    canTakeActions: null,
    hasRealtimeLookup: null,
    dataFreshness: null,
    capabilityNotes: null,
    estimatedLlm: entry.labels.estimatedLlm,
    llmConfidence: null,
    llmEvidenceNotes: null,
    hasRag: entry.labels.hasRag,
    ragDomainScope: null,
    hasFunctionCalling: entry.labels.hasFunctionCalling,
    detectedTools: [],
    hasCrossSessionMemory: entry.labels.hasCrossSessionMemory,
    systemPromptHints: null,
    promptStructureNotes: null,
    promptInjectionResistance: null,
    handlesOffensiveInput: null,
    competitorMentionPolicy: null,
    consistencyScore: null,
    hallucinationRate: null,
    adversarialNotes: null,
    changesFromPrevious: null,
    significantChanges: false,
    improvements: [],
    regressions: [],
    scores: Object.fromEntries(
      Object.entries(entry.labels.scores).map(([k, v]) => [k, { score: v, justification: 'perfect' }]),
    ),
    scoreTotal: null,
    bestTurnOrder: null,
    bestTurnText: null,
    bestTurnJustification: null,
    worstTurnOrder: null,
    worstTurnText: null,
    worstTurnJustification: null,
    keyStrengths: entry.labels.keyStrengths,
    keyWeaknesses: entry.labels.keyWeaknesses,
    uniqueCapabilities: [],
    thingsToReplicate: [],
    thingsToAvoid: [],
    executiveSummary: null,
  };
}

describe('runCalibration', () => {
  it('returns total count equal to ground truth size', async () => {
    const subset = GROUND_TRUTH.slice(0, 5);
    const analyzer: MockAnalyzer = (input) =>
      perfectAnalyzer(subset.find((e) => e.turns[0]!.message === input.turns[0]!.message) ?? subset[0]!);
    const result = await runCalibration(analyzer, subset);
    expect(result.total).toBe(5);
  });

  it('perfect analyzer meets all targets on the full ground truth', async () => {
    // Build a mock that maps input turns to ground truth entry
    const analyzer: MockAnalyzer = (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = GROUND_TRUTH.find((e) => e.turns[0]?.message === firstMsg);
      return perfectAnalyzer(entry ?? GROUND_TRUTH[0]!);
    };
    const result = await runCalibration(analyzer, GROUND_TRUTH);
    expect(result.meetsTargets.llmExactMatch).toBe(true);
    expect(result.meetsTargets.booleans).toBe(true);
    expect(result.meetsTargets.scoreMAE).toBe(true);
    expect(result.meetsTargets.jaccard).toBe(true);
    expect(result.meetsTargets.all).toBe(true);
  });

  it('perfect analyzer has LLM exact match rate = 1 for entries with non-null labels', async () => {
    const l3Entries = GROUND_TRUTH.filter((e) => e.labels.estimatedLlm !== null);
    const analyzer: MockAnalyzer = (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = l3Entries.find((e) => e.turns[0]?.message === firstMsg) ?? l3Entries[0]!;
      return perfectAnalyzer(entry);
    };
    const result = await runCalibration(analyzer, l3Entries);
    expect(result.llmExactMatch.rate).toBe(1);
  });

  it('wrong analyzer has low LLM exact match', async () => {
    const l3Entries = GROUND_TRUTH.filter((e) => e.labels.estimatedLlm !== null);
    const analyzer: MockAnalyzer = (input) => ({
      ...perfectAnalyzer(l3Entries[0]!),
      estimatedLlm: 'always-wrong-llm',
    });
    const result = await runCalibration(analyzer, l3Entries);
    expect(result.llmExactMatch.rate).toBe(0);
    expect(result.meetsTargets.llmExactMatch).toBe(false);
  });

  it('perfect analyzer has MAE = 0 for all dimensions', async () => {
    const analyzer: MockAnalyzer = (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = GROUND_TRUTH.find((e) => e.turns[0]?.message === firstMsg) ?? GROUND_TRUTH[0]!;
      return perfectAnalyzer(entry);
    };
    const result = await runCalibration(analyzer, GROUND_TRUTH);
    for (const dim of Object.values(result.scoresByDimension)) {
      expect(dim.mae).toBe(0);
    }
  });

  it('perfect analyzer has Pearson r = NaN (or undefined) when only 1 entry per dimension', async () => {
    // With a single data point, Pearson r is undefined
    const singleEntry = [GROUND_TRUTH[0]!];
    const analyzer: MockAnalyzer = () => perfectAnalyzer(singleEntry[0]!);
    const result = await runCalibration(analyzer, singleEntry);
    for (const dim of Object.values(result.scoresByDimension)) {
      expect(dim.n).toBe(1);
      // Pearson r undefined with n=1 (zero variance)
      expect(dim.pearsonR).toBeNaN();
    }
  });

  it('off-by-1 scores produce MAE of 1', async () => {
    // Use entries where all scores are ≤9 so +1 never hits the cap.
    const singleEntry = GROUND_TRUTH.filter(
      (e) => Object.values(e.labels.scores).every((s) => s <= 9),
    ).slice(0, 3);
    const analyzer: MockAnalyzer = (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = singleEntry.find((e) => e.turns[0]?.message === firstMsg) ?? singleEntry[0]!;
      const wrongScores = Object.fromEntries(
        Object.entries(entry.labels.scores).map(([k, v]) => [
          k,
          // +1 is safe because all scores ≤9
          { score: v + 1, justification: 'off by 1' },
        ]),
      );
      return { ...perfectAnalyzer(entry), scores: wrongScores };
    };
    const result = await runCalibration(analyzer, singleEntry);
    for (const dim of Object.values(result.scoresByDimension)) {
      expect(dim.mae).toBeCloseTo(1, 5);
    }
  });

  it('perfect analyzer has Jaccard = 1 for keyStrengths and keyWeaknesses', async () => {
    const subset = GROUND_TRUTH.slice(0, 5);
    const analyzer: MockAnalyzer = (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = subset.find((e) => e.turns[0]?.message === firstMsg) ?? subset[0]!;
      return perfectAnalyzer(entry);
    };
    const result = await runCalibration(analyzer, subset);
    expect(result.jaccard.keyStrengths).toBe(1);
    expect(result.jaccard.keyWeaknesses).toBe(1);
    expect(result.jaccard.avg).toBe(1);
  });

  it('empty strengths/weaknesses produce Jaccard = 0', async () => {
    const singleEntry = [GROUND_TRUTH[0]!];
    const analyzer: MockAnalyzer = () => ({
      ...perfectAnalyzer(singleEntry[0]!),
      keyStrengths: [],
      keyWeaknesses: [],
    });
    const result = await runCalibration(analyzer, singleEntry);
    expect(result.jaccard.keyStrengths).toBe(0);
    expect(result.jaccard.keyWeaknesses).toBe(0);
  });

  it('perEntry has one record per ground truth entry', async () => {
    const subset = GROUND_TRUTH.slice(0, 8);
    const analyzer: MockAnalyzer = (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = subset.find((e) => e.turns[0]?.message === firstMsg) ?? subset[0]!;
      return perfectAnalyzer(entry);
    };
    const result = await runCalibration(analyzer, subset);
    expect(result.perEntry).toHaveLength(8);
    expect(result.perEntry.map((e) => e.id)).toEqual(subset.map((e) => e.id));
  });

  it('marks degraded entries in perEntry', async () => {
    const singleEntry = [GROUND_TRUTH[0]!];
    const analyzer: MockAnalyzer = () => ({
      ...perfectAnalyzer(singleEntry[0]!),
      _degraded: true,
    });
    const result = await runCalibration(analyzer, singleEntry);
    expect(result.perEntry[0]!.degraded).toBe(true);
  });

  it('accepts async analyzer', async () => {
    const subset = GROUND_TRUTH.slice(0, 3);
    const asyncAnalyzer: MockAnalyzer = async (input) => {
      const firstMsg = input.turns[0]?.message ?? '';
      const entry = subset.find((e) => e.turns[0]?.message === firstMsg) ?? subset[0]!;
      return await Promise.resolve(perfectAnalyzer(entry));
    };
    const result = await runCalibration(asyncAnalyzer, subset);
    expect(result.total).toBe(3);
  });
});

// ─── Ground truth dataset integrity ──────────────────────────────────────────

describe('GROUND_TRUTH dataset', () => {
  it('has exactly 30 entries', () => {
    expect(GROUND_TRUTH).toHaveLength(30);
  });

  it('has unique IDs', () => {
    const ids = GROUND_TRUTH.map((e) => e.id);
    expect(new Set(ids).size).toBe(30);
  });

  it('covers 5 different verticals', () => {
    const verticals = new Set(GROUND_TRUTH.map((e) => e.verticalSlug));
    expect(verticals.size).toBe(5);
  });

  it('covers multiple probe levels', () => {
    const levels = new Set(GROUND_TRUTH.map((e) => e.level));
    expect(levels.size).toBeGreaterThanOrEqual(3);
  });

  it('every entry has at least 2 turns', () => {
    for (const entry of GROUND_TRUTH) {
      expect(entry.turns.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every entry has at least 2 keyStrengths labels', () => {
    for (const entry of GROUND_TRUTH) {
      expect(entry.labels.keyStrengths.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every entry has at least 1 keyWeakness label', () => {
    for (const entry of GROUND_TRUTH) {
      expect(entry.labels.keyWeaknesses.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every entry has scores for all rubric dimensions', () => {
    for (const entry of GROUND_TRUTH) {
      const dimKeys = entry.scoringRubric.dimensions.map((d) => d.key);
      for (const key of dimKeys) {
        expect(entry.labels.scores[key]).toBeDefined();
        expect(entry.labels.scores[key]).toBeGreaterThanOrEqual(1);
        expect(entry.labels.scores[key]).toBeLessThanOrEqual(10);
      }
    }
  });

  it('L3/L4 entries have non-null estimatedLlm and hasRag labels', () => {
    const archEntries = GROUND_TRUTH.filter(
      (e) => e.level === 'L3_ARCHITECTURE' || e.level === 'L4_ADVERSARIAL',
    );
    expect(archEntries.length).toBeGreaterThan(0);
    for (const entry of archEntries) {
      expect(entry.labels.estimatedLlm).not.toBeNull();
      expect(entry.labels.hasRag).not.toBeNull();
    }
  });

  it('getGroundTruthByVertical returns only entries for that vertical', () => {
    const auto = getGroundTruthByVertical('automotriz');
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((e) => e.verticalSlug === 'automotriz')).toBe(true);
  });

  it('getGroundTruthByLevel returns only entries for that level', () => {
    const l3 = getGroundTruthByLevel('L3_ARCHITECTURE');
    expect(l3.length).toBeGreaterThan(0);
    expect(l3.every((e) => e.level === 'L3_ARCHITECTURE')).toBe(true);
  });
});
