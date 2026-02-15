/**
 * Integration test script for catalog ingestion and search
 * 
 * Usage:
 *   pnpm tsx scripts/test-catalog.ts
 */

import { PrismaClient } from '@prisma/client';
import { createCatalogSearchTool } from '../src/tools/definitions/catalog-search.js';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import { parse } from 'csv-parse/sync';
import { nanoid } from 'nanoid';
import type { ExecutionContext } from '../src/core/types.js';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TEST_PROJECT_ID = 'test-catalog-project';

type Product = {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  unit: string;
};

async function loadCatalog(): Promise<Product[]> {
  console.log('📖 Loading catalog CSV...');
  
  const csvContent = await fs.readFile('test-data/ferreteria-catalog.csv', 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  const products: Product[] = records.map((row) => ({
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    price: parseFloat(row.price),
    stock: parseInt(row.stock, 10),
    unit: row.unit,
  }));

  console.log(`✅ Loaded ${products.length} products`);
  return products;
}

async function ingestProducts(products: Product[]): Promise<void> {
  console.log('🔄 Ingesting products with embeddings...');

  // Delete existing catalog
  await prisma.memoryEntry.deleteMany({
    where: {
      projectId: TEST_PROJECT_ID,
      category: 'catalog_product',
    },
  });

  let inserted = 0;
  const batchSize = 20;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    
    // Generate embeddings for batch
    const embeddingTexts = batch.map((p) => 
      `${p.name} - ${p.description} (${p.category})`
    );

    console.log(`  Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)}...`);

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
          ${TEST_PROJECT_ID},
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
  }

  console.log(`✅ Ingested ${inserted} products`);
}

async function testSearch(query: string, filters?: Record<string, unknown>): Promise<void> {
  console.log(`\n🔍 Searching: "${query}"`);
  if (filters && Object.keys(filters).length > 0) {
    console.log(`   Filters: ${JSON.stringify(filters)}`);
  }

  const tool = createCatalogSearchTool({ prisma, openai });
  
  const context: ExecutionContext = {
    projectId: TEST_PROJECT_ID,
    sessionId: 'test-session',
    traceId: 'test-trace',
    userId: 'test-user',
    permissions: { canAccessTools: true },
  };

  const input = {
    query,
    topK: 5,
    ...filters,
  };

  const result = await tool.execute(input, context);

  if (!result.ok) {
    console.error(`❌ Search failed: ${result.error.message}`);
    return;
  }

  const { products, totalFound } = result.value.output as { 
    products: Array<Product & { similarity: number }>;
    totalFound: number;
  };

  console.log(`✅ Found ${totalFound} products:\n`);

  products.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.name} (${p.sku})`);
    console.log(`      ${p.description}`);
    console.log(`      Categoría: ${p.category} | Precio: $${p.price} | Stock: ${p.stock} ${p.unit}`);
    console.log(`      Similarity: ${(p.similarity * 100).toFixed(1)}%`);
  });
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting catalog integration test\n');

    // Create test project if it doesn't exist
    const existingProject = await prisma.project.findUnique({
      where: { id: TEST_PROJECT_ID },
    });

    if (!existingProject) {
      console.log('📦 Creating test project...');
      await prisma.project.create({
        data: {
          id: TEST_PROJECT_ID,
          name: 'Test Catalog Project',
          description: 'Test project for catalog RAG',
          owner: 'test-user',
          configJson: {},
        },
      });
      console.log('✅ Test project created\n');
    }

    // Load and ingest catalog
    const products = await loadCatalog();
    await ingestProducts(products);

    // Run test queries
    console.log('\n═══════════════════════════════════════════════');
    console.log('TEST 1: Natural language search - "tornillos phillips"');
    console.log('═══════════════════════════════════════════════');
    await testSearch('tornillos phillips');

    console.log('\n═══════════════════════════════════════════════');
    console.log('TEST 2: Problem-based search - "algo para pegar caño"');
    console.log('═══════════════════════════════════════════════');
    await testSearch('algo para pegar caño');

    console.log('\n═══════════════════════════════════════════════');
    console.log('TEST 3: Category filter - pinturas');
    console.log('═══════════════════════════════════════════════');
    await testSearch('pintura blanca', { category: 'pinturas' });

    console.log('\n═══════════════════════════════════════════════');
    console.log('TEST 4: Price range filter');
    console.log('═══════════════════════════════════════════════');
    await testSearch('herramientas', { minPrice: 10, maxPrice: 30 });

    console.log('\n═══════════════════════════════════════════════');
    console.log('TEST 5: Stock filter - only in stock');
    console.log('═══════════════════════════════════════════════');
    await testSearch('led', { inStock: true });

    console.log('\n═══════════════════════════════════════════════');
    console.log('TEST 6: Complex query - "destapador cañería"');
    console.log('═══════════════════════════════════════════════');
    await testSearch('destapador cañería');

    console.log('\n✨ All tests completed successfully!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
