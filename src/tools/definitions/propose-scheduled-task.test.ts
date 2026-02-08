import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProposeScheduledTaskTool } from './propose-scheduled-task.js';
import type { ExecutableTool } from '@/tools/types.js';
import type { ExecutionContext, ProjectId, SessionId, ScheduledTaskId } from '@/core/types.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
import type { ScheduledTask } from '@/scheduling/types.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import { ValidationError } from '@/core/errors.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockTaskManager(): { [K in keyof TaskManager]: ReturnType<typeof vi.fn> } {
  return {
    createTask: vi.fn(),
    proposeTask: vi.fn(),
    approveTask: vi.fn(),
    rejectTask: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listRuns: vi.fn(),
    validateCron: vi.fn(),
  };
}

const validInput = {
  name: 'Daily report',
  description: 'Generate a summary report every morning',
  cronExpression: '0 9 * * *',
  taskMessage: 'Generate the daily summary report for all active projects.',
  suggestedDurationMinutes: 15,
};

const validInputRequiredOnly = {
  name: 'Daily report',
  cronExpression: '0 9 * * *',
  taskMessage: 'Generate the daily summary report.',
};

const nextRunDates = [
  new Date('2026-02-08T09:00:00Z'),
  new Date('2026-02-09T09:00:00Z'),
  new Date('2026-02-10T09:00:00Z'),
];

