/**
 * Admin write tools for prompt layers.
 *
 * - admin-create-prompt-layer: create a new version of a prompt layer
 * - admin-activate-prompt-layer: activate a specific layer version (high risk)
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger({ name: 'admin-write-prompts' });

/** DI options for prompt write tools. */
export interface AdminWritePromptToolOptions {
  prisma: PrismaClient;
}

// ─── admin-create-prompt-layer ─────────────────────────────────────

const createLayerInput = z.object({
  projectId: z.string(),
  layerType: z.enum(['identity', 'instructions', 'safety']),
  content: z.string().min(1),
  createdBy: z.string().min(1),
  changeReason: z.string().min(1),
});

/**
 * Create the admin-create-prompt-layer tool.
 *
 * Creates a new version of a prompt layer (inactive by default).
 * Use admin-activate-prompt-layer to make it live.
 */
export function createAdminCreatePromptLayerTool(
  options: AdminWritePromptToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-create-prompt-layer',
    name: 'Admin Create Prompt Layer',
    description:
      'Create a new version of a prompt layer (identity, instructions, or safety). ' +
      'Created as inactive — use admin-activate-prompt-layer to make it live.',
    category: 'admin',
    inputSchema: createLayerInput,
    outputSchema: z.object({ layerId: z.string(), version: z.number() }),
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = createLayerInput.parse(input);

      logger.info('Creating prompt layer', {
        component: 'admin-create-prompt-layer',
        projectId: parsed.projectId,
        layerType: parsed.layerType,
      });

      try {
        // Find the highest version for this project+layerType
        const latest = await prisma.promptLayer.findFirst({
          where: {
            projectId: parsed.projectId,
            layerType: parsed.layerType,
          },
          orderBy: { version: 'desc' },
          select: { version: true },
        });

        const nextVersion = (latest?.version ?? 0) + 1;

        const layer = await prisma.promptLayer.create({
          data: {
            id: randomUUID(),
            projectId: parsed.projectId,
            layerType: parsed.layerType,
            version: nextVersion,
            content: parsed.content,
            isActive: false,
            createdBy: parsed.createdBy,
            changeReason: parsed.changeReason,
          },
        });

        return ok({
          success: true,
          output: { layerId: layer.id, version: layer.version },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-create-prompt-layer',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = createLayerInput.parse(input);
      return ok({
        success: true,
        output: {
          layerId: '[dry-run]',
          version: -1,
          wouldCreate: true,
          projectId: parsed.projectId,
          layerType: parsed.layerType,
        },
        durationMs: 0,
      });
    },
  };
}

// ─── admin-activate-prompt-layer ───────────────────────────────────

const activateLayerInput = z.object({
  layerId: z.string(),
});

/**
 * Create the admin-activate-prompt-layer tool.
 *
 * Activates a specific layer version, deactivating the previously active one.
 * High risk — requires approval in non-interactive contexts.
 */
export function createAdminActivatePromptLayerTool(
  options: AdminWritePromptToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-activate-prompt-layer',
    name: 'Admin Activate Prompt Layer',
    description:
      'Activate a specific prompt layer version, deactivating the current active one. ' +
      'This changes what the agent says in production — high risk.',
    category: 'admin',
    inputSchema: activateLayerInput,
    outputSchema: z.object({ layerId: z.string(), activated: z.boolean() }),
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = activateLayerInput.parse(input);

      logger.info('Activating prompt layer', {
        component: 'admin-activate-prompt-layer',
        layerId: parsed.layerId,
      });

      try {
        const layer = await prisma.promptLayer.findUnique({
          where: { id: parsed.layerId },
        });

        if (!layer) {
          return err(
            new ToolExecutionError(
              'admin-activate-prompt-layer',
              `Layer not found: ${parsed.layerId}`,
            ),
          );
        }

        // Deactivate current active layer for same project+type
        await prisma.promptLayer.updateMany({
          where: {
            projectId: layer.projectId,
            layerType: layer.layerType,
            isActive: true,
          },
          data: { isActive: false },
        });

        // Activate the target layer
        await prisma.promptLayer.update({
          where: { id: parsed.layerId },
          data: { isActive: true },
        });

        return ok({
          success: true,
          output: { layerId: parsed.layerId, activated: true },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-activate-prompt-layer',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = activateLayerInput.parse(input);
      return ok({
        success: true,
        output: { layerId: parsed.layerId, wouldActivate: true },
        durationMs: 0,
      });
    },
  };
}
