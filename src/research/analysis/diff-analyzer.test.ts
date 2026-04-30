import { describe, it, expect } from 'vitest';
import {
  parseDiffFields,
  computeDimensionDeltas,
  computeCapabilityChanges,
  assessSignificance,
  buildAnalysisDiff,
} from './diff-analyzer.js';

// ─── Synthetic transcripts context ────────────────────────────────
//
// Transcript A (baseline): agent scores ~8/10 across dimensions,
//   has 'appointment-booking' and 'realtime-availability' capabilities.
// Transcript B (regression): agent scores ~5/10, lost 'realtime-availability'.

describe('parseDiffFields', () => {
  it('extracts all L5 fields from a well-formed LLM response', () => {
    const raw = {
      changesFromPrevious: 'El agente perdió capacidad de reservas en tiempo real.',
      significantChanges: true,
      improvements: ['Mejor manejo de objeciones'],
      regressions: ['Ya no ofrece disponibilidad en tiempo real'],
    };

    const result = parseDiffFields(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.significantChanges).toBe(true);
    expect(result.value.improvements).toHaveLength(1);
    expect(result.value.regressions).toHaveLength(1);
    expect(result.value.changesFromPrevious).toContain('reservas');
  });

  it('defaults to false/empty when fields are missing', () => {
    const result = parseDiffFields({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.significantChanges).toBe(false);
    expect(result.value.improvements).toEqual([]);
    expect(result.value.regressions).toEqual([]);
    expect(result.value.changesFromPrevious).toBeNull();
  });
});

describe('computeDimensionDeltas', () => {
  const prevScores = {
    responsiveness: { score: 8 },
    accuracy: { score: 7 },
    tone: { score: 9 },
  };

  const newScores = {
    responsiveness: { score: 5 },
    accuracy: { score: 7 },
    tone: { score: 9 },
  };

  it('detects score regression > 2 on responsiveness', () => {
    const deltas = computeDimensionDeltas(prevScores, newScores);
    const resp = deltas.find((d) => d.key === 'responsiveness');
    expect(resp).toBeDefined();
    expect(resp?.delta).toBe(-3);
  });

  it('returns empty array when either map is null', () => {
    expect(computeDimensionDeltas(null, newScores)).toEqual([]);
    expect(computeDimensionDeltas(prevScores, null)).toEqual([]);
  });
});

describe('computeCapabilityChanges', () => {
  it('detects capability removed', () => {
    const prev = { 'appointment-booking': true, 'realtime-availability': true };
    const next = { 'appointment-booking': true, 'realtime-availability': false };

    const changes = computeCapabilityChanges(prev, next);
    const removed = changes.find((c) => c.capability === 'realtime-availability');
    expect(removed?.change).toBe('removed');
  });

  it('detects capability added', () => {
    const prev = { 'appointment-booking': true };
    const next = { 'appointment-booking': true, 'payment-processing': true };

    const changes = computeCapabilityChanges(prev, next);
    const added = changes.find((c) => c.capability === 'payment-processing');
    expect(added?.change).toBe('added');
  });

  it('returns empty when both maps are null', () => {
    expect(computeCapabilityChanges(null, null)).toEqual([]);
  });
});

describe('assessSignificance', () => {
  const baseline: Parameters<typeof assessSignificance>[0] = {
    changesFromPrevious: null,
    significantChanges: false,
    improvements: [],
    regressions: [],
  };

  it('returns true when LLM already flagged it', () => {
    expect(
      assessSignificance({ ...baseline, significantChanges: true }, [], [], null, null),
    ).toBe(true);
  });

  it('returns true when score-total drops > 2 pts', () => {
    expect(assessSignificance(baseline, [], [], 8.5, 5.9)).toBe(true);
  });

  it('returns true when single dimension drops >= 2 pts', () => {
    const deltas = [{ key: 'accuracy', prevScore: 8, newScore: 5, delta: -3 }];
    expect(assessSignificance(baseline, deltas, [], null, null)).toBe(true);
  });

  it('returns true when capability removed', () => {
    const caps = [{ capability: 'realtime-availability', change: 'removed' as const }];
    expect(assessSignificance(baseline, [], caps, null, null)).toBe(true);
  });

  it('returns false for minor changes', () => {
    const deltas = [{ key: 'tone', prevScore: 8, newScore: 7.5, delta: -0.5 }];
    expect(assessSignificance(baseline, deltas, [], 8, 7.8)).toBe(false);
  });
});

describe('buildAnalysisDiff — full pipeline with synthetic transcripts', () => {
  // Scenario: second probe of a concesionaria agent shows score regression
  // and lost realtime-availability capability.

  const prevScores = {
    responsiveness: { score: 8 },
    product_knowledge: { score: 7 },
    closing: { score: 6 },
  };
  const newScores = {
    responsiveness: { score: 5 },
    product_knowledge: { score: 7 },
    closing: { score: 6 },
  };
  const prevCaps = { 'appointment-booking': true, 'realtime-availability': true };
  const newCaps = { 'appointment-booking': true, 'realtime-availability': false };

  it('detects capability removed and score regression, overrides significantChanges', () => {
    const raw = {
      changesFromPrevious: 'Respuestas más lentas, sin disponibilidad en tiempo real.',
      significantChanges: false, // LLM didn't flag it — heuristic should override
      improvements: [],
      regressions: ['Ya no informa disponibilidad en tiempo real'],
    };

    const result = buildAnalysisDiff({
      raw,
      prevScores,
      newScores,
      prevCapabilityMap: prevCaps,
      newCapabilityMap: newCaps,
      prevScoreTotal: 7.5,
      newScoreTotal: 6.0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.fields.significantChanges).toBe(true);
    expect(result.value.capabilityChanges.some((c) => c.change === 'removed')).toBe(true);
    expect(result.value.dimensionDeltas.some((d) => d.delta <= -2)).toBe(true);
  });

  it('does not flag significance for minor improvements', () => {
    const raw = {
      changesFromPrevious: 'Ligeramente más amigable en el tono.',
      significantChanges: false,
      improvements: ['Tono más cálido'],
      regressions: [],
    };

    const result = buildAnalysisDiff({
      raw,
      prevScores: { responsiveness: { score: 7 } },
      newScores: { responsiveness: { score: 7.5 } },
      prevCapabilityMap: null,
      newCapabilityMap: null,
      prevScoreTotal: 7.0,
      newScoreTotal: 7.3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fields.significantChanges).toBe(false);
  });
});
