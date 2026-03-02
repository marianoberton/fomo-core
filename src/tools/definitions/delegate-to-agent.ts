/**
 * Delegate-to-Agent tool — allows a manager agent to dispatch a task to a subagent.
 *
 * The manager LLM calls this tool with an agent name and task description.
 * The tool runs the target subagent's full agent loop and returns its response.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'delegate-to-agent' });

const inputSchema = z.object({
  agentName: z
    .string()
    .min(1)
    .describe('The name of the subagent to delegate this task to.'),
  task: z
    .string()
    .min(1)
    .describe('A clear description of the task for the subagent to complete.'),
  context: z
    .string()
    .optional()
    .describe(
      'Optional background context or data the subagent needs to complete the task.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .optional()
    .default(60_000)
    .describe('Maximum time to wait for the subagent, in milliseconds.'),
});

const outputSchema = z.object({
  agentName: z.string(),
  response: z.string(),
  success: z.boolean(),
});

/**
 * Function that runs a subagent and returns its text response.
 * Implemented in main.ts and injected at startup.
 */
export type RunSubAgentFn = (params: {
  projectId: string;
  agentName: string;
  task: string;
  context?: string;
  timeoutMs?: number;
}) => Promise<{ response: string }>;

/** Options for createDelegateToAgentTool. */
export interface DelegateToAgentToolOptions {
  /** Registry used in dryRun to validate the agent exists. */
  agentRegistry: AgentRegistry;
  /** Factory that runs the subagent loop and returns its response. */
  runSubAgent: RunSubAgentFn;
}

/**
 * Create the delegate-to-agent tool.
 *
 * Allows a manager agent to dispatch a task to a specialized subagent and receive
 * its response. The subagent runs its full agent loop (with its own tools, prompts,
 * and session) and returns the final assistant text.
 */
export function createDelegateToAgentTool(
  options: DelegateToAgentToolOptions,
): ExecutableTool {
  const { agentRegistry, runSubAgent } = options;

  return {
    id: 'delegate-to-agent',
    name: 'Delegate to Agent',
    description:
      'Delegate a task to a specialized subagent and receive their response. ' +
      'Use this to route specialized work (e.g. "resolve this sales query", ' +
      '"check stock for product X", "score this lead") to the appropriate agent. ' +
      'The subagent runs its full capabilities and returns a result.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        agentName: string;
        task: string;
        context?: string;
        timeoutMs: number;
      };

      logger.info('Delegating task to subagent', {
        component: 'delegate-to-agent',
        projectId: context.projectId,
        traceId: context.traceId,
        agentName: data.agentName,
        taskPreview: data.task.slice(0, 80),
      });

      try {
        const result = await runSubAgent({
          projectId: context.projectId,
          agentName: data.agentName,
          task: data.task,
          context: data.context,
          timeoutMs: data.timeoutMs,
        });

        logger.info('Subagent delegation completed', {
          component: 'delegate-to-agent',
          projectId: context.projectId,
          traceId: context.traceId,
          agentName: data.agentName,
          durationMs: Date.now() - startTime,
        });

        return ok({
          success: true,
          output: {
            agentName: data.agentName,
            response: result.response,
            success: true,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Subagent delegation failed', {
          component: 'delegate-to-agent',
          projectId: context.projectId,
          traceId: context.traceId,
          agentName: data.agentName,
          error: message,
        });
        // Return structured failure — the manager LLM decides how to handle it.
        return ok({
          success: false,
          output: {
            agentName: data.agentName,
            response: '',
            success: false,
          },
          error: message,
          durationMs: Date.now() - startTime,
        });
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const data = inputSchema.parse(input) as {
        agentName: string;
        task: string;
        context?: string;
        timeoutMs: number;
      };

      // Validate the target agent exists without running it
      const agent = await agentRegistry.getByName(context.projectId, data.agentName);
      if (!agent) {
        return ok({
          success: false,
          output: {
            agentName: data.agentName,
            response: '',
            success: false,
          },
          error: `Agent "${data.agentName}" not found in project`,
          durationMs: 0,
        });
      }

      return ok({
        success: true,
        output: {
          agentName: data.agentName,
          response: '[dry-run] Task would be delegated to agent',
          success: true,
          dryRun: true,
        },
        durationMs: 0,
      });
    },
  };
}
