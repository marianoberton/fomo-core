/**
 * ResearchProbeRunner — unit tests.
 *
 * Level 1: handleInbound (PII scrub, opt-out, Redis signal)
 * Level 2: handleTimeout (Redis publish)
 * Level 3: start() — turn loop, timeout, failure, restart dedup
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchProbeRunner } from './probe-runner.js';
import type { ResearchSessionId } from '../types.js';

// ─── Mock helpers ─────────────────────────────────────────────────

function buildMockSubscriber(immediateSignal?: string) {
  const sub = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation(
      (event: string, cb: (channel: string, msg: string) => void) => {
        if (event === 'message' && immediateSignal !== undefined) {
          setImmediate(() => cb('channel', immediateSignal));
        }
      },
    ),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  return sub;
}

function buildMockRedis(bufferValue: string | null = null, immediateSignal?: string) {
  const sub = buildMockSubscriber(immediateSignal);
  return {
    get: vi.fn().mockResolvedValue(bufferValue),
    set: vi.fn().mockResolvedValue('OK'),
    publish: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn().mockReturnValue(sub),
    _subscriber: sub,
  };
}

function buildMockSessionRepo(sessionOverrides?: Partial<ReturnType<typeof baseMockSession>>) {
  const session = { ...baseMockSession(), ...sessionOverrides };
  return {
    findById: vi.fn().mockResolvedValue(session),
    updateStatus: vi.fn().mockResolvedValue(session),
    updateCurrentTurn: vi.fn().mockResolvedValue(session),
    markCompleted: vi.fn().mockResolvedValue({ ...session, status: 'completed' }),
    markFailed: vi.fn().mockResolvedValue({ ...session, status: 'failed' }),
    abort: vi.fn().mockResolvedValue({ ...session, status: 'aborted' }),
  };
}

function buildMockTurnRepo() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'turn-1' }),
    findByWahaMessageId: vi.fn().mockResolvedValue(null),
    findLastOutbound: vi.fn().mockResolvedValue(null),
    listBySession: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
}

function buildMockWahaClient() {
  return {
    sendText: vi.fn().mockResolvedValue({ ok: true, value: { id: 'waha-msg-1' } }),
    startTyping: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    stopTyping: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    getMessages: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    createSession: vi.fn(),
    getSessionQR: vi.fn(),
    getSessionStatus: vi.fn(),
    listSessions: vi.fn(),
    stopSession: vi.fn(),
    configureWebhook: vi.fn(),
  };
}

function buildMockProbeQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    remove: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
  };
}

function buildMockPrisma(
  existingOutbound: { id: string } | null = null,
) {
  return {
    probeScript: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'script-1',
        waitMinMs: 0,
        waitMaxMs: 0,
        turns: [
          {
            order: 1,
            message: 'Hola, ¿trabajas en soporte?',
            waitForResponseMs: 5000,
            notes: 'opener',
            continueOnTimeout: false,
          },
        ],
      }),
    },
    researchPhone: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'ph-1',
        wahaSession: 'sess-test',
      }),
    },
    researchTarget: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'tgt-1',
        phoneNumber: '5491100001111@c.us',
      }),
    },
    researchTurn: {
      findFirst: vi.fn().mockResolvedValue(existingOutbound),
    },
    researchSession: {
      update: vi.fn().mockResolvedValue({}),
    },
    researchTarget: {
      findUnique: vi.fn().mockResolvedValue({ id: 'tgt-1', phoneNumber: '5491100001111@c.us' }),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(
      async (ops: Promise<unknown>[]) => await Promise.all(ops),
    ),
  };
}

function baseMockSession() {
  return {
    id: 'sess-1',
    targetId: 'tgt-1',
    phoneId: 'ph-1',
    scriptId: 'script-1',
    status: 'queued' as string,
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
  };
}

// ─── Level 1: handleInbound ───────────────────────────────────────

describe('ResearchProbeRunner — handleInbound', () => {
  it('scrubs PII, persists inbound turn, writes buffer and publishes', async () => {
    const redis = buildMockRedis();
    const turnRepo = buildMockTurnRepo();

    const runner = createResearchProbeRunner({
      prisma: buildMockPrisma() as never,
      redis: redis as never,
      wahaClient: buildMockWahaClient() as never,
      sessionRepo: buildMockSessionRepo() as never,
      turnRepo: turnRepo as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.handleInbound({
      sessionId: 'sess-1' as ResearchSessionId,
      turnOrder: 1,
      wahaMessageId: 'waha-in-1',
      text: 'Mi número es 12345678 y mi email es test@example.com',
      targetId: 'tgt-1',
    });

    // PII should be scrubbed
    const createCall = turnRepo.create.mock.calls[0]?.[0];
    expect(createCall?.message).toContain('[DNI]');
    expect(createCall?.message).toContain('[EMAIL]');
    expect(createCall?.redactionsCount).toBeGreaterThanOrEqual(2);
    expect(createCall?.sanitized).toBe(true);
    expect(createCall?.direction).toBe('inbound');

    // Redis buffer written before publish
    expect(redis.set).toHaveBeenCalled();
    expect(redis.publish).toHaveBeenCalled();

    const publishPayload = JSON.parse(redis.publish.mock.calls[0]?.[1] as string);
    expect(publishPayload.type).toBe('response');
    expect(publishPayload.wahaMessageId).toBe('waha-in-1');
  });

  it('detects opt-out: aborts session, bans target, publishes aborted signal', async () => {
    const redis = buildMockRedis();
    const prisma = buildMockPrisma();

    const runner = createResearchProbeRunner({
      prisma: prisma as never,
      redis: redis as never,
      wahaClient: buildMockWahaClient() as never,
      sessionRepo: buildMockSessionRepo() as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.handleInbound({
      sessionId: 'sess-1' as ResearchSessionId,
      turnOrder: 1,
      wahaMessageId: 'waha-in-opt',
      text: 'No quiero más mensajes por favor',
      targetId: 'tgt-1',
    });

    // Transaction should update session and target
    expect(prisma.$transaction).toHaveBeenCalled();

    // Aborted signal published
    const publishPayload = JSON.parse(redis.publish.mock.calls[0]?.[1] as string);
    expect(publishPayload.type).toBe('aborted');
  });

  it('does not persist turn on opt-out', async () => {
    const turnRepo = buildMockTurnRepo();

    const runner = createResearchProbeRunner({
      prisma: buildMockPrisma() as never,
      redis: buildMockRedis() as never,
      wahaClient: buildMockWahaClient() as never,
      sessionRepo: buildMockSessionRepo() as never,
      turnRepo: turnRepo as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.handleInbound({
      sessionId: 'sess-1' as ResearchSessionId,
      turnOrder: 1,
      wahaMessageId: 'waha-in-opt',
      text: 'STOP',
      targetId: 'tgt-1',
    });

    expect(turnRepo.create).not.toHaveBeenCalled();
  });
});

// ─── Level 2: handleTimeout ───────────────────────────────────────

describe('ResearchProbeRunner — handleTimeout', () => {
  it('publishes timeout signal to the correct Redis channel', async () => {
    const redis = buildMockRedis();

    const runner = createResearchProbeRunner({
      prisma: buildMockPrisma() as never,
      redis: redis as never,
      wahaClient: buildMockWahaClient() as never,
      sessionRepo: buildMockSessionRepo() as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.handleTimeout('sess-1' as ResearchSessionId, 2);

    const [channel, message] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe('research:response:sess-1:2');
    const payload = JSON.parse(message);
    expect(payload.type).toBe('timeout');
  });
});

// ─── Level 3: start() ─────────────────────────────────────────────

describe('ResearchProbeRunner — start()', () => {
  it('happy path: sends turn, receives response, marks completed', async () => {
    const responseSignal = JSON.stringify({
      type: 'response',
      wahaMessageId: 'waha-in-1',
      text: 'Soy agente de soporte',
    });
    const redis = buildMockRedis(null, responseSignal);
    const sessionRepo = buildMockSessionRepo();
    const turnRepo = buildMockTurnRepo();
    const wahaClient = buildMockWahaClient();
    const probeQueue = buildMockProbeQueue();

    const runner = createResearchProbeRunner({
      prisma: buildMockPrisma() as never,
      redis: redis as never,
      wahaClient: wahaClient as never,
      sessionRepo: sessionRepo as never,
      turnRepo: turnRepo as never,
      probeQueue: probeQueue as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.start('sess-1' as ResearchSessionId);

    // Outbound sent
    expect(wahaClient.sendText).toHaveBeenCalledWith(
      'sess-test',
      '5491100001111@c.us',
      'Hola, ¿trabajas en soporte?',
    );

    // Outbound turn persisted
    const outboundCall = turnRepo.create.mock.calls[0]?.[0];
    expect(outboundCall?.direction).toBe('outbound');
    expect(outboundCall?.turnOrder).toBe(1);

    // Session marked completed
    expect(sessionRepo.markCompleted).toHaveBeenCalledWith('sess-1');

    // Timeout job enqueued then cancelled
    expect(probeQueue.add).toHaveBeenCalledWith(
      'research-probe-timeout',
      { sessionId: 'sess-1', turnOrder: 1 },
      expect.objectContaining({ delay: 5000, jobId: 'timeout:sess-1:1' }),
    );
    expect(probeQueue.remove).toHaveBeenCalledWith('timeout:sess-1:1');
  });

  it('skips if session is already completed', async () => {
    const sessionRepo = buildMockSessionRepo({ status: 'completed' });
    const wahaClient = buildMockWahaClient();

    const runner = createResearchProbeRunner({
      prisma: buildMockPrisma() as never,
      redis: buildMockRedis() as never,
      wahaClient: wahaClient as never,
      sessionRepo: sessionRepo as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.start('sess-1' as ResearchSessionId);

    expect(wahaClient.sendText).not.toHaveBeenCalled();
  });

  it('marks failed when WAHA sendText errors', async () => {
    const sessionRepo = buildMockSessionRepo();
    const wahaClient = buildMockWahaClient();
    wahaClient.sendText.mockResolvedValue({
      ok: false,
      error: { message: 'WAHA down', researchCode: 'WAHA_UNREACHABLE' },
    });

    const runner = createResearchProbeRunner({
      prisma: buildMockPrisma() as never,
      redis: buildMockRedis() as never,
      wahaClient: wahaClient as never,
      sessionRepo: sessionRepo as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.start('sess-1' as ResearchSessionId);

    expect(sessionRepo.markFailed).toHaveBeenCalledWith(
      'sess-1',
      'WAHA down',
      'WAHA_UNREACHABLE',
    );
  });

  it('timeout with continueOnTimeout=false → marks failed', async () => {
    // No signal — in-process timer will timeout, but we use a very short timeout
    const prismaWithShortTurn = buildMockPrisma();
    prismaWithShortTurn.probeScript.findUnique.mockResolvedValue({
      id: 'script-1',
      waitMinMs: 0,
      waitMaxMs: 0,
      turns: [
        {
          order: 1,
          message: 'Hi',
          waitForResponseMs: 1, // 1ms — will timeout immediately in test
          notes: '',
          continueOnTimeout: false,
        },
      ],
    });
    const sessionRepo = buildMockSessionRepo();

    const runner = createResearchProbeRunner({
      prisma: prismaWithShortTurn as never,
      redis: buildMockRedis() as never, // get returns null, no subscriber signal
      wahaClient: buildMockWahaClient() as never,
      sessionRepo: sessionRepo as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.start('sess-1' as ResearchSessionId);

    expect(sessionRepo.markFailed).toHaveBeenCalledWith(
      'sess-1',
      'Response timeout',
      'RESPONSE_TIMEOUT',
    );
  });

  it('timeout with continueOnTimeout=true → continues to next turn', async () => {
    const prismaWithContinue = buildMockPrisma();
    prismaWithContinue.probeScript.findUnique.mockResolvedValue({
      id: 'script-1',
      waitMinMs: 0,
      waitMaxMs: 0,
      turns: [
        {
          order: 1,
          message: 'Turn 1',
          waitForResponseMs: 1,
          notes: '',
          continueOnTimeout: true, // continue even without response
        },
        {
          order: 2,
          message: 'Turn 2',
          waitForResponseMs: 1,
          notes: '',
          continueOnTimeout: true,
        },
      ],
    });
    const sessionRepo = buildMockSessionRepo();
    const wahaClient = buildMockWahaClient();

    const runner = createResearchProbeRunner({
      prisma: prismaWithContinue as never,
      redis: buildMockRedis() as never,
      wahaClient: wahaClient as never,
      sessionRepo: sessionRepo as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.start('sess-1' as ResearchSessionId);

    // Both outbounds sent despite timeouts
    expect(wahaClient.sendText).toHaveBeenCalledTimes(2);
    expect(sessionRepo.markCompleted).toHaveBeenCalledWith('sess-1');
  });

  it('restart dedup: skips sendText if outbound already persisted', async () => {
    const prismaWithExistingOutbound = buildMockPrisma({ id: 'existing-turn' }); // pre-existing outbound
    // Provide a response signal so the runner doesn't hang
    const responseSignal = JSON.stringify({ type: 'response', wahaMessageId: 'w-1', text: 'ok' });
    const redis = buildMockRedis(null, responseSignal);
    const sessionRepo = buildMockSessionRepo({ currentTurn: 0 }); // starting at turn 0
    const wahaClient = buildMockWahaClient();

    const runner = createResearchProbeRunner({
      prisma: prismaWithExistingOutbound as never,
      redis: redis as never,
      wahaClient: wahaClient as never,
      sessionRepo: sessionRepo as never,
      turnRepo: buildMockTurnRepo() as never,
      probeQueue: buildMockProbeQueue() as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await runner.start('sess-1' as ResearchSessionId);

    // sendText should NOT have been called (outbound already in DB)
    expect(wahaClient.sendText).not.toHaveBeenCalled();
    // But session should still complete
    expect(sessionRepo.markCompleted).toHaveBeenCalled();
  });
});
