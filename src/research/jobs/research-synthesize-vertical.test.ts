import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchSynthesizeWorker, maybeEnqueueSynthesis } from './research-synthesize-vertical.js';
import { ok, err } from '@/core/result.js';
import { ResearchError } from '../errors.js';

vi.mock('bullmq', () => {
  const workerHandlers: Record<string, (...args: unknown[]) => void> = {};

  class Worker {
    private processor: (job: unknown) => Promise<void>;

    constructor(_queueName: string, processor: (job: unknown) => Promise<void>) {
      this.processor = processor;
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      workerHandlers[event] = handler;
      return this;
    }

    async runJob(data: unknown): Promise<void> {
      await this.processor({ id: 'job-1', data, attemptsMade: 0 });
    }
  }

  class Queue {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
  }

  return { Worker, Queue };
});

// ─── Helpers ─────────────────────────────────────────────────────

function mockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function mockSynthesizer() {
  return { synthesizeVertical: vi.fn() };
}

const fakeRedis = { host: 'localhost', port: 6380 };

// ─── Tests ────────────────────────────────────────────────────────

describe('ResearchSynthesizeWorker — happy path', () => {
  it('calls synthesizer and logs completion', async () => {
    const logger = mockLogger();
    const synthesizer = mockSynthesizer();
    synthesizer.synthesizeVertical.mockResolvedValue(
      ok({ insightIds: ['i1'], patternIds: ['p1'], llmInputTokens: 1000, llmOutputTokens: 500, llmCostUsd: 0.05 }),
    );

    const worker = createResearchSynthesizeWorker({ synthesizer: synthesizer as never, logger: logger as never, redisConnection: fakeRedis });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    await (worker as any).runJob({ verticalSlug: 'automotriz', triggeredBy: 'admin@fomo.com' });

    expect(synthesizer.synthesizeVertical).toHaveBeenCalledWith('automotriz');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('completed'),
      expect.objectContaining({ component: 'research-job-synthesize' }),
    );
  });
});

describe('ResearchSynthesizeWorker — failure', () => {
  it('throws when synthesizer returns error', async () => {
    const logger = mockLogger();
    const synthesizer = mockSynthesizer();
    synthesizer.synthesizeVertical.mockResolvedValue(
      err(new ResearchError({ message: 'parse failed', code: 'ANALYSIS_PARSE_FAILED' })),
    );

    const worker = createResearchSynthesizeWorker({ synthesizer: synthesizer as never, logger: logger as never, redisConnection: fakeRedis });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      (worker as any).runJob({ verticalSlug: 'automotriz' }),
    ).rejects.toThrow();
  });
});

describe('maybeEnqueueSynthesis', () => {
  let queue: { add: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof mockLogger>;

  beforeEach(async () => {
    const { Queue } = await import('bullmq');
    queue = new Queue('test') as unknown as { add: ReturnType<typeof vi.fn> };
    queue.add = vi.fn().mockResolvedValue({ id: 'job-1' });
    logger = mockLogger();
  });

  it('enqueues when analysis count is multiple of 5', async () => {
    const prisma = { researchAnalysis: { count: vi.fn().mockResolvedValue(10) } };

    await maybeEnqueueSynthesis(prisma as never, queue as never, 'automotriz', logger as never);

    expect(queue.add).toHaveBeenCalledWith(
      'research-synthesize-vertical',
      { verticalSlug: 'automotriz' },
      expect.objectContaining({ jobId: 'synthesis-automotriz-10' }),
    );
  });

  it('does NOT enqueue when analysis count is not multiple of 5', async () => {
    const prisma = { researchAnalysis: { count: vi.fn().mockResolvedValue(7) } };

    await maybeEnqueueSynthesis(prisma as never, queue as never, 'automotriz', logger as never);

    expect(queue.add).not.toHaveBeenCalled();
  });
});
