/**
 * propose-scheduled-task — internal tool for agents to propose scheduled tasks.
 *
 * Proposing is safe (riskLevel: 'low') — the proposed task requires human
 * approval before activation. This enforces the "agent proposes, human disposes" pattern.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
import type { ProjectId } from '@/core/types.js';

const inputSchema = z.object({
  name: z.string().min(1).max(100).describe('A short, descriptive name for the task'),
  description: z.string().max(500).optional().describe('Optional detailed description'),
  cronExpression: z.string().min(9).max(100).describe('Cron expression (5-field)'),
  taskMessage: z.string().min(1).max(2000).describe('The message/instruction the agent should execute'),
  suggestedDurationMinutes: z.number().int().min(1).max(120).optional().describe('Suggested max duration in minutes'),
});

const outputSchema = z.object({
  taskId: z.string(),
  name: z.string(),
  cronExpression: z.string(),
  status: z.string(),
  nextRuns: z.array(z.string()).optional(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ProposeScheduledTaskToolOptions {
  taskManager: TaskManager;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a tool that allows agents to propose scheduled tasks for human approval. */
export function createProposeScheduledTaskTool(
  options: ProposeScheduledTaskToolOptions,
): ExecutableTool {
  const { taskManager } = options;

  return {
    id: 'propose-scheduled-task',
    name: 'Propose Scheduled Task',
    description:
      'Proposes a new scheduled task for human review. The task will NOT execute until ' +
      'a human approves it. Use this when the user needs recurring automated actions.',
    category: 'scheduling',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      return taskManager
        .proposeTask({
          projectId: context.projectId,
          name: parsed.name,
          description: parsed.description,
          cronExpression: parsed.cronExpression,
          taskPayload: {
            message: parsed.taskMessage,
          },
          origin: 'agent_proposed',
          proposedBy: `session:${context.sessionId}`,
          maxDurationMinutes: parsed.suggestedDurationMinutes,
        })
        .then((result) => {
          if (!result.ok) {
            return err(new ToolExecutionError(
              'propose-scheduled-task',
              result.error.message,
            ));
          }

          const task = result.value;

          // Also compute next runs for informational purposes
          const cronResult = taskManager.validateCron(task.cronExpression);
          const nextRuns = cronResult.ok
            ? cronResult.value.map((d) => d.toISOString())
            : undefined;

          return ok({
            success: true,
            output: {
              taskId: task.id,
              name: task.name,
              cronExpression: task.cronExpression,
              status: task.status,
              nextRuns,
            },
            durationMs: Date.now() - startTime,
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          return err(new ToolExecutionError('propose-scheduled-task', message));
        });
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      // Validate cron expression without creating anything
      const cronResult = taskManager.validateCron(parsed.cronExpression);
      if (!cronResult.ok) {
        return Promise.resolve(err(new ToolExecutionError(
          'propose-scheduled-task',
          cronResult.error.message,
        )));
      }

      const nextRuns = cronResult.value.map((d) => d.toISOString());

      return Promise.resolve(ok({
        success: true,
        output: {
          valid: true,
          name: parsed.name,
          cronExpression: parsed.cronExpression,
          nextRuns,
          dryRun: true,
        },
        durationMs: 0,
      }));
    },
  };
}