function createMockTask(overrides?: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'task-1' as ScheduledTaskId,
    projectId: 'test-project' as ProjectId,
    name: 'Daily report',
    description: 'Generate a summary report every morning',
    cronExpression: '0 9 * * *',
    taskPayload: { message: 'Generate the daily summary report for all active projects.' },
    origin: 'agent_proposed',
    status: 'proposed',
    proposedBy: 'session:test-session',
    maxRetries: 3,
    timeoutMs: 60_000,
    budgetPerRunUSD: 1,
    maxDurationMinutes: 15,
    maxTurns: 10,
    runCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('propose-scheduled-task', () => {
  let taskManager: ReturnType<typeof createMockTaskManager>;
  let tool: ExecutableTool;
  let context: ExecutionContext;

  beforeEach(() => {
    taskManager = createMockTaskManager();
    tool = createProposeScheduledTaskTool({ taskManager });
    context = createTestContext({ allowedTools: ['propose-scheduled-task'] });
  });

  // ─── Tool Definition ───────────────────────────────────────────

  describe('tool definition', () => {
    it('has the correct id', () => {
      expect(tool.id).toBe('propose-scheduled-task');
    });

    it('is low risk', () => {
      expect(tool.riskLevel).toBe('low');
    });

    it('does not require approval', () => {
      expect(tool.requiresApproval).toBe(false);
    });

    it('has no side effects', () => {
      expect(tool.sideEffects).toBe(false);
    });
  });

  // ─── Schema Validation ─────────────────────────────────────────

  describe('schema validation', () => {
    it('rejects empty input', () => {
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
      const result = tool.inputSchema.safeParse({
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing cronExpression', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test task',
        taskMessage: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing taskMessage', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test task',
        cronExpression: '0 9 * * *',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid input with all fields', () => {
      const result = tool.inputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('accepts valid input with only required fields', () => {
      const result = tool.inputSchema.safeParse(validInputRequiredOnly);
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = tool.inputSchema.safeParse({
        name: '',
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name exceeding max length', () => {
      const result = tool.inputSchema.safeParse({
        name: 'x'.repeat(101),
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('rejects cronExpression shorter than min length', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '* * * *',
        taskMessage: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty taskMessage', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '0 9 * * *',
        taskMessage: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects taskMessage exceeding max length', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '0 9 * * *',
        taskMessage: 'x'.repeat(2001),
      });
      expect(result.success).toBe(false);
    });

    it('rejects description exceeding max length', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
        description: 'x'.repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it('rejects suggestedDurationMinutes below min', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
        suggestedDurationMinutes: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects suggestedDurationMinutes above max', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
        suggestedDurationMinutes: 121,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer suggestedDurationMinutes', () => {
      const result = tool.inputSchema.safeParse({
        name: 'Test',
        cronExpression: '0 9 * * *',
        taskMessage: 'Do something',
        suggestedDurationMinutes: 15.5,
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Dry Run ───────────────────────────────────────────────────

  describe('dryRun', () => {
    it('returns valid=true with next run times for valid cron', async () => {
      taskManager.validateCron.mockReturnValue({
        ok: true,
        value: nextRunDates,
      });

      const result = await tool.dryRun(validInput, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['valid']).toBe(true);
        expect(output['dryRun']).toBe(true);
        expect(output['name']).toBe('Daily report');
        expect(output['cronExpression']).toBe('0 9 * * *');
        expect(output['nextRuns']).toEqual(
          nextRunDates.map((d) => d.toISOString()),
        );
      }

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(taskManager.validateCron).toHaveBeenCalledWith('0 9 * * *');
    });

    it('returns error for invalid cron expression', async () => {
      taskManager.validateCron.mockReturnValue({
        ok: false,
        error: new ValidationError('Invalid cron expression: bad syntax', {
          cronExpression: 'not-a-cron',
        }),
      });

      const result = await tool.dryRun(
        {
          name: 'Bad cron task',
          cronExpression: 'not-a-cron',
          taskMessage: 'Do something',
        },
        context,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Invalid cron expression');
      }
    });

    it('does not call proposeTask during dry run', async () => {
      taskManager.validateCron.mockReturnValue({
        ok: true,
        value: nextRunDates,
      });

      await tool.dryRun(validInput, context);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(taskManager.proposeTask).not.toHaveBeenCalled();
    });
  });

  // ─── Execute ───────────────────────────────────────────────────

  describe('execute', () => {
    it('proposes task and returns task ID with cron info', async () => {
      const mockTask = createMockTask();
      taskManager.proposeTask.mockResolvedValue({ ok: true, value: mockTask });
      taskManager.validateCron.mockReturnValue({ ok: true, value: nextRunDates });

      const result = await tool.execute(validInput, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as {
          taskId: string;
          name: string;
          cronExpression: string;
          status: string;
          nextRuns: string[];
        };
        expect(output.taskId).toBe('task-1');
        expect(output.name).toBe('Daily report');
        expect(output.cronExpression).toBe('0 9 * * *');
        expect(output.status).toBe('proposed');
        expect(output.nextRuns).toEqual(
          nextRunDates.map((d) => d.toISOString()),
        );
        expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns error when proposeTask fails', async () => {
      taskManager.proposeTask.mockResolvedValue({
        ok: false,
        error: new ValidationError('Invalid cron expression: unexpected token', {
          cronExpression: '0 9 * * *',
        }),
      });

      const result = await tool.execute(validInput, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Invalid cron expression');
      }
    });

    it('passes correct input to taskManager.proposeTask', async () => {
      const mockTask = createMockTask();
      taskManager.proposeTask.mockResolvedValue({ ok: true, value: mockTask });
      taskManager.validateCron.mockReturnValue({ ok: true, value: nextRunDates });

      await tool.execute(validInput, context);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(taskManager.proposeTask).toHaveBeenCalledWith({
        projectId: context.projectId,
        name: 'Daily report',
        description: 'Generate a summary report every morning',
        cronExpression: '0 9 * * *',
        taskPayload: {
          message: 'Generate the daily summary report for all active projects.',
        },
        origin: 'agent_proposed',
        proposedBy: `session:${context.sessionId}`,
        maxDurationMinutes: 15,
      });
    });

    it('omits nextRuns from output when validateCron fails', async () => {
      const mockTask = createMockTask();
      taskManager.proposeTask.mockResolvedValue({ ok: true, value: mockTask });
      taskManager.validateCron.mockReturnValue({
        ok: false,
        error: new ValidationError('parse error'),
      });

      const result = await tool.execute(validInput, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['taskId']).toBe('task-1');
        expect(output['nextRuns']).toBeUndefined();
      }
    });

    it('handles proposeTask throwing an unexpected error', async () => {
      taskManager.proposeTask.mockRejectedValue(new Error('Database unavailable'));

      const result = await tool.execute(validInput, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toContain('Database unavailable');
      }
    });

    it('passes optional fields as undefined when not provided', async () => {
      const mockTask = createMockTask({
        description: undefined,
        maxDurationMinutes: 15,
      });
      taskManager.proposeTask.mockResolvedValue({ ok: true, value: mockTask });
      taskManager.validateCron.mockReturnValue({ ok: true, value: nextRunDates });

      await tool.execute(validInputRequiredOnly, context);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(taskManager.proposeTask).toHaveBeenCalledWith({
        projectId: context.projectId,
        name: 'Daily report',
        description: undefined,
        cronExpression: '0 9 * * *',
        taskPayload: {
          message: 'Generate the daily summary report.',
        },
        origin: 'agent_proposed',
        proposedBy: `session:${context.sessionId}`,
        maxDurationMinutes: undefined,
      });
    });
  });
});
