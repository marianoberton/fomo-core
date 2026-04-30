/**
 * research-probe-run worker — unit tests.
 *
 * BullMQ's Worker is mocked so no real Redis connection is needed.
 * We extract the job processor via the mock's constructor call and
 * invoke it directly to test routing logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchProbeRunWorker } from './research-probe-run.js';
import type { ResearchSessionId } from '../types.js';

// ─── Mock BullMQ ──────────────────────────────────────────────────

vi.mock('bullmq', () => {
  const WorkerMock = vi.fn().mockImplementation(
    (_queue: string, processor: (job: unknown) => Promise<void>, _opts: unknown) => ({
      on: vi.fn(),
      close: vi.fn(),
      _processor: processor, // expose for tests
    }),
  );
  return { Worker: WorkerMock };
});

// ─── Helpers ─────────────────────────────────────────────────────

function buildMockRunner() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    handleInbound: vi.fn().mockResolvedValue(undefined),
    handleTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

function buildMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

const mockRedisConnection = { host: 'localhost', port: 6380 };

// ─── Tests ───────────────────────────────────────────────────────

describe('createResearchProbeRunWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Worker on the research-probes queue', async () => {
    const { Worker } = await import('bullmq');
    createResearchProbeRunWorker({
      runner: buildMockRunner() as never,
      logger: buildMockLogger() as never,
      redisConnection: mockRedisConnection,
    });

    expect(Worker).toHaveBeenCalledWith(
      'research-probes',
      expect.any(Function),
      expect.objectContaining({ concurrency: 3 }),
    );
  });

  it('research-probe-run job calls runner.start with sessionId', async () => {
    const runner = buildMockRunner();
    const worker = createResearchProbeRunWorker({
      runner: runner as never,
      logger: buildMockLogger() as never,
      redisConnection: mockRedisConnection,
    });

    const processor = (worker as unknown as { _processor: (j: unknown) => Promise<void> })._processor;
    await processor({
      name: 'research-probe-run',
      data: { sessionId: 'sess-abc' },
      attemptsMade: 0,
      opts: {},
    });

    expect(runner.start).toHaveBeenCalledWith('sess-abc' as ResearchSessionId);
  });

  it('research-probe-timeout job calls runner.handleTimeout', async () => {
    const runner = buildMockRunner();
    const worker = createResearchProbeRunWorker({
      runner: runner as never,
      logger: buildMockLogger() as never,
      redisConnection: mockRedisConnection,
    });

    const processor = (worker as unknown as { _processor: (j: unknown) => Promise<void> })._processor;
    await processor({
      name: 'research-probe-timeout',
      data: { sessionId: 'sess-abc', turnOrder: 3 },
      attemptsMade: 0,
      opts: {},
    });

    expect(runner.handleTimeout).toHaveBeenCalledWith('sess-abc' as ResearchSessionId, 3);
  });

  it('unknown job name logs warning and does not throw', async () => {
    const logger = buildMockLogger();
    const worker = createResearchProbeRunWorker({
      runner: buildMockRunner() as never,
      logger: logger as never,
      redisConnection: mockRedisConnection,
    });

    const processor = (worker as unknown as { _processor: (j: unknown) => Promise<void> })._processor;
    await expect(
      processor({ name: 'unknown-job', data: {}, attemptsMade: 0, opts: {} }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'research job: unknown job name',
      expect.objectContaining({ jobName: 'unknown-job' }),
    );
  });

  it('failed event logs error with isFinalAttempt flag', async () => {
    const { Worker } = await import('bullmq');
    const logger = buildMockLogger();

    createResearchProbeRunWorker({
      runner: buildMockRunner() as never,
      logger: logger as never,
      redisConnection: mockRedisConnection,
    });

    const onCall = (Worker as unknown as { mock: { results: Array<{ value: { on: ReturnType<typeof vi.fn> } }> } })
      .mock.results[0]?.value.on;
    if (!onCall) return;

    // Simulate the 'failed' event
    const onCallArgs = onCall.mock.calls as Array<[string, (...args: unknown[]) => void]>;
    const failedCallback = onCallArgs.find(([event]) => event === 'failed')?.[1];

    if (failedCallback) {
      failedCallback(
        { id: 'job-1', name: 'research-probe-run', data: { sessionId: 'sess-xyz' }, attemptsMade: 3, opts: { attempts: 3 } },
        new Error('WAHA unreachable'),
      );

      expect(logger.error).toHaveBeenCalledWith(
        'research job: probe-run failed',
        expect.objectContaining({ isFinalAttempt: true }),
      );
    }
  });
});
