/**
 * Catalog Search Tool Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { createCatalogSearchTool } from './catalog-search.js';
import type { ExecutionContext } from '@/core/types.js';

describe('catalog-search tool', () => {
  const mockContext: ExecutionContext = {
    projectId: 'test-project' as any,
    sessionId: 'test-session' as any,
    traceId: 'test-trace' as any,
    allowedTools: new Set(['catalog-search']),
  };

  describe('schema validation', () => {
    it('rejects empty query', async () => {
      const tool = createCatalogSearchTool();
      const result = await tool.execute({
        query: '',
      }, mockContext);

      expect(result.ok).toBe(false);
    });

    it('rejects query exceeding max length', async () => {
      const tool = createCatalogSearchTool();
      const result = await tool.execute({
        query: 'a'.repeat(501),
      }, mockContext);

      expect(result.ok).toBe(false);
    });

    it('accepts valid input with minimal fields', async () => {
      const tool = createCatalogSearchTool();
      const result = await tool.execute({
        query: 'auto rojo',
      }, mockContext);

      expect(result.ok).toBe(true);
    });

    it('accepts valid input with all fields', async () => {
      const tool = createCatalogSearchTool();
      const result = await tool.execute({
        query: 'SUV',
        filters: {
          category: 'suv',
          minPrice: 10000,
          maxPrice: 50000,
          inStock: true,
          brand: 'Toyota',
        },
        limit: 10,
      }, mockContext);

      expect(result.ok).toBe(true);
    });
  });

  describe('execute', () => {
    it('returns mock results when no custom provider', async () => {
      const tool = createCatalogSearchTool();
      const result = await tool.execute({
        query: 'test product',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.output).toHaveProperty('results');
        expect(result.value.output).toHaveProperty('totalCount');
        expect(result.value.output).toHaveProperty('searchTime');
      }
    });

    it('uses custom search provider when provided', async () => {
      const mockProvider = vi.fn().mockResolvedValue([
        {
          id: 'PROD-001',
          name: 'Custom Product',
          description: 'Test',
          category: 'test',
          price: 100,
          currency: 'USD',
          inStock: true,
        },
      ]);

      const tool = createCatalogSearchTool({ searchProvider: mockProvider });
      const result = await tool.execute({
        query: 'custom search',
      }, mockContext);

      expect(mockProvider).toHaveBeenCalledWith('custom search', undefined);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output: any = result.value.output;
        expect(output.results).toHaveLength(1);
        expect(output.results[0].name).toBe('Custom Product');
      }
    });

    it('respects limit parameter', async () => {
      const mockProvider = vi.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `PROD-${i}`,
          name: `Product ${i}`,
          description: 'Test',
          category: 'test',
          price: 100,
          currency: 'USD',
          inStock: true,
        }))
      );

      const tool = createCatalogSearchTool({ searchProvider: mockProvider });
      const result = await tool.execute({
        query: 'test',
        limit: 5,
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output: any = result.value.output;
        expect(output.results).toHaveLength(5);
        expect(output.totalCount).toBe(20);
      }
    });
  });

  describe('dryRun', () => {
    it('validates input without executing search', async () => {
      const mockProvider = vi.fn();
      const tool = createCatalogSearchTool({ searchProvider: mockProvider });
      
      const result = await tool.dryRun({
        query: 'test',
      }, mockContext);

      expect(mockProvider).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output: any = result.value.output;
        expect(output.results).toEqual([]);
        expect(output.totalCount).toBe(0);
      }
    });

    it('rejects invalid input', async () => {
      const tool = createCatalogSearchTool();
      const result = await tool.dryRun({
        query: '',
      }, mockContext);

      expect(result.ok).toBe(false);
    });
  });
});
