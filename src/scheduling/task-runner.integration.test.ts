/**
 * TaskRunner integration tests.
 * Tests BullMQ queue + worker against real Redis.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import type { ProjectId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestRedis, type TestRedis } from '@/testing/helpers/test-redis.js';
import { createScheduledTaskRepository } from '@/infrastructure/repositories/scheduled-task-repository.js';
import { createTaskRunner, type TaskRunner } from './task-runner.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'task-runner-test' });

describe('TaskRunner Integration', () => {
  let testDb: TestDatabase;
  let testRedis: TestRedis;
  let projectId: ProjectId;
  let taskRunner: TaskRunner | null = null;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    testRedis = await createTestRedis();
  });

  beforeEach(async () => {
    await testDb.reset();
    await testRedis.flush();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterEach(async () => {
    if (taskRunner) {
      await taskRunner.stop();
      taskRunner = null;
    }
  });

  afterAll(async () => {
    await testDb.disconnect();
    await testRedis.disconnect();
  });

  it('enqueues and executes a scheduled task via BullMQ', async () => {
    const repo = createScheduledTaskRepository(testDb.prisma);

    // Create an active task with nextRunAt in the past (due now)
    const task = await repo.create({
      projectId,
      name: 'Test Task',
      cronExpression: '* * * * *',
      taskPayload: { message: 'Execute test' },
      origin: 'static',
    });

    // Set nextRunAt to now (make it due)
    await repo.update(task.id, { nextRunAt: new Date(Date.now() - 1000) });

    let executionCount = 0;
    let executedTaskId: string | undefined;

    taskRunner = createTaskRunner({
      repository: repo,
      logger,
      redisUrl: testRedis.url,
      pollIntervalMs: 200, // Fast polling for test
      onExecuteTask: (executedTask) => {
        executionCount++;
        executedTaskId = executedTask.id;
        return Promise.resolve({ success: true, tokensUsed: 100, costUsd: 0.003 });
      },
    });

    await taskRunner.start();

    // Wait for execution
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(executionCount).toBeGreaterThanOrEqual(1);
    expect(executedTaskId).toBe(task.id);

    // Verify run record in DB
    const runs = await repo.listRuns(task.id);
    expect(runs.length).toBeGreaterThanOrEqual(1);

    const completedRun = runs.find((r) => r.status === 'completed');
    expect(completedRun).toBeDefined();
    expect(completedRun?.tokensUsed).toBe(100);
  });

  it('does not execute proposed tasks', async () => {
    const repo = createScheduledTaskRepository(testDb.prisma);

    const task = await repo.create({
      projectId,
      name: 'Proposed Task',
      cronExpression: '* * * * *',
      taskPayload: { message: 'Should not run' },
      origin: 'agent_proposed',
    });

    // Force nextRunAt (wouldn't normally be set for proposed tasks)
    await testDb.prisma.scheduledTask.update({
      where: { id: task.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });

    let executionCount = 0;

    taskRunner = createTaskRunner({
      repository: repo,
      logger,
      redisUrl: testRedis.url,
      pollIntervalMs: 200,
      onExecuteTask: () => {
        executionCount++;
        return Promise.resolve({ success: true });
      },
    });

    await taskRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Proposed tasks (status='proposed') are not returned by getTasksDueForExecution
    expect(executionCount).toBe(0);
  });

  it('handles task execution failure', async () => {
    const repo = createScheduledTaskRepository(testDb.prisma);

    const task = await repo.create({
      projectId,
      name: 'Failing Task',
      cronExpression: '* * * * *',
      taskPayload: { message: 'Will fail' },
      origin: 'static',
    });

    await repo.update(task.id, { nextRunAt: new Date(Date.now() - 1000) });

    taskRunner = createTaskRunner({
      repository: repo,
      logger,
      redisUrl: testRedis.url,
      pollIntervalMs: 200,
      onExecuteTask: () => {
        return Promise.resolve({
          success: false,
          errorMessage: 'API rate limit exceeded',
        });
      },
    });

    await taskRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const runs = await repo.listRuns(task.id);
    expect(runs.length).toBeGreaterThanOrEqual(1);

    const failedRun = runs.find((r) => r.status === 'failed');
    expect(failedRun).toBeDefined();
    expect(failedRun?.errorMessage).toBe('API rate limit exceeded');
  });

  it('updates runCount after execution', async () => {
    const repo = createScheduledTaskRepository(testDb.prisma);

    const task = await repo.create({
      projectId,
      name: 'Counter Task',
      cronExpression: '* * * * *',
      taskPayload: { message: 'Count me' },
      origin: 'static',
    });

    await repo.update(task.id, { nextRunAt: new Date(Date.now() - 1000) });

    taskRunner = createTaskRunner({
      repository: repo,
      logger,
      redisUrl: testRedis.url,
      pollIntervalMs: 200,
      onExecuteTask: () => {
        return Promise.resolve({ success: true });
      },
    });

    await taskRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const updated = await repo.findById(task.id);
    expect(updated?.runCount).toBeGreaterThanOrEqual(1);
    expect(updated?.lastRunAt).toBeDefined();
  });

  it('completes task when maxRuns is reached', async () => {
    const repo = createScheduledTaskRepository(testDb.prisma);

    const task = await repo.create({
      projectId,
      name: 'Limited Task',
      cronExpression: '* * * * *',
      taskPayload: { message: 'Limited' },
      origin: 'static',
      maxRuns: 1,
    });

    // Set runCount to maxRuns to trigger completion check
    await repo.update(task.id, {
      nextRunAt: new Date(Date.now() - 1000),
      runCount: 1,
    });

    taskRunner = createTaskRunner({
      repository: repo,
      logger,
      redisUrl: testRedis.url,
      pollIntervalMs: 200,
      onExecuteTask: () => {
        return Promise.resolve({ success: true });
      },
    });

    await taskRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const updated = await repo.findById(task.id);
    expect(updated?.status).toBe('completed');
  });

  it('starts and stops cleanly', async () => {
    const repo = createScheduledTaskRepository(testDb.prisma);

    taskRunner = createTaskRunner({
      repository: repo,
      logger,
      redisUrl: testRedis.url,
      pollIntervalMs: 5000,
      onExecuteTask: () => Promise.resolve({ success: true }),
    });

    await taskRunner.start();
    // Should not throw
    await taskRunner.stop();
    taskRunner = null;
  });
});
