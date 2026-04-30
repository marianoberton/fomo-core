/**
 * Synthesizer tests.
 *
 * Level 1 — happy path with synthetic corpus
 * Level 2 — malformed JSON → re-prompt
 * Level 3 — budget exceeded → ANALYSIS_BUDGET_EXCEEDED
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchAnalysis } from '@prisma/client';
import { createSynthesizer } from './synthesizer.js';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@/providers/anthropic.js', () => ({
  createAnthropicProvider: vi.fn(),
}));

vi.mock('@/providers/models.js', () => ({
  getModelMeta: vi.fn().mockReturnValue({ inputPricePer1M: 15, outputPricePer1M: 75 }),
}));

import { createAnthropicProvider } from '@/providers/anthropic.js';

const mockCreateAnthropicProvider = vi.mocked(createAnthropicProvider);

// ─── Helpers ─────────────────────────────────────────────────────

function makeAnalysis(overrides?: Partial<ResearchAnalysis>): ResearchAnalysis {
  return {
    id: `analysis-${Math.random().toString(36).slice(2)}`,
    sessionId: 'session-1',
    version: 1,
    previousVersionId: null,
    rawJson: {},
    llmModel: 'claude-sonnet-4-6',
    llmInputTokens: 1000,
    llmOutputTokens: 500,
    llmCostUsd: null,
    llmReasoningTrace: null,
    degraded: false,
    agentName: 'TestBot',
    hasPresentationMenu: true,
    menuType: 'numbered',
    toneProfile: 'professional',
    toneNotes: null,
    usesEmoji: true,
    responseTimeP50Ms: 2000,
    responseTimeP95Ms: 5000,
    hasProactiveReengage: false,
    reengageTimeMs: null,
    languagesDetected: ['es'],
    capabilityMap: {},
    canTakeActions: true,
    hasRealtimeLookup: false,
    dataFreshness: null,
    capabilityNotes: null,
    estimatedLlm: 'gpt-4o',
    llmConfidence: 0.8,
    llmEvidenceNotes: null,
    hasRag: true,
    ragDomainScope: null,
    hasFunctionCalling: false,
    detectedTools: [],
    hasCrossSessionMemory: false,
    systemPromptHints: 'Uses a menu-based flow',
    promptStructureNotes: null,
    promptInjectionResistance: null,
    handlesOffensiveInput: null,
    competitorMentionPolicy: null,
    consistencyScore: null,
    hallucinationRate: null,
    adversarialNotes: null,
    changesFromPrevious: null,
    significantChanges: false,
    regressions: [],
    improvements: [],
    scores: {},
    scoreTotal: 7.5,
    bestTurnOrder: 1,
    bestTurnText: '¡Hola! ¿En qué te puedo ayudar?',
    bestTurnJustification: null,
    worstTurnOrder: null,
    worstTurnText: null,
    worstTurnJustification: null,
    keyStrengths: ['fast responses', 'clear menu'],
    keyWeaknesses: ['no escalation'],
    uniqueCapabilities: ['real-time stock'],
    thingsToReplicate: ['menu structure'],
    thingsToAvoid: ['long delays'],
    executiveSummary: 'Good bot overall.',
    analyzedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeSynthesisJson(): string {
  return JSON.stringify({
    insights: [
      {
        category: 'onboarding',
        title: 'Saludo personalizado efectivo',
        content: 'Los mejores agentes saludan con el nombre del asesor.',
        evidence: '7 de 8 agentes con score > 7',
        seenInCount: 7,
      },
    ],
    patterns: [
      {
        category: 'onboarding',
        patternText: '¡Hola {{nombre}}! Soy {{agente_name}}.',
        patternVariables: ['nombre', 'agente_name'],
        seenInCount: 5,
        avgScoreWhen: 8.1,
        notes: 'Visto en los top performers',
      },
    ],
  });
}

function buildMockPrisma(analyses: ResearchAnalysis[]) {
  const patternCreateFn = vi.fn().mockImplementation(async (data: { data: { verticalSlug: string; category: string } }) => ({
    id: `pattern-${Math.random().toString(36).slice(2)}`,
    ...data.data,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    rejectedReason: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
  }));

  return {
    researchVertical: {
      findUnique: vi.fn().mockResolvedValue({
        slug: 'automotriz',
        name: 'Automotriz',
        analysisInstructions: 'Analyze car dealer bots.',
        scoringRubric: { dimensions: [] },
      }),
    },
    researchAnalysis: {
      findMany: vi.fn().mockResolvedValue(analyses),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    intelligenceInsight: {
      create: vi.fn().mockImplementation(async (data: { data: { title: string } }) => ({
        id: `insight-${Math.random().toString(36).slice(2)}`,
        ...data.data,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        evidence: null,
        seenInCount: 1,
        rejectedReason: null,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
      })),
    },
    promptPattern: {
      create: patternCreateFn,
    },
    promptPatternVersion: {
      aggregate: vi.fn().mockResolvedValue({ _max: { versionNumber: null } }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockImplementation(async (data: { data: { patternText: string } }) => ({
        id: `ppv-${Math.random().toString(36).slice(2)}`,
        ...data.data,
        versionNumber: 1,
        isCurrent: true,
        createdAt: new Date(),
      })),
    },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        promptPattern: { create: patternCreateFn },
        promptPatternVersion: {
          aggregate: vi.fn().mockResolvedValue({ _max: { versionNumber: null } }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockImplementation(async () => ({ id: 'ppv-1', versionNumber: 1 })),
        },
      };
      return fn(txMock);
    }),
  };
}

function makeStreamingProvider(jsonText: string) {
  return {
    chat: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'content_delta', text: jsonText };
        yield { type: 'message_end', usage: { inputTokens: 1000, outputTokens: 500 } };
      })(),
    ),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Synthesizer — happy path', () => {
  it('produces insights and patterns from corpus of 5 analyses', async () => {
    const analyses = Array.from({ length: 5 }, () => makeAnalysis());
    const prisma = buildMockPrisma(analyses);

    mockCreateAnthropicProvider.mockReturnValue(makeStreamingProvider(makeSynthesisJson()) as never);

    const synth = createSynthesizer({ prisma: prisma as never, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never });
    const result = await synth.synthesizeVertical('automotriz');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.insightIds.length).toBe(1);
    expect(result.value.patternIds.length).toBe(1);
    expect(result.value.llmCostUsd).toBeGreaterThan(0);
  });
});

describe('Synthesizer — malformed JSON re-prompt', () => {
  it('re-prompts on malformed response and succeeds on corrected', async () => {
    const analyses = Array.from({ length: 5 }, () => makeAnalysis());
    const prisma = buildMockPrisma(analyses);

    let callCount = 0;
    mockCreateAnthropicProvider.mockImplementation(() => ({
      chat: vi.fn().mockReturnValue(
        (async function* () {
          callCount++;
          const text = callCount === 1 ? 'this is not json {broken' : makeSynthesisJson();
          yield { type: 'content_delta', text };
          yield { type: 'message_end', usage: { inputTokens: 500, outputTokens: 200 } };
        })(),
      ),
    }) as never);

    const synth = createSynthesizer({ prisma: prisma as never, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never });
    const result = await synth.synthesizeVertical('automotriz');

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it('returns ANALYSIS_PARSE_FAILED when both attempts fail', async () => {
    const analyses = Array.from({ length: 5 }, () => makeAnalysis());
    const prisma = buildMockPrisma(analyses);

    mockCreateAnthropicProvider.mockImplementation(() => ({
      chat: vi.fn().mockReturnValue(
        (async function* () {
          yield { type: 'content_delta', text: 'not json at all' };
          yield { type: 'message_end', usage: { inputTokens: 100, outputTokens: 50 } };
        })(),
      ),
    }) as never);

    const synth = createSynthesizer({ prisma: prisma as never, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never });
    const result = await synth.synthesizeVertical('automotriz');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.researchCode).toBe('ANALYSIS_PARSE_FAILED');
  });
});

describe('Synthesizer — budget exceeded', () => {
  it('returns ANALYSIS_BUDGET_EXCEEDED when LLM throws budget error', async () => {
    const analyses = Array.from({ length: 5 }, () => makeAnalysis());
    const prisma = buildMockPrisma(analyses);

    mockCreateAnthropicProvider.mockImplementation(() => ({
      chat: vi.fn().mockReturnValue(
        (async function* (): AsyncGenerator<never> {
          throw new Error('Monthly quota exceeded');
          // eslint-disable-next-line @typescript-eslint/no-unreachable
          yield* [];
        })(),
      ),
    }) as never);

    const synth = createSynthesizer({ prisma: prisma as never, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never });
    const result = await synth.synthesizeVertical('automotriz');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.researchCode).toBe('ANALYSIS_BUDGET_EXCEEDED');
  });
});

describe('Synthesizer — insufficient analyses', () => {
  it('returns SCRIPT_INVALID when fewer than 3 analyses', async () => {
    const prisma = buildMockPrisma([makeAnalysis(), makeAnalysis()]);

    const synth = createSynthesizer({ prisma: prisma as never, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never });
    const result = await synth.synthesizeVertical('automotriz');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.researchCode).toBe('SCRIPT_INVALID');
  });
});
