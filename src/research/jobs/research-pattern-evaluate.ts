/**
 * BullMQ delayed job for the `research-pattern-evaluate` queue.
 *
 * Enqueued 30 days after a PromptPatternUse is created.
 * Compares scoreAtInsertion vs current template score to determine outcome.
 *
 * Auto-supersedes a pattern if >5 uses and >50% are regressed.
 */
import { Worker, Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { PatternUseRepository } from '../repositories/pattern-use-repository.js';
import type { PatternRepository } from '../repositories/pattern-repository.js';
import type { PromptPatternUseId, PromptPatternId } from '../types.js';

// ─── Constants ───────────────────────────────────────────────────

export const RESEARCH_PATTERN_EVALUATE_QUEUE = 'research-pattern-evaluate';
const DELAY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Outcome thresholds (§6.4a)
const IMPROVED_DELTA = 0.5;
const REGRESSED_DELTA = -0.3;
const AUTO_SUPERSEDE_MIN_USES = 5;
const AUTO_SUPERSEDE_REGRESSED_RATIO = 0.5;

// ─── Payload ─────────────────────────────────────────────────────

export interface ResearchPatternEvaluatePayload {
  patternUseId: string;
  patternId: string;
}

// ─── Worker deps ──────────────────────────────────────────────────

export interface ResearchPatternEvaluateWorkerDeps {
  prisma: PrismaClient;
  patternUseRepo: PatternUseRepository;
  patternRepo: PatternRepository;
  logger: Logger;
  redisConnection: { host: string; port: number; password?: string };
  /** Injected for testing — fetches current avg score for a template. */
  fetchCurrentTemplateScore?: (templateSlug: string) => Promise<number | null>;
}

// ─── Queue factory ────────────────────────────────────────────────

export function createResearchPatternEvaluateQueue(
  redisConnection: { host: string; port: number; password?: string },
): Queue<ResearchPatternEvaluatePayload> {
  return new Queue<ResearchPatternEvaluatePayload>(RESEARCH_PATTERN_EVALUATE_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: 200,
      removeOnFail: 100,
    },
  });
}

/**
 * Enqueue a delayed evaluation job 30 days after a PromptPatternUse is created.
 */
export async function enqueuePatternEvaluate(
  queue: Queue<ResearchPatternEvaluatePayload>,
  patternUseId: string,
  patternId: string,
): Promise<void> {
  await queue.add(
    'research-pattern-evaluate',
    { patternUseId, patternId },
    {
      delay: DELAY_MS,
      jobId: `evaluate-use-${patternUseId}`,
    },
  );
}

// ─── Default score fetcher (no-op — real implementation needs agent scoring module) ──

async function defaultFetchScore(_templateSlug: string): Promise<number | null> {
  return null;
}

// ─── Worker factory ───────────────────────────────────────────────

export function createResearchPatternEvaluateWorker(
  deps: ResearchPatternEvaluateWorkerDeps,
): Worker<ResearchPatternEvaluatePayload> {
  const { patternUseRepo, patternRepo, logger, redisConnection } = deps;
  const fetchScore = deps.fetchCurrentTemplateScore ?? defaultFetchScore;

  const worker = new Worker<ResearchPatternEvaluatePayload>(
    RESEARCH_PATTERN_EVALUATE_QUEUE,
    async (job) => {
      const { patternUseId, patternId } = job.data;

      logger.info('research job: pattern-evaluate started', {
        component: 'research-job-pattern-evaluate',
        patternUseId,
        patternId,
      });

      // Load the use record
      const use = await patternUseRepo.findById(patternUseId as PromptPatternUseId);
      if (!use) {
        logger.warn('research job: pattern-evaluate — use not found, skipping', {
          component: 'research-job-pattern-evaluate',
          patternUseId,
        });
        return;
      }

      if (use.outcome !== null) {
        logger.info('research job: pattern-evaluate — already evaluated, skipping', {
          component: 'research-job-pattern-evaluate',
          patternUseId,
        });
        return;
      }

      // Fetch current template score
      const scoreAfter = await fetchScore(use.agentTemplateSlug);

      if (scoreAfter === null) {
        logger.info('research job: pattern-evaluate — no current score available, skipping', {
          component: 'research-job-pattern-evaluate',
          patternUseId,
          agentTemplateSlug: use.agentTemplateSlug,
        });
        return;
      }

      const baseline = use.scoreAtInsertion ?? scoreAfter;
      const delta = scoreAfter - baseline;

      const outcome =
        delta > IMPROVED_DELTA ? 'improved' :
        delta < REGRESSED_DELTA ? 'regressed' :
        'neutral';

      await patternUseRepo.updateOutcome(patternUseId as PromptPatternUseId, { scoreAfter, outcome });

      logger.info('research job: pattern-evaluate outcome recorded', {
        component: 'research-job-pattern-evaluate',
        patternUseId,
        patternId,
        outcome,
        delta: delta.toFixed(2),
      });

      // Check auto-supersede
      const counts = await patternUseRepo.countByOutcome(patternId as PromptPatternId);
      const totalWithOutcome = counts.reduce((sum, c) => sum + c.count, 0);
      const regressedCount = counts.find((c) => c.outcome === 'regressed')?.count ?? 0;

      if (
        totalWithOutcome > AUTO_SUPERSEDE_MIN_USES &&
        regressedCount / totalWithOutcome > AUTO_SUPERSEDE_REGRESSED_RATIO
      ) {
        await patternRepo.markSuperseded(patternId as PromptPatternId);

        logger.warn('research job: pattern auto-superseded due to high regression rate', {
          component: 'research-job-pattern-evaluate',
          patternId,
          totalWithOutcome,
          regressedCount,
          ratio: (regressedCount / totalWithOutcome).toFixed(2),
        });
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    logger.error('research job: pattern-evaluate worker failure', {
      component: 'research-job-pattern-evaluate',
      jobId: job.id,
      patternUseId: job.data.patternUseId,
      error: error.message,
    });
  });

  worker.on('error', (error) => {
    logger.error('research job: pattern-evaluate worker error', {
      component: 'research-job-pattern-evaluate',
      error: error.message,
    });
  });

  return worker;
}
