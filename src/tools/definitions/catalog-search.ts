/**
 * Catalog Search Tool
 * Searches for products/items in a catalog using semantic and keyword search.
 * Used for helping customers find products in inventory.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'catalog-search' });

// ─── Catalog Search Options ────────────────────────────────────

export interface CatalogSearchToolOptions {
  /** Custom catalog search provider. If not provided, uses mock data. */
  searchProvider?: (query: string, filters?: unknown) => Promise<unknown[]>;
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  query: z.string().min(1).max(500).describe('Search query - product name, category, features, or description'),
  filters: z.object({
    category: z.string().optional().describe('Filter by category (e.g., "sedan", "suv", "herramientas")'),
    minPrice: z.number().positive().optional().describe('Minimum price filter'),
    maxPrice: z.number().positive().optional().describe('Maximum price filter'),
    inStock: z.boolean().optional().describe('Filter to only show items in stock'),
    brand: z.string().optional().describe('Filter by brand or manufacturer'),
  }).optional().describe('Optional filters to narrow down search results'),
  limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to return (default: 5)'),
});

const outputSchema = z.object({
  results: z.array(z.object({
    id: z.string().describe('Product/item ID'),
    name: z.string().describe('Product name'),
    description: z.string().describe('Product description'),
    category: z.string().describe('Product category'),
    price: z.number().describe('Price in local currency'),
    currency: z.string().default('ARS').describe('Currency code'),
    inStock: z.boolean().describe('Whether the item is in stock'),
    quantity: z.number().optional().describe('Available quantity if in stock'),
    specifications: z.record(z.string(), z.unknown()).optional().describe('Product specifications'),
    imageUrl: z.string().url().optional().describe('Product image URL'),
    brand: z.string().optional().describe('Brand or manufacturer'),
  })),
  totalCount: z.number().describe('Total number of matching items in catalog'),
  searchTime: z.number().describe('Search execution time in milliseconds'),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createCatalogSearchTool(options: CatalogSearchToolOptions = {}): ExecutableTool {
  return {
    id: 'catalog-search',
    name: 'catalog_search',
    description: 'Search for products or services in the catalog. Use this to help customers find items, check availability, get pricing, and view specifications.',
    category: 'data',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    // ─── Execution ────────────────────────────────────────────────

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('catalog-search', 'Invalid input', { cause: parsed.error }));
      }
      const validated = parsed.data;

      logger.debug('Executing catalog search', {
        component: 'catalog-search',
        projectId: context.projectId,
        sessionId: context.sessionId,
        query: validated.query,
        filters: validated.filters,
      });

      try {
        let results;
        
        if (options.searchProvider) {
          results = await options.searchProvider(validated.query, validated.filters);
        } else {
          // Default mock implementation
          results = [
            {
              id: 'DEMO-001',
              name: `Demo Product matching "${validated.query}"`,
              description: 'This is a placeholder. Configure your catalog in the project settings.',
              category: validated.filters?.category || 'general',
              price: 0,
              currency: 'ARS',
              inStock: true,
              quantity: 0,
              specifications: {},
            },
          ];
        }

        const searchTime = Date.now() - startTime;

        return ok({
          success: true,
          output: {
            results: results.slice(0, validated.limit),
            totalCount: results.length,
            searchTime,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Catalog search failed', {
          component: 'catalog-search',
          projectId: context.projectId,
          error,
        });
        return err(new ToolExecutionError('catalog-search', 'Catalog search failed', { cause: error }));
      }
    },

    // ─── Dry Run ──────────────────────────────────────────────────

    async dryRun(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('catalog-search', 'Invalid input', { cause: parsed.error }));
      }

      logger.debug('Dry run: catalog search', {
        component: 'catalog-search',
        mode: 'dry-run',
        projectId: context.projectId,
        query: parsed.data.query,
      });

      return ok({
        success: true,
        output: {
          results: [],
          totalCount: 0,
          searchTime: 0,
        },
        durationMs: 0,
      });
    },
  };
}
