/**
 * Catalog routes — upload and manage product catalogs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import type { RouteDependencies } from '../types.js';
import type { ProjectId } from '@/core/types.js';
import { nanoid } from 'nanoid';
import OpenAI from 'openai';

// ─── Schemas ────────────────────────────────────────────────────

const uploadQuerySchema = z.object({
  projectId: z.string().min(1),
  format: z.enum(['csv', 'excel']).optional(),
  replace: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().optional().default(false)
  ),
});

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.string(),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  unit: z.string().default('unidad'),
});

type Product = z.infer<typeof productSchema>;

// ─── Route Registration ─────────────────────────────────────────

export function catalogRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'],
  });

  // ─── Upload Catalog ─────────────────────────────────────────────

  fastify.post(
    '/catalog/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = uploadQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: query.error.flatten(),
        });
      }

      const { projectId, format, replace } = query.data;

      // Get raw body as buffer
      const content = request.body as Buffer | undefined;

      if (!content || content.length === 0) {
        return reply.status(400).send({ error: 'Empty file body' });
      }

      try {
        // Parse file based on format
        let products: Product[];

        if (format === 'excel' || request.headers['content-type']?.includes('spreadsheet')) {
          products = parseExcel(content);
        } else {
          // Default to CSV
          products = parseCsv(content.toString('utf-8'));
        }

        logger.info('Parsed catalog file', {
          component: 'catalog-route',
          projectId,
          format: format || 'csv',
          productsCount: products.length,
        });

        // If replace=true, delete existing catalog entries
        if (replace) {
          await prisma.memoryEntry.deleteMany({
            where: {
              projectId: projectId as ProjectId,
              category: 'catalog_product',
            },
          });

          logger.info('Deleted existing catalog', {
            component: 'catalog-route',
            projectId,
          });
        }

        // Generate embeddings and store in memory_entries
        const inserted = await ingestProducts(projectId as ProjectId, products, prisma, openai, logger);

        logger.info('Catalog uploaded successfully', {
          component: 'catalog-route',
          projectId,
          productsCount: products.length,
          insertedCount: inserted,
        });

        return reply.status(201).send({
          success: true,
          productsCount: products.length,
          insertedCount: inserted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Catalog upload failed', {
          component: 'catalog-route',
          projectId,
          error: message,
        });
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ─── Get Catalog Stats ──────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/catalog/stats',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      const stats = await prisma.memoryEntry.groupBy({
        by: ['category'],
        where: {
          projectId: projectId as ProjectId,
          category: 'catalog_product',
        },
        _count: true,
      });

      const totalProducts = stats.reduce((sum, s) => sum + s._count, 0);

      // Get unique categories from metadata
      const entries = await prisma.memoryEntry.findMany({
        where: {
          projectId: projectId as ProjectId,
          category: 'catalog_product',
        },
        select: {
          metadata: true,
        },
      });

      const categories = new Set<string>();
      entries.forEach((entry) => {
        const metadata = entry.metadata as Record<string, unknown>;
        if (metadata['category']) {
          categories.add(String(metadata['category']));
        }
      });

      return reply.send({
        totalProducts,
        categories: Array.from(categories),
      });
    },
  );

  // ─── Delete Catalog ─────────────────────────────────────────────

  fastify.delete(
    '/projects/:projectId/catalog',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };

      const deleted = await prisma.memoryEntry.deleteMany({
        where: {
          projectId: projectId as ProjectId,
          category: 'catalog_product',
        },
      });

      logger.info('Catalog deleted', {
        component: 'catalog-route',
        projectId,
        deletedCount: deleted.count,
      });

      return await reply.status(200).send({
        success: true,
        deletedCount: deleted.count,
      });
    },
  );
}

// ─── Parsers ────────────────────────────────────────────────────

function parseCsv(content: string): Product[] {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    escape: '\\',
  }) as Array<Record<string, string>>;

  return records.map((row) => {
    const product = {
      sku: row['sku'] || row['SKU'] || '',
      name: row['name'] || row['nombre'] || row['Name'] || '',
      description: row['description'] || row['descripcion'] || row['Description'] || '',
      category: row['category'] || row['categoria'] || row['Category'] || '',
      price: parseFloat(row['price'] || row['precio'] || row['Price'] || '0'),
      stock: parseInt(row['stock'] || row['Stock'] || '0', 10),
      unit: row['unit'] || row['unidad'] || row['Unit'] || 'unidad',
    };
    return productSchema.parse(product);
  });
}

function parseExcel(content: Buffer): Product[] {
  const workbook = XLSX.read(content, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Excel file has no sheets');
  }
  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(firstSheet);

  return rows.map((row) => {
    const product = {
      sku: String(row['sku'] || row['SKU'] || ''),
      name: String(row['name'] || row['nombre'] || row['Name'] || ''),
      description: String(row['description'] || row['descripcion'] || row['Description'] || ''),
      category: String(row['category'] || row['categoria'] || row['Category'] || ''),
      price: Number(row['price'] || row['precio'] || row['Price'] || 0),
      stock: Number(row['stock'] || row['Stock'] || 0),
      unit: String(row['unit'] || row['unidad'] || row['Unit'] || 'unidad'),
    };
    return productSchema.parse(product);
  });
}

// ─── Ingestion ──────────────────────────────────────────────────

async function ingestProducts(
  projectId: ProjectId,
  products: Product[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  openai: OpenAI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  let inserted = 0;

  // Process in batches to avoid rate limits
  const batchSize = 20;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    // Generate embeddings for batch
    const embeddingTexts = batch.map((p) => 
      `${p.name} - ${p.description} (${p.category})`
    );

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingTexts,
    });

    // Insert entries with embeddings
    for (let j = 0; j < batch.length; j++) {
      const product = batch[j];
      const embedding = embeddingResponse.data[j].embedding;

      await prisma.$executeRaw`
        INSERT INTO memory_entries (
          id,
          project_id,
          category,
          content,
          embedding,
          importance,
          metadata,
          created_at,
          last_accessed_at
        ) VALUES (
          ${nanoid()},
          ${projectId},
          'catalog_product',
          ${product.description},
          ${`[${embedding.join(',')}]`}::vector,
          0.7,
          ${JSON.stringify(product)}::jsonb,
          NOW(),
          NOW()
        )
      `;

      inserted++;
    }

    logger.debug('Batch inserted', {
      component: 'catalog-ingestion',
      projectId,
      batchIndex: i / batchSize,
      batchSize: batch.length,
    });
  }

  return inserted;
}
