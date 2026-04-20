/**
 * Admin prompt-layer read-only tools.
 *
 * - admin-list-prompt-layers: list layers for a project/agent
 * - admin-get-prompt-layer: get a specific layer by ID
 * - admin-diff-prompt-layers: compare two layer versions
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

const logger = createLogger({ name: 'admin-tools-prompts' });

// ─── Options ───────────────────────────────────────────────────────

/** DI options for prompt admin tools. */
export interface AdminPromptToolOptions {
  prisma: PrismaClient;
}

// ─── admin-list-prompt-layers ──────────────────────────────────────

const listLayersInput = z.object({
  projectId: z.string().describe('Project ID to list layers for.'),
  layerType: z
    .enum(['identity', 'instructions', 'safety'])
    .optional()
    .describe('Filter by layer type.'),
});

const listLayersOutput = z.object({
  layers: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      layerType: z.string(),
      version: z.number(),
      isActive: z.boolean(),
      createdBy: z.string(),
      changeReason: z.string(),
      contentPreview: z.string(),
      createdAt: z.string(),
    }),
  ),
});

/**
 * Create the admin-list-prompt-layers tool.
 *
 * Lists all prompt layer versions for a project, optionally filtered by agent and type.
 */
export function createAdminListPromptLayersTool(
  options: AdminPromptToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-list-prompt-layers',
    name: 'Admin List Prompt Layers',
    description:
      'List all prompt layer versions for a project. Optionally filter by layerType. ' +
      'Shows version, active status, creator, and content preview.',
    category: 'admin',
    inputSchema: listLayersInput,
    outputSchema: listLayersOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = listLayersInput.parse(input) as {
        projectId: string;
        layerType?: string;
      };

      logger.info('Listing prompt layers', {
        component: 'admin-list-prompt-layers',
        projectId: parsed.projectId,
      });

      try {
        const where: Record<string, unknown> = { projectId: parsed.projectId };
        if (parsed.layerType) where['layerType'] = parsed.layerType;

        const layers = await prisma.promptLayer.findMany({
          where,
          orderBy: [{ layerType: 'asc' }, { version: 'desc' }],
          take: 100,
        });

        return ok({
          success: true,
          output: {
            layers: layers.map((l) => ({
              id: l.id,
              projectId: l.projectId,
              layerType: l.layerType,
              version: l.version,
              isActive: l.isActive,
              createdBy: l.createdBy,
              changeReason: l.changeReason,
              contentPreview: l.content.slice(0, 200) + (l.content.length > 200 ? '...' : ''),
              createdAt: l.createdAt.toISOString(),
            })),
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        return err(
          new ToolExecutionError(
            'admin-list-prompt-layers',
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

// ─── admin-get-prompt-layer ────────────────────────────────────────

const getLayerInput = z.object({
  layerId: z.string().describe('Prompt layer ID to retrieve.'),
});

const getLayerOutput = z.object({
  layer: z.object({
    id: z.string(),
    projectId: z.string(),
    layerType: z.string(),
    version: z.number(),
    isActive: z.boolean(),
    content: z.string(),
    createdBy: z.string(),
    changeReason: z.string(),
    createdAt: z.string(),
  }),
});

/**
 * Create the admin-get-prompt-layer tool.
 *
 * Returns full content of a specific prompt layer by ID.
 */
export function createAdminGetPromptLayerTool(
  options: AdminPromptToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-get-prompt-layer',
    name: 'Admin Get Prompt Layer',
    description:
      'Get the full content and metadata of a specific prompt layer by ID. ' +
      'Use after list-prompt-layers to inspect a specific version.',
    category: 'admin',
    inputSchema: getLayerInput,
    outputSchema: getLayerOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = getLayerInput.parse(input) as { layerId: string };

      logger.info('Getting prompt layer', {
        component: 'admin-get-prompt-layer',
        layerId: parsed.layerId,
      });

      try {
        const layer = await prisma.promptLayer.findUnique({
          where: { id: parsed.layerId },
        });

        if (!layer) {
          return err(
            new ToolExecutionError(
              'admin-get-prompt-layer',
              `Prompt layer not found: ${parsed.layerId}`,
            ),
          );
        }

        return ok({
          success: true,
          output: {
            layer: {
              id: layer.id,
              projectId: layer.projectId,
              layerType: layer.layerType,
              version: layer.version,
              isActive: layer.isActive,
              content: layer.content,
              createdBy: layer.createdBy,
              changeReason: layer.changeReason,
              createdAt: layer.createdAt.toISOString(),
            },
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-get-prompt-layer',
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

// ─── admin-diff-prompt-layers ──────────────────────────────────────

const diffLayersInput = z.object({
  layerIdA: z.string().describe('First prompt layer ID (base).'),
  layerIdB: z.string().describe('Second prompt layer ID (compare).'),
});

const diffLayersOutput = z.object({
  layerA: z.object({
    id: z.string(),
    version: z.number(),
    layerType: z.string(),
    isActive: z.boolean(),
  }),
  layerB: z.object({
    id: z.string(),
    version: z.number(),
    layerType: z.string(),
    isActive: z.boolean(),
  }),
  contentA: z.string(),
  contentB: z.string(),
  lengthDelta: z.number(),
  isSameContent: z.boolean(),
});

/**
 * Create the admin-diff-prompt-layers tool.
 *
 * Compares two prompt layer versions side-by-side.
 */
export function createAdminDiffPromptLayersTool(
  options: AdminPromptToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'admin-diff-prompt-layers',
    name: 'Admin Diff Prompt Layers',
    description:
      'Compare two prompt layer versions side-by-side. Returns both contents, ' +
      'metadata, and whether they differ. Useful for reviewing changes before activation.',
    category: 'admin',
    inputSchema: diffLayersInput,
    outputSchema: diffLayersOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = diffLayersInput.parse(input) as { layerIdA: string; layerIdB: string };

      logger.info('Diffing prompt layers', {
        component: 'admin-diff-prompt-layers',
        layerIdA: parsed.layerIdA,
        layerIdB: parsed.layerIdB,
      });

      try {
        const [layerA, layerB] = await Promise.all([
          prisma.promptLayer.findUnique({ where: { id: parsed.layerIdA } }),
          prisma.promptLayer.findUnique({ where: { id: parsed.layerIdB } }),
        ]);

        if (!layerA) {
          return err(
            new ToolExecutionError(
              'admin-diff-prompt-layers',
              `Layer A not found: ${parsed.layerIdA}`,
            ),
          );
        }
        if (!layerB) {
          return err(
            new ToolExecutionError(
              'admin-diff-prompt-layers',
              `Layer B not found: ${parsed.layerIdB}`,
            ),
          );
        }

        return ok({
          success: true,
          output: {
            layerA: {
              id: layerA.id,
              version: layerA.version,
              layerType: layerA.layerType,
              isActive: layerA.isActive,
            },
            layerB: {
              id: layerB.id,
              version: layerB.version,
              layerType: layerB.layerType,
              isActive: layerB.isActive,
            },
            contentA: layerA.content,
            contentB: layerB.content,
            lengthDelta: layerB.content.length - layerA.content.length,
            isSameContent: layerA.content === layerB.content,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (e) {
        if (e instanceof ToolExecutionError) return err(e);
        return err(
          new ToolExecutionError(
            'admin-diff-prompt-layers',
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
