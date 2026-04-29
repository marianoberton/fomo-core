/**
 * research-sessions route — unit tests with mocked Prisma.
 *
 * Tests cover: list, create (happy + validation), batch, detail (404),
 * pause/abort conflict checks, and retry policy (§3.3a).
 *
 * The super_admin guard is bypassed by setting apiKeyProjectId=null
 * and RESEARCH_MODULE_ENABLED=true in beforeEach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ResearchSession } from '@prisma/client';
import { registerErrorHandler } from '../error-handler.js';
import { researchSessionsRoutes } from './research-sessions.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createLogger } from '@/observability/logger.js';

// ─── Fixtures ────────────────────────────────────────────────────

function mockSession(overrides?: Partial<ResearchSession>): ResearchSession {
  return {
    id: 'sess-1',
    targetId: 'tgt-1',
    phoneId: 'ph-1',
    scriptId: 'scr-1',
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

// ─── Mock prisma builder ──────────────────────────────────────────

function buildMockPrisma() {
  const prisma = {
    researchSession: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    researchTarget: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    researchPhone: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    probeScript: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  return prisma;
}

type MockPrisma = ReturnType<typeof buildMockPrisma>;

// ─── Test app factory ─────────────────────────────────────────────

function createApp(): { app: FastifyInstance; prisma: MockPrisma } {
  const prisma = buildMockPrisma();
  const logger = createLogger({ level: 'silent' });

  const app = Fastify({ logger: false });

  // Bypass auth: simulate master key so requireSuperAdmin passes
  app.addHook('onRequest', async (request) => {
    request.apiKeyProjectId = null;
    request.superAdminEmail = 'test@fomo.com';
  });

  // Apply super_admin guard at app level (same effect as the scoped register
  // in index.ts — guard inherits from parent scope in tests)
  app.addHook('preHandler', requireSuperAdmin({ logger }));

  registerErrorHandler(app);

  researchSessionsRoutes(app, {
    prisma: prisma as unknown as Parameters<typeof researchSessionsRoutes>[1]['prisma'],
    logger,
  } as Parameters<typeof researchSessionsRoutes>[1]);

  return { app, prisma };
}

// ─── Env setup ───────────────────────────────────────────────────

beforeEach(() => {
  process.env['RESEARCH_MODULE_ENABLED'] = 'true';
});

afterEach(() => {
  delete process.env['RESEARCH_MODULE_ENABLED'];
  vi.clearAllMocks();
});

// ─── GET /research/sessions ───────────────────────────────────────

describe('GET /research/sessions', () => {
  it('returns 200 with empty list when no sessions exist', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findMany.mockResolvedValue([]);

    const response = await app.inject({ method: 'GET', url: '/research/sessions' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
  });

  it('passes status filter to prisma', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findMany.mockResolvedValue([]);

    await app.inject({ method: 'GET', url: '/research/sessions?status=completed' });

    const whereArg = prisma.researchSession.findMany.mock.calls[0]?.[0]?.where;
    expect(whereArg).toMatchObject({ status: 'completed' });
  });

  it('returns 400 for invalid status', async () => {
    const { app } = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/research/sessions?status=invalid_status',
    });

    expect(response.statusCode).toBe(400);
  });

  it('passes scriptLevel as nested script.level filter', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findMany.mockResolvedValue([]);

    await app.inject({ method: 'GET', url: '/research/sessions?scriptLevel=L2_CAPABILITIES' });

    const whereArg = prisma.researchSession.findMany.mock.calls[0]?.[0]?.where;
    expect(whereArg).toMatchObject({ script: { level: 'L2_CAPABILITIES' } });
  });
});

// ─── POST /research/sessions ──────────────────────────────────────

describe('POST /research/sessions', () => {
  it('creates session and returns 201', async () => {
    const { app, prisma } = createApp();

    const target = { id: 'tgt-1', verticalSlug: 'automotriz' };
    const phone = { id: 'ph-1', label: 'phone-01' };
    const script = { id: 'scr-1', name: 'l1-onboarding', level: 'L1_SURFACE' };
    const session = mockSession();

    prisma.researchTarget.findUnique.mockResolvedValue(target);
    prisma.researchPhone.findUnique.mockResolvedValue(phone);
    prisma.probeScript.findUnique.mockResolvedValue(script);
    prisma.researchSession.create.mockResolvedValue(session);

    const response = await app.inject({
      method: 'POST',
      url: '/research/sessions',
      payload: { targetId: 'tgt-1', phoneId: 'ph-1', scriptId: 'scr-1' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ success: boolean; data: { id: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('sess-1');
  });

  it('returns 404 when target does not exist', async () => {
    const { app, prisma } = createApp();
    prisma.researchTarget.findUnique.mockResolvedValue(null);
    prisma.researchPhone.findUnique.mockResolvedValue({ id: 'ph-1' });
    prisma.probeScript.findUnique.mockResolvedValue({ id: 'scr-1' });

    const response = await app.inject({
      method: 'POST',
      url: '/research/sessions',
      payload: { targetId: 'missing', phoneId: 'ph-1', scriptId: 'scr-1' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 400 for missing required fields', async () => {
    const { app } = createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/research/sessions',
      payload: { targetId: 'tgt-1' }, // missing phoneId + scriptId
    });

    expect(response.statusCode).toBe(400);
  });
});

// ─── POST /research/sessions/batch ───────────────────────────────

describe('POST /research/sessions/batch', () => {
  it('creates one session per active script at the given level', async () => {
    const { app, prisma } = createApp();

    prisma.researchTarget.findUnique.mockResolvedValue({ id: 'tgt-1', verticalSlug: 'automotriz' });
    prisma.researchPhone.findUnique.mockResolvedValue({ id: 'ph-1' });
    prisma.probeScript.findMany.mockResolvedValue([
      { id: 'scr-1', name: 'script-a' },
      { id: 'scr-2', name: 'script-b' },
    ]);
    prisma.researchSession.create
      .mockResolvedValueOnce(mockSession({ id: 'sess-a', scriptId: 'scr-1' }))
      .mockResolvedValueOnce(mockSession({ id: 'sess-b', scriptId: 'scr-2' }));

    const response = await app.inject({
      method: 'POST',
      url: '/research/sessions/batch',
      payload: { targetId: 'tgt-1', phoneId: 'ph-1', level: 'L2_CAPABILITIES' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ success: boolean; data: { count: number } }>();
    expect(body.data.count).toBe(2);
    expect(prisma.researchSession.create).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when no scripts found for level', async () => {
    const { app, prisma } = createApp();
    prisma.researchTarget.findUnique.mockResolvedValue({ id: 'tgt-1', verticalSlug: 'automotriz' });
    prisma.researchPhone.findUnique.mockResolvedValue({ id: 'ph-1' });
    prisma.probeScript.findMany.mockResolvedValue([]); // no scripts

    const response = await app.inject({
      method: 'POST',
      url: '/research/sessions/batch',
      payload: { targetId: 'tgt-1', phoneId: 'ph-1', level: 'L4_ADVERSARIAL' },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ─── GET /research/sessions/:id ───────────────────────────────────

describe('GET /research/sessions/:id', () => {
  it('returns 404 when session not found', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findUnique.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/research/sessions/missing' });

    expect(response.statusCode).toBe(404);
  });

  it('returns session with nested data', async () => {
    const { app, prisma } = createApp();
    const full = {
      ...mockSession(),
      target: { name: 'Toyota BA', company: 'Toyota', verticalSlug: 'automotriz', phoneNumber: '+54911' },
      phone: { label: 'phone-01', wahaSession: 'session-01' },
      script: { name: 'l1-onboarding', level: 'L1_SURFACE', objective: 'Test', estimatedMinutes: 5 },
      turns: [],
      analysis: null,
    };
    prisma.researchSession.findUnique.mockResolvedValue(full);

    const response = await app.inject({ method: 'GET', url: '/research/sessions/sess-1' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { id: string; target: { name: string } } }>();
    expect(body.data.target.name).toBe('Toyota BA');
  });
});

// ─── POST /research/sessions/:id/abort ───────────────────────────

describe('POST /research/sessions/:id/abort', () => {
  it('returns 404 when session not found', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findUnique.mockResolvedValue(null);

    const response = await app.inject({ method: 'POST', url: '/research/sessions/missing/abort' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 409 when session is already in terminal state', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findUnique.mockResolvedValue(mockSession({ status: 'completed' }));

    const response = await app.inject({ method: 'POST', url: '/research/sessions/sess-1/abort' });

    expect(response.statusCode).toBe(409);
  });

  it('aborts a running session', async () => {
    const { app, prisma } = createApp();
    const running = mockSession({ status: 'running' });
    prisma.researchSession.findUnique.mockResolvedValue(running);
    prisma.researchSession.update.mockResolvedValue(mockSession({ status: 'aborted' }));

    const response = await app.inject({ method: 'POST', url: '/research/sessions/sess-1/abort' });

    expect(response.statusCode).toBe(200);
    expect(prisma.researchSession.update).toHaveBeenCalled();
  });
});

// ─── POST /research/sessions/:id/retry ───────────────────────────

describe('POST /research/sessions/:id/retry', () => {
  it('returns 409 for non-retryable failCode (OPT_OUT_DETECTED)', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findUnique.mockResolvedValue(
      mockSession({ status: 'failed', failCode: 'OPT_OUT_DETECTED' }),
    );

    const response = await app.inject({ method: 'POST', url: '/research/sessions/sess-1/retry' });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { message: string } }>();
    expect(body.error.message).toContain('OPT_OUT_DETECTED');
  });

  it('returns 409 when retry count >= 2', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findUnique.mockResolvedValue(
      mockSession({ status: 'failed', failCode: 'WAHA_UNREACHABLE', retryCount: 2 }),
    );

    const response = await app.inject({ method: 'POST', url: '/research/sessions/sess-1/retry' });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { message: string } }>();
    expect(body.error.message).toContain('max is 2');
  });

  it('returns 409 for non-failed session', async () => {
    const { app, prisma } = createApp();
    prisma.researchSession.findUnique.mockResolvedValue(mockSession({ status: 'running' }));

    const response = await app.inject({ method: 'POST', url: '/research/sessions/sess-1/retry' });

    expect(response.statusCode).toBe(409);
  });

  it('creates retry session for retryable failCode with retryCount < 2', async () => {
    const { app, prisma } = createApp();
    const original = mockSession({ status: 'failed', failCode: 'WAHA_UNREACHABLE', retryCount: 0 });
    const cloned = mockSession({ id: 'sess-retry', notes: 'retry-of:sess-1', retryCount: 1 });

    prisma.researchSession.findUnique.mockResolvedValue(original);
    prisma.researchSession.create.mockResolvedValue(cloned);
    prisma.researchSession.update.mockResolvedValue({ ...cloned, retryCount: 1 });

    const response = await app.inject({ method: 'POST', url: '/research/sessions/sess-1/retry' });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { retry: { id: string } } }>();
    expect(body.data.retry.id).toBe('sess-retry');
    expect(prisma.researchSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'retry-of:sess-1' }),
      }),
    );
  });
});

// ─── Module disabled (404) ────────────────────────────────────────

describe('RESEARCH_MODULE_ENABLED=false', () => {
  it('returns 404 when module is disabled', async () => {
    process.env['RESEARCH_MODULE_ENABLED'] = 'false';
    const { app } = createApp();

    const response = await app.inject({ method: 'GET', url: '/research/sessions' });

    expect(response.statusCode).toBe(404);
  });
});
