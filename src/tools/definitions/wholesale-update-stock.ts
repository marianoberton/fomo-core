/**
 * Wholesale Update Stock Tool
 *
 * Updates inventory from CSV data
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  parseStockCSV,
  applyStockUpdates,
  ProductSchema,
} from '@/verticals/wholesale/stock-manager.js';

const logger = createLogger({ name: 'wholesale-update-stock' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  csvContent: z.string().describe('CSV content with columns: sku,stock,price (optional)'),
  projectId: z.string().describe('Project ID to update stock for'),
});

const outputSchema = z.object({
  success: z.boolean(),
  updatedCount: z.number(),
  notFoundCount: z.number(),
  notFoundSkus: z.array(z.string()),
  message: z.string(),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createWholesaleUpdateStockTool(): ExecutableTool {
  return {
    id: 'wholesale-update-stock',
    name: 'Update Wholesale Stock',
    description:
      'Update inventory from CSV data. CSV must contain SKU and STOCK columns. Optional PRICE column to update prices.',
    category: 'wholesale',
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('wholesale-update-stock', 'Invalid input', parsed.error));
      }
      const { csvContent, projectId } = parsed.data;

      try {
        if (projectId !== context.projectId) {
          return err(new ToolExecutionError('wholesale-update-stock', 'Cannot update stock for different project'));
        }

        let updates;
        try {
          updates = parseStockCSV(csvContent);
        } catch (parseError) {
          return err(new ToolExecutionError(
            'wholesale-update-stock',
            `Failed to parse CSV: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
          ));
        }

        if (updates.length === 0) {
          return ok({
            success: false,
            output: {
              success: false,
              updatedCount: 0,
              notFoundCount: 0,
              notFoundSkus: [],
              message: 'No valid stock updates found in CSV',
            },
            durationMs: Date.now() - startTime,
          });
        }

        const project = await getDatabase().client.project.findUnique({
          where: { id: projectId },
        });

        if (!project) {
          return err(new ToolExecutionError('wholesale-update-stock', `Project ${projectId} not found`));
        }

        const config = project.configJson as Record<string, unknown>;
        const catalog = (config['catalog'] ?? {}) as Record<string, unknown>;
        const existingProducts = ((catalog['products'] ?? []) as unknown[]).map((p) =>
          ProductSchema.parse(p)
        );

        const result = applyStockUpdates(existingProducts, updates);

        const updatedProductMap = new Map(existingProducts.map((p) => [p.sku, p]));
        for (const updated of result.updated) {
          updatedProductMap.set(updated.sku, updated);
        }

        const updatedProducts = Array.from(updatedProductMap.values());

        const updatedConfig = {
          ...config,
          catalog: {
            ...catalog,
            products: updatedProducts,
            lastStockUpdate: new Date().toISOString(),
          },
        };

        await getDatabase().client.project.update({
          where: { id: projectId },
          data: { configJson: updatedConfig },
        });

        logger.info('Stock updated from CSV', {
          component: 'wholesale-update-stock',
          projectId,
          updatedCount: result.updated.length,
          notFoundCount: result.notFound.length,
        });

        return ok({
          success: true,
          output: {
            success: true,
            updatedCount: result.updated.length,
            notFoundCount: result.notFound.length,
            notFoundSkus: result.notFound,
            message: `Stock updated: ${result.updated.length} products updated${result.notFound.length > 0 ? `, ${result.notFound.length} SKUs not found` : ''}`,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Stock update failed', {
          component: 'wholesale-update-stock',
          error,
        });
        return err(new ToolExecutionError(
          'wholesale-update-stock',
          'Stock update failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('wholesale-update-stock', 'Invalid input', parsed.error)));
      }

      const updates = parseStockCSV(parsed.data.csvContent);

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          updatedCount: updates.length,
          notFoundCount: 0,
          notFoundSkus: [],
          message: `Dry run: would update ${updates.length} products`,
        },
        durationMs: 0,
      }));
    },
  };
}
