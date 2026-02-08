import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectId, ScheduledTaskId, ScheduledTaskRunId, TraceId } from '@/core/types.js';
import {
  createScheduledTaskRepository,
  type ScheduledTaskRepository,
} from './scheduled-task-repository.js';

// ─── Mock Prisma ─────────────────────────────────────────────────

function createMockPrisma() {
  return {
    scheduledTask: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    scheduledTaskRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

// ─── Fixtures ────────────────────────────────────────────────────

const rawTask = {
  id: 'task-1',
  projectId: 'proj-1',
  name: 'Daily Report',
  description: null,
  cronExpression: '0 9 * * *',
  taskPayload: { message: 'Generate report' },
  origin: 'static',
  status: 'active',
  proposedBy: null,
  approvedBy: null,
  maxRetries: 2,
  timeoutMs: 300000,
  budgetPerRunUsd: 1.0,
  maxDurationMinutes: 30,
  maxTurns: 10,
  maxRuns: null,
  runCount: 0,
  lastRunAt: null,
  nextRunAt: null,
  expiresAt: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const rawRun = {
  id: 'run-1',
  taskId: 'task-1',
  status: 'pending',
  startedAt: null,
  completedAt: null,
  durationMs: null,
  tokensUsed: null,
  costUsd: null,
  traceId: null,
  result: null,
  errorMessage: null,
  retryCount: 0,
  createdAt: new Date('2025-01-01'),
};

// ─── Tests ──────────────────────────────────────────────────────

describe('ScheduledTaskRepository', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let repo: ScheduledTaskRepository;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    repo = createScheduledTaskRepository(mockPrisma as never);
  });

  describe('create', () => {
    it('returns a mapped ScheduledTask', async () => {
      mockPrisma.scheduledTask.create.mockResolvedValue(rawTask);

      const result = await repo.create({
        projectId: 'proj-1' as ProjectId,
        name: 'Daily Report',
        cronExpression: '0 9 * * *',
        taskPayload: { message: 'Generate report' },
        origin: 'static',
      });

      expect(result.id).toBe('task-1');
      expect(result.projectId).toBe('proj-1');
      expect(result.name).toBe('Daily Report');
      expect(result.description).toBeUndefined();
      expect(result.budgetPerRunUSD).toBe(1.0);
      expect(result.taskPayload).toEqual({ message: 'Generate report' });
      expect(result.maxRuns).toBeUndefined();
      expect(result.lastRunAt).toBeUndefined();
      expect(result.nextRunAt).toBeUndefined();
      expect(result.expiresAt).toBeUndefined();
    });

    it('sets status to proposed for agent_proposed origin', async () => {
      const proposedTask = {
        ...rawTask,
        origin: 'agent_proposed',
        status: 'proposed',
        proposedBy: 'agent-session-1',
      };
      mockPrisma.scheduledTask.create.mockResolvedValue(proposedTask);

      const result = await repo.create({
        projectId: 'proj-1' as ProjectId,
        name: 'Daily Report',
        cronExpression: '0 9 * * *',
        taskPayload: { message: 'Generate report' },
        origin: 'agent_proposed',
        proposedBy: 'agent-session-1',
      });

      expect(result.status).toBe('proposed');
      expect(result.proposedBy).toBe('agent-session-1');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          origin: 'agent_proposed',
          status: 'proposed',
          proposedBy: 'agent-session-1',
        }),
      });
    });
  });

  describe('findById', () => {
    it('returns a mapped task when found', async () => {
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(rawTask);

      const result = await repo.findById('task-1' as ScheduledTaskId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('task-1');
      expect(result?.budgetPerRunUSD).toBe(1.0);
      expect(result?.description).toBeUndefined();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTask.findUnique).toHaveBeenCalledWith({
        where: { id: 'task-1' },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(null);

      const result = await repo.findById('missing' as ScheduledTaskId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('returns the updated task', async () => {
      const updatedRaw = {
        ...rawTask,
        status: 'paused',
        approvedBy: 'admin-1',
      };
      mockPrisma.scheduledTask.update.mockResolvedValue(updatedRaw);

      const result = await repo.update('task-1' as ScheduledTaskId, {
        status: 'paused',
        approvedBy: 'admin-1',
      });

      expect(result).not.toBeNull();
      expect(result?.status).toBe('paused');
      expect(result?.approvedBy).toBe('admin-1');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: 'paused',
          approvedBy: 'admin-1',
          lastRunAt: undefined,
          nextRunAt: undefined,
          runCount: undefined,
        },
      });
    });

    it('returns null when task not found (catch block)', async () => {
      mockPrisma.scheduledTask.update.mockRejectedValue(new Error('not found'));

      const result = await repo.update('missing' as ScheduledTaskId, {
        status: 'active',
      });

      expect(result).toBeNull();
    });
  });

  describe('listByProject', () => {
    it('returns mapped tasks', async () => {
      mockPrisma.scheduledTask.findMany.mockResolvedValue([rawTask]);

      const result = await repo.listByProject('proj-1' as ProjectId);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('task-1');
      expect(result[0]?.budgetPerRunUSD).toBe(1.0);
      expect(result[0]?.description).toBeUndefined();
    });

    it('filters by status when provided', async () => {
      mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

      await repo.listByProject('proj-1' as ProjectId, 'active');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('does not filter by status when omitted', async () => {
      mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

      await repo.listByProject('proj-1' as ProjectId);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getTasksDueForExecution', () => {
    it('queries active tasks with nextRunAt <= now', async () => {
      const now = new Date('2025-06-01T10:00:00Z');
      const dueTask = {
        ...rawTask,
        nextRunAt: new Date('2025-06-01T09:00:00Z'),
      };
      mockPrisma.scheduledTask.findMany.mockResolvedValue([dueTask]);

      const result = await repo.getTasksDueForExecution(now);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('task-1');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
        where: {
          status: 'active',
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: 'asc' },
      });
    });
  });

  describe('createRun', () => {
    it('returns a mapped run', async () => {
      mockPrisma.scheduledTaskRun.create.mockResolvedValue(rawRun);

      const result = await repo.createRun({
        taskId: 'task-1' as ScheduledTaskId,
      });

      expect(result.id).toBe('run-1');
      expect(result.taskId).toBe('task-1');
      expect(result.status).toBe('pending');
      expect(result.startedAt).toBeUndefined();
      expect(result.completedAt).toBeUndefined();
      expect(result.durationMs).toBeUndefined();
      expect(result.tokensUsed).toBeUndefined();
      expect(result.costUsd).toBeUndefined();
      expect(result.traceId).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
      expect(result.retryCount).toBe(0);
    });
  });

  describe('updateRun', () => {
    it('returns the updated run', async () => {
      const completedRun = {
        ...rawRun,
        status: 'completed',
        startedAt: new Date('2025-06-01T10:00:00Z'),
        completedAt: new Date('2025-06-01T10:01:00Z'),
        durationMs: 60000,
        tokensUsed: 1500,
        costUsd: 0.05,
        traceId: 'trace-1',
        result: { summary: 'done' },
      };
      mockPrisma.scheduledTaskRun.update.mockResolvedValue(completedRun);

      const result = await repo.updateRun('run-1' as ScheduledTaskRunId, {
        status: 'completed',
        startedAt: new Date('2025-06-01T10:00:00Z'),
        completedAt: new Date('2025-06-01T10:01:00Z'),
        durationMs: 60000,
        tokensUsed: 1500,
        costUsd: 0.05,
        traceId: 'trace-1' as TraceId,
        result: { summary: 'done' },
      });

      expect(result).not.toBeNull();
      expect(result?.status).toBe('completed');
      expect(result?.durationMs).toBe(60000);
      expect(result?.tokensUsed).toBe(1500);
      expect(result?.costUsd).toBe(0.05);
      expect(result?.traceId).toBe('trace-1');
      expect(result?.result).toEqual({ summary: 'done' });
    });

    it('returns null when run not found (catch block)', async () => {
      mockPrisma.scheduledTaskRun.update.mockRejectedValue(new Error('not found'));

      const result = await repo.updateRun('missing' as ScheduledTaskRunId, {
        status: 'failed',
        errorMessage: 'timeout',
      });

      expect(result).toBeNull();
    });
  });

  describe('listRuns', () => {
    it('returns mapped runs with default limit', async () => {
      mockPrisma.scheduledTaskRun.findMany.mockResolvedValue([rawRun]);

      const result = await repo.listRuns('task-1' as ScheduledTaskId);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('run-1');
      expect(result[0]?.startedAt).toBeUndefined();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTaskRun.findMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('respects custom limit', async () => {
      mockPrisma.scheduledTaskRun.findMany.mockResolvedValue([]);

      await repo.listRuns('task-1' as ScheduledTaskId, 10);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPrisma.scheduledTaskRun.findMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });
});
