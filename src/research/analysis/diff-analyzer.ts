/**
 * Diff Analyzer — extracts structured diff fields from L5 analysis output.
 *
 * The LLM (via analyzer.ts) already detects changes between the current and
 * previous transcript and returns them in `significantChanges`, `improvements`,
 * `regressions`, and `changesFromPrevious`. This module provides:
 *
 *  1. `parseDiffFields` — validates and extracts the L5-specific fields from
 *     a raw parsed analysis object.
 *  2. `assessSignificance` — deterministic heuristic: marks significantChanges=true
 *     when score regression > 2 pts OR a capability appears in regressions.
 *
 * The analyzer.ts orchestrator uses these helpers when persisting L5 analyses.
 */
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ResearchError } from '../errors.js';

// ─── Public types ──────────────────────────────────────────────────

export interface DiffFields {
  changesFromPrevious: string | null;
  significantChanges: boolean;
  improvements: string[];
  regressions: string[];
}

export interface DimensionDelta {
  key: string;
  prevScore: number;
  newScore: number;
  delta: number;
}

export interface CapabilityChange {
  capability: string;
  change: 'added' | 'removed' | 'unchanged';
}

export interface AnalysisDiff {
  fields: DiffFields;
  dimensionDeltas: DimensionDelta[];
  capabilityChanges: CapabilityChange[];
}

// ─── Score threshold for "significant" ────────────────────────────

const SIGNIFICANT_SCORE_DROP = 2;

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Parse and validate the L5-specific diff fields from a raw LLM response
 * object. Returns `err` if required fields are missing or malformed.
 */
export function parseDiffFields(
  raw: Record<string, unknown>,
): Result<DiffFields, ResearchError> {
  const significantChanges =
    typeof raw['significantChanges'] === 'boolean' ? raw['significantChanges'] : false;

  const improvements = Array.isArray(raw['improvements'])
    ? (raw['improvements'] as unknown[])
        .filter((x): x is string => typeof x === 'string')
    : [];

  const regressions = Array.isArray(raw['regressions'])
    ? (raw['regressions'] as unknown[])
        .filter((x): x is string => typeof x === 'string')
    : [];

  const changesFromPrevious =
    typeof raw['changesFromPrevious'] === 'string' ? raw['changesFromPrevious'] : null;

  return ok({ changesFromPrevious, significantChanges, improvements, regressions });
}

/**
 * Compute per-dimension score deltas between the previous analysis scores
 * and the new ones. Only dimensions present in both analyses are included.
 */
export function computeDimensionDeltas(
  prevScores: Record<string, { score: number }> | null | undefined,
  newScores: Record<string, { score: number }> | null | undefined,
): DimensionDelta[] {
  if (!prevScores || !newScores) return [];

  const deltas: DimensionDelta[] = [];
  for (const key of Object.keys(newScores)) {
    const prev = prevScores[key];
    const next = newScores[key];
    if (prev !== undefined && next !== undefined) {
      deltas.push({
        key,
        prevScore: prev.score,
        newScore: next.score,
        delta: next.score - prev.score,
      });
    }
  }
  return deltas;
}

/**
 * Derive capability changes by comparing previous and new capabilityMaps.
 */
export function computeCapabilityChanges(
  prevMap: Record<string, boolean> | null | undefined,
  newMap: Record<string, boolean> | null | undefined,
): CapabilityChange[] {
  if (!prevMap && !newMap) return [];
  const prev = prevMap ?? {};
  const next = newMap ?? {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changes: CapabilityChange[] = [];

  for (const cap of allKeys) {
    const hadIt = prev[cap] === true;
    const hasIt = next[cap] === true;
    if (!hadIt && hasIt) {
      changes.push({ capability: cap, change: 'added' });
    } else if (hadIt && !hasIt) {
      changes.push({ capability: cap, change: 'removed' });
    }
  }
  return changes;
}

/**
 * Deterministic significance override: if the LLM didn't flag it but we
 * detect a score drop > 2 pts or a capability was removed, force true.
 */
export function assessSignificance(
  diffFields: DiffFields,
  dimensionDeltas: DimensionDelta[],
  capabilityChanges: CapabilityChange[],
  prevScoreTotal: number | null,
  newScoreTotal: number | null,
): boolean {
  if (diffFields.significantChanges) return true;

  // Score-total regression
  if (prevScoreTotal !== null && newScoreTotal !== null) {
    if (prevScoreTotal - newScoreTotal > SIGNIFICANT_SCORE_DROP) return true;
  }

  // Any single dimension drop > threshold
  if (dimensionDeltas.some((d) => d.delta <= -SIGNIFICANT_SCORE_DROP)) return true;

  // Capability removed
  if (capabilityChanges.some((c) => c.change === 'removed')) return true;

  return false;
}

/**
 * Full diff pipeline: parse raw LLM output, compute deltas, assess significance.
 */
export function buildAnalysisDiff(params: {
  raw: Record<string, unknown>;
  prevScores: Record<string, { score: number }> | null | undefined;
  newScores: Record<string, { score: number }> | null | undefined;
  prevCapabilityMap: Record<string, boolean> | null | undefined;
  newCapabilityMap: Record<string, boolean> | null | undefined;
  prevScoreTotal: number | null;
  newScoreTotal: number | null;
}): Result<AnalysisDiff, ResearchError> {
  const fieldsResult = parseDiffFields(params.raw);
  if (!fieldsResult.ok) return err(fieldsResult.error);

  const dimensionDeltas = computeDimensionDeltas(params.prevScores, params.newScores);
  const capabilityChanges = computeCapabilityChanges(
    params.prevCapabilityMap,
    params.newCapabilityMap,
  );

  const significantChanges = assessSignificance(
    fieldsResult.value,
    dimensionDeltas,
    capabilityChanges,
    params.prevScoreTotal,
    params.newScoreTotal,
  );

  return ok({
    fields: { ...fieldsResult.value, significantChanges },
    dimensionDeltas,
    capabilityChanges,
  });
}
