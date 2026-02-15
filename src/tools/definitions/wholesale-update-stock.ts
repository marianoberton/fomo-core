/**
 * Wholesale Update Stock Tool
 *
 * Updates inventory from CSV data
 */

import { z } from 'zod';
import type { ExecutableTool } from '../registry/types.js';
import type { ExecutionContext } from '../../core/types.js';
import { NexusError } from '../../core/errors.js';
import { prisma } from '../../infrastructure/database.js';
import {
  parseStockCSV,
  applyStockUpdates,
  ProductSchema,
} from '../../verticals/wholesale/stock-manager.js';

// ─── Tool Definition ────────────────────────────────────────────

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

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────────

async function execute(input: Input, context: ExecutionContext): Promise<Output> {
  const { csvContent, projectId } = input;

  // Validate project access
  if (projectId !== context.projectId) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      'Cannot update stock for different project'
    );
  }

  // Parse CSV
  let updates;
  try {
    updates = parseStockCSV(csvContent);
  } catch (error) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      `Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (updates.length === 0) {
    return {
      success: false,
      updatedCount: 0,
      notFoundCount: 0,
      notFoundSkus: [],
      message: 'No valid stock updates found in CSV',
    };
  }

  // Get existing catalog from project metadata
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new NexusError('TOOL_EXECUTION_ERROR', `Project ${projectId} not found`);
  }

  const config = project.configJson as Record<string, unknown>;
  const catalog = (config.catalog as Record<string, unknown>) || {};
  const existingProducts = ((catalog.products as unknown[]) || []).map((p) =>
    ProductSchema.parse(p)
  );

  // Apply updates
  const result = applyStockUpdates(existingProducts, updates);

  // Update all products in map
  const updatedProductMap = new Map(existingProducts.map((p) => [p.sku, p]));
  for (const updated of result.updated) {
    updatedProductMap.set(updated.sku, updated);
  }

  const updatedProducts = Array.from(updatedProductMap.values());

  // Save back to project config
  const updatedConfig = {
    ...config,
    catalog: {
      ...catalog,
      products: updatedProducts,
      lastStockUpdate: new Date().toISOString(),
    },
  };

  await prisma.project.update({
    where: { id: projectId },
    data: { configJson: updatedConfig },
  });

  context.logger.info('Stock updated from CSV', {
    projectId,
    updatedCount: result.updated.length,
    notFoundCount: result.notFound.length,
  });

  return {
    success: true,
    updatedCount: result.updated.length,
    notFoundCount: result.notFound.length,
    notFoundSkus: result.notFound,
    message: `Stock updated: ${result.updated.length} products updated${result.notFound.length > 0 ? `, ${result.notFound.length} SKUs not found` : ''}`,
  };
}

async function dryRun(input: Input): Promise<Output> {
  const updates = parseStockCSV(input.csvContent);

  return {
    success: true,
    updatedCount: updates.length,
    notFoundCount: 0,
    notFoundSkus: [],
    message: `Dry run: would update ${updates.length} products`,
  };
}

// ─── Tool Export ────────────────────────────────────────────────

export const wholesaleUpdateStockTool: ExecutableTool = {
  id: 'wholesale-update-stock',
  name: 'Update Wholesale Stock',
  description:
    'Update inventory from CSV data. CSV must contain SKU and STOCK columns. Optional PRICE column to update prices.',
  inputSchema,
  outputSchema,
  riskLevel: 'medium',
  requiresApproval: false,
  tags: ['wholesale', 'inventory', 'stock'],
  execute,
  dryRun,
};
