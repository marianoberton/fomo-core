/**
 * ResearchAnalyzer unit tests.
 *
 * Level 1: happy-path — LLM returns valid JSON → analysis persisted
 * Level 2: degraded — LLM returns invalid JSON → partial coercion
 * Level 3: session not found → returns err
 * Level 4: LLM throws → returns err
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchAnalyzer } from './analyzer.js';
import type { ResearchSessionId } from '../types.js';

// ─── LLM mock ────────────────────────────────────────────────────

vi.mock('@/providers/anthropic.js', () => ({
  createAnthropicProvider: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));

import { createAnthropicProvider } from '@/providers/anthropic.js';

// ─── Helpers ─────────────────────────────────────────────────────

const VALID_L1_RESPONSE = JSON.stringify({
  agentName: 'Asistente Virtual',
  hasPresentationMenu: true,
  menuType: 'numbered',
  toneProfile: 'formal',
  toneNotes: 'Respuestas educadas, sin emojis.',
  usesEmoji: false,
  responseTimeP50Ms: 1200,
  responseTimeP95Ms: 3500,
  hasProactiveReengage: false,
  reengageTimeMs: null,
  languagesDetected: ['es'],
  scores: {
    clarity: { score: 7, justification: 'Respuestas claras y concisas.' },
  },
  bestTurnOrder: 2,
  bestTurnText: '¿En qué puedo ayudarte hoy?',
  bestTurnJustification: 'Presentación clara del menú.',
  worstTurnOrder: 3,
  worstTurnText: 'No entiendo tu consulta.',
  worstTurnJustification: 'Respuesta genérica sin intentar resolver.',
  keyStrengths: ['Rápido', 'Claro'],
  keyWeaknesses: ['Sin escalamiento humano'],
  uniqueCapabilities: [],
  thingsToReplicate: ['Menú inicial numerado'],
  thingsToAvoid: ['Respuestas genéricas'],
  executiveSummary: 'Agente básico con menú numerado y tono formal.',
});

function makeAsyncGenerator(events: unknown[]) {
  return async function* () {
    for (const e of events) yield e;
  };
}

function buildLlmEvents(text: string) {
  return [
    { type: 'message_start', messageId: 'msg-1' },
    { type: 'content_delta', text },
    { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 200 } },
  ];
}

function buildMockPrisma(sessionOverrides?: Record<string, unknown>) {
  const defaultSession = {
    id: 'sess-1',
    targetId: 'tgt-1',
    scriptId: 'script-1',
    status: 'completed',
    turns: [
      {
        id: 'turn-1',
        turnOrder: 1,
        direction: 'outbound',
        message: 'Hola, ¿podés ayudarme?',
        latencyMs: null,
        isTimeout: false,
        timestamp: new Date('2026-01-01T10:00:00Z'),
      },
      {
        id: 'turn-2',
        turnOrder: 1,
        direction: 'inbound',
        message: 'Hola, ¿en qué puedo ayudarte hoy?',
        latencyMs: 1200,
        isTimeout: false,
        timestamp: new Date('2026-01-01T10:00:01Z'),
      },
    ],
    target: {
      id: 'tgt-1',
      name: 'Empresa Test',
      company: 'Test SA',
      country: 'AR',
      verticalSlug: 'automotriz',
      vertical: {
        id: 'vert-1',
        slug: 'automotriz',
        name: 'Automotriz',
        analysisInstructions: 'Evalúa el agente desde perspectiva automotriz.',
        scoringRubric: {
          dimensions: [
            { key: 'clarity', label: 'Claridad', weight: 1.0 },
          ],
        },
      },
    },
    script: {
      id: 'script-1',
      name: 'L1 Automotriz',
      objective: 'Evaluar superficie del agente',
      level: 'L1_SURFACE',
    },
    ...(sessionOverrides ?? {}),
  };

  return {
    researchSession: {
      findUnique: vi.fn().mockResolvedValue(defaultSession),
    },
    researchAnalysis: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
}

function buildMockAnalysisRepo() {
  return {
    create: vi.fn().mockImplementation((data: unknown) =>
      Promise.resolve({
        id: 'analysis-1',
        sessionId: 'sess-1',
        analyzedAt: new Date(),
        ...(data as Record<string, unknown>),
      }),
    ),
    findBySession: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    listByVertical: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('ResearchAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: calls LLM, parses valid JSON, persists analysis', async () => {
    const mockCreate = vi.mocked(createAnthropicProvider);
    mockCreate.mockReturnValue({
      id: 'anthropic:test',
      displayName: 'Test',
      chat: makeAsyncGenerator(buildLlmEvents(VALID_L1_RESPONSE)) as never,
      countTokens: vi.fn(),
      getContextWindow: vi.fn().mockReturnValue(100_000),
      supportsToolUse: vi.fn().mockReturnValue(true),
      formatTools: vi.fn().mockReturnValue([]),
      formatToolResult: vi.fn(),
    });

    const prisma = buildMockPrisma();
    const analysisRepo = buildMockAnalysisRepo();
    const logger = buildLogger();

    const analyzer = createResearchAnalyzer({
      prisma: prisma as never,
      analysisRepo: analysisRepo as never,
      anthropicApiKey: 'test-key',
      logger: logger as never,
    });

    const result = await analyzer.analyze('sess-1' as ResearchSessionId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(analysisRepo.create).toHaveBeenCalledOnce();
    const createArg = analysisRepo.create.mock.calls[0]?.[0];
    expect(createArg).toMatchObject({
      sessionId: 'sess-1',
      toneProfile: 'formal',
      executiveSummary: expect.stringContaining('Agente básico'),
      llmModel: 'claude-haiku-4-5-20251001',
      llmInputTokens: 100,
      llmOutputTokens: 200,
    });
    expect(createArg?.degraded).toBeFalsy();
  });

  it('uses modelOverride when provided', async () => {
    const mockCreate = vi.mocked(createAnthropicProvider);
    mockCreate.mockReturnValue({
      id: 'anthropic:override',
      displayName: 'Override',
      chat: makeAsyncGenerator(buildLlmEvents(VALID_L1_RESPONSE)) as never,
      countTokens: vi.fn(),
      getContextWindow: vi.fn().mockReturnValue(100_000),
      supportsToolUse: vi.fn().mockReturnValue(true),
      formatTools: vi.fn().mockReturnValue([]),
      formatToolResult: vi.fn(),
    });

    const analyzer = createResearchAnalyzer({
      prisma: buildMockPrisma() as never,
      analysisRepo: buildMockAnalysisRepo() as never,
      anthropicApiKey: 'test-key',
      logger: buildLogger() as never,
    });

    await analyzer.analyze('sess-1' as ResearchSessionId, { modelOverride: 'claude-opus-4-6' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' }),
    );
  });

  it('degrades gracefully when LLM returns invalid JSON', async () => {
    const mockCreate = vi.mocked(createAnthropicProvider);
    mockCreate.mockReturnValue({
      id: 'anthropic:test',
      displayName: 'Test',
      chat: makeAsyncGenerator(buildLlmEvents('This is not JSON at all')) as never,
      countTokens: vi.fn(),
      getContextWindow: vi.fn().mockReturnValue(100_000),
      supportsToolUse: vi.fn().mockReturnValue(true),
      formatTools: vi.fn().mockReturnValue([]),
      formatToolResult: vi.fn(),
    });

    const analysisRepo = buildMockAnalysisRepo();

    const analyzer = createResearchAnalyzer({
      prisma: buildMockPrisma() as never,
      analysisRepo: analysisRepo as never,
      anthropicApiKey: 'test-key',
      logger: buildLogger() as never,
    });

    const result = await analyzer.analyze('sess-1' as ResearchSessionId);

    expect(result.ok).toBe(true);
    const createArg = analysisRepo.create.mock.calls[0]?.[0];
    expect(createArg?.degraded).toBe(true);
  });

  it('returns err when session not found', async () => {
    const prisma = {
      researchSession: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      researchAnalysis: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const analyzer = createResearchAnalyzer({
      prisma: prisma as never,
      analysisRepo: buildMockAnalysisRepo() as never,
      anthropicApiKey: 'test-key',
      logger: buildLogger() as never,
    });

    const result = await analyzer.analyze('missing' as ResearchSessionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.researchCode).toBe('SCRIPT_INVALID');
  });

  it('returns err when LLM throws', async () => {
    const mockCreate = vi.mocked(createAnthropicProvider);
    mockCreate.mockReturnValue({
      id: 'anthropic:test',
      displayName: 'Test',
      chat: (async function* () {
        throw new Error('API error');
      }) as never,
      countTokens: vi.fn(),
      getContextWindow: vi.fn().mockReturnValue(100_000),
      supportsToolUse: vi.fn().mockReturnValue(true),
      formatTools: vi.fn().mockReturnValue([]),
      formatToolResult: vi.fn(),
    });

    const analyzer = createResearchAnalyzer({
      prisma: buildMockPrisma() as never,
      analysisRepo: buildMockAnalysisRepo() as never,
      anthropicApiKey: 'test-key',
      logger: buildLogger() as never,
    });

    const result = await analyzer.analyze('sess-1' as ResearchSessionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.researchCode).toBe('ANALYSIS_PARSE_FAILED');
  });

  it('links previousVersionId when re-analyzing', async () => {
    const mockCreate = vi.mocked(createAnthropicProvider);
    mockCreate.mockReturnValue({
      id: 'anthropic:test',
      displayName: 'Test',
      chat: makeAsyncGenerator(buildLlmEvents(VALID_L1_RESPONSE)) as never,
      countTokens: vi.fn(),
      getContextWindow: vi.fn().mockReturnValue(100_000),
      supportsToolUse: vi.fn().mockReturnValue(true),
      formatTools: vi.fn().mockReturnValue([]),
      formatToolResult: vi.fn(),
    });

    const existingAnalysis = { id: 'prev-analysis-1' };
    const analysisRepo = buildMockAnalysisRepo();
    analysisRepo.findBySession.mockResolvedValue(existingAnalysis as never);

    const analyzer = createResearchAnalyzer({
      prisma: buildMockPrisma() as never,
      analysisRepo: analysisRepo as never,
      anthropicApiKey: 'test-key',
      logger: buildLogger() as never,
    });

    await analyzer.analyze('sess-1' as ResearchSessionId);

    const createArg = analysisRepo.create.mock.calls[0]?.[0];
    expect(createArg?.previousVersionId).toBe('prev-analysis-1');
  });
});
