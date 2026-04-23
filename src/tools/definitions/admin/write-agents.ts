/**
 * Admin write tools for agents and projects.
 *
 * - admin-create-agent
 * - admin-update-agent
 * - admin-set-agent-status
 * - admin-create-project
 * - admin-update-project
 * - admin-set-agent-model
 * - admin-grant-tool
 * - admin-revoke-tool
 *
 * All write tools enforce meta-safety: cannot modify fomo-admin itself.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import { ToolExecutionError, NexusError as NexusErrorClass } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRepository, AgentId } from '@/agents/types.js';
import type { ProjectId } from '@/core/types.js';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-write-agents' });

// ─── Meta-safety ───────────────────────────────────────────────────

const FOMO_ADMIN_NAME = 'FOMO-Admin';

/** Check that a mutation does not target fomo-admin. */
async function assertNotSelfModify(
  agentRepository: AgentRepository,
  agentId: string,
  toolId: string,
): Promise<void> {
  const agent = await agentRepository.findById(agentId as AgentId);
  if (agent?.name === FOMO_ADMIN_NAME) {
    throw new NexusErrorClass({
      message: `Meta-safety: ${toolId} cannot modify the fomo-admin agent`,
      code: 'ADMIN_SELF_MODIFY',
      statusCode: 403,
    });
  }
}

// ─── Options ───────────────────────────────────────────────────────

/** Shared DI for admin write tools. */
export interface AdminWriteAgentToolOptions {
  agentRepository: AgentRepository;
  projectRepository: ProjectRepository;
}

// ─── admin-create-agent ────────────────────────────────────────────

const createAgentInput = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(['conversational', 'process', 'backoffice']).optional(),
  model: z.string().optional(),
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
  temperature: z.number().min(0).max(2).optional(),
  identity: z.string().min(1),
  instructions: z.string().min(1),
  safety: z.string().min(1),
  toolAllowlist: z.array(z.string()).optional(),
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  budgetPerDayUsd: z.number().positive().optional(),
});

/**
 * Create the admin-create-agent tool.
 *
 * Creates a new agent in a project. Cannot create admin-mode agents.
 */
