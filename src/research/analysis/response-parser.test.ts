import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAnalysisResponse, extractJson, buildZodSchemaForLevel } from './response-parser.js';
import type { ScoringRubric } from '../types.js';

const rubric: ScoringRubric = {
  dimensions: [
    { key: 'tone', label: 'Tono', weight: 0.5 },
    { key: 'speed', label: 'Velocidad', weight: 0.5 },
  ],
};

// Minimal valid L1 JSON
const validL1 = {
  toneProfile: 'formal',
  executiveSummary: 'El agente es formal y responde rápido.',
  languagesDetected: ['es'],
  keyStrengths: ['Respuesta rápida'],
  keyWeaknesses: ['Sin acciones reales'],
  scores: {
    tone: { score: 7, justification: 'Tono formal consistente.' },
    speed: { score: 8, justification: 'Respuesta en menos de 1 segundo.' },
  },
};

const validL1Json = JSON.stringify(validL1);

// Valid L3 adds required architecture fields
const validL3 = {
  ...validL1,
  capabilityMap: { stock_lookup: true },
  canTakeActions: false,
  estimatedLlm: 'GPT-4',
  hasRag: true,
  hasFunctionCalling: false,
};

describe('extractJson', () => {
  it('extracts JSON from plain text', () => {
    const raw = '{"key": "value"}';
    expect(extractJson(raw)).toBe('{"key": "value"}');
  });

  it('extracts JSON from markdown code fence', () => {
    const raw = '```json\n{"key": "value"}\n```';
    expect(extractJson(raw)).toBe('{"key": "value"}');
  });

  it('extracts JSON from markdown fence without language tag', () => {
    const raw = '```\n{"key": "value"}\n```';
    expect(extractJson(raw)).toBe('{"key": "value"}');
  });

  it('extracts JSON when surrounded by text', () => {
    const raw = 'Here is the analysis:\n{"tone": "formal"}\nEnd.';
    expect(extractJson(raw)).toBe('{"tone": "formal"}');
  });

  it('handles nested objects correctly', () => {
    const raw = '{"outer": {"inner": 1}}';
    expect(extractJson(raw)).toBe('{"outer": {"inner": 1}}');
  });

  it('handles strings with braces inside them', () => {
    const raw = '{"message": "has {braces} inside"}';
    const result = extractJson(raw);
    expect(result).toBe('{"message": "has {braces} inside"}');
  });

  it('handles escaped quotes in strings', () => {
    const raw = '{"message": "say \\"hello\\""}';
    expect(extractJson(raw)).toBe('{"message": "say \\"hello\\""}');
  });

  it('returns null when no JSON is found', () => {
    expect(extractJson('No JSON here, just text.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJson('')).toBeNull();
  });

  it('extracts arrays', () => {
    const raw = 'Result: [1, 2, 3]';
    expect(extractJson(raw)).toBe('[1, 2, 3]');
  });
});

describe('buildZodSchemaForLevel', () => {
  it('L1 rejects when toneProfile is missing', () => {
    const schema = buildZodSchemaForLevel('L1_SURFACE');
    const result = schema.safeParse({ executiveSummary: 'ok' });
    expect(result.success).toBe(false);
  });

  it('L1 rejects when executiveSummary is missing', () => {
    const schema = buildZodSchemaForLevel('L1_SURFACE');
    const result = schema.safeParse({ toneProfile: 'formal' });
    expect(result.success).toBe(false);
  });

  it('L1 accepts valid minimal data', () => {
    const schema = buildZodSchemaForLevel('L1_SURFACE');
    const result = schema.safeParse(validL1);
    expect(result.success).toBe(true);
  });

  it('L2 rejects when capabilityMap is missing', () => {
    const schema = buildZodSchemaForLevel('L2_CAPABILITIES');
    const result = schema.safeParse(validL1);
    expect(result.success).toBe(false);
  });

  it('L3 rejects when estimatedLlm is missing', () => {
    const schema = buildZodSchemaForLevel('L3_ARCHITECTURE');
    const result = schema.safeParse({ ...validL1, capabilityMap: {}, canTakeActions: false });
    expect(result.success).toBe(false);
  });

  it('L3 accepts valid data with architecture fields', () => {
    const schema = buildZodSchemaForLevel('L3_ARCHITECTURE');
    const result = schema.safeParse(validL3);
    expect(result.success).toBe(true);
  });

  it('L5 rejects when changesFromPrevious is missing', () => {
    const schema = buildZodSchemaForLevel('L5_LONGITUDINAL');
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('L5 accepts valid data with changesFromPrevious', () => {
    const schema = buildZodSchemaForLevel('L5_LONGITUDINAL');
    const result = schema.safeParse({ changesFromPrevious: 'Sin cambios relevantes.', significantChanges: false });
    expect(result.success).toBe(true);
  });
});

describe('parseAnalysisResponse', () => {
  it('parses valid L1 JSON response', async () => {
    const result = await parseAnalysisResponse(validL1Json, 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toneProfile).toBe('formal');
    expect(result.value.executiveSummary).toBe('El agente es formal y responde rápido.');
    expect(result.value._degraded).toBeUndefined();
  });

  it('computes scoreTotal from rubric', async () => {
    const result = await parseAnalysisResponse(validL1Json, 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 0.5 * 7 + 0.5 * 8 = 7.5
    expect(result.value.scoreTotal).toBeCloseTo(7.5, 5);
  });

  it('sets scoreTotal to null when scores are absent', async () => {
    const noScores = { ...validL1, scores: undefined };
    const result = await parseAnalysisResponse(JSON.stringify(noScores), 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scoreTotal).toBeNull();
  });

  it('parses JSON wrapped in markdown fence', async () => {
    const wrapped = '```json\n' + validL1Json + '\n```';
    const result = await parseAnalysisResponse(wrapped, 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toneProfile).toBe('formal');
  });

  it('degrades gracefully when no JSON is found (no rePrompt)', async () => {
    const result = await parseAnalysisResponse('No JSON here.', 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._degraded).toBe(true);
    expect(result.value.toneProfile).toBeNull();
  });

  it('degrades gracefully when JSON is malformed (no rePrompt)', async () => {
    const result = await parseAnalysisResponse('{broken json', 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._degraded).toBe(true);
  });

  it('degrades after schema validation failure (no rePrompt)', async () => {
    // Valid JSON but missing required L1 fields
    const invalid = JSON.stringify({ agentName: 'Bot' });
    const result = await parseAnalysisResponse(invalid, 'L1_SURFACE', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._degraded).toBe(true);
  });

  it('uses rePrompt callback on parse failure and succeeds on second attempt', async () => {
    const rePrompt = vi.fn().mockResolvedValue(validL1Json);
    const result = await parseAnalysisResponse('not json', 'L1_SURFACE', rubric, { rePrompt });

    expect(rePrompt).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._degraded).toBeUndefined();
    expect(result.value.toneProfile).toBe('formal');
  });

  it('degrades after exhausting rePrompt retries', async () => {
    const rePrompt = vi.fn().mockResolvedValue('still not json');
    const result = await parseAnalysisResponse('not json', 'L1_SURFACE', rubric, {
      rePrompt,
      maxRetries: 1,
    });

    expect(rePrompt).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._degraded).toBe(true);
  });

  it('does not call rePrompt more than maxRetries times', async () => {
    const rePrompt = vi.fn().mockResolvedValue('still bad');
    await parseAnalysisResponse('bad', 'L1_SURFACE', rubric, { rePrompt, maxRetries: 1 });
    expect(rePrompt).toHaveBeenCalledTimes(1);
  });

  it('passes the issues list to rePrompt', async () => {
    const rePrompt = vi.fn().mockResolvedValue(validL1Json);
    await parseAnalysisResponse('no json', 'L1_SURFACE', rubric, { rePrompt });

    const [_content, issues] = rePrompt.mock.calls[0]! as [string, string[]];
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('L5 parse returns changesFromPrevious field', async () => {
    const l5Json = JSON.stringify({
      changesFromPrevious: 'Mejoró la velocidad de respuesta.',
      significantChanges: true,
      improvements: ['Latencia reducida a la mitad'],
      regressions: [],
    });
    const result = await parseAnalysisResponse(l5Json, 'L5_LONGITUDINAL', rubric);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changesFromPrevious).toBe('Mejoró la velocidad de respuesta.');
    expect(result.value.significantChanges).toBe(true);
    expect(result.value.improvements).toEqual(['Latencia reducida a la mitad']);
  });

  describe('rePrompt not called', () => {
    let rePrompt: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      rePrompt = vi.fn();
    });

    it('does not call rePrompt on success', async () => {
      await parseAnalysisResponse(validL1Json, 'L1_SURFACE', rubric, { rePrompt });
      expect(rePrompt).not.toHaveBeenCalled();
    });
  });
});
