/**
 * BullMQ worker for the `research-probes` queue.
 *
 * Handles two job types:
 *   `research-probe-run`     — runs a full probe session (calls runner.start)
 *   `research-probe-timeout` — signals a per-turn timeout (calls runner.handleTimeout)
 *
 * Retry policy: max 3 attempts with exponential backoff (§3.3a).
 * On final failure: logs an audit entry.
 */
import { Worker } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { ResearchProbeRunner } from '../runner/probe-runner.js';
import type { ResearchSessionId } from '../types.js';

// ─── Queue + payload types ────────────────────────────────────────

export const RESEARCH_PROBES_QUEUE = 'research-probes';

export interface ResearchProbeRunPayload {
  sessionId: string;
}

export interface ResearchProbeTimeoutPayload {
  sessionId: string;
  turnOrder: number;
}

type ProbeJobPayload = ResearchProbeRunPayload | ResearchProbeTimeoutPayload;

// ─── Worker deps ──────────────────────────────────────────────────

export interface ResearchProbeRunWorkerDeps {
  runner: ResearchProbeRunner;
  logger: Logger;
  redisConnection: { host: string; port: number; password?: string };
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create and start a BullMQ Worker for the research-probes queue.
 * Concurrency defaults to 3 (one per simultaneous active session).
 *
 * Shutdown: call `worker.close()` during graceful shutdown.
 */
export function createResearchProbeRunWorker(
  deps: ResearchProbeRunWorkerDeps,
): Worker<ProbeJobPayload> {
  const { runner, logger, redisConnection } = deps;

  const worker = new Worker<ProbeJobPayload>(
    RESEARCH_PROBES_QUEUE,
    async (job) => {
      if (job.name === 'research-probe-run') {
        const { sessionId } = job.data as ResearchProbeRunPayload;

        logger.info('research job: probe-run started', {
          component: 'research-job-probe-run',
          sessionId,
          attempt: job.attemptsMade + 1,
        });

        await runner.start(sessionId as ResearchSessionId);

        logger.info('research job: probe-run completed', {
          component: 'research-job-probe-run',
          sessionId,
        });
        return;
      }

      if (job.name === 'research-probe-timeout') {
        const { sessionId, turnOrder } = job.data as ResearchProbeTimeoutPayload;

        logger.info('research job: probe-timeout fired', {
          component: 'research-job-probe-run',
          sessionId,
          turnOrder,
        });

        await runner.handleTimeout(sessionId as ResearchSessionId, turnOrder);
        return;
      }

      logger.warn('research job: unknown job name', {
        component: 'research-job-probe-run',
        jobName: job.name,
      });
    },
    {
      connection: redisConnection,
      concurrency: 3,
      // Long lock duration — probe sessions can wait several minutes for responses
      lockDuration: 30 * 60 * 1000,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 3);
    const sessionId = (job.data as ResearchProbeRunPayload).sessionId ?? 'unknown';

    logger.error('research job: probe-run failed', {
      component: 'research-job-probe-run',
      jobId: job.id,
      jobName: job.name,
      sessionId,
      attempt: job.attemptsMade,
      isFinalAttempt,
      error: error.message,
    });
  });

  worker.on('error', (error) => {
    logger.error('research job: worker error', {
      component: 'research-job-probe-run',
      error: error.message,
    });
  });

  return worker;
}
