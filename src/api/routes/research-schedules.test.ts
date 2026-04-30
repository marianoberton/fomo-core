/**
 * research-schedules route — unit tests with mocked Prisma + schedule repo.
 *
 * Tests cover: list, create (happy + validation), update, activate,
 * deactivate, delete (happy + 404).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ResearchSessionSchedule } from '@prisma/client';
import { registerErrorHandler } from '../error-handler.js';
import { researchSchedulesRoutes } from './research-schedules.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createLogger } from '@/observability/logger.js';

// ─── Fixture ──────────────────────────────────────────────────────

function mockSchedule(overrides?: Partial<ResearchSessionSchedule>): ResearchSessionSchedule {
  return {
    id: 'sched-1',
    targetId: 'target-1',
    scriptId: 'script-1',
    phoneId: 'phone-1',
    cronExpr: null,
    intervalMs: BigInt(14 * 24 * 60 * 60 * 1000),
    jitterMs: 7200000,
    isActive: true,
    lastRunAt: null,
    nextRunAt: new Date('2026-06-01T10:00:00Z'),
    runCount: 0,
    failCount: 0,
    createdBy: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ─── Mock Prisma builder ───────────────────────────────────────────

function buildMockPrisma() {
  return {
    researchSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'sess-1' }),
    },
    researchSessionSchedule: {
      findMany: vi.fn().mockResolvedValue([mockSchedule()]),
      findUnique: vi.fn().mockResolvedValue(mockSchedule()),
      create: vi.fn().mockResolvedValue(mockSchedule()),
      update: vi.fn().mockResolvedValue(mockSchedule()),
      delete: vi.fn().mockResolvedValue(mockSchedule()),
    },
  };
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

// ─── App factory ──────────────────────────────────────────────────

function createApp(): { app: FastifyInstance; prisma: MockPrisma } {
  const prisma = buildMockPrisma();
  const logger = createLogger({ level: 'silent' });
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request) => {
    request.apiKeyProjectId = null;
    request.superAdminEmail = 'test@fomo.com';
  });

  app.addHook('preHandler', requireSuperAdmin({ logger }));
  registerErrorHandler(app);

  researchSchedulesRoutes(app, {
    prisma: prisma as unknown as Parameters<typeof researchSchedulesRoutes>[1]['prisma'],
    logger,
  } as Parameters<typeof researchSchedulesRoutes>[1]);

  return { app, prisma };
}

// ─── Env setup ────────────────────────────────────────────────────

beforeEach(() => {
  process.env['RESEARCH_MODULE_ENABLED'] = 'true';
});

afterEach(() => {
  delete process.env['RESEARCH_MODULE_ENABLED'];
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────

describe('GET /research/targets/:id/schedules', () => {
  it('returns list of schedules for a target', async () => {
    const { app, prisma } = createApp();
    prisma.researchSessionSchedule.findMany.mockResolvedValue([mockSchedule()]);

    const res = await app.inject({
      method: 'GET',
      url: '/research/targets/target-1/schedules',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(1);
  });
});

describe('POST /research/targets/:id/schedules', () => {
  it('creates a schedule with intervalMs', async () => {
    const { app } = createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/research/targets/target-1/schedules',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scriptId: 'script-1',
        phoneId: 'phone-1',
        intervalMs: 14 * 24 * 60 * 60 * 1000,
      }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('returns 400 when scriptId is missing', async () => {
    const { app } = createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/research/targets/target-1/schedules',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneId: 'phone-1' }),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /research/schedules/:id', () => {
  it('updates jitterMs on an existing schedule', async () => {
    const { app } = createApp();

    const res = await app.inject({
      method: 'PATCH',
      url: '/research/schedules/sched-1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jitterMs: 3600000 }),
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when schedule not found', async () => {
    const { app, prisma } = createApp();
    prisma.researchSessionSchedule.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/research/schedules/nonexistent',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jitterMs: 3600000 }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /research/schedules/:id/activate', () => {
  it('activates a schedule', async () => {
    const { app } = createApp();

    const res = await app.inject({
      method: 'POST',
      url: '/research/schedules/sched-1/activate',
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when not found', async () => {
    const { app, prisma } = createApp();
    prisma.researchSessionSchedule.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/research/schedules/nonexistent/activate',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /research/schedules/:id/deactivate', () => {
  it('deactivates a schedule', async () => {
    const { app, prisma } = createApp();
    // Ensure update returns mock (re-assert for deactivate — different mock instance)
    prisma.researchSessionSchedule.update.mockResolvedValue(mockSchedule());
    prisma.researchSessionSchedule.findUnique.mockResolvedValue(mockSchedule());

    const res = await app.inject({
      method: 'POST',
      url: '/research/schedules/sched-1/deactivate',
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /research/schedules/:id', () => {
  it('deletes a schedule and returns 204', async () => {
    const { app } = createApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/research/schedules/sched-1',
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 404 when not found', async () => {
    const { app, prisma } = createApp();
    prisma.researchSessionSchedule.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/research/schedules/nonexistent',
    });

    expect(res.statusCode).toBe(404);
  });
});
