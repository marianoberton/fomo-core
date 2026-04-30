/**
 * BullMQ repeatable job: `research-schedule-tick`.
 *
 * Runs every hour (every: 60 * 60 * 1000). Each tick calls
 * `scheduleManager.processDueSchedules()`, which finds all active
 * schedules with `nextRunAt <= now`, creates probe sessions, and
 * advances `nextRunAt`.
 *
 * Startup: enqueue the repeatable job (idempotent — BullMQ deduplicates
 * by `jobId`). A Worker processes each tick invocation.
 */
import { Queue, Worker } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { ResearchScheduleManager } from '../scheduling/schedule-manager.js';

// ─── Queue name + constants ────────────────────────────────────────

export const RESEARCH_SCHEDULE_TICK_QUEUE = 'research-schedule-tick';
const TICK_JOB_NAME = 'research-schedule-tick';
const TICK_EVERY_MS = 60 * 60 * 1000; // 1 hour

// ─── Worker deps ──────────────────────────────────────────────────

export interface ResearchScheduleTickWorkerDeps {
  scheduleManager: ResearchScheduleManager;
  logger: Logger;
  redisConnection: { host: string; port: number; password?: string };
}

// ─── Queue factory ────────────────────────────────────────────────

export function createResearchScheduleTickQueue(
  redisConnection: { host: string; port: number; password?: string },
): Queue {
  return new Queue(RESEARCH_SCHEDULE_TICK_QUEUE, { connection: redisConnection });
}

// ─── Repeatable job setup ─────────────────────────────────────────

/**
 * Register the hourly repeatable job (idempotent — safe to call on every
 * server boot). BullMQ deduplicates by the `repeat.every` fingerprint.
 */
export async function startResearchScheduleTickRepeatable(
  queue: Queue,
  logger: Logger,
): Promise<void> {
  await queue.add(
    TICK_JOB_NAME,
    {},
    {
      repeat: { every: TICK_EVERY_MS },
      jobId: `${TICK_JOB_NAME}-repeatable`,
    },
  );

  logger.info('research scheduler: repeatable tick registered', {
    component: 'research-job-schedule-tick',
    everyMs: TICK_EVERY_MS,
  });
}

// ─── Worker factory ───────────────────────────────────────────────

/**
 * Create and start the BullMQ Worker that processes schedule-tick jobs.
 * Concurrency 1 — tick jobs are lightweight but sequential to avoid
 * duplicate session creation.
 */
export function createResearchScheduleTickWorker(
  deps: ResearchScheduleTickWorkerDeps,
): Worker {
  const { scheduleManager, logger, redisConnection } = deps;

  const worker = new Worker(
    RESEARCH_SCHEDULE_TICK_QUEUE,
    async () => {
      logger.info('research scheduler: tick job started', {
        component: 'research-job-schedule-tick',
      });

      const result = await scheduleManager.processDueSchedules();

      logger.info('research scheduler: tick job completed', {
        component: 'research-job-schedule-tick',
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
      });
    },
    {
      connection: redisConnection,
      concurrency: 1,
      lockDuration: 5 * 60 * 1000,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error('research scheduler: tick job failed', {
      component: 'research-job-schedule-tick',
      jobId: job?.id,
      error: error.message,
    });
  });

  worker.on('error', (error) => {
    logger.error('research scheduler: tick worker error', {
      component: 'research-job-schedule-tick',
      error: error.message,
    });
  });

  return worker;
}
