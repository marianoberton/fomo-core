import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchSessionSchedule } from '@prisma/client';
import { createScheduleManager } from './schedule-manager.js';
import type { ResearchSessionScheduleRepository } from '../repositories/schedule-repository.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mock logger ───────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

// ─── Mock schedule repo ────────────────────────────────────────────

function makeScheduleRepo(
  overrides: Partial<ResearchSessionScheduleRepository> = {},
): ResearchSessionScheduleRepository {
  return {
    create: vi.fn().mockResolvedValue(makeSchedule()),
    findById: vi.fn().mockResolvedValue(null),
    listByTarget: vi.fn().mockResolvedValue([]),
    listDue: vi.fn().mockResolvedValue([]),
    listActive: vi.fn().mockResolvedValue([]),
    recordRun: vi.fn().mockResolvedValue(makeSchedule()),
    update: vi.fn().mockResolvedValue(makeSchedule()),
    deactivate: vi.fn().mockResolvedValue(makeSchedule()),
    ...overrides,
  };
}

// ─── Schedule fixture ──────────────────────────────────────────────

function makeSchedule(overrides: Partial<ResearchSessionSchedule> = {}): ResearchSessionSchedule {
  return {
    id: 'sched-1',
    targetId: 'target-1',
    scriptId: 'script-1',
    phoneId: 'phone-1',
    cronExpr: null,
    intervalMs: BigInt(14 * 24 * 60 * 60 * 1000),
    jitterMs: 0,
    isActive: true,
    lastRunAt: null,
    nextRunAt: new Date('2025-01-01T10:00:00Z'),
    runCount: 0,
    failCount: 0,
    createdBy: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Mock Prisma ───────────────────────────────────────────────────

function makePrisma(sessionFindFirstResult: unknown = null) {
  return {
    researchSession: {
      findFirst: vi.fn().mockResolvedValue(sessionFindFirstResult),
    },
    researchSessionSchedule: {
      create: vi.fn().mockResolvedValue(makeSchedule()),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(makeSchedule()),
    },
  } as unknown as Parameters<typeof createScheduleManager>[0]['prisma'];
}

// ─── Tests ────────────────────────────────────────────────────────

describe('computeNextRunAt', () => {
  it('advances by approximately intervalMs (no jitter when jitterMs=0)', () => {
    const mgr = createScheduleManager({
      prisma: makePrisma(),
      logger: makeLogger(),
    });
    const schedule = makeSchedule({ jitterMs: 0 });
    // Use a midday UTC time so clamping doesn't shift the date
    const from = new Date('2025-01-15T14:00:00Z');
    const next = mgr.computeNextRunAt(schedule, from);
    const expectedMs = from.getTime() + 14 * 24 * 60 * 60 * 1000;
    // Active-hours clamping may adjust within same calendar day (±24h window)
    expect(next.getTime()).toBeGreaterThanOrEqual(expectedMs - 24 * 60 * 60 * 1000);
    expect(next.getTime()).toBeLessThanOrEqual(expectedMs + 24 * 60 * 60 * 1000);
  });

  it('uses cron-parser v5 when cronExpr is set', () => {
    const mgr = createScheduleManager({
      prisma: makePrisma(),
      logger: makeLogger(),
    });
    // Every Monday at 10am
    const schedule = makeSchedule({
      cronExpr: '0 10 * * 1',
      intervalMs: null,
      jitterMs: 0,
    });
    const from = new Date('2025-01-14T11:00:00Z'); // Tuesday
    const next = mgr.computeNextRunAt(schedule, from);
    // Next Monday
    expect(next.getDay()).toBe(1);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('throws SCRIPT_INVALID when neither cronExpr nor intervalMs', () => {
    const mgr = createScheduleManager({
      prisma: makePrisma(),
      logger: makeLogger(),
    });
    const schedule = makeSchedule({ cronExpr: null, intervalMs: null });
    expect(() => mgr.computeNextRunAt(schedule)).toThrow();
  });
});

describe('createSchedule', () => {
  it('returns ok with the created schedule', async () => {
    const repo = makeScheduleRepo();
    const mgr = createScheduleManager({
      prisma: makePrisma(),
      scheduleRepo: repo,
      logger: makeLogger(),
    });

    const result = await mgr.createSchedule({
      targetId: 'target-1',
      scriptId: 'script-1',
      phoneId: 'phone-1',
      nextRunAt: new Date(),
      intervalMs: 14 * 24 * 60 * 60 * 1000,
    });

    expect(result.ok).toBe(true);
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('returns err when neither cronExpr nor intervalMs provided', async () => {
    const mgr = createScheduleManager({
      prisma: makePrisma(),
      logger: makeLogger(),
    });

    const result = await mgr.createSchedule({
      targetId: 'target-1',
      scriptId: 'script-1',
      phoneId: 'phone-1',
      nextRunAt: new Date(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.researchCode).toBe('SCRIPT_INVALID');
  });
});

describe('processDueSchedules', () => {
  it('creates sessions for due schedules', async () => {
    const dueSchedule = makeSchedule({ nextRunAt: new Date(Date.now() - 1000) });
    const repo = makeScheduleRepo({
      listDue: vi.fn().mockResolvedValue([dueSchedule]),
      recordRun: vi.fn().mockResolvedValue(dueSchedule),
    });

    const sessionCreate = vi.fn().mockResolvedValue({ id: 'sess-1' });
    const prisma = {
      researchSession: {
        findFirst: vi.fn().mockResolvedValue(null), // no active session
        create: sessionCreate,
      },
      researchSessionSchedule: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(dueSchedule),
      },
    } as unknown as Parameters<typeof createScheduleManager>[0]['prisma'];

    const mgr = createScheduleManager({ prisma, scheduleRepo: repo, logger: makeLogger() });
    const result = await mgr.processDueSchedules();

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(repo.recordRun).toHaveBeenCalledOnce();
  });

  it('skips and postpones when target has active session', async () => {
    const dueSchedule = makeSchedule({ nextRunAt: new Date(Date.now() - 1000) });
    const repo = makeScheduleRepo({
      listDue: vi.fn().mockResolvedValue([dueSchedule]),
      recordRun: vi.fn().mockResolvedValue(dueSchedule),
    });

    const prisma = {
      researchSession: {
        findFirst: vi.fn().mockResolvedValue({ id: 'active-sess' }), // busy!
      },
      researchSessionSchedule: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(dueSchedule),
      },
    } as unknown as Parameters<typeof createScheduleManager>[0]['prisma'];

    const mgr = createScheduleManager({ prisma, scheduleRepo: repo, logger: makeLogger() });
    const result = await mgr.processDueSchedules();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    // recordRun called with success=false to advance nextRunAt by 1h
    expect(repo.recordRun).toHaveBeenCalledWith(
      dueSchedule.id,
      false,
      expect.any(Date),
    );
  });

  it('increments errors and continues on unexpected failure', async () => {
    const dueSchedule = makeSchedule({ nextRunAt: new Date(Date.now() - 1000) });
    const repo = makeScheduleRepo({
      listDue: vi.fn().mockResolvedValue([dueSchedule]),
      recordRun: vi.fn().mockRejectedValue(new Error('DB exploded')),
    });

    const prisma = {
      researchSession: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'sess-1' }),
      },
      researchSessionSchedule: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(dueSchedule),
      },
    } as unknown as Parameters<typeof createScheduleManager>[0]['prisma'];

    const mgr = createScheduleManager({ prisma, scheduleRepo: repo, logger: makeLogger() });
    const result = await mgr.processDueSchedules();

    expect(result.errors).toBe(1);
  });
});
