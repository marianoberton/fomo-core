/**
 * ResearchScheduleRepository — unit tests with mocked PrismaClient.
 *
 * Level 1: create (BigInt handling), findById, deactivate
 * Level 2: listDue filters, recordRun increments correct counter
 * Level 3: Integration — skipped (requires live DB)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchSessionSchedule } from '@prisma/client';
import { createResearchScheduleRepository } from './schedule-repository.js';
import type { ResearchSessionScheduleId } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockSchedule(overrides?: Partial<ResearchSessionSchedule>): ResearchSessionSchedule {
  return {
    id: 'sched-1',
    targetId: 'target-1',
    scriptId: 'script-1',
    phoneId: 'phone-1',
    cronExpr: null,
    intervalMs: BigInt(14 * 24 * 60 * 60 * 1000), // 14 days
    jitterMs: 7200000,
    isActive: true,
    lastRunAt: null,
    nextRunAt: new Date('2026-05-01T10:00:00Z'),
    runCount: 0,
    failCount: 0,
    createdBy: 'user@test.com',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    researchSessionSchedule: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

// ─── Level 1: Core CRUD ──────────────────────────────────────────

describe('ResearchScheduleRepository — create / find', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchScheduleRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchScheduleRepository(
      prisma as unknown as Parameters<typeof createResearchScheduleRepository>[0],
    );
  });

  it('create: converts numeric intervalMs to BigInt', async () => {
    const sched = mockSchedule();
    prisma.researchSessionSchedule.create.mockResolvedValue(sched);

    const intervalMs = 14 * 24 * 60 * 60 * 1000;
    await repo.create({
      targetId: 'target-1',
      scriptId: 'script-1',
      phoneId: 'phone-1',
      nextRunAt: new Date('2026-05-01'),
      intervalMs,
    });

    const data = prisma.researchSessionSchedule.create.mock.calls[0]?.[0]?.data;
    expect(data?.intervalMs).toBe(BigInt(intervalMs));
  });

  it('create: accepts BigInt intervalMs directly', async () => {
    prisma.researchSessionSchedule.create.mockResolvedValue(mockSchedule());

    const bigMs = BigInt(14 * 24 * 60 * 60 * 1000);
    await repo.create({
      targetId: 'target-1',
      scriptId: 'script-1',
      phoneId: 'phone-1',
      nextRunAt: new Date(),
      intervalMs: bigMs,
    });

    const data = prisma.researchSessionSchedule.create.mock.calls[0]?.[0]?.data;
    expect(data?.intervalMs).toBe(bigMs);
  });

  it('create: passes cronExpr when provided', async () => {
    prisma.researchSessionSchedule.create.mockResolvedValue(mockSchedule());

    await repo.create({
      targetId: 'target-1',
      scriptId: 'script-1',
      phoneId: 'phone-1',
      nextRunAt: new Date(),
      cronExpr: '0 10 * * 1',
    });

    const data = prisma.researchSessionSchedule.create.mock.calls[0]?.[0]?.data;
    expect(data?.cronExpr).toBe('0 10 * * 1');
  });

  it('create: intervalMs is undefined when not provided', async () => {
    prisma.researchSessionSchedule.create.mockResolvedValue(mockSchedule());

    await repo.create({
      targetId: 'target-1',
      scriptId: 'script-1',
      phoneId: 'phone-1',
      nextRunAt: new Date(),
      cronExpr: '0 10 * * 1',
    });

    const data = prisma.researchSessionSchedule.create.mock.calls[0]?.[0]?.data;
    expect(data?.intervalMs).toBeUndefined();
  });

  it('findById: calls findUnique with correct id', async () => {
    const sched = mockSchedule();
    prisma.researchSessionSchedule.findUnique.mockResolvedValue(sched);

    const result = await repo.findById('sched-1' as ResearchSessionScheduleId);

    expect(result).toEqual(sched);
    expect(prisma.researchSessionSchedule.findUnique).toHaveBeenCalledWith({
      where: { id: 'sched-1' },
    });
  });

  it('deactivate: sets isActive=false', async () => {
    const deactivated = mockSchedule({ isActive: false });
    prisma.researchSessionSchedule.update.mockResolvedValue(deactivated);

    await repo.deactivate('sched-1' as ResearchSessionScheduleId);

    expect(prisma.researchSessionSchedule.update).toHaveBeenCalledWith({
      where: { id: 'sched-1' },
      data: { isActive: false },
    });
  });
});

// ─── Level 2: listDue + recordRun ────────────────────────────────

describe('ResearchScheduleRepository — listDue / recordRun', () => {
  let prisma: MockPrisma;
  let repo: ReturnType<typeof createResearchScheduleRepository>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    repo = createResearchScheduleRepository(
      prisma as unknown as Parameters<typeof createResearchScheduleRepository>[0],
    );
  });

  it('listDue: filters isActive=true and nextRunAt <= now', async () => {
    prisma.researchSessionSchedule.findMany.mockResolvedValue([]);
    const now = new Date('2026-05-01T12:00:00Z');

    await repo.listDue(now);

    expect(prisma.researchSessionSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          nextRunAt: { lte: now },
        },
      }),
    );
  });

  it('listDue: uses current time when no now arg provided', async () => {
    prisma.researchSessionSchedule.findMany.mockResolvedValue([]);

    const before = new Date();
    await repo.listDue();
    const after = new Date();

    const callArg = prisma.researchSessionSchedule.findMany.mock.calls[0]?.[0];
    const lte = callArg?.where?.nextRunAt?.lte as Date;
    expect(lte).toBeInstanceOf(Date);
    expect(lte.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(lte.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
  });

  it('recordRun (success): increments runCount, sets lastRunAt and nextRunAt', async () => {
    const nextRunAt = new Date('2026-05-15T10:00:00Z');
    prisma.researchSessionSchedule.update.mockResolvedValue(mockSchedule({ runCount: 1 }));

    await repo.recordRun('sched-1' as ResearchSessionScheduleId, true, nextRunAt);

    const data = prisma.researchSessionSchedule.update.mock.calls[0]?.[0]?.data;
    expect(data?.lastRunAt).toBeInstanceOf(Date);
    expect(data?.nextRunAt).toBe(nextRunAt);
    expect(data?.runCount).toEqual({ increment: 1 });
    expect(data).not.toHaveProperty('failCount');
  });

  it('recordRun (failure): increments failCount, not runCount', async () => {
    prisma.researchSessionSchedule.update.mockResolvedValue(mockSchedule({ failCount: 1 }));

    await repo.recordRun('sched-1' as ResearchSessionScheduleId, false, new Date());

    const data = prisma.researchSessionSchedule.update.mock.calls[0]?.[0]?.data;
    expect(data?.failCount).toEqual({ increment: 1 });
    expect(data).not.toHaveProperty('runCount');
  });

  it('listActive: returns only isActive=true schedules', async () => {
    prisma.researchSessionSchedule.findMany.mockResolvedValue([]);

    await repo.listActive();

    expect(prisma.researchSessionSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      }),
    );
  });

  it('listByTarget: filters by targetId', async () => {
    prisma.researchSessionSchedule.findMany.mockResolvedValue([]);

    await repo.listByTarget('target-abc');

    expect(prisma.researchSessionSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { targetId: 'target-abc' },
      }),
    );
  });
});

// ─── Level 3: Integration ─────────────────────────────────────────

describe.skip('ResearchScheduleRepository — integration (requires DB)', () => {
  it('create → listDue round-trip', () => {});
  it('recordRun advances nextRunAt in DB', () => {});
});
