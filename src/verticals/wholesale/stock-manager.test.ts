import { describe, it, expect } from 'vitest';
import {
  parseStockCSV,
  applyStockUpdates,
  checkAvailability,
  searchProducts,
} from './stock-manager.js';
import type { Product } from './stock-manager.js';

describe('Stock Manager', () => {
  describe('parseStockCSV', () => {
    it('should parse valid CSV with SKU and STOCK', () => {
      const csv = `SKU,STOCK,PRICE
PROD-001,100,5000
PROD-002,50,3000`;

      const result = parseStockCSV(csv);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        sku: 'PROD-001',
        stock: 100,
        price: 5000,
      });
    });

    it('should parse CSV with Spanish headers', () => {
      const csv = `sku,cantidad,precio
PROD-001,100,5000`;

      const result = parseStockCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0].stock).toBe(100);
    });

    it('should throw on invalid CSV (missing headers)', () => {
      const csv = `NAME,DESCRIPTION
Product 1,Description`;

      expect(() => parseStockCSV(csv)).toThrow('must contain at least SKU');
    });

    it('should throw on invalid stock value', () => {
      const csv = `SKU,STOCK
PROD-001,invalid`;

      expect(() => parseStockCSV(csv)).toThrow('Invalid stock value');
    });
  });

  describe('applyStockUpdates', () => {
    const existingProducts: Product[] = [
      {
        sku: 'PROD-001',
        name: 'Product 1',
        category: 'Category A',
        price: 5000,
        stock: 100,
        minStock: 10,
        unit: 'unidad',
      },
      {
        sku: 'PROD-002',
        name: 'Product 2',
        category: 'Category B',
        price: 3000,
        stock: 50,
        minStock: 5,
        unit: 'unidad',
      },
    ];

    it('should update existing products', () => {
      const updates = [
        { sku: 'PROD-001', stock: 200 },
        { sku: 'PROD-002', stock: 75, price: 3500 },
      ];

      const result = applyStockUpdates(existingProducts, updates);

      expect(result.updated).toHaveLength(2);
      expect(result.updated[0].stock).toBe(200);
      expect(result.updated[1].stock).toBe(75);
      expect(result.updated[1].price).toBe(3500);
    });

    it('should track not found SKUs', () => {
      const updates = [
        { sku: 'PROD-001', stock: 200 },
        { sku: 'PROD-999', stock: 100 },
      ];

      const result = applyStockUpdates(existingProducts, updates);

      expect(result.updated).toHaveLength(1);
      expect(result.notFound).toContain('PROD-999');
    });
  });

  describe('checkAvailability', () => {
    const products: Product[] = [
      {
        sku: 'PROD-001',
        name: 'Product 1',
        category: 'Category A',
        price: 5000,
        stock: 100,
        minStock: 10,
        unit: 'unidad',
      },
      {
        sku: 'PROD-002',
        name: 'Product 2',
        category: 'Category B',
        price: 3000,
        stock: 0,
        minStock: 5,
        unit: 'unidad',
      },
    ];

    it('should confirm availability when stock is sufficient', () => {
      const result = checkAvailability(products, 'PROD-001', 50);

      expect(result.available).toBe(true);
      expect(result.currentStock).toBe(100);
    });

    it('should reject when stock is insufficient', () => {
      const result = checkAvailability(products, 'PROD-001', 150);

      expect(result.available).toBe(false);
      expect(result.message).toContain('solo 100');
    });

    it('should reject when product is out of stock', () => {
      const result = checkAvailability(products, 'PROD-002', 1);

      expect(result.available).toBe(false);
      expect(result.message).toContain('sin stock');
    });

    it('should reject when product does not exist', () => {
      const result = checkAvailability(products, 'PROD-999', 1);

      expect(result.available).toBe(false);
      expect(result.message).toContain('no encontrado');
    });
  });

  describe('searchProducts', () => {
    const products: Product[] = [
      {
        sku: 'LAPTOP-001',
        name: 'Laptop Dell XPS 13',
        category: 'Electronics',
        price: 150000,
        stock: 10,
        minStock: 2,
        unit: 'unidad',
      },
      {
        sku: 'MOUSE-001',
        name: 'Mouse Logitech MX',
        category: 'Accessories',
        price: 8000,
        stock: 50,
        minStock: 5,
        unit: 'unidad',
      },
    ];

    it('should search by SKU', () => {
      const result = searchProducts(products, 'LAPTOP');

      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe('LAPTOP-001');
    });

    it('should search by name', () => {
      const result = searchProducts(products, 'Mouse');

      expect(result).toHaveLength(1);
      expect(result[0].name).toContain('Mouse');
    });

    it('should search by category', () => {
      const result = searchProducts(products, 'electronics');

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('Electronics');
    });

    it('should return empty array for no matches', () => {
      const result = searchProducts(products, 'keyboard');

      expect(result).toHaveLength(0);
    });
  });
});
