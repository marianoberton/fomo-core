/**
 * Admin agent & project read-only tools.
 *
 * - admin-list-projects: list all projects
 * - admin-list-agents: list agents (optionally filtered by project)
 * - admin-get-agent: get full agent config by ID
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRepository } from '@/agents/types.js';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-tools-agents' });

// ─── Options ───────────────────────────────────────────────────────

/** Shared DI options for agent/project admin tools. */
export interface AdminAgentToolOptions {
  agentRepository: AgentRepository;
  projectRepository: ProjectRepository;
}

// ─── admin-list-projects ───────────────────────────────────────────

const listProjectsInput = z.object({});

const listProjectsOutput = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      status: z.string(),
      agentCount: z.number(),
    }),
  ),
});

/**
 * Create the admin-list-projects tool.
 *
 * Returns all projects with basic metadata and agent count.
 * Cross-project: ignores ExecutionContext.projectId (admin scope).
 */
export function createAdminListProjectsTool(
  options: AdminAgentToolOptions,
): ExecutableTool {
  const { projectRepository, agentRepository } = options;

  return {
    id: 'admin-list-projects',
    name: 'Admin List Projects',
    description:
      'List all projects in the platform with their name, status, and agent count. ' +
      'Use this to get a high-level overview of what is deployed.',
    category: 'admin',
    inputSchema: listProjectsInput,
    outputSchema: listProjectsOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void input;
      const startTime = Date.now();
      logger.info('Listing all projects', { component: 'admin-list-projects' });

      try {
        const projects = await projectRepository.list();
        const allAgents = await agentRepository.listAll();

        const agentCountByProject = new Map<string, number>();
        for (const agent of allAgents) {
          const count = agentCountByProject.get(agent.projectId) ?? 0;
          agentCountByProject.set(agent.projectId, count + 1);
        }

        return ok({
          success: true,
          output: {
            projects: projects.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              status: p.status,
              agentCount: agentCountByProject.get(p.id) ?? 0,
            })),
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-list-projects',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── admin-list-agents ─────────────────────────────────────────────

const listAgentsInput = z.object({
  projectId: z.string().optional().describe('Filter by project ID. Omit for all agents across projects.'),
});

const listAgentsOutput = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      operatingMode: z.string(),
      status: z.string(),
      model: z.string().optional(),
      toolCount: z.number(),
    }),
  ),
});

/**
 * Create the admin-list-agents tool.
 *
 * Lists agents across all projects or filtered by projectId.
 */
export function createAdminListAgentsTool(
  options: AdminAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-list-agents',
    name: 'Admin List Agents',
    description:
      'List agents across the platform. Optionally filter by projectId. ' +
      'Returns name, status, model, and tool count for each agent.',
    category: 'admin',
    inputSchema: listAgentsInput,
    outputSchema: listAgentsOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = listAgentsInput.parse(input) as { projectId?: string };

      logger.info('Listing agents', {
        component: 'admin-list-agents',
        projectId: parsed.projectId ?? 'all',
      });

      try {
        const agents = parsed.projectId
          ? await agentRepository.list(parsed.projectId)
          : await agentRepository.listAll();

        return ok({
          success: true,
          output: {
            agents: agents.map((a) => ({
              id: a.id,
              projectId: a.projectId,
              name: a.name,
              description: a.description,
              operatingMode: a.operatingMode,
              status: a.status,
              model: a.llmConfig?.model,
              toolCount: a.toolAllowlist.length,
            })),
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-list-agents',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}

// ─── admin-get-agent ───────────────────────────────────────────────

const getAgentInput = z.object({
  agentId: z.string().describe('Agent ID to retrieve.'),
});

const getAgentOutput = z.object({
  agent: z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    operatingMode: z.string(),
    status: z.string(),
    llmConfig: z.record(z.unknown()).optional(),
    promptConfig: z.object({
      identity: z.string(),
      instructions: z.string(),
      safety: z.string(),
    }),
    toolAllowlist: z.array(z.string()),
    channelConfig: z.record(z.unknown()).optional(),
    modes: z.array(z.record(z.unknown())),
    limits: z.object({
      maxTurns: z.number(),
      maxTokensPerTurn: z.number(),
      budgetPerDayUsd: z.number(),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

/**
 * Create the admin-get-agent tool.
 *
 * Returns the full configuration of a single agent by ID.
 */
export function createAdminGetAgentTool(
  options: AdminAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-get-agent',
    name: 'Admin Get Agent',
    description:
      'Get the full configuration of a specific agent by ID. ' +
      'Returns prompt config, LLM config, tool allowlist, modes, and limits.',
    category: 'admin',
    inputSchema: getAgentInput,
    outputSchema: getAgentOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = getAgentInput.parse(input) as { agentId: string };

      logger.info('Getting agent details', {
        component: 'admin-get-agent',
        agentId: parsed.agentId,
      });

      try {
        const agent = await agentRepository.findById(
          parsed.agentId as import('@/agents/types.js').AgentId,
        );

        if (!agent) {
          return err(
            new ToolExecutionError('admin-get-agent', `Agent not found: ${parsed.agentId}`),
          );
        }

        return ok({
          success: true,
          output: {
            agent: {
              id: agent.id,
              projectId: agent.projectId,
              name: agent.name,
              description: agent.description,
              operatingMode: agent.operatingMode,
              status: agent.status,
              llmConfig: agent.llmConfig as Record<string, unknown> | undefined,
              promptConfig: agent.promptConfig,
              toolAllowlist: agent.toolAllowlist,
              channelConfig: agent.channelConfig as unknown as Record<string, unknown>,
              modes: agent.modes as unknown as Record<string, unknown>[],
              limits: agent.limits,
              createdAt: agent.createdAt.toISOString(),
              updatedAt: agent.updatedAt.toISOString(),
            },
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-get-agent',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}
