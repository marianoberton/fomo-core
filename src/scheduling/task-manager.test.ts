import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTaskManager } from './task-manager.js';
import type { TaskManager } from './task-manager.js';
import type { ScheduledTaskRepository } from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ScheduledTaskId, ScheduledTaskRunId, ProjectId } from '@/core/types.js';
import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskCreateInput } from './types.js';
import { NexusError, ValidationError } from '@/core/errors.js';

// ─── Sample Data ─────────────────────────────────────────────────

const sampleTask: ScheduledTask = {
  id: 'task-1' as ScheduledTaskId,
  projectId: 'proj-1' as ProjectId,
  name: 'Daily Report',
  cronExpression: '0 9 * * *',
  taskPayload: { message: 'Generate report' },
  origin: 'static',
  status: 'active',
  maxRetries: 2,
  timeoutMs: 300_000,
  budgetPerRunUSD: 1.0,
  maxDurationMinutes: 30,
  maxTurns: 10,
  runCount: 0,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const sampleInput: ScheduledTaskCreateInput = {
  projectId: 'proj-1' as ProjectId,
  name: 'Daily Report',
  cronExpression: '0 9 * * *',
  taskPayload: { message: 'Generate report' },
  origin: 'static',
};

const sampleRun: ScheduledTaskRun = {
  id: 'run-1' as ScheduledTaskRunId,
  taskId: 'task-1' as ScheduledTaskId,
  status: 'completed',
  retryCount: 0,
  createdAt: new Date('2025-01-01'),
};

// ─── Mock Repo Factory ──────────────────────────────────────────

function createMockRepo(): {
  [K in keyof ScheduledTaskRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    listByProject: vi.fn(),
    getTasksDueForExecution: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    listRuns: vi.fn(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('TaskManager', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let manager: TaskManager;

  beforeEach(() => {
    repo = createMockRepo();
    manager = createTaskManager({ repository: repo });
  });

  // ── createTask ───────────────────────────────────────────────

  describe('createTask', () => {
    it('creates a static active task and updates nextRunAt on valid cron', async () => {
      const createdTask = { ...sampleTask };
      const updatedTask = { ...sampleTask, nextRunAt: new Date('2025-06-01T09:00:00Z') };

      repo.create.mockResolvedValue(createdTask);
      repo.update.mockResolvedValue(updatedTask);

      const result = await manager.createTask(sampleInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('task-1');
      }

       
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ origin: 'static' }));

       
      expect(repo.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ nextRunAt: expect.any(Date) as Date }),
      );
    });

    it('returns err with ValidationError for invalid cron', async () => {
      const input: ScheduledTaskCreateInput = {
        ...sampleInput,
        cronExpression: 'not a cron',
      };

      const result = await manager.createTask(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }

       
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── proposeTask ──────────────────────────────────────────────

  describe('proposeTask', () => {
    it('creates a task with origin agent_proposed on valid cron', async () => {
      const proposedTask: ScheduledTask = {
        ...sampleTask,
        origin: 'agent_proposed',
        status: 'proposed',
      };

      repo.create.mockResolvedValue(proposedTask);

      const result = await manager.proposeTask(sampleInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.origin).toBe('agent_proposed');
        expect(result.value.status).toBe('proposed');
      }

       
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'agent_proposed' }),
      );
    });

    it('returns err with ValidationError for invalid cron', async () => {
      const input: ScheduledTaskCreateInput = {
        ...sampleInput,
        cronExpression: '*/invalid',
      };

      const result = await manager.proposeTask(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }

       
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── approveTask ──────────────────────────────────────────────

  describe('approveTask', () => {
    it('transitions a proposed task to active with nextRunAt', async () => {
      const proposedTask: ScheduledTask = {
        ...sampleTask,
        status: 'proposed',
        origin: 'agent_proposed',
      };
      const approvedTask: ScheduledTask = {
        ...proposedTask,
        status: 'active',
        approvedBy: 'admin',
        nextRunAt: new Date('2025-06-01T09:00:00Z'),
      };

      repo.findById.mockResolvedValue(proposedTask);
      repo.update.mockResolvedValue(approvedTask);

      const result = await manager.approveTask('task-1' as ScheduledTaskId, 'admin');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('active');
        expect(result.value.approvedBy).toBe('admin');
      }

       
      expect(repo.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'active',
          approvedBy: 'admin',
          nextRunAt: expect.any(Date) as Date,
        }),
      );
    });

    it('returns err TASK_NOT_FOUND when task does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await manager.approveTask('missing' as ScheduledTaskId, 'admin');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NexusError);
        expect(result.error.code).toBe('TASK_NOT_FOUND');
      }
    });

    it('returns err VALIDATION_ERROR when task is not in proposed status', async () => {
      const activeTask: ScheduledTask = { ...sampleTask, status: 'active' };
      repo.findById.mockResolvedValue(activeTask);

      const result = await manager.approveTask('task-1' as ScheduledTaskId, 'admin');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }

       
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // ── rejectTask ───────────────────────────────────────────────

  describe('rejectTask', () => {
    it('transitions a proposed task to rejected', async () => {
      const proposedTask: ScheduledTask = {
        ...sampleTask,
        status: 'proposed',
        origin: 'agent_proposed',
      };
      const rejectedTask: ScheduledTask = { ...proposedTask, status: 'rejected' };

      repo.findById.mockResolvedValue(proposedTask);
      repo.update.mockResolvedValue(rejectedTask);

      const result = await manager.rejectTask('task-1' as ScheduledTaskId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
      }

       
      expect(repo.update).toHaveBeenCalledWith('task-1', { status: 'rejected' });
    });

    it('returns err TASK_NOT_FOUND when task does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await manager.rejectTask('missing' as ScheduledTaskId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TASK_NOT_FOUND');
      }
    });

    it('returns err VALIDATION_ERROR when task is not in proposed status', async () => {
      const activeTask: ScheduledTask = { ...sampleTask, status: 'active' };
      repo.findById.mockResolvedValue(activeTask);

      const result = await manager.rejectTask('task-1' as ScheduledTaskId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }

       
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // ── pauseTask ────────────────────────────────────────────────

  describe('pauseTask', () => {
    it('transitions an active task to paused with null nextRunAt', async () => {
      const activeTask: ScheduledTask = { ...sampleTask, status: 'active' };
      const pausedTask: ScheduledTask = { ...activeTask, status: 'paused' };

      repo.findById.mockResolvedValue(activeTask);
      repo.update.mockResolvedValue(pausedTask);

      const result = await manager.pauseTask('task-1' as ScheduledTaskId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('paused');
      }

       
      expect(repo.update).toHaveBeenCalledWith('task-1', {
        status: 'paused',
        nextRunAt: null,
      });
    });

    it('returns err VALIDATION_ERROR when task is not active', async () => {
      const proposedTask: ScheduledTask = { ...sampleTask, status: 'proposed' };
      repo.findById.mockResolvedValue(proposedTask);

      const result = await manager.pauseTask('task-1' as ScheduledTaskId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }

       
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // ── resumeTask ───────────────────────────────────────────────

  describe('resumeTask', () => {
    it('transitions a paused task to active with new nextRunAt', async () => {
      const pausedTask: ScheduledTask = { ...sampleTask, status: 'paused' };
      const resumedTask: ScheduledTask = {
        ...pausedTask,
        status: 'active',
        nextRunAt: new Date('2025-06-01T09:00:00Z'),
      };

      repo.findById.mockResolvedValue(pausedTask);
      repo.update.mockResolvedValue(resumedTask);

      const result = await manager.resumeTask('task-1' as ScheduledTaskId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('active');
        expect(result.value.nextRunAt).toBeInstanceOf(Date);
      }

       
      expect(repo.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'active',
          nextRunAt: expect.any(Date) as Date,
        }),
      );
    });

    it('returns err VALIDATION_ERROR when task is not paused', async () => {
      const activeTask: ScheduledTask = { ...sampleTask, status: 'active' };
      repo.findById.mockResolvedValue(activeTask);

      const result = await manager.resumeTask('task-1' as ScheduledTaskId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }

       
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // ── getTask ──────────────────────────────────────────────────

  describe('getTask', () => {
    it('delegates to repo.findById', async () => {
      repo.findById.mockResolvedValue(sampleTask);

      const task = await manager.getTask('task-1' as ScheduledTaskId);

      expect(task).toEqual(sampleTask);

       
      expect(repo.findById).toHaveBeenCalledWith('task-1');
    });
  });

  // ── listTasks ────────────────────────────────────────────────

  describe('listTasks', () => {
    it('delegates to repo.listByProject', async () => {
      repo.listByProject.mockResolvedValue([sampleTask]);

      const tasks = await manager.listTasks('proj-1' as ProjectId, 'active');

      expect(tasks).toEqual([sampleTask]);

       
      expect(repo.listByProject).toHaveBeenCalledWith('proj-1', 'active');
    });
  });

  // ── listRuns ─────────────────────────────────────────────────

  describe('listRuns', () => {
    it('delegates to repo.listRuns', async () => {
      repo.listRuns.mockResolvedValue([sampleRun]);

      const runs = await manager.listRuns('task-1' as ScheduledTaskId, 10);

      expect(runs).toEqual([sampleRun]);

       
      expect(repo.listRuns).toHaveBeenCalledWith('task-1', 10);
    });
  });

  // ── validateCron ─────────────────────────────────────────────

  describe('validateCron', () => {
    it('returns ok with 3 dates for a valid cron expression', () => {
      const result = manager.validateCron('0 9 * * *');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        for (const date of result.value) {
          expect(date).toBeInstanceOf(Date);
        }
      }
    });

    it('returns err with ValidationError for an invalid cron expression', () => {
      const result = manager.validateCron('not valid cron');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
