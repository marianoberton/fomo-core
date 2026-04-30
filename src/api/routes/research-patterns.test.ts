import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PromptPattern, PromptPatternVersion } from '@prisma/client';
import { registerErrorHandler } from '../error-handler.js';
import { researchPatternsRoutes } from './research-patterns.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createLogger } from '@/observability/logger.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockPattern(overrides?: Partial<PromptPattern>): PromptPattern {
  return {
    id: 'pattern-1',
    verticalSlug: 'automotriz',
    category: 'onboarding',
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

function mockVersion(overrides?: Partial<PromptPatternVersion>): PromptPatternVersion {
  return {
    id: 'ppv-1',
    patternId: 'pattern-1',
    versionNumber: 1,
    patternText: '¡Hola {{nombre}}!',
    patternVariables: ['nombre'],
    seenInCount: 3,
    avgScoreWhen: 8.1,
    notes: null,
    isCurrent: true,
    editedBy: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function buildMockPrisma() {
  const txFns = {
    promptPattern: { create: vi.fn() },
    promptPatternVersion: {
      aggregate: vi.fn().mockResolvedValue({ _max: { versionNumber: 1 } }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue(mockVersion({ versionNumber: 2 })),
    },
  };

  return {
    promptPattern: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn(),
    },
    promptPatternVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _max: { versionNumber: 1 } }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
    },
    researchAuditLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
    $transaction: vi.fn((fn: (tx: typeof txFns) => Promise<unknown>) => fn(txFns)),
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

  researchPatternsRoutes(app, {
    prisma: prisma as unknown as Parameters<typeof researchPatternsRoutes>[1]['prisma'],
    logger,
  } as Parameters<typeof researchPatternsRoutes>[1]);

  return { app, prisma };
}

beforeEach(() => {
  process.env['RESEARCH_MODULE_ENABLED'] = 'true';
});

afterEach(() => {
  delete process.env['RESEARCH_MODULE_ENABLED'];
  vi.clearAllMocks();
});

// ─── GET /research/patterns ───────────────────────────────────────

describe('GET /research/patterns', () => {
  it('returns 200 with empty list', async () => {
    const { app } = createApp();

    const res = await app.inject({ method: 'GET', url: '/research/patterns' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.data.items).toEqual([]);
  });

  it('filters by vertical + status', async () => {
    const { app, prisma } = createApp();

    await app.inject({ method: 'GET', url: '/research/patterns?vertical=automotriz&status=approved' });

    const whereArg = (prisma.promptPattern.findMany.mock.calls[0]?.[0] as { where: unknown })?.where;
    expect(whereArg).toMatchObject({ verticalSlug: 'automotriz', status: 'approved' });
  });
});

// ─── GET /research/patterns/:id ──────────────────────────────────

describe('GET /research/patterns/:id', () => {
  it('returns pattern with versions', async () => {
    const { app, prisma } = createApp();
    prisma.promptPattern.findUnique.mockResolvedValue(mockPattern());
    prisma.promptPatternVersion.findMany.mockResolvedValue([mockVersion()]);

    const res = await app.inject({ method: 'GET', url: '/research/patterns/pattern-1' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { versions: unknown[] } }>();
    expect(Array.isArray(body.data.versions)).toBe(true);
  });

  it('returns 404 when not found', async () => {
    const { app } = createApp();

    const res = await app.inject({ method: 'GET', url: '/research/patterns/nonexistent' });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /research/patterns/:id/approve ────────────────────────

describe('PATCH /research/patterns/:id/approve', () => {
  it('approves pattern and writes audit log', async () => {
    const { app, prisma } = createApp();
    prisma.promptPattern.findUnique.mockResolvedValue(mockPattern());
    prisma.promptPattern.update.mockResolvedValue(mockPattern({ status: 'approved', approvedBy: 'admin@fomo.com' }));

    const res = await app.inject({ method: 'PATCH', url: '/research/patterns/pattern-1/approve' });

    expect(res.statusCode).toBe(200);
    expect(prisma.researchAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'pattern.approve' }),
      }),
    );
  });
});

// ─── PATCH /research/patterns/:id (edit) ─────────────────────────

describe('PATCH /research/patterns/:id (edit text)', () => {
  it('creates new version and resets to pending', async () => {
    const { app, prisma } = createApp();
    prisma.promptPattern.findUnique.mockResolvedValue(mockPattern({ status: 'approved' }));
    prisma.promptPattern.update.mockResolvedValue(mockPattern({ status: 'pending' }));

    const res = await app.inject({
      method: 'PATCH',
      url: '/research/patterns/pattern-1',
      payload: { patternText: '¡Hola {{nombre}}! Updated text.' },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.researchAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'pattern.edit' }),
      }),
    );
    expect(prisma.promptPattern.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending' }),
      }),
    );
  });

  it('returns 400 on missing patternText', async () => {
    const { app } = createApp();

    const res = await app.inject({
      method: 'PATCH',
      url: '/research/patterns/pattern-1',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
