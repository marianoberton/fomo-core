/**
 * Admin provisioning tools.
 *
 * - admin-provision-client (high risk)
 * - admin-deprovision-client (high risk)
 * - admin-get-provision-status (read-only)
 * - admin-redeploy-client (medium risk)
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { ProvisioningService } from '@/provisioning/provisioning-service.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-provisioning' });

/** DI options for provisioning admin tools. */
export interface AdminProvisioningToolOptions {
  provisioningService: ProvisioningService;
}

// ─── admin-get-provision-status ────────────────────────────────────

const getStatusInput = z.object({
  clientId: z.string(),
});

/**
 * Create the admin-get-provision-status tool.
 */
export function createAdminGetProvisionStatusTool(
  options: AdminProvisioningToolOptions,
): ExecutableTool {
  const { provisioningService } = options;

  return {
    id: 'admin-get-provision-status',
    name: 'Admin Get Provision Status',
    description: 'Get the current provisioning status of a client deployment.',
    category: 'admin',
    inputSchema: getStatusInput,
    outputSchema: z.object({ clientId: z.string(), status: z.string(), details: z.record(z.unknown()) }),
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = getStatusInput.parse(input);

      logger.info('Getting provision status', {
        component: 'admin-get-provision-status',
        clientId: parsed.clientId,
      });

      try {
        const status = await provisioningService.getClientStatus(parsed.clientId);

        return ok({
          success: true,
          output: {
            clientId: parsed.clientId,
            status: status.status,
            details: status as unknown as Record<string, unknown>,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-get-provision-status',
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

// ─── admin-provision-client ────────────────────────────────────────

const provisionInput = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  channels: z.array(z.object({
    type: z.string(),
    config: z.record(z.unknown()).optional(),
  })).min(1),
  agentConfig: z.object({
    name: z.string(),
    model: z.string().optional(),
    provider: z.string().optional(),
    identity: z.string().optional(),
    instructions: z.string().optional(),
    safety: z.string().optional(),
  }),
  vertical: z.string().optional(),
  companyName: z.string().optional(),
  ownerName: z.string().optional(),
});

/**
 * Create the admin-provision-client tool.
 */
export function createAdminProvisionClientTool(
  options: AdminProvisioningToolOptions,
): ExecutableTool {
  const { provisioningService } = options;

  return {
    id: 'admin-provision-client',
    name: 'Admin Provision Client',
    description:
      'Provision a new client deployment (Docker container). Creates isolated infrastructure. ' +
      'Requires approval.',
    category: 'admin',
    inputSchema: provisionInput,
    outputSchema: z.object({ clientId: z.string(), provisioned: z.boolean() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = provisionInput.parse(input);

      logger.info('Provisioning client', {
        component: 'admin-provision-client',
        clientId: parsed.clientId,
      });

      try {
        await provisioningService.provisionClient(
          parsed as unknown as import('@/provisioning/provisioning-types.js').CreateClientRequest,
        );

        return ok({
          success: true,
          output: { clientId: parsed.clientId, provisioned: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-provision-client',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = provisionInput.parse(input);
      return ok({
        success: true,
        output: { clientId: parsed.clientId, wouldProvision: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-deprovision-client ──────────────────────────────────────

const deprovisionInput = z.object({
  clientId: z.string(),
  confirm: z.literal(true),
});

/**
 * Create the admin-deprovision-client tool.
 */
export function createAdminDeprovisionClientTool(
  options: AdminProvisioningToolOptions,
): ExecutableTool {
  const { provisioningService } = options;

  return {
    id: 'admin-deprovision-client',
    name: 'Admin Deprovision Client',
    description:
      'Tear down a client deployment. IRREVERSIBLE — all client-specific infrastructure is destroyed. ' +
      'Requires approval.',
    category: 'admin',
    inputSchema: deprovisionInput,
    outputSchema: z.object({ clientId: z.string(), deprovisioned: z.boolean() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = deprovisionInput.parse(input);

      logger.info('Deprovisioning client', {
        component: 'admin-deprovision-client',
        clientId: parsed.clientId,
      });

      try {
        await provisioningService.deprovisionClient(parsed.clientId);

        return ok({
          success: true,
          output: { clientId: parsed.clientId, deprovisioned: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-deprovision-client',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = deprovisionInput.parse(input);
      return ok({
        success: true,
        output: { clientId: parsed.clientId, wouldDeprovision: true },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-redeploy-client ─────────────────────────────────────────

const redeployInput = z.object({
  clientId: z.string(),
});

/**
 * Create the admin-redeploy-client tool.
 */
export function createAdminRedeployClientTool(
  options: AdminProvisioningToolOptions,
): ExecutableTool {
  const { provisioningService } = options;

  return {
    id: 'admin-redeploy-client',
    name: 'Admin Redeploy Client',
    description:
      'Trigger a redeployment of a client container (pull latest code + rebuild). ' +
      'Use after config changes or to recover from a failed state.',
    category: 'admin',
    inputSchema: redeployInput,
    outputSchema: z.object({ clientId: z.string(), redeployed: z.boolean() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = redeployInput.parse(input);

      logger.info('Redeploying client', {
        component: 'admin-redeploy-client',
        clientId: parsed.clientId,
      });

      try {
        await provisioningService.redeployClient(parsed.clientId);

        return ok({
          success: true,
          output: { clientId: parsed.clientId, redeployed: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-redeploy-client',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = redeployInput.parse(input);
      return ok({
        success: true,
        output: { clientId: parsed.clientId, wouldRedeploy: true },
        durationMs: 0,
      });
    },
  };
}
