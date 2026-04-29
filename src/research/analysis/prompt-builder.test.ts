import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt } from './prompt-builder.js';
import type { AnalysisPromptInput, TranscriptTurn } from './prompt-builder.js';
import type { ScoringRubric } from '../types.js';

const rubric: ScoringRubric = {
  dimensions: [
    { key: 'tone', label: 'Tono', weight: 0.5 },
    { key: 'speed', label: 'Velocidad', weight: 0.5 },
  ],
};

const turns: TranscriptTurn[] = [
  {
    turnOrder: 1,
    direction: 'outbound',
    message: 'Hola, ¿qué autos tienen disponibles?',
    latencyMs: null,
    isTimeout: false,
    timestamp: new Date('2026-01-01T10:00:00Z'),
  },
  {
    turnOrder: 2,
    direction: 'inbound',
    message: 'Hola! 😊 Tenemos varios modelos disponibles. ¿Qué te interesa?',
    latencyMs: 800,
    isTimeout: false,
    timestamp: new Date('2026-01-01T10:00:01Z'),
  },
  {
    turnOrder: 3,
    direction: 'outbound',
    message: '¿Tienen el Cronos?',
    latencyMs: null,
    isTimeout: false,
    timestamp: new Date('2026-01-01T10:00:05Z'),
  },
  {
    turnOrder: 4,
    direction: 'inbound',
    message: 'Sí, el Cronos está disponible en versiones Drive y Like.',
    latencyMs: 1200,
    isTimeout: false,
    timestamp: new Date('2026-01-01T10:00:07Z'),
  },
];

const baseInput: AnalysisPromptInput = {
  turns,
  vertical: {
    slug: 'automotriz',
    name: 'Automotriz',
    analysisInstructions: 'Enfocate en detectar si el agente tiene acceso al stock real.',
    scoringRubric: rubric,
  },
  level: 'L1_SURFACE',
  target: { name: 'Auto SA', company: 'Auto SA', country: 'AR' },
  script: { name: 'l1-onboarding-baseline', objective: 'Medir tono y tiempo de respuesta', level: 'L1_SURFACE' },
};

describe('buildAnalysisPrompt', () => {
  it('returns system and user strings', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.system.length).toBeGreaterThan(100);
    expect(result.user.length).toBeGreaterThan(100);
  });

  it('system includes vertical analysis instructions', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.system).toContain('Enfocate en detectar si el agente tiene acceso al stock real.');
  });

  it('system instructs JSON-only response', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.system).toContain('ÚNICAMENTE con un JSON válido');
  });

  it('user includes transcript turns with direction indicators', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.user).toContain('[INVESTIGADOR]');
    expect(result.user).toContain('[AGENTE]');
    expect(result.user).toContain('Hola, ¿qué autos tienen disponibles?');
    expect(result.user).toContain('Hola! 😊');
  });

  it('user includes latency values', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.user).toContain('+800ms');
    expect(result.user).toContain('+1200ms');
  });

  it('user includes computed timing metrics', () => {
    const result = buildAnalysisPrompt(baseInput);
    // avg of [800, 1200] = 1000
    expect(result.user).toContain('1000ms');
  });

  it('user includes target and script context', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.user).toContain('Auto SA');
    expect(result.user).toContain('l1-onboarding-baseline');
    expect(result.user).toContain('Medir tono y tiempo de respuesta');
  });

  it('user includes scoring rubric dimensions', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.user).toContain('Tono');
    expect(result.user).toContain('Velocidad');
    expect(result.user).toContain('tone');
    expect(result.user).toContain('speed');
  });

  it('user includes JSON schema block', () => {
    const result = buildAnalysisPrompt(baseInput);
    expect(result.user).toContain('toneProfile');
    expect(result.user).toContain('keyStrengths');
    expect(result.user).toContain('executiveSummary');
  });

  it('L2 schema includes capability fields', () => {
    const l2Input: AnalysisPromptInput = { ...baseInput, level: 'L2_CAPABILITIES' };
    const result = buildAnalysisPrompt(l2Input);
    expect(result.user).toContain('capabilityMap');
    expect(result.user).toContain('canTakeActions');
    expect(result.user).toContain('dataFreshness');
  });

  it('L3 schema includes architecture fields', () => {
    const l3Input: AnalysisPromptInput = { ...baseInput, level: 'L3_ARCHITECTURE' };
    const result = buildAnalysisPrompt(l3Input);
    expect(result.user).toContain('estimatedLlm');
    expect(result.user).toContain('hasRag');
    expect(result.user).toContain('hasFunctionCalling');
    expect(result.user).toContain('hasCrossSessionMemory');
  });

  it('L3+ includes architecture context section', () => {
    const l3Input: AnalysisPromptInput = { ...baseInput, level: 'L3_ARCHITECTURE' };
    const result = buildAnalysisPrompt(l3Input);
    expect(result.user).toContain('análisis de arquitectura');
    expect(result.user).toContain('RAG vs. respuestas estáticas');
  });

  it('L4 schema includes adversarial fields', () => {
    const l4Input: AnalysisPromptInput = { ...baseInput, level: 'L4_ADVERSARIAL' };
    const result = buildAnalysisPrompt(l4Input);
    expect(result.user).toContain('promptInjectionResistance');
    expect(result.user).toContain('handlesOffensiveInput');
  });

  it('L5 includes previous analysis when provided', () => {
    const l5Input: AnalysisPromptInput = {
      ...baseInput,
      level: 'L5_LONGITUDINAL',
      previousAnalysis: {
        analyzedAt: new Date('2025-12-01T00:00:00Z'),
        estimatedLlm: 'GPT-4',
        hasRag: true,
        scoreTotal: 7.5,
        keyStrengths: ['Respuesta rápida'],
        keyWeaknesses: ['Sin acciones reales'],
      },
    };
    const result = buildAnalysisPrompt(l5Input);
    expect(result.user).toContain('GPT-4');
    expect(result.user).toContain('7.5');
    expect(result.user).toContain('Respuesta rápida');
    expect(result.user).toContain('changesFromPrevious');
  });

  it('L5 handles missing previous analysis gracefully', () => {
    const l5Input: AnalysisPromptInput = { ...baseInput, level: 'L5_LONGITUDINAL' };
    const result = buildAnalysisPrompt(l5Input);
    expect(result.user).toContain('Sin referencia previa');
  });

  it('L5 does not include scoring rubric', () => {
    const l5Input: AnalysisPromptInput = { ...baseInput, level: 'L5_LONGITUDINAL' };
    const result = buildAnalysisPrompt(l5Input);
    expect(result.user).not.toContain('Rúbrica de scoring');
  });

  it('marks timeout turns in the transcript', () => {
    const timeoutTurns: TranscriptTurn[] = [
      ...turns,
      {
        turnOrder: 5,
        direction: 'inbound',
        message: '',
        latencyMs: null,
        isTimeout: true,
        timestamp: new Date('2026-01-01T10:01:00Z'),
      },
    ];
    const result = buildAnalysisPrompt({ ...baseInput, turns: timeoutTurns });
    expect(result.user).toContain('[TIMEOUT — sin respuesta]');
  });

  it('works without optional target and script fields', () => {
    const minimalInput: AnalysisPromptInput = {
      turns,
      vertical: baseInput.vertical,
      level: 'L1_SURFACE',
    };
    const result = buildAnalysisPrompt(minimalInput);
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.user).toContain('Automotriz');
  });
});
