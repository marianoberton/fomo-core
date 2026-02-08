/**
 * TaskManager — business logic for scheduled task lifecycle.
 *
 * Handles proposing, approving, rejecting, pausing, resuming tasks,
 * and computing next run times from cron expressions.
 */
import { CronExpressionParser } from 'cron-parser';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { NexusError, ValidationError } from '@/core/errors.js';
import type { ProjectId, ScheduledTaskId } from '@/core/types.js';
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskCreateInput,
} from './types.js';
import type {
  ScheduledTaskRepository,
  ScheduledTaskUpdateInput,
} from '@/infrastructure/repositories/scheduled-task-repository.js';

// ─── Interface ──────────────────────────────────────────────────

export interface TaskManager {
  /** Create a task directly (origin: static, starts as active). */
  createTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>>;
  /** Propose a task from an agent (origin: agent_proposed, starts as proposed). */
  proposeTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>>;
  /** Approve a proposed task — transitions to active and calculates nextRunAt. */
  approveTask(id: ScheduledTaskId, approvedBy: string): Promise<Result<ScheduledTask, NexusError>>;
  /** Reject a proposed task. */
  rejectTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>>;
  /** Pause an active task — stops scheduling runs. */
  pauseTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>>;
  /** Resume a paused task — restores to active with new nextRunAt. */
  resumeTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>>;
  /** Get a task by ID. */
  getTask(id: ScheduledTaskId): Promise<ScheduledTask | null>;
  /** List tasks for a project with optional status filter. */
  listTasks(projectId: ProjectId, status?: string): Promise<ScheduledTask[]>;
  /** List runs for a task. */
  listRuns(taskId: ScheduledTaskId, limit?: number): Promise<ScheduledTaskRun[]>;
  /** Validate a cron expression. Returns the next 3 run times on success. */
  validateCron(cronExpression: string): Result<Date[], NexusError>;
}

// ─── Options ────────────────────────────────────────────────────

export interface TaskManagerOptions {
  repository: ScheduledTaskRepository;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Parse a cron expression and compute the next N run times. */
function computeNextRuns(cronExpression: string, count: number, from?: Date): Date[] {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: from ?? new Date(),
  });

  const runs: Date[] = [];
  for (let i = 0; i < count; i++) {
    runs.push(interval.next().toDate());
  }
  return runs;
}

/** Validate a cron expression. Returns null if valid, error message if invalid. */
function validateCronExpression(cronExpression: string): string | null {
  try {
    CronExpressionParser.parse(cronExpression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a TaskManager instance. */
export function createTaskManager(options: TaskManagerOptions): TaskManager {
  const { repository } = options;

  return {
    async createTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>> {
      const cronError = validateCronExpression(input.cronExpression);
      if (cronError) {
        return err(new ValidationError(`Invalid cron expression: ${cronError}`, {
          cronExpression: input.cronExpression,
        }));
      }

      // Static tasks start as active
      const taskInput: ScheduledTaskCreateInput = {
        ...input,
        origin: 'static',
      };

      const task = await repository.create(taskInput);

      // Calculate first run time
      const nextRuns = computeNextRuns(task.cronExpression, 1);
      const nextRunAt = nextRuns[0];
      if (nextRunAt) {
        const updated = await repository.update(task.id, { nextRunAt });
        if (updated) return ok(updated);
      }

      return ok(task);
    },

    async proposeTask(input: ScheduledTaskCreateInput): Promise<Result<ScheduledTask, NexusError>> {
      const cronError = validateCronExpression(input.cronExpression);
      if (cronError) {
        return err(new ValidationError(`Invalid cron expression: ${cronError}`, {
          cronExpression: input.cronExpression,
        }));
      }

      const taskInput: ScheduledTaskCreateInput = {
        ...input,
        origin: 'agent_proposed',
      };

      const task = await repository.create(taskInput);
      return ok(task);
    },

    async approveTask(
      id: ScheduledTaskId,
      approvedBy: string,
    ): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'proposed') {
        return err(new ValidationError(
          `Cannot approve task in status '${task.status}'. Only 'proposed' tasks can be approved.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const nextRuns = computeNextRuns(task.cronExpression, 1);
      const nextRunAt = nextRuns[0];

      const updateData: ScheduledTaskUpdateInput = {
        status: 'active',
        approvedBy,
        nextRunAt,
      };

      const updated = await repository.update(id, updateData);
      if (!updated) {
        return err(new NexusError({
          message: `Failed to approve task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async rejectTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'proposed') {
        return err(new ValidationError(
          `Cannot reject task in status '${task.status}'. Only 'proposed' tasks can be rejected.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const updated = await repository.update(id, { status: 'rejected' });
      if (!updated) {
        return err(new NexusError({
          message: `Failed to reject task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async pauseTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'active') {
        return err(new ValidationError(
          `Cannot pause task in status '${task.status}'. Only 'active' tasks can be paused.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const updated = await repository.update(id, { status: 'paused', nextRunAt: null });
      if (!updated) {
        return err(new NexusError({
          message: `Failed to pause task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async resumeTask(id: ScheduledTaskId): Promise<Result<ScheduledTask, NexusError>> {
      const task = await repository.findById(id);
      if (!task) {
        return err(new NexusError({
          message: `Scheduled task not found: ${id}`,
          code: 'TASK_NOT_FOUND',
          statusCode: 404,
        }));
      }

      if (task.status !== 'paused') {
        return err(new ValidationError(
          `Cannot resume task in status '${task.status}'. Only 'paused' tasks can be resumed.`,
          { taskId: id, currentStatus: task.status },
        ));
      }

      const nextRuns = computeNextRuns(task.cronExpression, 1);
      const nextRunAt = nextRuns[0];

      const updated = await repository.update(id, { status: 'active', nextRunAt });
      if (!updated) {
        return err(new NexusError({
          message: `Failed to resume task: ${id}`,
          code: 'TASK_UPDATE_FAILED',
          statusCode: 500,
        }));
      }

      return ok(updated);
    },

    async getTask(id: ScheduledTaskId): Promise<ScheduledTask | null> {
      return repository.findById(id);
    },

    async listTasks(projectId: ProjectId, status?: string): Promise<ScheduledTask[]> {
      const validStatuses = ['proposed', 'active', 'paused', 'rejected', 'completed', 'expired'];
      const taskStatus = status && validStatuses.includes(status)
        ? status as ScheduledTask['status']
        : undefined;
      return repository.listByProject(projectId, taskStatus);
    },

    async listRuns(taskId: ScheduledTaskId, limit?: number): Promise<ScheduledTaskRun[]> {
      return repository.listRuns(taskId, limit);
    },

    validateCron(cronExpression: string): Result<Date[], NexusError> {
      const cronError = validateCronExpression(cronExpression);
      if (cronError) {
        return err(new ValidationError(`Invalid cron expression: ${cronError}`, {
          cronExpression,
        }));
      }

      const nextRuns = computeNextRuns(cronExpression, 3);
      return ok(nextRuns);
    },
  };
}
