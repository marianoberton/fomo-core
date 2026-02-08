/**
 * TaskRunner — BullMQ-based scheduled task execution.
 *
 * Scheduler loop runs every minute, queries tasks due for execution,
 * and enqueues BullMQ jobs. Worker processes jobs by creating agent
 * runs with the task's payload.
 *
 * Conditional startup: only starts if REDIS_URL is set.
 */
import { Queue, Worker } from 'bullmq';
import { CronExpressionParser } from 'cron-parser';
import type { Logger } from '@/observability/logger.js';
import type {
  ScheduledTaskRepository,
} from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ScheduledTask } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TaskRunnerOptions {
  repository: ScheduledTaskRepository;
  logger: Logger;
  /** Redis connection URL. */
  redisUrl: string;
  /** Poll interval in milliseconds. Defaults to 60_000 (1 minute). */
  pollIntervalMs?: number;
  /** Callback invoked for each task execution. Returns trace data. */
  onExecuteTask: (task: ScheduledTask) => Promise<TaskExecutionResult>;
}

export interface TaskExecutionResult {
  success: boolean;
  traceId?: string;
  tokensUsed?: number;
  costUsd?: number;
  result?: Record<string, unknown>;
  errorMessage?: string;
}

export interface TaskRunner {
  /** Start the scheduler loop and worker. */
  start(): Promise<void>;
  /** Stop the scheduler loop, close queue and worker. */
  stop(): Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Compute the next run time from a cron expression. */
function computeNextRunAt(cronExpression: string, from?: Date): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: from ?? new Date(),
  });
  return interval.next().toDate();
}

/** Parse Redis URL into host/port/password for BullMQ connection. */
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
  };
}

// ─── Factory ────────────────────────────────────────────────────

const QUEUE_NAME = 'scheduled-tasks';

/** Create a TaskRunner backed by BullMQ. */
export function createTaskRunner(options: TaskRunnerOptions): TaskRunner {
  const {
    repository,
    logger,
    redisUrl,
    pollIntervalMs = 60_000,
    onExecuteTask,
  } = options;

  const connection = parseRedisUrl(redisUrl);

  let queue: Queue | null = null;
  let worker: Worker | null = null;
  let schedulerInterval: ReturnType<typeof setInterval> | null = null;

  /** Poll for due tasks and enqueue them. */
  async function pollAndEnqueue(): Promise<void> {
    try {
      const now = new Date();
      const dueTasks = await repository.getTasksDueForExecution(now);

      for (const task of dueTasks) {
        // Check if task has hit maxRuns
        if (task.maxRuns !== undefined && task.runCount >= task.maxRuns) {
          await repository.update(task.id, { status: 'completed', nextRunAt: null });
          logger.info('Task completed (maxRuns reached)', {
            component: 'task-runner',
            taskId: task.id,
            runCount: task.runCount,
            maxRuns: task.maxRuns,
          });
          continue;
        }

        // Check if task has expired
        if (task.expiresAt && task.expiresAt <= now) {
          await repository.update(task.id, { status: 'expired', nextRunAt: null });
          logger.info('Task expired', {
            component: 'task-runner',
            taskId: task.id,
            expiresAt: task.expiresAt.toISOString(),
          });
          continue;
        }

        // Enqueue the task
        if (queue) {
          await queue.add(`task-${task.id}`, { taskId: task.id }, {
            removeOnComplete: 100,
            removeOnFail: 100,
          });
        }

        // Calculate next run time immediately
        const nextRunAt = computeNextRunAt(task.cronExpression, now);
        await repository.update(task.id, { nextRunAt });

        logger.debug('Enqueued scheduled task', {
          component: 'task-runner',
          taskId: task.id,
          nextRunAt: nextRunAt.toISOString(),
        });
      }
    } catch (error) {
      logger.error('Scheduler poll failed', {
        component: 'task-runner',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async start(): Promise<void> {
      queue = new Queue(QUEUE_NAME, { connection });

      worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          const taskId = job.data.taskId as string;
          const task = await repository.findById(taskId as Parameters<typeof repository.findById>[0]);

          if (!task || task.status !== 'active') {
            logger.warn('Skipping task execution (not active)', {
              component: 'task-runner',
              taskId,
              status: task?.status,
            });
            return;
          }

          // Create run record
          const run = await repository.createRun({ taskId: task.id });

          // Mark run as started
          const startedAt = new Date();
          await repository.updateRun(run.id, { status: 'running', startedAt });

          try {
            // Execute with timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error('Task execution timeout'));
              }, task.timeoutMs);
            });

            const executionResult = await Promise.race([
              onExecuteTask(task),
              timeoutPromise,
            ]);

            const completedAt = new Date();
            const durationMs = completedAt.getTime() - startedAt.getTime();

            await repository.updateRun(run.id, {
              status: executionResult.success ? 'completed' : 'failed',
              completedAt,
              durationMs,
              tokensUsed: executionResult.tokensUsed,
              costUsd: executionResult.costUsd,
              traceId: executionResult.traceId as Parameters<typeof repository.updateRun>[1]['traceId'],
              result: executionResult.result,
              errorMessage: executionResult.errorMessage,
            });

            // Update task counters
            await repository.update(task.id, {
              lastRunAt: startedAt,
              runCount: task.runCount + 1,
            });

            logger.info('Task execution completed', {
              component: 'task-runner',
              taskId: task.id,
              runId: run.id,
              success: executionResult.success,
              durationMs,
            });
          } catch (error) {
            const completedAt = new Date();
            const durationMs = completedAt.getTime() - startedAt.getTime();
            const errorMessage = error instanceof Error ? error.message : String(error);

            const status = errorMessage === 'Task execution timeout' ? 'timeout' : 'failed';

            await repository.updateRun(run.id, {
              status,
              completedAt,
              durationMs,
              errorMessage,
            });

            // Update task counters even on failure
            await repository.update(task.id, {
              lastRunAt: startedAt,
              runCount: task.runCount + 1,
            });

            logger.error('Task execution failed', {
              component: 'task-runner',
              taskId: task.id,
              runId: run.id,
              error: errorMessage,
            });
          }
        },
        { connection, concurrency: 5 },
      );

      worker.on('error', (error) => {
        logger.error('BullMQ worker error', {
          component: 'task-runner',
          error: error.message,
        });
      });

      // Start polling loop
      schedulerInterval = setInterval(() => void pollAndEnqueue(), pollIntervalMs);
      // Initial poll
      await pollAndEnqueue();

      logger.info('Task runner started', {
        component: 'task-runner',
        pollIntervalMs,
        queueName: QUEUE_NAME,
      });
    },

    async stop(): Promise<void> {
      if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
      }

      if (worker) {
        await worker.close();
        worker = null;
      }

      if (queue) {
        await queue.close();
        queue = null;
      }

      logger.info('Task runner stopped', { component: 'task-runner' });
    },
  };
}
