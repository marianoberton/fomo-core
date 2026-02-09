import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { scheduledTaskRoutes } from './scheduled-tasks.js';
import { registerErrorHandler } from '../error-handler.js';
import {
  createMockDeps,
  createSampleScheduledTask,
} from '@/testing/fixtures/routes.js';
import type { RouteDependencies } from '../types.js';

// ─── Setup ──────────────────────────────────────────────────────

let app: FastifyInstance;
let deps: ReturnType<typeof createMockDeps>;

beforeEach(async () => {
  deps = createMockDeps();
  app = Fastify();
  registerErrorHandler(app);
  await app.register(
    (instance, opts: RouteDependencies, done) => {
      scheduledTaskRoutes(instance, opts);
      done();
    },
    deps,
  );
  await app.ready();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('GET /projects/:projectId/scheduled-tasks', () => {
  it('returns tasks for a project', async () => {
    const tasks = [
      createSampleScheduledTask({ name: 'Task A' }),
      createSampleScheduledTask({ name: 'Task B' }),
    ];
    deps.taskManager.listTasks.mockResolvedValue(tasks);

    const response = await app.inject({
      method: 'GET',
      url: '/projects/proj-1/scheduled-tasks',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown[];
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it('filters by status query param', async () => {
    deps.taskManager.listTasks.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/projects/proj-1/scheduled-tasks?status=active',
    });

     
    expect(deps.taskManager.listTasks).toHaveBeenCalledWith(
      'proj-1',
      'active',
    );
  });
});

describe('GET /scheduled-tasks/:id', () => {
  it('returns a task by ID', async () => {
    const task = createSampleScheduledTask();
    deps.taskManager.getTask.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: '/scheduled-tasks/task-1',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown;
    };
    expect(body.success).toBe(true);
  });

  it('returns 404 when task not found', async () => {
    deps.taskManager.getTask.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/scheduled-tasks/missing',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /projects/:projectId/scheduled-tasks', () => {
  it('creates a new task', async () => {
    const created = createSampleScheduledTask();
    deps.taskManager.createTask.mockResolvedValue({
      ok: true,
      value: created,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/scheduled-tasks',
      payload: {
        name: 'Daily Report',
        description: 'Generate daily summary report',
        cronExpression: '0 9 * * *',
        taskPayload: { message: 'Generate the daily report' },
        maxRetries: 2,
        timeoutMs: 300_000,
        budgetPerRunUSD: 1.0,
        maxDurationMinutes: 30,
        maxTurns: 10,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('rejects invalid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects/proj-1/scheduled-tasks',
      payload: {
        name: '',
        cronExpression: 'bad',
        taskPayload: {},
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /scheduled-tasks/:id/approve', () => {
  it('approves a task', async () => {
    const task = createSampleScheduledTask({ status: 'active' });
    deps.taskManager.approveTask.mockResolvedValue({
      ok: true,
      value: task,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-tasks/task-1/approve',
      payload: { approvedBy: 'admin-user' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown;
    };
    expect(body.success).toBe(true);

     
    expect(deps.taskManager.approveTask).toHaveBeenCalledWith(
      'task-1',
      'admin-user',
    );
  });

  it('returns 400 when approvedBy missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-tasks/task-1/approve',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /scheduled-tasks/:id/reject', () => {
  it('rejects a task', async () => {
    const task = createSampleScheduledTask({ status: 'rejected' });
    deps.taskManager.rejectTask.mockResolvedValue({
      ok: true,
      value: task,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-tasks/task-1/reject',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown;
    };
    expect(body.success).toBe(true);

     
    expect(deps.taskManager.rejectTask).toHaveBeenCalledWith('task-1');
  });

  it('returns error status from result', async () => {
    deps.taskManager.rejectTask.mockResolvedValue({
      ok: false,
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'ScheduledTask "missing" not found',
        statusCode: 404,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-tasks/missing/reject',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TASK_NOT_FOUND');
  });
});

describe('POST /scheduled-tasks/:id/pause', () => {
  it('pauses a task', async () => {
    const task = createSampleScheduledTask({ status: 'paused' });
    deps.taskManager.pauseTask.mockResolvedValue({
      ok: true,
      value: task,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-tasks/task-1/pause',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown;
    };
    expect(body.success).toBe(true);

     
    expect(deps.taskManager.pauseTask).toHaveBeenCalledWith('task-1');
  });
});

describe('POST /scheduled-tasks/:id/resume', () => {
  it('resumes a task', async () => {
    const task = createSampleScheduledTask({ status: 'active' });
    deps.taskManager.resumeTask.mockResolvedValue({
      ok: true,
      value: task,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/scheduled-tasks/task-1/resume',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown;
    };
    expect(body.success).toBe(true);

     
    expect(deps.taskManager.resumeTask).toHaveBeenCalledWith('task-1');
  });
});

describe('GET /scheduled-tasks/:id/runs', () => {
  it('returns runs for a task', async () => {
    const runs = [
      { id: 'run-1', status: 'completed' },
      { id: 'run-2', status: 'running' },
    ];
    deps.taskManager.listRuns.mockResolvedValue(runs);

    const response = await app.inject({
      method: 'GET',
      url: '/scheduled-tasks/task-1/runs',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: unknown[];
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);

     
    expect(deps.taskManager.listRuns).toHaveBeenCalledWith(
      'task-1',
      undefined,
    );
  });
});
