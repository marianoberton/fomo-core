/**
 * BullMQ worker for the `research-synthesis` queue.
 *
 * Handles one job type:
 *   `research-synthesize-vertical` — runs the synthesis pipeline for a
 *                                     vertical and persists insights + patterns.
 *
 * Triggered automatically by analyzer.ts when a vertical reaches 5 new analyses
 * without a corresponding synthesis, or manually via:
 *   POST /research/verticals/:slug/synthesize
 *
 * Retry policy: max 1 attempt (synthesis is expensive, failures need human review).
 */
import { Worker, Queue } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { Synthesizer } from '../synthesis/synthesizer.js';

// ─── Queue name + payload ─────────────────────────────────────────

export const RESEARCH_SYNTHESIS_QUEUE = 'research-synthesis';

export interface ResearchSynthesizeVerticalPayload {
  verticalSlug: string;
  /** Optional: email of person who triggered the manual synthesis. */
  triggeredBy?: string;
}

// ─── Worker deps ──────────────────────────────────────────────────

export interface ResearchSynthesizeWorkerDeps {
  synthesizer: Synthesizer;
  logger: Logger;
  redisConnection: { host: string; port: number; password?: string };
}

// ─── Queue factory (for enqueueing from routes / analyzer) ────────

export function createResearchSynthesisQueue(
  redisConnection: { host: string; port: number; password?: string },
): Queue<ResearchSynthesizeVerticalPayload> {
  return new Queue<ResearchSynthesizeVerticalPayload>(RESEARCH_SYNTHESIS_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });
}

// ─── Worker factory ───────────────────────────────────────────────

export function createResearchSynthesizeWorker(
  deps: ResearchSynthesizeWorkerDeps,
): Worker<ResearchSynthesizeVerticalPayload> {
  const { synthesizer, logger, redisConnection } = deps;

  const worker = new Worker<ResearchSynthesizeVerticalPayload>(
    RESEARCH_SYNTHESIS_QUEUE,
    async (job) => {
      const { verticalSlug, triggeredBy } = job.data;

      logger.info('research job: synthesize-vertical started', {
        component: 'research-job-synthesize',
        verticalSlug,
        triggeredBy: triggeredBy ?? 'auto',
        jobId: job.id,
      });

      const result = await synthesizer.synthesizeVertical(verticalSlug);

      if (!result.ok) {
        logger.error('research job: synthesize-vertical failed', {
          component: 'research-job-synthesize',
          verticalSlug,
          code: result.error.researchCode,
          error: result.error.message,
        });
        throw result.error;
      }

      logger.info('research job: synthesize-vertical completed', {
        component: 'research-job-synthesize',
        verticalSlug,
        insightCount: result.value.insightIds.length,
        patternCount: result.value.patternIds.length,
        costUsd: result.value.llmCostUsd.toFixed(4),
      });
    },
    {
      connection: redisConnection,
      concurrency: 1,
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;

    logger.error('research job: synthesize worker failure', {
      component: 'research-job-synthesize',
      jobId: job.id,
      verticalSlug: job.data.verticalSlug,
      attempt: job.attemptsMade,
      error: error.message,
    });
  });

  worker.on('error', (error) => {
    logger.error('research job: synthesize worker error', {
      component: 'research-job-synthesize',
      error: error.message,
    });
  });

  return worker;
}

// ─── Auto-trigger helper (called from analyzer.ts hook) ──────────

/**
 * Enqueue a synthesis job if the vertical has accumulated 5 new analyses
 * since the last synthesis (checked via unsynthesized count).
 *
 * This is the only place that modifies behavior outside P6 scope —
 * analyzer.ts calls this after persisting an analysis.
 */
export async function maybeEnqueueSynthesis(
  prisma: { researchAnalysis: { count(args: unknown): Promise<number> } },
  queue: Queue<ResearchSynthesizeVerticalPayload>,
  verticalSlug: string,
  logger: Logger,
): Promise<void> {
  // Count analyses that have no corresponding insight yet (rough proxy)
  const analysisCount = await prisma.researchAnalysis.count({
    where: {
      session: {
        target: { verticalSlug },
      },
    },
  });

  // Trigger every 5 analyses (simple modulo threshold)
  if (analysisCount > 0 && analysisCount % 5 === 0) {
    await queue.add('research-synthesize-vertical', { verticalSlug }, {
      jobId: `synthesis-${verticalSlug}-${analysisCount}`,
      attempts: 1,
    });

    logger.info('research: auto-enqueued synthesis job', {
      component: 'research-job-synthesize',
      verticalSlug,
      analysisCount,
    });
  }
}
