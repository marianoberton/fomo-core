/**
 * Stock Management Service for Wholesale
 *
 * Handles inventory tracking and updates from CSV imports
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const ProductSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string().optional(),
  price: z.number(),
  stock: z.number(),
  minStock: z.number().optional().default(0),
  unit: z.string().optional().default('unidad'),
  lastUpdated: z.string().datetime().optional(),
});

export type Product = z.infer<typeof ProductSchema>;

export const StockUpdateSchema = z.object({
  sku: z.string(),
  stock: z.number(),
  price: z.number().optional(),
});

export type StockUpdate = z.infer<typeof StockUpdateSchema>;

export interface StockCatalog {
  products: Product[];
  lastSync: string;
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
}

// ─── Stock Management ───────────────────────────────────────────

/**
 * Parse CSV content into stock updates
 */
export function parseStockCSV(csvContent: string): StockUpdate[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must have at least a header and one data row');
  }

  const headerLine = lines[0];
  if (!headerLine) {
    throw new Error('CSV must have a header row');
  }
  const header = headerLine.toLowerCase().split(',').map((h) => h.trim());

  // Validate required columns
  const skuIndex = header.indexOf('sku');
  const stockIndex = header.includes('stock') ? header.indexOf('stock') : header.indexOf('cantidad');
  const priceIndex = header.includes('price') ? header.indexOf('price') : header.indexOf('precio');

  if (skuIndex === -1 || stockIndex === -1) {
    throw new Error('CSV must contain at least SKU and STOCK/CANTIDAD columns');
  }

  const updates: StockUpdate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;

    const values = line.trim().split(',').map((v) => v.trim());

    const skuValue = values[skuIndex] ?? '';
    const stockValue = values[stockIndex] ?? '';

    const update: StockUpdate = {
      sku: skuValue,
      stock: parseInt(stockValue, 10),
    };

    const priceValue = priceIndex !== -1 ? values[priceIndex] : undefined;
    if (priceValue) {
      update.price = parseFloat(priceValue);
    }

    if (isNaN(update.stock)) {
      throw new Error(`Invalid stock value for SKU ${update.sku} on line ${i + 1}`);
    }

    updates.push(update);
  }

  return updates;
}

/**
 * Apply stock updates to catalog
 */
export function applyStockUpdates(
  existingProducts: Product[],
  updates: StockUpdate[]
): {
  updated: Product[];
  added: string[];
  notFound: string[];
} {
  const productMap = new Map(existingProducts.map((p) => [p.sku, p]));
  const updated: Product[] = [];
  const added: string[] = [];
  const notFound: string[] = [];
  const now = new Date().toISOString();

  for (const update of updates) {
    const existing = productMap.get(update.sku);

    if (existing) {
      // Update existing product
      const updatedProduct: Product = {
        ...existing,
        stock: update.stock,
        lastUpdated: now,
      };

      if (update.price !== undefined) {
        updatedProduct.price = update.price;
      }

      updated.push(updatedProduct);
      productMap.set(update.sku, updatedProduct);
    } else {
      // Product not in catalog - mark as not found
      notFound.push(update.sku);
    }
  }

  return {
    updated,
    added,
    notFound,
  };
}

/**
 * Build catalog summary statistics
 */
export function buildCatalogStats(products: Product[]): StockCatalog {
  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= p.minStock).length;
  const outOfStockCount = products.filter((p) => p.stock === 0).length;

  return {
    products,
    lastSync: new Date().toISOString(),
    totalProducts: products.length,
    lowStockCount,
    outOfStockCount,
  };
}

/**
 * Get low stock alerts
 */
export function getLowStockAlerts(products: Product[]): Product[] {
  return products
    .filter((p) => p.stock > 0 && p.stock <= p.minStock)
    .sort((a, b) => a.stock - b.stock);
}

/**
 * Get out of stock products
 */
export function getOutOfStockProducts(products: Product[]): Product[] {
  return products.filter((p) => p.stock === 0).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Search products by query
 */
export function searchProducts(products: Product[], query: string): Product[] {
  const lowerQuery = query.toLowerCase();
  return products.filter(
    (p) =>
      p.sku.toLowerCase().includes(lowerQuery) ||
      p.name.toLowerCase().includes(lowerQuery) ||
      (p.category?.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Check product availability
 */
export function checkAvailability(
  products: Product[],
  sku: string,
  quantity: number
): {
  available: boolean;
  currentStock: number;
  message: string;
} {
  const product = products.find((p) => p.sku === sku);

  if (!product) {
    return {
      available: false,
      currentStock: 0,
      message: `Producto ${sku} no encontrado en catálogo`,
    };
  }

  if (product.stock === 0) {
    return {
      available: false,
      currentStock: 0,
      message: `${product.name} sin stock`,
    };
  }

  if (product.stock < quantity) {
    return {
      available: false,
      currentStock: product.stock,
      message: `${product.name}: solo ${product.stock} ${product.unit} disponibles (solicitas ${quantity})`,
    };
  }

  return {
    available: true,
    currentStock: product.stock,
    message: `${product.name}: ${product.stock} ${product.unit} disponibles`,
  };
}
