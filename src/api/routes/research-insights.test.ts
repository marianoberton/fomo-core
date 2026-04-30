import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { IntelligenceInsight } from '@prisma/client';
import { registerErrorHandler } from '../error-handler.js';
import { researchInsightsRoutes } from './research-insights.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createLogger } from '@/observability/logger.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockInsight(overrides?: Partial<IntelligenceInsight>): IntelligenceInsight {
  return {
    id: 'insight-1',
    verticalSlug: 'automotriz',
    category: 'onboarding',
    title: 'Los mejores saludan con nombre',
    content: 'El 70% de los agentes top incluyen el nombre del asesor.',
    evidence: null,
    seenInCount: 5,
    status: 'pending',
    rejectedReason: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function buildMockPrisma() {
  return {
    intelligenceInsight: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn(),
    },
    researchAuditLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
  };
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

function createApp(): { app: FastifyInstance; prisma: MockPrisma } {
  const prisma = buildMockPrisma();
  const logger = createLogger({ level: 'silent' });
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request) => {
    request.apiKeyProjectId = null;
    request.superAdminEmail = 'admin@fomo.com';
  });

  app.addHook('preHandler', requireSuperAdmin({ logger }));
  registerErrorHandler(app);

  researchInsightsRoutes(app, {
    prisma: prisma as unknown as Parameters<typeof researchInsightsRoutes>[1]['prisma'],
    logger,
  } as Parameters<typeof researchInsightsRoutes>[1]);

  return { app, prisma };
}

beforeEach(() => {
  process.env['RESEARCH_MODULE_ENABLED'] = 'true';
});

afterEach(() => {
  delete process.env['RESEARCH_MODULE_ENABLED'];
  vi.clearAllMocks();
});

// ─── GET /research/insights ───────────────────────────────────────

describe('GET /research/insights', () => {
  it('returns 200 with empty list', async () => {
    const { app } = createApp();

    const res = await app.inject({ method: 'GET', url: '/research/insights' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
  });

  it('passes vertical filter', async () => {
    const { app, prisma } = createApp();

    await app.inject({ method: 'GET', url: '/research/insights?vertical=automotriz' });

    const whereArg = (prisma.intelligenceInsight.findMany.mock.calls[0]?.[0] as { where: unknown })?.where;
    expect(whereArg).toMatchObject({ verticalSlug: 'automotriz' });
  });

  it('passes status filter', async () => {
    const { app, prisma } = createApp();

    await app.inject({ method: 'GET', url: '/research/insights?status=approved' });

    const whereArg = (prisma.intelligenceInsight.findMany.mock.calls[0]?.[0] as { where: unknown })?.where;
    expect(whereArg).toMatchObject({ status: 'approved' });
  });
});

// ─── GET /research/insights/:id ──────────────────────────────────

describe('GET /research/insights/:id', () => {
  it('returns 200 with insight', async () => {
    const { app, prisma } = createApp();
    prisma.intelligenceInsight.findUnique.mockResolvedValue(mockInsight());

    const res = await app.inject({ method: 'GET', url: '/research/insights/insight-1' });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when not found', async () => {
    const { app } = createApp();

    const res = await app.inject({ method: 'GET', url: '/research/insights/nonexistent' });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /research/insights/:id/approve ────────────────────────

describe('PATCH /research/insights/:id/approve', () => {
  it('approves insight and writes audit log', async () => {
    const { app, prisma } = createApp();
    prisma.intelligenceInsight.findUnique.mockResolvedValue(mockInsight());
    prisma.intelligenceInsight.update.mockResolvedValue(mockInsight({ status: 'approved', approvedBy: 'admin@fomo.com' }));

    const res = await app.inject({ method: 'PATCH', url: '/research/insights/insight-1/approve' });

    expect(res.statusCode).toBe(200);
    expect(prisma.intelligenceInsight.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
    expect(prisma.researchAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'insight.approve' }),
      }),
    );
  });

  it('returns 404 when insight not found', async () => {
    const { app } = createApp();

    const res = await app.inject({ method: 'PATCH', url: '/research/insights/bad-id/approve' });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /research/insights/:id/reject ─────────────────────────

describe('PATCH /research/insights/:id/reject', () => {
  it('rejects insight with reason', async () => {
    const { app, prisma } = createApp();
    prisma.intelligenceInsight.findUnique.mockResolvedValue(mockInsight());
    prisma.intelligenceInsight.update.mockResolvedValue(mockInsight({ status: 'rejected' }));

    const res = await app.inject({
      method: 'PATCH',
      url: '/research/insights/insight-1/reject',
      payload: { reason: 'Not actionable enough' },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.researchAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'insight.reject' }),
      }),
    );
  });
});
