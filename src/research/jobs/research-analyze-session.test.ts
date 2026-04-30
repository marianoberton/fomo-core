/**
 * research-analyze-session worker tests.
 *
 * Strategy: mock BullMQ Worker entirely and extract the processor
 * function, then test routing directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ok, err } from '@/core/result.js';
import { ResearchError } from '../errors.js';

// ─── BullMQ mock ─────────────────────────────────────────────────

let _processor: ((job: unknown) => Promise<void>) | undefined;
let _failedHandler: ((job: unknown, error: Error) => void) | undefined;

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(
    (_queue: string, processor: (job: unknown) => Promise<void>, _opts: unknown) => {
      _processor = processor;
      return {
        on: vi.fn().mockImplementation((event: string, handler: unknown) => {
          if (event === 'failed') _failedHandler = handler as (job: unknown, error: Error) => void;
        }),
      };
    },
  ),
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createResearchAnalyzeWorker } from './research-analyze-session.js';

// ─── Helpers ─────────────────────────────────────────────────────

function buildJob(data: Record<string, unknown>, attemptsMade = 0, opts = { attempts: 2 }) {
  return { data, attemptsMade, opts, id: 'job-1', name: 'research-analyze-session' };
}

function buildAnalyzer(resolveWith?: unknown) {
  return {
    analyze: vi.fn().mockResolvedValue(
      resolveWith ?? ok({ id: 'analysis-1', scoreTotal: 7.5, sessionId: 'sess-1' }),
    ),
  };
}

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('ResearchAnalyzeWorker', () => {
  beforeEach(() => {
    _processor = undefined;
    _failedHandler = undefined;
    vi.clearAllMocks();
  });

  it('creates Worker on the correct queue', async () => {
    const bullmq = await import('bullmq');
    const WorkerMock = vi.mocked(bullmq.Worker);
    createResearchAnalyzeWorker({
      analyzer: buildAnalyzer() as never,
      logger: buildLogger() as never,
      redisConnection: { host: 'localhost', port: 6380 },
    });
    expect(WorkerMock).toHaveBeenCalledWith(
      'research-analysis',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it('calls analyzer.analyze with sessionId and modelOverride', async () => {
    const analyzer = buildAnalyzer();
    createResearchAnalyzeWorker({
      analyzer: analyzer as never,
      logger: buildLogger() as never,
      redisConnection: { host: 'localhost', port: 6380 },
    });

    await _processor!(buildJob({ sessionId: 'sess-42', modelOverride: 'claude-opus-4-6' }));

    expect(analyzer.analyze).toHaveBeenCalledWith('sess-42', { modelOverride: 'claude-opus-4-6' });
  });

  it('throws when analyzer returns err (so BullMQ retries)', async () => {
    const analyzer = buildAnalyzer(
      err(new ResearchError({ message: 'Parse failed', code: 'ANALYSIS_PARSE_FAILED' })),
    );
    createResearchAnalyzeWorker({
      analyzer: analyzer as never,
      logger: buildLogger() as never,
      redisConnection: { host: 'localhost', port: 6380 },
    });

    await expect(_processor!(buildJob({ sessionId: 'sess-1' }))).rejects.toThrow();
  });

  it('logs isFinalAttempt=true on failed event when attempts exhausted', () => {
    const logger = buildLogger();
    createResearchAnalyzeWorker({
      analyzer: buildAnalyzer() as never,
      logger: logger as never,
      redisConnection: { host: 'localhost', port: 6380 },
    });

    _failedHandler!(
      buildJob({ sessionId: 'sess-1' }, 2, { attempts: 2 }),
      new Error('boom'),
    );

    const call = (logger.error as Mock).mock.calls[0];
    expect(call?.[1]).toMatchObject({ isFinalAttempt: true, sessionId: 'sess-1' });
  });
});
