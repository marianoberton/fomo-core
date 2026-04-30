import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchPatternEvaluateWorker, enqueuePatternEvaluate } from './research-pattern-evaluate.js';
import { ResearchError } from '../errors.js';

vi.mock('bullmq', () => {
  class Worker {
    private processor: (job: unknown) => Promise<void>;
    private handlers: Record<string, (...args: unknown[]) => void> = {};

    constructor(_name: string, processor: (job: unknown) => Promise<void>) {
      this.processor = processor;
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers[event] = handler;
      return this;
    }

    async runJob(data: unknown): Promise<void> {
      await this.processor({ id: 'job-1', data, attemptsMade: 0, opts: { attempts: 2 } });
    }
  }

  class Queue {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
  }

  return { Worker, Queue };
});

function mockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeUse(overrides?: Record<string, unknown>) {
  return {
    id: 'use-1',
    patternId: 'pattern-1',
    patternVersionId: 'ppv-1',
    agentTemplateSlug: 'customer-support',
    insertedAt: new Date('2026-01-01'),
    insertedBy: 'admin@fomo.com',
    scoreAtInsertion: 7.0,
    scoreAfter: null,
    outcome: null,
    ...overrides,
  };
}

const fakeRedis = { host: 'localhost', port: 6380 };

describe('ResearchPatternEvaluateWorker — improved outcome', () => {
  it('marks outcome as improved when delta > 0.5', async () => {
    const use = makeUse({ scoreAtInsertion: 7.0 });
    const patternUseRepo = {
      findById: vi.fn().mockResolvedValue(use),
      updateOutcome: vi.fn().mockResolvedValue({ ...use, outcome: 'improved', scoreAfter: 8.0 }),
      countByOutcome: vi.fn().mockResolvedValue([
        { outcome: 'improved', count: 1 },
        { outcome: 'neutral', count: 0 },
        { outcome: 'regressed', count: 0 },
      ]),
    };
    const patternRepo = { markSuperseded: vi.fn() };
    const logger = mockLogger();
    const fetchCurrentTemplateScore = vi.fn().mockResolvedValue(8.0);

    const worker = createResearchPatternEvaluateWorker({
      prisma: {} as never,
      patternUseRepo: patternUseRepo as never,
      patternRepo: patternRepo as never,
      logger: logger as never,
      redisConnection: fakeRedis,
      fetchCurrentTemplateScore,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    await (worker as any).runJob({ patternUseId: 'use-1', patternId: 'pattern-1' });

    expect(patternUseRepo.updateOutcome).toHaveBeenCalledWith(
      'use-1',
      expect.objectContaining({ outcome: 'improved', scoreAfter: 8.0 }),
    );
    expect(patternRepo.markSuperseded).not.toHaveBeenCalled();
  });
});

describe('ResearchPatternEvaluateWorker — regressed outcome + auto-supersede', () => {
  it('auto-supersedes when >5 uses and >50% regressed', async () => {
    const use = makeUse({ scoreAtInsertion: 7.0 });
    const patternUseRepo = {
      findById: vi.fn().mockResolvedValue(use),
      updateOutcome: vi.fn().mockResolvedValue({ ...use, outcome: 'regressed', scoreAfter: 6.3 }),
      countByOutcome: vi.fn().mockResolvedValue([
        { outcome: 'improved', count: 1 },
        { outcome: 'neutral', count: 1 },
        { outcome: 'regressed', count: 4 },
      ]),
    };
    const patternRepo = { markSuperseded: vi.fn().mockResolvedValue({}) };
    const logger = mockLogger();
    const fetchCurrentTemplateScore = vi.fn().mockResolvedValue(6.3);

    const worker = createResearchPatternEvaluateWorker({
      prisma: {} as never,
      patternUseRepo: patternUseRepo as never,
      patternRepo: patternRepo as never,
      logger: logger as never,
      redisConnection: fakeRedis,
      fetchCurrentTemplateScore,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    await (worker as any).runJob({ patternUseId: 'use-1', patternId: 'pattern-1' });

    expect(patternRepo.markSuperseded).toHaveBeenCalledWith('pattern-1');
  });
});

describe('ResearchPatternEvaluateWorker — skip conditions', () => {
  it('skips when use not found', async () => {
    const patternUseRepo = { findById: vi.fn().mockResolvedValue(null), updateOutcome: vi.fn(), countByOutcome: vi.fn() };
    const patternRepo = { markSuperseded: vi.fn() };
    const logger = mockLogger();

    const worker = createResearchPatternEvaluateWorker({
      prisma: {} as never,
      patternUseRepo: patternUseRepo as never,
      patternRepo: patternRepo as never,
      logger: logger as never,
      redisConnection: fakeRedis,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    await (worker as any).runJob({ patternUseId: 'use-99', patternId: 'pattern-1' });

    expect(patternUseRepo.updateOutcome).not.toHaveBeenCalled();
  });

  it('skips when outcome already set', async () => {
    const use = makeUse({ outcome: 'improved' });
    const patternUseRepo = { findById: vi.fn().mockResolvedValue(use), updateOutcome: vi.fn(), countByOutcome: vi.fn() };
    const patternRepo = { markSuperseded: vi.fn() };
    const logger = mockLogger();

    const worker = createResearchPatternEvaluateWorker({
      prisma: {} as never,
      patternUseRepo: patternUseRepo as never,
      patternRepo: patternRepo as never,
      logger: logger as never,
      redisConnection: fakeRedis,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    await (worker as any).runJob({ patternUseId: 'use-1', patternId: 'pattern-1' });

    expect(patternUseRepo.updateOutcome).not.toHaveBeenCalled();
  });
});

describe('enqueuePatternEvaluate', () => {
  it('adds job with 30-day delay', async () => {
    const { Queue } = await import('bullmq');
    const queue = new Queue('test') as unknown as { add: ReturnType<typeof vi.fn> };
    queue.add = vi.fn().mockResolvedValue({ id: 'job-1' });

    await enqueuePatternEvaluate(queue as never, 'use-1', 'pattern-1');

    expect(queue.add).toHaveBeenCalledWith(
      'research-pattern-evaluate',
      { patternUseId: 'use-1', patternId: 'pattern-1' },
      expect.objectContaining({
        delay: 30 * 24 * 60 * 60 * 1000,
        jobId: 'evaluate-use-use-1',
      }),
    );
  });
});
