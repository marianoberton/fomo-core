/**
 * ResearchAnalysisRepository — unit tests with mocked PrismaClient.
 *
 * Level 1: create with required fields + defaults, findBySession, findById
 * Level 2: listByVertical uses nested where, update applies partial patch
 * Level 3: Integration — skipped (requires live DB)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchAnalysis } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createResearchAnalysisRepository } from './analysis-repository.js';
import type { ResearchAnalysisId } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockAnalysis(overrides?: Partial<ResearchAnalysis>): ResearchAnalysis {
  return {
    id: 'analysis-1',
    sessionId: 'session-1',
    version: 1,
    previousVersionId: null,
    rawJson: { level: 'L1_SURFACE' },
    llmModel: 'claude-haiku-4-5-20251001',
    llmInputTokens: 1200,
    llmOutputTokens: 400,
    llmCostUsd: new Prisma.Decimal('0.002000'),
    llmReasoningTrace: null,
    degraded: false,
    agentName: 'AssistBot',
    hasPresentationMenu: true,
    menuType: 'numeric',
    toneProfile: 'formal',
    toneNotes: null,
    usesEmoji: false,
    responseTimeP50Ms: 2100,
    responseTimeP95Ms: 4500,
    hasProactiveReengage: false,
    reengageTimeMs: null,
    languagesDetected: ['es'],
    capabilityMap: null,
    canTakeActions: null,
    hasRealtimeLookup: null,
    dataFreshness: null,
    capabilityNotes: null,
    estimatedLlm: null,
    llmConfidence: null,
    llmEvidenceNotes: null,
    hasRag: null,
    ragDomainScope: null,
    hasFunctionCalling: null,
    detectedTools: [],
    hasCrossSessionMemory: null,
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
    regressions: [],
    improvements: [],
    scores: null,
    scoreTotal: null,
    bestTurnOrder: null,
    bestTurnText: null,
    bestTurnJustification: null,
    worstTurnOrder: null,
    worstTurnText: null,
    worstTurnJustification: null,
    keyStrengths: [],
    keyWeaknesses: [],
    uniqueCapabilities: [],
    thingsToReplicate: [],
    thingsToAvoid: [],
    executiveSummary: null,
    analyzedAt: new Date('2026-01-01T12:00:00Z'),
    ...overrides,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    researchAnalysis: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

// ─── Level 1: Core CRUD ──────────────────────────────────────────

describe('ResearchAnalysisRepository — create / find', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchAnalysisRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchAnalysisRepository(
      prisma as unknown as Parameters<typeof createResearchAnalysisRepository>[0],
    );
  });

  it('create: passes required fields and defaults for arrays', async () => {
    const analysis = mockAnalysis();
    prisma.researchAnalysis.create.mockResolvedValue(analysis);

    await repo.create({
      sessionId: 'session-1',
      rawJson: { level: 'L1_SURFACE' },
      llmModel: 'claude-haiku-4-5-20251001',
    });

    const data = prisma.researchAnalysis.create.mock.calls[0]?.[0]?.data;
    expect(data?.sessionId).toBe('session-1');
    expect(data?.llmModel).toBe('claude-haiku-4-5-20251001');
    expect(data?.degraded).toBe(false);
    expect(data?.significantChanges).toBe(false);
    expect(data?.languagesDetected).toEqual([]);
    expect(data?.detectedTools).toEqual([]);
    expect(data?.regressions).toEqual([]);
    expect(data?.improvements).toEqual([]);
    expect(data?.keyStrengths).toEqual([]);
    expect(data?.keyWeaknesses).toEqual([]);
    expect(data?.thingsToReplicate).toEqual([]);
    expect(data?.thingsToAvoid).toEqual([]);
    expect(data?.uniqueCapabilities).toEqual([]);
  });

  it('create: passes optional L1 fields', async () => {
    const analysis = mockAnalysis();
    prisma.researchAnalysis.create.mockResolvedValue(analysis);

    await repo.create({
      sessionId: 'session-1',
      rawJson: {},
      llmModel: 'claude-haiku-4-5-20251001',
      agentName: 'TestBot',
      hasPresentationMenu: true,
      toneProfile: 'casual',
      responseTimeP50Ms: 1800,
      languagesDetected: ['es', 'en'],
    });

    const data = prisma.researchAnalysis.create.mock.calls[0]?.[0]?.data;
    expect(data?.agentName).toBe('TestBot');
    expect(data?.hasPresentationMenu).toBe(true);
    expect(data?.toneProfile).toBe('casual');
    expect(data?.responseTimeP50Ms).toBe(1800);
    expect(data?.languagesDetected).toEqual(['es', 'en']);
  });

  it('findBySession: uses unique lookup on sessionId', async () => {
    const analysis = mockAnalysis();
    prisma.researchAnalysis.findUnique.mockResolvedValue(analysis);

    const result = await repo.findBySession('session-1');

    expect(result).toEqual(analysis);
    expect(prisma.researchAnalysis.findUnique).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
    });
  });

  it('findById: calls findUnique with id', async () => {
    const analysis = mockAnalysis();
    prisma.researchAnalysis.findUnique.mockResolvedValue(analysis);

    await repo.findById('analysis-1' as ResearchAnalysisId);

    expect(prisma.researchAnalysis.findUnique).toHaveBeenCalledWith({
      where: { id: 'analysis-1' },
    });
  });
});

// ─── Level 2: listByVertical + update ────────────────────────────

describe('ResearchAnalysisRepository — listByVertical / update', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchAnalysisRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchAnalysisRepository(
      prisma as unknown as Parameters<typeof createResearchAnalysisRepository>[0],
    );
  });

  it('listByVertical: uses nested session.target.verticalSlug where clause', async () => {
    prisma.researchAnalysis.findMany.mockResolvedValue([]);

    await repo.listByVertical('automotriz');

    expect(prisma.researchAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          session: {
            target: { verticalSlug: 'automotriz' },
          },
        },
        take: 100,
      }),
    );
  });

  it('listByVertical: respects custom limit', async () => {
    prisma.researchAnalysis.findMany.mockResolvedValue([]);

    await repo.listByVertical('real-estate', 25);

    expect(prisma.researchAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
  });

  it('update: applies only provided fields (partial patch)', async () => {
    const updated = mockAnalysis({ scoreTotal: 0.82, executiveSummary: 'Good agent' });
    prisma.researchAnalysis.update.mockResolvedValue(updated);

    await repo.update('analysis-1' as ResearchAnalysisId, {
      scoreTotal: 0.82,
      executiveSummary: 'Good agent',
    });

    const data = prisma.researchAnalysis.update.mock.calls[0]?.[0]?.data;
    expect(data).toHaveProperty('scoreTotal', 0.82);
    expect(data).toHaveProperty('executiveSummary', 'Good agent');
    // Fields not passed should not appear
    expect(data).not.toHaveProperty('llmModel');
    expect(data).not.toHaveProperty('agentName');
  });

  it('update: handles scores as InputJsonValue', async () => {
    prisma.researchAnalysis.update.mockResolvedValue(mockAnalysis());

    await repo.update('analysis-1' as ResearchAnalysisId, {
      scores: { onboarding: 0.8, catalog_navigation: 0.7 },
    });

    const data = prisma.researchAnalysis.update.mock.calls[0]?.[0]?.data;
    expect(data?.scores).toEqual({ onboarding: 0.8, catalog_navigation: 0.7 });
  });
});

// ─── Level 3: Integration ─────────────────────────────────────────

describe.skip('ResearchAnalysisRepository — integration (requires DB)', () => {
  it('create → findBySession round-trip', () => {});
  it('listByVertical with real nested join', () => {});
});
