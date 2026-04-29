/**
 * ResearchTurnRepository — unit tests with mocked PrismaClient.
 *
 * Level 1: create, findByWahaMessageId (idempotency key), findLastOutbound
 * Level 2: listBySession ordering, direction filter
 * Level 3: Integration — skipped (requires live DB)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchTurn } from '@prisma/client';
import { createResearchTurnRepository } from './turn-repository.js';
import type { ResearchTurnId } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockTurn(overrides?: Partial<ResearchTurn>): ResearchTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    turnOrder: 1,
    direction: 'outbound',
    message: 'Hola, me interesa el Toyota Corolla',
    rawMessage: null,
    sanitized: false,
    redactionsCount: 0,
    timestamp: new Date('2026-01-01T10:00:00Z'),
    latencyMs: null,
    wahaMessageId: null,
    isTimeout: false,
    notes: null,
    ...overrides,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    researchTurn: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

// ─── Level 1: Core CRUD ──────────────────────────────────────────

describe('ResearchTurnRepository — create / find', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchTurnRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchTurnRepository(
      prisma as unknown as Parameters<typeof createResearchTurnRepository>[0],
    );
  });

  it('create: passes all required fields', async () => {
    const turn = mockTurn();
    prisma.researchTurn.create.mockResolvedValue(turn);

    const result = await repo.create({
      sessionId: 'session-1',
      turnOrder: 1,
      direction: 'outbound',
      message: 'Hola',
    });

    expect(result).toEqual(turn);
    expect(prisma.researchTurn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'session-1',
          turnOrder: 1,
          direction: 'outbound',
          message: 'Hola',
          sanitized: false,
          redactionsCount: 0,
          isTimeout: false,
        }),
      }),
    );
  });

  it('create: passes optional fields when provided', async () => {
    const turn = mockTurn({ wahaMessageId: 'waha-msg-123', latencyMs: 3200, sanitized: true });
    prisma.researchTurn.create.mockResolvedValue(turn);

    await repo.create({
      sessionId: 'session-1',
      turnOrder: 2,
      direction: 'inbound',
      message: 'Hola, bienvenido',
      wahaMessageId: 'waha-msg-123',
      latencyMs: 3200,
      sanitized: true,
      redactionsCount: 2,
      rawMessage: 'Original with PII',
    });

    const data = prisma.researchTurn.create.mock.calls[0]?.[0]?.data;
    expect(data?.wahaMessageId).toBe('waha-msg-123');
    expect(data?.latencyMs).toBe(3200);
    expect(data?.sanitized).toBe(true);
    expect(data?.redactionsCount).toBe(2);
    expect(data?.rawMessage).toBe('Original with PII');
  });

  it('findByWahaMessageId: uses unique lookup', async () => {
    const turn = mockTurn({ wahaMessageId: 'waha-123' });
    prisma.researchTurn.findUnique.mockResolvedValue(turn);

    const result = await repo.findByWahaMessageId('waha-123');

    expect(result).toEqual(turn);
    expect(prisma.researchTurn.findUnique).toHaveBeenCalledWith({
      where: { wahaMessageId: 'waha-123' },
    });
  });

  it('findByWahaMessageId: returns null when not found', async () => {
    prisma.researchTurn.findUnique.mockResolvedValue(null);
    const result = await repo.findByWahaMessageId('not-found');
    expect(result).toBeNull();
  });

  it('findById: calls findUnique with id', async () => {
    const turn = mockTurn();
    prisma.researchTurn.findUnique.mockResolvedValue(turn);

    await repo.findById('turn-1' as ResearchTurnId);

    expect(prisma.researchTurn.findUnique).toHaveBeenCalledWith({ where: { id: 'turn-1' } });
  });

  it('findLastOutbound: queries outbound direction, ordered desc', async () => {
    const turn = mockTurn({ direction: 'outbound', turnOrder: 3 });
    prisma.researchTurn.findFirst.mockResolvedValue(turn);

    const result = await repo.findLastOutbound('session-1');

    expect(result).toEqual(turn);
    expect(prisma.researchTurn.findFirst).toHaveBeenCalledWith({
      where: { sessionId: 'session-1', direction: 'outbound' },
      orderBy: { turnOrder: 'desc' },
    });
  });
});

// ─── Level 2: listBySession ordering ─────────────────────────────

describe('ResearchTurnRepository — listBySession', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchTurnRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchTurnRepository(
      prisma as unknown as Parameters<typeof createResearchTurnRepository>[0],
    );
  });

  it('listBySession: orders by turnOrder asc then direction asc', async () => {
    const turns = [mockTurn({ turnOrder: 1 }), mockTurn({ turnOrder: 2, direction: 'inbound' })];
    prisma.researchTurn.findMany.mockResolvedValue(turns);

    const result = await repo.listBySession('session-1');

    expect(result).toEqual(turns);
    expect(prisma.researchTurn.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      orderBy: [{ turnOrder: 'asc' }, { direction: 'asc' }],
    });
  });

  it('listBySession: returns empty array when no turns', async () => {
    prisma.researchTurn.findMany.mockResolvedValue([]);
    const result = await repo.listBySession('session-empty');
    expect(result).toEqual([]);
  });
});

// ─── Level 3: Integration ─────────────────────────────────────────

describe.skip('ResearchTurnRepository — integration (requires DB)', () => {
  it('insert + findByWahaMessageId idempotency', () => {});
  it('unique constraint on (sessionId, turnOrder, direction)', () => {});
});
