/**
 * List-Project-Agents tool — returns all agents in the current project.
 *
 * Used by the manager agent to discover which subagents are available
 * before deciding how to delegate a task.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'list-project-agents' });

const inputSchema = z.object({});

const outputSchema = z.object({
  agents: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      operatingMode: z.string(),
      status: z.string(),
      toolCount: z.number(),
    }),
  ),
});

/** Options for createListProjectAgentsTool. */
export interface ListProjectAgentsToolOptions {
  agentRegistry: AgentRegistry;
}

/**
 * Create the list-project-agents tool.
 *
 * Returns the name, description, operating mode, and status of every agent
 * in the current project. Intended for manager agents that need to know
 * which subagents to delegate work to.
 */
export function createListProjectAgentsTool(
  options: ListProjectAgentsToolOptions,
): ExecutableTool {
  const { agentRegistry } = options;

  return {
    id: 'list-project-agents',
    name: 'List Project Agents',
    description:
      'List all agents in this project with their names, descriptions, and current status. ' +
      'Use this to discover which specialized agents are available before delegating tasks.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void input;
      logger.info('Listing project agents', {
        component: 'list-project-agents',
        projectId: context.projectId,
      });

      const agents = await agentRegistry.list(context.projectId);

      return ok({
        success: true,
        output: {
          agents: agents.map((a) => ({
            name: a.name,
            description: a.description,
            operatingMode: a.operatingMode,
            status: a.status,
            toolCount: a.toolAllowlist.length,
          })),
        },
        durationMs: 0,
      });
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}
