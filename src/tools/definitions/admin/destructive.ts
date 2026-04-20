/**
 * Admin destructive tools — all require approval.
 *
 * - admin-delete-agent (high risk)
 * - admin-delete-project (critical risk)
 * - admin-issue-api-key (high risk)
 * - admin-revoke-api-key (high risk)
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
import type { ApiKeyService } from '@/security/api-key-service.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-destructive' });

const FOMO_ADMIN_NAME = 'FOMO-Admin';

/** Meta-safety check. */
async function assertNotSelfModify(
  agentRepository: AgentRepository,
  agentId: string,
  toolId: string,
): Promise<void> {
  const agent = await agentRepository.findById(agentId as AgentId);
  if (agent?.name === FOMO_ADMIN_NAME) {
    throw new NexusErrorClass({
      message: `Meta-safety: ${toolId} cannot target the fomo-admin agent`,
      code: 'ADMIN_SELF_MODIFY',
      statusCode: 403,
    });
  }
}

/** DI options for destructive admin tools. */
export interface AdminDestructiveToolOptions {
  agentRepository: AgentRepository;
  projectRepository: ProjectRepository;
  apiKeyService: ApiKeyService;
}

// ─── admin-delete-agent ────────────────────────────────────────────

const deleteAgentInput = z.object({
  agentId: z.string(),
  confirm: z.literal(true).describe('Must be true to confirm deletion.'),
});

/**
 * Create the admin-delete-agent tool.
 */
export function createAdminDeleteAgentTool(
  options: AdminDestructiveToolOptions,
): ExecutableTool {
  const { agentRepository } = options;

  return {
    id: 'admin-delete-agent',
    name: 'Admin Delete Agent',
    description:
      'Permanently delete an agent. IRREVERSIBLE. Cannot delete fomo-admin. Requires approval.',
    category: 'admin',
    inputSchema: deleteAgentInput,
    outputSchema: z.object({ deleted: z.boolean(), agentId: z.string() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = deleteAgentInput.parse(input);

      try {
        await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-delete-agent');

        await agentRepository.delete(parsed.agentId as AgentId);

        logger.info('Agent deleted', {
          component: 'admin-delete-agent',
          agentId: parsed.agentId,
        });

        return ok({
          success: true,
          output: { deleted: true, agentId: parsed.agentId },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof NexusErrorClass) return err(e);
        return err(
          new ToolExecutionError(
            'admin-delete-agent',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = deleteAgentInput.parse(input);
      await assertNotSelfModify(agentRepository, parsed.agentId, 'admin-delete-agent');
      return ok({
        success: true,
        output: { deleted: false, agentId: parsed.agentId, wouldDelete: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-delete-project ──────────────────────────────────────────

const deleteProjectInput = z.object({
  projectId: z.string(),
  confirm: z.literal(true),
});

/**
 * Create the admin-delete-project tool.
 */
export function createAdminDeleteProjectTool(
  options: AdminDestructiveToolOptions,
): ExecutableTool {
  const { projectRepository } = options;

  return {
    id: 'admin-delete-project',
    name: 'Admin Delete Project',
    description:
      'Permanently delete a project and ALL its data (agents, sessions, traces). ' +
      'IRREVERSIBLE. Cannot delete fomo-internal. Requires approval.',
    category: 'admin',
    inputSchema: deleteProjectInput,
    outputSchema: z.object({ deleted: z.boolean(), projectId: z.string() }),
    riskLevel: 'critical',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = deleteProjectInput.parse(input);

      if (parsed.projectId === 'fomo-internal') {
        return err(
          new ToolExecutionError(
            'admin-delete-project',
            'Cannot delete the fomo-internal project (meta-safety)',
          ),
        );
      }

      try {
        await projectRepository.delete(parsed.projectId as ProjectId);

        logger.info('Project deleted', {
          component: 'admin-delete-project',
          projectId: parsed.projectId,
        });

        return ok({
          success: true,
          output: { deleted: true, projectId: parsed.projectId },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-delete-project',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = deleteProjectInput.parse(input);
      if (parsed.projectId === 'fomo-internal') {
        return err(
          new ToolExecutionError(
            'admin-delete-project',
            'Cannot delete the fomo-internal project (meta-safety)',
          ),
        );
      }
      return ok({
        success: true,
        output: { deleted: false, projectId: parsed.projectId, wouldDelete: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-issue-api-key ───────────────────────────────────────────

const issueKeyInput = z.object({
  projectId: z.string().optional().describe('Omit for master key.'),
  name: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

/**
 * Create the admin-issue-api-key tool.
 *
 * Returns plaintext ONCE. The LLM instructions layer prohibits echoing it.
 */
export function createAdminIssueApiKeyTool(
  options: AdminDestructiveToolOptions,
): ExecutableTool {
  const { apiKeyService } = options;

  return {
    id: 'admin-issue-api-key',
    name: 'Admin Issue API Key',
    description:
      'Generate a new API key (master or project-scoped). The plaintext is returned ONCE. ' +
      'NEVER echo the plaintext in your response — reference by keyId only.',
    category: 'admin',
    inputSchema: issueKeyInput,
    outputSchema: z.object({ keyId: z.string(), prefix: z.string() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = issueKeyInput.parse(input);

      logger.info('Issuing API key', {
        component: 'admin-issue-api-key',
        projectId: parsed.projectId ?? 'master',
        name: parsed.name,
      });

      try {
        const result = await apiKeyService.generateApiKey({
          projectId: parsed.projectId,
          name: parsed.name,
          scopes: parsed.scopes,
        });

        return ok({
          success: true,
          output: {
            keyId: result.meta.id,
            prefix: result.plaintext.slice(0, 10) + '...',
            // Plaintext stored in tool result metadata only, not in output text
          },
          durationMs: Date.now() - startTime,
          metadata: { plaintext: result.plaintext },
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-issue-api-key',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = issueKeyInput.parse(input);
      return ok({
        success: true,
        output: {
          keyId: '[dry-run]',
          prefix: 'nx_...',
          wouldIssue: true,
          name: parsed.name,
        },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-revoke-api-key ──────────────────────────────────────────

const revokeKeyInput = z.object({
  keyId: z.string(),
});

/**
 * Create the admin-revoke-api-key tool.
 */
export function createAdminRevokeApiKeyTool(
  options: AdminDestructiveToolOptions,
): ExecutableTool {
  const { apiKeyService } = options;

  return {
    id: 'admin-revoke-api-key',
    name: 'Admin Revoke API Key',
    description: 'Revoke an API key by its ID. The key will immediately stop working.',
    category: 'admin',
    inputSchema: revokeKeyInput,
    outputSchema: z.object({ keyId: z.string(), revoked: z.boolean() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = revokeKeyInput.parse(input);

      logger.info('Revoking API key', {
        component: 'admin-revoke-api-key',
        keyId: parsed.keyId,
      });

      try {
        await apiKeyService.revokeApiKey(parsed.keyId);

        return ok({
          success: true,
          output: { keyId: parsed.keyId, revoked: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-revoke-api-key',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = revokeKeyInput.parse(input);
      return ok({
        success: true,
        output: { keyId: parsed.keyId, wouldRevoke: true },
        durationMs: 0,
      });
    },
  };
}
