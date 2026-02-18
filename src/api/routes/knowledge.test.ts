/**
 * Tests for knowledge base API routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { knowledgeRoutes } from './knowledge.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';
import type { KnowledgeService, KnowledgeEntry } from '@/knowledge/types.js';

// ─── Fixtures ────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 'kb-1',
    projectId: 'proj-1',
    category: 'fact',
    content: 'Water boils at 100°C',
    importance: 0.8,
    accessCount: 0,
    lastAccessedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeKnowledgeService(overrides?: Partial<KnowledgeService>): KnowledgeService {
  return {
    add: vi.fn(() => Promise.resolve(makeEntry())),
    list: vi.fn(() => Promise.resolve({
      entries: [makeEntry()],
      total: 1,
      page: 1,
      limit: 20,
      hasMore: false,
    })),
    delete: vi.fn(() => Promise.resolve(true)),
    bulkImport: vi.fn(() => Promise.resolve({ imported: 2, failed: 0, errors: [] })),
    ...overrides,
  };
}

// ─── App Factory ─────────────────────────────────────────────────

function createApp(service: KnowledgeService | null = makeKnowledgeService()): {
  app: FastifyInstance;
  deps: ReturnType<typeof createMockDeps>;
} {
  const deps = createMockDeps();
  (deps as typeof deps & { knowledgeService: KnowledgeService | null }).knowledgeService = service;
  const app = Fastify();
  registerErrorHandler(app);
  knowledgeRoutes(app, deps as Parameters<typeof knowledgeRoutes>[1]);
  return { app, deps };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('knowledgeRoutes', () => {
  describe('POST /projects/:projectId/knowledge', () => {
    it('adds a knowledge entry and returns 201', async () => {
      const service = makeKnowledgeService();
      const { app } = createApp(service);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge',
        payload: { content: 'Water boils at 100°C', category: 'fact', importance: 0.8 },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ success: boolean; data: KnowledgeEntry }>();
      expect(body.success).toBe(true);
      expect(body.data.content).toBe('Water boils at 100°C');
      expect(service.add).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-1', content: 'Water boils at 100°C' }),
      );
    });

    it('returns 503 when knowledge service is not configured', async () => {
      const { app } = createApp(null);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge',
        payload: { content: 'test' },
      });

      expect(response.statusCode).toBe(503);
      const body = response.json<{ success: boolean; error: { code: string } }>();
      expect(body.error.code).toBe('KNOWLEDGE_UNAVAILABLE');
    });

    it('returns 400 for empty content', async () => {
      const { app } = createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge',
        payload: { content: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid category', async () => {
      const { app } = createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge',
        payload: { content: 'test', category: 'invalid-category' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /projects/:projectId/knowledge', () => {
    it('lists entries with default pagination', async () => {
      const service = makeKnowledgeService();
      const { app } = createApp(service);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/knowledge',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: { entries: KnowledgeEntry[]; total: number; hasMore: boolean };
      }>();
      expect(body.success).toBe(true);
      expect(body.data.entries).toHaveLength(1);
      expect(body.data.total).toBe(1);
      expect(body.data.hasMore).toBe(false);
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-1', page: 1, limit: 20 }),
      );
    });

    it('passes category filter to service', async () => {
      const service = makeKnowledgeService();
      const { app } = createApp(service);

      await app.inject({
        method: 'GET',
        url: '/projects/proj-1/knowledge?category=fact&page=2&limit=10',
      });

      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'fact', page: 2, limit: 10 }),
      );
    });

    it('returns 503 when knowledge service is not configured', async () => {
      const { app } = createApp(null);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/knowledge',
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('DELETE /knowledge/:id', () => {
    it('deletes entry and returns 200', async () => {
      const service = makeKnowledgeService();
      const { app } = createApp(service);

      const response = await app.inject({
        method: 'DELETE',
        url: '/knowledge/kb-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { deleted: boolean; id: string } }>();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
      expect(body.data.id).toBe('kb-1');
    });

    it('returns 404 when entry not found', async () => {
      const service = makeKnowledgeService({
        delete: vi.fn(() => Promise.resolve(false)),
      });
      const { app } = createApp(service);

      const response = await app.inject({
        method: 'DELETE',
        url: '/knowledge/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 503 when knowledge service is not configured', async () => {
      const { app } = createApp(null);

      const response = await app.inject({
        method: 'DELETE',
        url: '/knowledge/kb-1',
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('POST /projects/:projectId/knowledge/bulk', () => {
    it('imports items and returns 201 when all succeed', async () => {
      const service = makeKnowledgeService({
        bulkImport: vi.fn(() => Promise.resolve({ imported: 2, failed: 0, errors: [] })),
      });
      const { app } = createApp(service);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge/bulk',
        payload: {
          items: [
            { content: 'Fact one', category: 'fact' },
            { content: 'Fact two', category: 'learning', importance: 0.9 },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{
        success: boolean;
        data: { imported: number; failed: number; errors: string[] };
      }>();
      expect(body.success).toBe(true);
      expect(body.data.imported).toBe(2);
      expect(body.data.failed).toBe(0);
    });

    it('returns 207 when some items fail', async () => {
      const service = makeKnowledgeService({
        bulkImport: vi.fn(() => Promise.resolve({ imported: 1, failed: 1, errors: ['Item 1: embedding failed'] })),
      });
      const { app } = createApp(service);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge/bulk',
        payload: { items: [{ content: 'Good' }, { content: 'Bad' }] },
      });

      expect(response.statusCode).toBe(207);
      const body = response.json<{
        success: boolean;
        data: { imported: number; failed: number };
      }>();
      expect(body.data.failed).toBe(1);
    });

    it('returns 400 for empty items array', async () => {
      const { app } = createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge/bulk',
        payload: { items: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 503 when knowledge service is not configured', async () => {
      const { app } = createApp(null);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/knowledge/bulk',
        payload: { items: [{ content: 'test' }] },
      });

      expect(response.statusCode).toBe(503);
    });
  });
});

// Suppress unused import
void vi;
void beforeEach;
