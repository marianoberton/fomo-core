/**
 * Admin tools-management read-only tool.
 *
 * - admin-list-tools: list all registered tools in the platform
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok } from '@/core/result.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-tools-management' });

// ─── Options ───────────────────────────────────────────────────────

/** DI options for tool management admin tools. */
export interface AdminToolManagementOptions {
  toolRegistry: ToolRegistry;
}

// ─── admin-list-tools ──────────────────────────────────────────────

const listToolsInput = z.object({
  category: z.string().optional().describe('Filter by tool category.'),
});

const listToolsOutput = z.object({
  tools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      riskLevel: z.string(),
      requiresApproval: z.boolean(),
      sideEffects: z.boolean(),
      supportsDryRun: z.boolean(),
    }),
  ),
  total: z.number(),
});

/**
 * Create the admin-list-tools tool.
 *
 * Returns all registered tools in the platform with their metadata.
 * Useful for understanding what capabilities are available.
 */
export function createAdminListToolsTool(
  options: AdminToolManagementOptions,
): ExecutableTool {
  const { toolRegistry } = options;

  return {
    id: 'admin-list-tools',
    name: 'Admin List Tools',
    description:
      'List all registered tools in the platform with their risk level, ' +
      'approval requirements, and capabilities. Optionally filter by category.',
    category: 'admin',
    inputSchema: listToolsInput,
    outputSchema: listToolsOutput,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = listToolsInput.parse(input) as { category?: string };

      logger.info('Listing all tools', {
        component: 'admin-list-tools',
        category: parsed.category ?? 'all',
      });

      const allIds = toolRegistry.listAll();
      const allTools = allIds
        .map((id) => toolRegistry.get(id))
        .filter((t): t is NonNullable<typeof t> => t != null);

      const filtered = parsed.category
        ? allTools.filter((t) => t.category === parsed.category)
        : allTools;

      return Promise.resolve(
        ok({
          success: true,
          output: {
            tools: filtered.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              category: t.category,
              riskLevel: t.riskLevel,
              requiresApproval: t.requiresApproval,
              sideEffects: t.sideEffects,
              supportsDryRun: t.supportsDryRun,
            })),
            total: filtered.length,
          },
          durationMs: Date.now() - startTime,
        }),
      );
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      return this.execute(input, context);
    },
  };
}
