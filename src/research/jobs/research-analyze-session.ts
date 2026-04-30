/**
 * BullMQ worker for the `research-analysis` queue.
 *
 * Handles one job type:
 *   `research-analyze-session` — runs the full analysis pipeline for a
 *                                 completed probe session.
 *
 * Enqueued by probe-runner.ts after a session reaches `completed` status.
 * Retry policy: max 2 attempts (analysis is expensive — don't retry blindly).
 */
import { Worker, Queue } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { ResearchAnalyzer } from '../analysis/analyzer.js';
import type { ResearchSessionId } from '../types.js';

// ─── Queue name + payload ─────────────────────────────────────────

export const RESEARCH_ANALYSIS_QUEUE = 'research-analysis';

export interface ResearchAnalyzeSessionPayload {
  sessionId: string;
  /** Optional model override for this run (e.g. from manual re-run). */
  modelOverride?: string;
}

// ─── Worker deps ──────────────────────────────────────────────────

export interface ResearchAnalyzeWorkerDeps {
  analyzer: ResearchAnalyzer;
  logger: Logger;
  redisConnection: { host: string; port: number; password?: string };
}

// ─── Queue factory (for enqueueing from other workers / routes) ───

export function createResearchAnalysisQueue(
  redisConnection: { host: string; port: number; password?: string },
): Queue<ResearchAnalyzeSessionPayload> {
  return new Queue<ResearchAnalyzeSessionPayload>(RESEARCH_ANALYSIS_QUEUE, {
    connection: redisConnection,
  });
}

// ─── Worker factory ───────────────────────────────────────────────

/**
 * Create and start a BullMQ Worker for the research-analysis queue.
 * Low concurrency (1) because analysis calls are expensive LLM operations.
 */
export function createResearchAnalyzeWorker(
  deps: ResearchAnalyzeWorkerDeps,
): Worker<ResearchAnalyzeSessionPayload> {
  const { analyzer, logger, redisConnection } = deps;

  const worker = new Worker<ResearchAnalyzeSessionPayload>(
    RESEARCH_ANALYSIS_QUEUE,
    async (job) => {
      const { sessionId, modelOverride } = job.data;

      logger.info('research job: analyze-session started', {
        component: 'research-job-analyze',
        sessionId,
        modelOverride,
        attempt: job.attemptsMade + 1,
      });

      const result = await analyzer.analyze(sessionId as ResearchSessionId, { modelOverride });

      if (!result.ok) {
        logger.error('research job: analyze-session failed (result err)', {
          component: 'research-job-analyze',
          sessionId,
          code: result.error.researchCode,
          error: result.error.message,
        });
        // Throw so BullMQ retries if attempts remain
        throw result.error;
      }

      logger.info('research job: analyze-session completed', {
        component: 'research-job-analyze',
        sessionId,
        analysisId: result.value.id,
        scoreTotal: result.value.scoreTotal,
      });
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Analysis can take up to 2 min for Opus on long transcripts
      lockDuration: 5 * 60 * 1000,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 2);
    const { sessionId } = job.data;

    logger.error('research job: analyze-session worker failure', {
      component: 'research-job-analyze',
      jobId: job.id,
      sessionId,
      attempt: job.attemptsMade,
      isFinalAttempt,
      error: error.message,
    });
  });

  worker.on('error', (error) => {
    logger.error('research job: analyze worker error', {
      component: 'research-job-analyze',
      error: error.message,
    });
  });

  return worker;
}
