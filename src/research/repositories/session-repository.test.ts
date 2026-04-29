/**
 * ResearchSessionRepository — unit tests with mocked PrismaClient.
 *
 * Level 1: Core CRUD + state machine (create, findById, updateStatus transitions)
 * Level 2: markCompleted (retention date), markFailed, abort, findAll filters
 * Level 3: Integration — skipped (requires live DB)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchSession, ResearchSessionStatus } from '@prisma/client';
import { createResearchSessionRepository } from './session-repository.js';
import type { ResearchSessionId } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockSession(overrides?: Partial<ResearchSession>): ResearchSession {
  return {
    id: 'session-1',
    targetId: 'target-1',
    phoneId: 'phone-1',
    scriptId: 'script-1',
    status: 'queued',
    currentTurn: 0,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    failReason: null,
    failCode: null,
    retryCount: 0,
    notes: null,
    scheduleId: null,
    retentionEligibleAt: null,
    triggeredBy: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────

function buildMockPrisma() {
  const prisma = {
    researchSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  // Default: execute callback with the same mock as `tx`
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  return prisma;
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

// ─── Level 1: Core CRUD ──────────────────────────────────────────

describe('ResearchSessionRepository — create / find', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchSessionRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    repo = createResearchSessionRepository(prisma as unknown as Parameters<typeof createResearchSessionRepository>[0]);
  });

  it('create: passes all fields to prisma', async () => {
    const session = mockSession();
    prisma.researchSession.create.mockResolvedValue(session);

    const result = await repo.create({
      targetId: 'target-1',
      phoneId: 'phone-1',
      scriptId: 'script-1',
      triggeredBy: 'user@test.com',
    });

    expect(result).toEqual(session);
    expect(prisma.researchSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetId: 'target-1',
          phoneId: 'phone-1',
          scriptId: 'script-1',
          triggeredBy: 'user@test.com',
        }),
      }),
    );
  });

  it('create: passes scheduleId when provided', async () => {
    const session = mockSession({ scheduleId: 'sched-1' });
    prisma.researchSession.create.mockResolvedValue(session);

    await repo.create({
      targetId: 'target-1',
      phoneId: 'phone-1',
      scriptId: 'script-1',
      scheduleId: 'sched-1',
    });

    expect(prisma.researchSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scheduleId: 'sched-1' }),
      }),
    );
  });

  it('findById: calls findUnique with correct id', async () => {
    const session = mockSession();
    prisma.researchSession.findUnique.mockResolvedValue(session);

    const result = await repo.findById('session-1' as ResearchSessionId);

    expect(result).toEqual(session);
    expect(prisma.researchSession.findUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } });
  });

  it('findById: returns null when not found', async () => {
    prisma.researchSession.findUnique.mockResolvedValue(null);
    const result = await repo.findById('missing' as ResearchSessionId);
    expect(result).toBeNull();
  });

  it('findActive: queries active statuses for phone+target pair', async () => {
    prisma.researchSession.findFirst.mockResolvedValue(null);

    await repo.findActive('phone-1', 'target-1');

    expect(prisma.researchSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phoneId: 'phone-1',
          targetId: 'target-1',
          status: { in: expect.arrayContaining(['queued', 'running', 'waiting_response']) },
        }),
      }),
    );
  });
});

// ─── Level 2: State machine + filters ────────────────────────────

describe('ResearchSessionRepository — state transitions', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchSessionRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    repo = createResearchSessionRepository(prisma as unknown as Parameters<typeof createResearchSessionRepository>[0]);
  });

  it('updateStatus: sets startedAt when transitioning to running for first time', async () => {
    const session = mockSession({ status: 'queued', startedAt: null });
    prisma.researchSession.findUniqueOrThrow.mockResolvedValue(session);
    const updated = mockSession({ status: 'running', startedAt: new Date() });
    prisma.researchSession.update.mockResolvedValue(updated);

    await repo.updateStatus('session-1' as ResearchSessionId, 'running');

    expect(prisma.researchSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'running',
          startedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('updateStatus: does not overwrite startedAt when already set', async () => {
    const session = mockSession({ status: 'paused', startedAt: new Date('2026-01-01') });
    prisma.researchSession.findUniqueOrThrow.mockResolvedValue(session);
    const updated = mockSession({ status: 'running' });
    prisma.researchSession.update.mockResolvedValue(updated);

    await repo.updateStatus('session-1' as ResearchSessionId, 'running');

    const updateCall = prisma.researchSession.update.mock.calls[0]?.[0];
    expect(updateCall?.data).not.toHaveProperty('startedAt');
  });

  it('updateStatus: is idempotent on terminal states (completed)', async () => {
    const session = mockSession({ status: 'completed' });
    prisma.researchSession.findUniqueOrThrow.mockResolvedValue(session);

    const result = await repo.updateStatus('session-1' as ResearchSessionId, 'running');

    expect(prisma.researchSession.update).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('updateStatus: is idempotent on terminal states (failed)', async () => {
    const session = mockSession({ status: 'failed' });
    prisma.researchSession.findUniqueOrThrow.mockResolvedValue(session);

    await repo.updateStatus('session-1' as ResearchSessionId, 'queued');

    expect(prisma.researchSession.update).not.toHaveBeenCalled();
  });

  it('markCompleted: sets completedAt and retentionEligibleAt (+18 months)', async () => {
    const beforeCall = new Date();
    const completed = mockSession({
      status: 'completed',
      completedAt: new Date(),
      retentionEligibleAt: new Date(),
    });
    prisma.researchSession.update.mockResolvedValue(completed);

    await repo.markCompleted('session-1' as ResearchSessionId);

    const updateData = prisma.researchSession.update.mock.calls[0]?.[0]?.data;
    expect(updateData?.status).toBe('completed');
    expect(updateData?.completedAt).toBeInstanceOf(Date);
    expect(updateData?.retentionEligibleAt).toBeInstanceOf(Date);

    // retentionEligibleAt should be ~18 months after completedAt
    const completedAt = updateData?.completedAt as Date;
    const eligible = updateData?.retentionEligibleAt as Date;
    const diffMs = eligible.getTime() - completedAt.getTime();
    const eighteenMonthsMs = 18 * 30 * 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThan(eighteenMonthsMs * 0.9);
    expect(diffMs).toBeLessThan(eighteenMonthsMs * 1.1);

    void beforeCall;
  });

  it('markFailed: sets failedAt, failReason, and failCode', async () => {
    const updated = mockSession({ status: 'failed' });
    prisma.researchSession.update.mockResolvedValue(updated);

    await repo.markFailed('session-1' as ResearchSessionId, 'WAHA offline', 'WAHA_UNREACHABLE');

    const data = prisma.researchSession.update.mock.calls[0]?.[0]?.data;
    expect(data?.status).toBe('failed');
    expect(data?.failReason).toBe('WAHA offline');
    expect(data?.failCode).toBe('WAHA_UNREACHABLE');
    expect(data?.failedAt).toBeInstanceOf(Date);
  });

  it('markFailed: omits failCode when not provided', async () => {
    prisma.researchSession.update.mockResolvedValue(mockSession());

    await repo.markFailed('session-1' as ResearchSessionId, 'Unknown error');

    const data = prisma.researchSession.update.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty('failCode');
  });

  it('abort: sets status=aborted and failCode', async () => {
    const updated = mockSession({ status: 'aborted' });
    prisma.researchSession.update.mockResolvedValue(updated);

    await repo.abort('session-1' as ResearchSessionId, 'OPT_OUT_DETECTED');

    const data = prisma.researchSession.update.mock.calls[0]?.[0]?.data;
    expect(data?.status).toBe('aborted');
    expect(data?.failCode).toBe('OPT_OUT_DETECTED');
    expect(data?.failedAt).toBeInstanceOf(Date);
  });

  it('updateCurrentTurn: updates only currentTurn', async () => {
    const updated = mockSession({ currentTurn: 3 });
    prisma.researchSession.update.mockResolvedValue(updated);

    await repo.updateCurrentTurn('session-1' as ResearchSessionId, 3);

    expect(prisma.researchSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { currentTurn: 3 },
    });
  });
});

// ─── Level 2: findAll filters ─────────────────────────────────────

describe('ResearchSessionRepository — findAll', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchSessionRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchSessionRepository(prisma as unknown as Parameters<typeof createResearchSessionRepository>[0]);
  });

  it('findAll: no filters → uses empty where, default pagination', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    await repo.findAll();

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        take: 100,
        skip: 0,
      }),
    );
  });

  it('findAll: applies targetId filter', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    await repo.findAll({ targetId: 'target-x' });

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetId: 'target-x' }),
      }),
    );
  });

  it('findAll: applies status filter', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    const status: ResearchSessionStatus = 'completed';
    await repo.findAll({ status });

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('findAll: scriptLevel maps to nested script.level filter', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    await repo.findAll({ scriptLevel: 'L2_CAPABILITIES' as import('@prisma/client').$Enums.ProbeLevel });

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          script: { level: 'L2_CAPABILITIES' },
        }),
      }),
    );
  });

  it('listByStatus: passes status to findMany', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    await repo.listByStatus('running');

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'running' } }),
    );
  });

  it('listByTarget: passes targetId to findMany', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    await repo.listByTarget('target-abc');

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetId: 'target-abc' } }),
    );
  });

  it('listByPhone: passes phoneId to findMany', async () => {
    prisma.researchSession.findMany.mockResolvedValue([]);

    await repo.listByPhone('phone-xyz');

    expect(prisma.researchSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneId: 'phone-xyz' } }),
    );
  });
});

// ─── Level 3: Integration ─────────────────────────────────────────

describe.skip('ResearchSessionRepository — integration (requires DB)', () => {
  it('create → findById round-trip', () => {});
  it('markCompleted sets retention date in DB', () => {});
  it('updateStatus transaction prevents double-complete', () => {});
});
