/**
 * ScheduledTaskRepository integration tests.
 * Tests real Prisma operations against PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { ProjectId, ScheduledTaskId, ScheduledTaskRunId, TraceId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createScheduledTaskRepository } from './scheduled-task-repository.js';

describe('ScheduledTaskRepository Integration', () => {
  let testDb: TestDatabase;
  let projectId: ProjectId;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('create', () => {
    it('creates static task with status active', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({
        projectId,
        name: 'Daily Report',
        cronExpression: '0 9 * * *',
        taskPayload: { message: 'Generate daily report' },
        origin: 'static',
      });

      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(projectId);
      expect(task.name).toBe('Daily Report');
      expect(task.status).toBe('active');
      expect(task.origin).toBe('static');
      expect(task.cronExpression).toBe('0 9 * * *');
      expect(task.taskPayload).toEqual({ message: 'Generate daily report' });
    });

    it('creates agent-proposed task with status proposed', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({
        projectId,
        name: 'Agent Suggestion',
        cronExpression: '*/30 * * * *',
        taskPayload: { message: 'Check metrics' },
        origin: 'agent_proposed',
        proposedBy: 'agent-session-123',
      });

      expect(task.status).toBe('proposed');
      expect(task.origin).toBe('agent_proposed');
      expect(task.proposedBy).toBe('agent-session-123');
    });

    it('applies default values for optional fields', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({
        projectId,
        name: 'Defaults Test',
        cronExpression: '* * * * *',
        taskPayload: { message: 'test' },
        origin: 'static',
      });

      expect(task.maxRetries).toBe(2);
      expect(task.timeoutMs).toBe(300_000);
      expect(task.budgetPerRunUSD).toBe(1.0);
      expect(task.maxDurationMinutes).toBe(30);
      expect(task.maxTurns).toBe(10);
      expect(task.maxRuns).toBeUndefined(); // null → undefined
      expect(task.runCount).toBe(0);
    });

    it('stores taskPayload JSON with metadata', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const payload = { message: 'Complex task', metadata: { priority: 'high', tags: ['urgent'] } };
      const task = await repo.create({
        projectId,
        name: 'Payload Test',
        cronExpression: '0 * * * *',
        taskPayload: payload,
        origin: 'static',
      });

      const found = await repo.findById(task.id);
      expect(found?.taskPayload).toEqual(payload);
    });
  });

  describe('findById', () => {
    it('retrieves task by ID', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({
        projectId,
        name: 'Find Me',
        cronExpression: '0 * * * *',
        taskPayload: { message: 'test' },
        origin: 'static',
      });

      const found = await repo.findById(task.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(task.id);
      expect(found?.name).toBe('Find Me');
    });

    it('returns null for non-existent ID', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const found = await repo.findById('non-existent' as ScheduledTaskId);
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('updates task status for approval workflow', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({
        projectId,
        name: 'To Approve',
        cronExpression: '0 9 * * *',
        taskPayload: { message: 'test' },
        origin: 'agent_proposed',
        proposedBy: 'agent-1',
      });

      expect(task.status).toBe('proposed');

      const approved = await repo.update(task.id, {
        status: 'active',
        approvedBy: 'admin@company.com',
      });

      expect(approved?.status).toBe('active');
      expect(approved?.approvedBy).toBe('admin@company.com');
    });

    it('updates nextRunAt and runCount', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({
        projectId,
        name: 'Run Tracking',
        cronExpression: '*/5 * * * *',
        taskPayload: { message: 'test' },
        origin: 'static',
      });

      const nextRun = new Date(Date.now() + 300_000);
      const now = new Date();

      const updated = await repo.update(task.id, {
        lastRunAt: now,
        nextRunAt: nextRun,
        runCount: 1,
      });

      expect(updated?.lastRunAt).toEqual(now);
      expect(updated?.nextRunAt).toEqual(nextRun);
      expect(updated?.runCount).toBe(1);
    });

    it('returns null for non-existent task', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const updated = await repo.update('non-existent' as ScheduledTaskId, {
        status: 'paused',
      });

      expect(updated).toBeNull();
    });
  });

  describe('listByProject', () => {
    it('lists tasks for a project', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      await repo.create({ projectId, name: 'Task 1', cronExpression: '0 * * * *', taskPayload: { message: 't1' }, origin: 'static' });
      await repo.create({ projectId, name: 'Task 2', cronExpression: '0 * * * *', taskPayload: { message: 't2' }, origin: 'static' });

      const tasks = await repo.listByProject(projectId);
      expect(tasks).toHaveLength(2);
    });

    it('filters by status', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      await repo.create({ projectId, name: 'Active', cronExpression: '0 * * * *', taskPayload: { message: 'a' }, origin: 'static' });
      await repo.create({ projectId, name: 'Proposed', cronExpression: '0 * * * *', taskPayload: { message: 'p' }, origin: 'agent_proposed' });

      const active = await repo.listByProject(projectId, 'active');
      expect(active).toHaveLength(1);
      expect(active[0]?.name).toBe('Active');

      const proposed = await repo.listByProject(projectId, 'proposed');
      expect(proposed).toHaveLength(1);
      expect(proposed[0]?.name).toBe('Proposed');
    });
  });

  describe('getTasksDueForExecution', () => {
    it('returns active tasks with nextRunAt <= now', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const pastDate = new Date(Date.now() - 60_000); // 1 minute ago
      const futureDate = new Date(Date.now() + 3600_000); // 1 hour from now

      // Create tasks and set nextRunAt
      const dueTask = await repo.create({ projectId, name: 'Due', cronExpression: '* * * * *', taskPayload: { message: 'due' }, origin: 'static' });
      await repo.update(dueTask.id, { nextRunAt: pastDate });

      const futureTask = await repo.create({ projectId, name: 'Future', cronExpression: '0 * * * *', taskPayload: { message: 'future' }, origin: 'static' });
      await repo.update(futureTask.id, { nextRunAt: futureDate });

      // Proposed tasks should not be returned even if due
      const proposedTask = await repo.create({ projectId, name: 'Proposed Due', cronExpression: '* * * * *', taskPayload: { message: 'proposed' }, origin: 'agent_proposed' });
      await testDb.prisma.scheduledTask.update({ where: { id: proposedTask.id }, data: { nextRunAt: pastDate } });

      const dueTasks = await repo.getTasksDueForExecution(new Date());

      expect(dueTasks).toHaveLength(1);
      expect(dueTasks[0]?.name).toBe('Due');
    });

    it('returns empty array when no tasks are due', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const dueTasks = await repo.getTasksDueForExecution(new Date());
      expect(dueTasks).toEqual([]);
    });
  });

  describe('createRun', () => {
    it('creates run with pending status', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'Run Test', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });

      const run = await repo.createRun({ taskId: task.id });

      expect(run.id).toBeDefined();
      expect(run.taskId).toBe(task.id);
      expect(run.status).toBe('pending');
      expect(run.retryCount).toBe(0);
    });

    it('creates run with traceId', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'Traced', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });

      const run = await repo.createRun({
        taskId: task.id,
        traceId: 'trace-abc-123' as TraceId,
      });

      expect(run.traceId).toBe('trace-abc-123');
    });
  });

  describe('updateRun', () => {
    it('updates run with completion data', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'Run Update', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });
      const run = await repo.createRun({ taskId: task.id });

      const startedAt = new Date();
      const completedAt = new Date(startedAt.getTime() + 5000);

      const updated = await repo.updateRun(run.id, {
        status: 'completed',
        startedAt,
        completedAt,
        durationMs: 5000,
        tokensUsed: 1500,
        costUsd: 0.045,
        result: { output: 'Report generated', entries: 42 },
      });

      expect(updated?.status).toBe('completed');
      expect(updated?.durationMs).toBe(5000);
      expect(updated?.tokensUsed).toBe(1500);
      expect(updated?.costUsd).toBeCloseTo(0.045);
      expect(updated?.result).toEqual({ output: 'Report generated', entries: 42 });
    });

    it('updates run with error info', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'Failed Run', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });
      const run = await repo.createRun({ taskId: task.id });

      const updated = await repo.updateRun(run.id, {
        status: 'failed',
        errorMessage: 'Connection timeout after 30s',
        retryCount: 1,
      });

      expect(updated?.status).toBe('failed');
      expect(updated?.errorMessage).toBe('Connection timeout after 30s');
      expect(updated?.retryCount).toBe(1);
    });

    it('returns null for non-existent run', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const updated = await repo.updateRun('non-existent' as ScheduledTaskRunId, {
        status: 'failed',
      });

      expect(updated).toBeNull();
    });
  });

  describe('listRuns', () => {
    it('lists runs newest first', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'Multi Run', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });

      await repo.createRun({ taskId: task.id });
      await repo.createRun({ taskId: task.id });
      await repo.createRun({ taskId: task.id });

      const runs = await repo.listRuns(task.id);
      expect(runs).toHaveLength(3);
      // Newest first
      const first = runs[0];
      const second = runs[1];
      if (!first || !second) throw new Error('Expected at least 2 runs');
      expect(first.createdAt.getTime()).toBeGreaterThanOrEqual(second.createdAt.getTime());
    });

    it('respects limit parameter', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'Limited', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });

      for (let i = 0; i < 5; i++) {
        await repo.createRun({ taskId: task.id });
      }

      const runs = await repo.listRuns(task.id, 2);
      expect(runs).toHaveLength(2);
    });

    it('returns empty array for task with no runs', async () => {
      const repo = createScheduledTaskRepository(testDb.prisma);

      const task = await repo.create({ projectId, name: 'No Runs', cronExpression: '* * * * *', taskPayload: { message: 'test' }, origin: 'static' });

      const runs = await repo.listRuns(task.id);
      expect(runs).toEqual([]);
    });
  });
});