export function createAdminCreateAgentTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-create-agent',
    name: 'Admin Create Agent',
    description:
      'Create a new agent in a project. Provide name, prompt layers (identity/instructions/safety), ' +
      'model, and tool allowlist. Agent type defaults to conversational.',
    category: 'admin',
    inputSchema: createAgentInput,
    outputSchema: z.object({ agentId: z.string(), name: z.string() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = createAgentInput.parse(input);

      logger.info('Creating agent', {
        component: 'admin-create-agent',
        projectId: parsed.projectId,
        name: parsed.name,
      });

      try {
        const agent = await agentRepository.create({
          projectId: parsed.projectId,
          name: parsed.name,
          description: parsed.description,
          type: parsed.type ?? 'conversational',
          llmConfig: {
            provider: parsed.provider,
            model: parsed.model,
            temperature: parsed.temperature,
          },
          promptConfig: {
            identity: parsed.identity,
            instructions: parsed.instructions,
            safety: parsed.safety,
          },
          toolAllowlist: parsed.toolAllowlist ?? [],
          limits: {
            maxTurns: parsed.maxTurns ?? 30,
            maxTokensPerTurn: parsed.maxTokensPerTurn ?? 4000,
            budgetPerDayUsd: parsed.budgetPerDayUsd ?? 10,
          },
        });

        return ok({
          success: true,
          output: { agentId: agent.id, name: agent.name },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-create-agent',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = createAgentInput.parse(input);
      return ok({
        success: true,
        output: {
          agentId: '[dry-run]',
          name: parsed.name,
          wouldCreate: true,
        },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-update-agent ────────────────────────────────────────────

const updateAgentInput = z.object({
  agentId: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  type: z.enum(['conversational', 'process', 'backoffice']).optional(),
  identity: z.string().optional(),
  instructions: z.string().optional(),
  safety: z.string().optional(),
  toolAllowlist: z.array(z.string()).optional(),
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  budgetPerDayUsd: z.number().positive().optional(),
});

/**
 * Create the admin-update-agent tool.
 *
 * Updates an existing agent's configuration. Meta-safety enforced.
 */
export function createAdminUpdateAgentTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-update-agent',
    name: 'Admin Update Agent',
    description:
      'Update an existing agent configuration: name, prompts, tools, limits. ' +
      'Cannot modify the fomo-admin agent (meta-safety).',
    category: 'admin',
    inputSchema: updateAgentInput,
    outputSchema: z.object({ agentId: z.string(), updated: z.boolean() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = updateAgentInput.parse(input);

      try {
        await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-update-agent');

        const updateData: Record<string, unknown> = {};
        if (parsed.name) updateData['name'] = parsed.name;
        if (parsed.description !== undefined) updateData['description'] = parsed.description;
        if (parsed.type) updateData['type'] = parsed.type;
        if (parsed.toolAllowlist) updateData['toolAllowlist'] = parsed.toolAllowlist;

        if (parsed.identity || parsed.instructions || parsed.safety) {
          const existing = await agentRepository.findById(parsed.agentId as AgentId);
          if (!existing) {
            return err(new ToolExecutionError('admin-update-agent', `Agent not found: ${parsed.agentId}`));
          }
          updateData['promptConfig'] = {
            identity: parsed.identity ?? existing.promptConfig.identity,
            instructions: parsed.instructions ?? existing.promptConfig.instructions,
            safety: parsed.safety ?? existing.promptConfig.safety,
          };
        }

        if (parsed.maxTurns || parsed.maxTokensPerTurn || parsed.budgetPerDayUsd) {
          const existing = await agentRepository.findById(parsed.agentId as AgentId);
          if (existing) {
            updateData['limits'] = {
              maxTurns: parsed.maxTurns ?? existing.limits.maxTurns,
              maxTokensPerTurn: parsed.maxTokensPerTurn ?? existing.limits.maxTokensPerTurn,
              budgetPerDayUsd: parsed.budgetPerDayUsd ?? existing.limits.budgetPerDayUsd,
            };
          }
        }

        await agentRepository.update(parsed.agentId as AgentId, updateData);

        logger.info('Agent updated', {
          component: 'admin-update-agent',
          agentId: parsed.agentId,
        });

        return ok({
          success: true,
          output: { agentId: parsed.agentId, updated: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof NexusErrorClass) return err(e);
        return err(
          new ToolExecutionError(
            'admin-update-agent',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = updateAgentInput.parse(input);
      await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-update-agent');
      return ok({
        success: true,
        output: { agentId: parsed.agentId, wouldUpdate: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-set-agent-status ────────────────────────────────────────

const setStatusInput = z.object({
  agentId: z.string(),
  status: z.enum(['active', 'paused', 'disabled']),
});

/**
 * Create the admin-set-agent-status tool.
 */
export function createAdminSetAgentStatusTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-set-agent-status',
    name: 'Admin Set Agent Status',
    description: 'Set an agent to active, paused, or disabled. Cannot change fomo-admin status.',
    category: 'admin',
    inputSchema: setStatusInput,
    outputSchema: z.object({ agentId: z.string(), status: z.string() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = setStatusInput.parse(input);

      try {
        await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-set-agent-status');
        await agentRepository.update(parsed.agentId as AgentId, { status: parsed.status });

        logger.info('Agent status updated', {
          component: 'admin-set-agent-status',
          agentId: parsed.agentId,
          status: parsed.status,
        });

        return ok({
          success: true,
          output: { agentId: parsed.agentId, status: parsed.status },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof NexusErrorClass) return err(e);
        return err(
          new ToolExecutionError(
            'admin-set-agent-status',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = setStatusInput.parse(input);
      await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-set-agent-status');
      return ok({
        success: true,
        output: { agentId: parsed.agentId, wouldSet: parsed.status },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-create-project ──────────────────────────────────────────

const createProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  owner: z.string().optional(),
});

/**
 * Create the admin-create-project tool.
 */
export function createAdminCreateProjectTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { projectRepository } = options;

  return {
    id: 'admin-create-project',
    name: 'Admin Create Project',
    description: 'Create a new project. Optionally provide an ID (auto-generated if omitted).',
    category: 'admin',
    inputSchema: createProjectInput,
    outputSchema: z.object({ projectId: z.string(), name: z.string() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = createProjectInput.parse(input);

      logger.info('Creating project', {
        component: 'admin-create-project',
        name: parsed.name,
      });

      try {
        const project = await projectRepository.create({
          name: parsed.name,
          description: parsed.description ?? '',
          owner: parsed.owner ?? 'fomo-admin',
          config: {
            projectId: '' as import('@/core/types.js').ProjectId, // filled by repo
            agentRole: 'default',
            provider: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
            failover: { onRateLimit: true, onServerError: true, onTimeout: true, timeoutMs: 30000, maxRetries: 2 },
            allowedTools: [],
            memoryConfig: {
              longTerm: { enabled: false, maxEntries: 1000, retrievalTopK: 5, embeddingProvider: 'openai', decayEnabled: false, decayHalfLifeDays: 30 },
              contextWindow: { reserveTokens: 2000, pruningStrategy: 'turn-based', maxTurnsInContext: 20, compaction: { enabled: false, memoryFlushBeforeCompaction: false } },
            },
            costConfig: {
              dailyBudgetUSD: 10, monthlyBudgetUSD: 300, maxTokensPerTurn: 4000, maxTurnsPerSession: 30,
              maxToolCallsPerTurn: 5, alertThresholdPercent: 80, hardLimitPercent: 100,
              maxRequestsPerMinute: 60, maxRequestsPerHour: 500,
            },
            maxTurnsPerSession: 30,
            maxConcurrentSessions: 10,
          },
        });

        return ok({
          success: true,
          output: { projectId: project.id, name: project.name },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-create-project',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = createProjectInput.parse(input);
      return ok({
        success: true,
        output: { projectId: '[auto]', name: parsed.name, wouldCreate: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-update-project ──────────────────────────────────────────

const updateProjectInput = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
});

/**
 * Create the admin-update-project tool.
 */
export function createAdminUpdateProjectTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { projectRepository } = options;

  return {
    id: 'admin-update-project',
    name: 'Admin Update Project',
    description: 'Update project name, description, or status.',
    category: 'admin',
    inputSchema: updateProjectInput,
    outputSchema: z.object({ projectId: z.string(), updated: z.boolean() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = updateProjectInput.parse(input);

      logger.info('Updating project', {
        component: 'admin-update-project',
        projectId: parsed.projectId,
      });

      try {
        const updateData: Record<string, unknown> = {};
        if (parsed.name) updateData['name'] = parsed.name;
        if (parsed.description !== undefined) updateData['description'] = parsed.description;
        if (parsed.status) updateData['status'] = parsed.status;

        await projectRepository.update(parsed.projectId as ProjectId, updateData);

        return ok({
          success: true,
          output: { projectId: parsed.projectId, updated: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-update-project',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = updateProjectInput.parse(input);
      return ok({
        success: true,
        output: { projectId: parsed.projectId, wouldUpdate: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-grant-tool / admin-revoke-tool ──────────────────────────

const grantToolInput = z.object({
  agentId: z.string(),
  toolId: z.string(),
});

/**
 * Create the admin-grant-tool tool.
 */
export function createAdminGrantToolTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-grant-tool',
    name: 'Admin Grant Tool',
    description: 'Add a tool to an agent\'s allowlist. Cannot modify fomo-admin.',
    category: 'admin',
    inputSchema: grantToolInput,
    outputSchema: z.object({ agentId: z.string(), toolId: z.string(), granted: z.boolean() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = grantToolInput.parse(input);

      try {
        await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-grant-tool');

        const agent = await agentRepository.findById(parsed.agentId as AgentId);
        if (!agent) {
          return err(new ToolExecutionError('admin-grant-tool', `Agent not found: ${parsed.agentId}`));
        }

        if (agent.toolAllowlist.includes(parsed.toolId)) {
          return ok({
            success: true,
            output: { agentId: parsed.agentId, toolId: parsed.toolId, granted: false, reason: 'already granted' },
            durationMs: Date.now() - startTime,
          });
        }

        await agentRepository.update(parsed.agentId as AgentId, {
          toolAllowlist: [...agent.toolAllowlist, parsed.toolId],
        });

        logger.info('Tool granted', {
          component: 'admin-grant-tool',
          agentId: parsed.agentId,
          toolId: parsed.toolId,
        });

        return ok({
          success: true,
          output: { agentId: parsed.agentId, toolId: parsed.toolId, granted: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof NexusErrorClass) return err(e);
        return err(
          new ToolExecutionError(
            'admin-grant-tool',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = grantToolInput.parse(input);
      await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-grant-tool');
      return ok({
        success: true,
        output: { agentId: parsed.agentId, toolId: parsed.toolId, wouldGrant: true },
        durationMs: 0,
      });
    },
  };
}

/**
 * Create the admin-revoke-tool tool.
 */
export function createAdminRevokeToolTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-revoke-tool',
    name: 'Admin Revoke Tool',
    description: 'Remove a tool from an agent\'s allowlist. Cannot modify fomo-admin.',
    category: 'admin',
    inputSchema: grantToolInput,
    outputSchema: z.object({ agentId: z.string(), toolId: z.string(), revoked: z.boolean() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = grantToolInput.parse(input);

      try {
        await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-revoke-tool');

        const agent = await agentRepository.findById(parsed.agentId as AgentId);
        if (!agent) {
          return err(new ToolExecutionError('admin-revoke-tool', `Agent not found: ${parsed.agentId}`));
        }

        if (!agent.toolAllowlist.includes(parsed.toolId)) {
          return ok({
            success: true,
            output: { agentId: parsed.agentId, toolId: parsed.toolId, revoked: false, reason: 'not in allowlist' },
            durationMs: Date.now() - startTime,
          });
        }

        await agentRepository.update(parsed.agentId as AgentId, {
          toolAllowlist: agent.toolAllowlist.filter((t) => t !== parsed.toolId),
        });

        logger.info('Tool revoked', {
          component: 'admin-revoke-tool',
          agentId: parsed.agentId,
          toolId: parsed.toolId,
        });

        return ok({
          success: true,
          output: { agentId: parsed.agentId, toolId: parsed.toolId, revoked: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof NexusErrorClass) return err(e);
        return err(
          new ToolExecutionError(
            'admin-revoke-tool',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = grantToolInput.parse(input);
      await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-revoke-tool');
      return ok({
        success: true,
        output: { agentId: parsed.agentId, toolId: parsed.toolId, wouldRevoke: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-set-agent-model ─────────────────────────────────────────

const setModelInput = z.object({
  agentId: z.string(),
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
});

/**
 * Create the admin-set-agent-model tool.
 */
export function createAdminSetAgentModelTool(
  options: AdminWriteAgentToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-set-agent-model',
    name: 'Admin Set Agent Model',
    description: 'Change the LLM model for an agent. Cannot modify fomo-admin.',
    category: 'admin',
    inputSchema: setModelInput,
    outputSchema: z.object({ agentId: z.string(), model: z.string() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = setModelInput.parse(input);

      try {
        await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-set-agent-model');

        await agentRepository.update(parsed.agentId as AgentId, {
          llmConfig: {
            provider: parsed.provider,
            model: parsed.model,
            temperature: parsed.temperature,
          },
        });

        logger.info('Agent model updated', {
          component: 'admin-set-agent-model',
          agentId: parsed.agentId,
          model: parsed.model,
        });

        return ok({
          success: true,
          output: { agentId: parsed.agentId, model: parsed.model },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof NexusErrorClass) return err(e);
        return err(
          new ToolExecutionError(
            'admin-set-agent-model',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = setModelInput.parse(input);
      await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-set-agent-model');
      return ok({
        success: true,
        output: { agentId: parsed.agentId, wouldSetModel: parsed.model },
        durationMs: 0,
      });
    },
  };
}
