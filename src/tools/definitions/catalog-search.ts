/**
 * Catalog search tool — semantic search over product catalog.
 *
 * Searches products stored in memory_entries (category = 'catalog_product')
 * using vector similarity. Supports filtering by category, price range, stock status.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const logger = createLogger({ name: 'catalog-search' });

export interface CatalogSearchToolOptions {
  /** Prisma client for database access. */
  prisma: PrismaClient;
  /** OpenAI client for generating embeddings. */
  openai: OpenAI;
}

const inputSchema = z.object({
  query: z.string().min(1).max(2000).describe('Search query (natural language)'),
  topK: z.number().int().min(1).max(50).optional().default(10).describe('Number of results to return'),
  category: z.string().optional().describe('Filter by product category'),
  minPrice: z.number().optional().describe('Minimum price filter'),
  maxPrice: z.number().optional().describe('Maximum price filter'),
  inStock: z.boolean().optional().describe('Filter only products in stock'),
});

const outputSchema = z.object({
  products: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      price: z.number(),
      stock: z.number(),
      unit: z.string(),
      similarity: z.number(),
    }),
  ),
  totalFound: z.number(),
});

type CatalogProduct = {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  unit: string;
};

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a catalog search tool for semantic product search. */
export function createCatalogSearchTool(options: CatalogSearchToolOptions): ExecutableTool {
  const { prisma, openai } = options;

  return {
    id: 'catalog-search',
    name: 'Catalog Search',
    description:
      'Search the product catalog using natural language. Returns matching products ' +
      'ranked by semantic similarity. Supports filters: category, price range (minPrice/maxPrice), ' +
      'and stock availability (inStock=true). Results include SKU, name, description, ' +
      'category, price, stock, and unit.',
    category: 'data',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parseResult = inputSchema.safeParse(input);
      
      if (!parseResult.success) {
        return err(new ToolExecutionError('catalog-search', parseResult.error.message));
      }
      
      const parsed = parseResult.data;

      try {
        // Generate embedding for the query
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: parsed.query,
        });

        const queryEmbedding = embeddingResponse.data[0].embedding;

        // Build filter conditions
        const whereClauses: string[] = [
          `"project_id" = $1`,
          `category = 'catalog_product'`,
        ];
        
        const params: unknown[] = [context.projectId];
        let paramIndex = 2;

        // Apply metadata filters (stored as JSON)
        // We'll use JSON operators to filter by category, price, stock
        if (parsed.category) {
          whereClauses.push(`metadata->>'category' = $${paramIndex}`);
          params.push(parsed.category);
          paramIndex++;
        }

        if (parsed.minPrice !== undefined) {
          whereClauses.push(`(metadata->>'price')::numeric >= $${paramIndex}`);
          params.push(parsed.minPrice);
          paramIndex++;
        }

        if (parsed.maxPrice !== undefined) {
          whereClauses.push(`(metadata->>'price')::numeric <= $${paramIndex}`);
          params.push(parsed.maxPrice);
          paramIndex++;
        }

        if (parsed.inStock === true) {
          whereClauses.push(`(metadata->>'stock')::numeric > 0`);
        }

        const whereClause = whereClauses.join(' AND ');

        // Vector similarity search using pgvector
        // Format: embedding <=> '[...]'::vector
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        
        const query = `
          SELECT 
            id,
            content,
            metadata,
            1 - (embedding <=> $${paramIndex}::vector) as similarity
          FROM memory_entries
          WHERE ${whereClause}
          ORDER BY embedding <=> $${paramIndex}::vector
          LIMIT $${paramIndex + 1}
        `;

        params.push(embeddingStr, parsed.topK);

        const results = await prisma.$queryRawUnsafe<Array<{
          id: string;
          content: string;
          metadata: unknown;
          similarity: number;
        }>>(query, ...params);

        // Parse and format results
        const products = results.map((row) => {
          const metadata = row.metadata as Record<string, unknown>;
          const product: CatalogProduct & { similarity: number } = {
            sku: String(metadata['sku'] || ''),
            name: String(metadata['name'] || ''),
            description: String(metadata['description'] || row.content),
            category: String(metadata['category'] || ''),
            price: Number(metadata['price'] || 0),
            stock: Number(metadata['stock'] || 0),
            unit: String(metadata['unit'] || ''),
            similarity: row.similarity,
          };
          return product;
        });

        logger.debug('Catalog search completed', {
          component: 'catalog-search',
          projectId: context.projectId,
          traceId: context.traceId,
          query: parsed.query,
          topK: parsed.topK,
          filters: {
            category: parsed.category,
            minPrice: parsed.minPrice,
            maxPrice: parsed.maxPrice,
            inStock: parsed.inStock,
          },
          resultsCount: products.length,
        });

        return ok({
          success: true,
          output: { products, totalFound: products.length },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Catalog search failed', {
          component: 'catalog-search',
          projectId: context.projectId,
          traceId: context.traceId,
          error: message,
        });
        return err(new ToolExecutionError('catalog-search', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parseResult = inputSchema.safeParse(input);
      
      if (!parseResult.success) {
        return Promise.resolve(err(new ToolExecutionError('catalog-search', parseResult.error.message)));
      }
      
      const parsed = parseResult.data;

      return Promise.resolve(ok({
        success: true,
        output: {
          query: parsed.query,
          topK: parsed.topK,
          filters: {
            category: parsed.category,
            minPrice: parsed.minPrice,
            maxPrice: parsed.maxPrice,
            inStock: parsed.inStock,
          },
          dryRun: true,
        },
        durationMs: 0,
      }));
    },
  };
}
