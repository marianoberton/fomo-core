/**
 * Tests for catalog-search tool
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCatalogSearchTool } from './catalog-search.js';
import type { ExecutionContext } from '@/core/types.js';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

describe('catalog-search tool', () => {
  let mockPrisma: PrismaClient;
  let mockOpenAI: OpenAI;
  let tool: ReturnType<typeof createCatalogSearchTool>;
  let context: ExecutionContext;

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      $queryRawUnsafe: vi.fn(),
    } as unknown as PrismaClient;

    // Mock OpenAI client
    mockOpenAI = {
      embeddings: {
        create: vi.fn(),
      },
    } as unknown as OpenAI;

    tool = createCatalogSearchTool({
      prisma: mockPrisma,
      openai: mockOpenAI,
    });

    context = {
      projectId: 'test-project',
      sessionId: 'test-session',
      traceId: 'test-trace',
      userId: 'test-user',
      permissions: { canAccessTools: true },
    };
  });

  // ─── Schema Validation ──────────────────────────────────────────

  describe('schema validation', () => {
    it('should accept valid input', async () => {
      const input = {
        query: 'tornillos phillips',
        topK: 5,
      };

      const result = await tool.dryRun(input, context);
      expect(result.ok).toBe(true);
    });

    it('should accept optional filters', async () => {
      const input = {
        query: 'pintura blanca',
        topK: 10,
        category: 'pinturas',
        minPrice: 5.0,
        maxPrice: 50.0,
        inStock: true,
      };

      const result = await tool.dryRun(input, context);
      expect(result.ok).toBe(true);
    });

    it('should reject empty query', async () => {
      const input = {
        query: '',
        topK: 5,
      };

      const result = await tool.dryRun(input, context);
      expect(result.ok).toBe(false);
    });

    it('should reject query too long', async () => {
      const input = {
        query: 'a'.repeat(2001),
        topK: 5,
      };

      const result = await tool.dryRun(input, context);
      expect(result.ok).toBe(false);
    });

    it('should reject topK out of range', async () => {
      const input = {
        query: 'test',
        topK: 0,
      };

      const result = await tool.dryRun(input, context);
      expect(result.ok).toBe(false);
    });

    it('should reject topK over limit', async () => {
      const input = {
        query: 'test',
        topK: 51,
      };

      const result = await tool.dryRun(input, context);
      expect(result.ok).toBe(false);
    });
  });

  // ─── Dry Run ────────────────────────────────────────────────────

  describe('dryRun', () => {
    it('should return validated input without executing', async () => {
      const input = {
        query: 'tornillos phillips',
        topK: 5,
        category: 'tornillería',
      };

      const result = await tool.dryRun(input, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.output).toMatchObject({
          query: 'tornillos phillips',
          topK: 5,
          dryRun: true,
        });
      }
    });

    it('should use default topK if not provided', async () => {
      const input = {
        query: 'test',
      };

      const result = await tool.dryRun(input, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.output).toMatchObject({
          topK: 10,
        });
      }
    });
  });

  // ─── Execution ──────────────────────────────────────────────────

  describe('execute', () => {
    it('should perform semantic search and return products', async () => {
      const input = {
        query: 'tornillos phillips',
        topK: 3,
      };

      // Mock OpenAI embedding
      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      // Mock Prisma query results
      const mockResults = [
        {
          id: '1',
          content: 'Tornillo Phillips #8 x 1"',
          metadata: {
            sku: 'TOR-001',
            name: 'Tornillo Phillips #8 x 1"',
            description: 'Tornillo cabeza phillips acero zincado 1 pulgada',
            category: 'tornillería',
            price: 0.15,
            stock: 5000,
            unit: 'unidad',
          },
          similarity: 0.92,
        },
        {
          id: '2',
          content: 'Tornillo Phillips #10 x 2"',
          metadata: {
            sku: 'TOR-002',
            name: 'Tornillo Phillips #10 x 2"',
            description: 'Tornillo cabeza phillips acero zincado 2 pulgadas',
            category: 'tornillería',
            price: 0.25,
            stock: 3500,
            unit: 'unidad',
          },
          similarity: 0.89,
        },
      ];

      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue(mockResults);

      const result = await tool.execute(input, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.output.products).toHaveLength(2);
        expect(result.value.output.products[0]).toMatchObject({
          sku: 'TOR-001',
          name: 'Tornillo Phillips #8 x 1"',
          category: 'tornillería',
          price: 0.15,
          stock: 5000,
          similarity: 0.92,
        });
      }

      // Verify OpenAI was called
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'tornillos phillips',
      });

      // Verify Prisma query was called
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
    });

    it('should apply category filter', async () => {
      const input = {
        query: 'producto',
        topK: 5,
        category: 'pinturas',
      };

      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([]);

      await tool.execute(input, context);

      const queryCall = vi.mocked(mockPrisma.$queryRawUnsafe).mock.calls[0];
      const query = queryCall[0] as string;

      expect(query).toContain("metadata->>'category'");
    });

    it('should apply price filters', async () => {
      const input = {
        query: 'producto',
        topK: 5,
        minPrice: 10.0,
        maxPrice: 50.0,
      };

      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([]);

      await tool.execute(input, context);

      const queryCall = vi.mocked(mockPrisma.$queryRawUnsafe).mock.calls[0];
      const query = queryCall[0] as string;

      expect(query).toContain("(metadata->>'price')::numeric >=");
      expect(query).toContain("(metadata->>'price')::numeric <=");
    });

    it('should apply stock filter', async () => {
      const input = {
        query: 'producto',
        topK: 5,
        inStock: true,
      };

      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([]);

      await tool.execute(input, context);

      const queryCall = vi.mocked(mockPrisma.$queryRawUnsafe).mock.calls[0];
      const query = queryCall[0] as string;

      expect(query).toContain("(metadata->>'stock')::numeric > 0");
    });

    it('should handle empty results', async () => {
      const input = {
        query: 'producto inexistente',
        topK: 5,
      };

      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      vi.mocked(mockPrisma.$queryRawUnsafe).mockResolvedValue([]);

      const result = await tool.execute(input, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.output.products).toHaveLength(0);
        expect(result.value.output.totalFound).toBe(0);
      }
    });

    it('should handle OpenAI error', async () => {
      const input = {
        query: 'test',
        topK: 5,
      };

      vi.mocked(mockOpenAI.embeddings.create).mockRejectedValue(
        new Error('OpenAI API error')
      );

      const result = await tool.execute(input, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('OpenAI API error');
      }
    });

    it('should handle database error', async () => {
      const input = {
        query: 'test',
        topK: 5,
      };

      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue({
        data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      vi.mocked(mockPrisma.$queryRawUnsafe).mockRejectedValue(
        new Error('Database error')
      );

      const result = await tool.execute(input, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Database error');
      }
    });
  });

  // ─── Tool Metadata ──────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct tool ID', () => {
      expect(tool.id).toBe('catalog-search');
    });

    it('should have low risk level', () => {
      expect(tool.riskLevel).toBe('low');
    });

    it('should not require approval', () => {
      expect(tool.requiresApproval).toBe(false);
    });

    it('should have no side effects', () => {
      expect(tool.sideEffects).toBe(false);
    });

    it('should support dry run', () => {
      expect(tool.supportsDryRun).toBe(true);
    });
  });
});
