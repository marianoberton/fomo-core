/**
 * Campaign template routes — CRUD tests with mocked Prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { campaignTemplateRoutes } from './campaign-templates.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface MockPrismaTemplate {
  campaignTemplate: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function createApp(): { app: FastifyInstance; prisma: MockPrismaTemplate } {
  const prisma: MockPrismaTemplate = {
    campaignTemplate: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const deps = { ...createMockDeps(), prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'] };
  const app = Fastify();
  app.addHook('onRequest', async (request) => { request.apiKeyProjectId = null; });
  registerErrorHandler(app);
  campaignTemplateRoutes(app, deps);
  return { app, prisma };
}

describe('campaignTemplateRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /projects/:projectId/campaign-templates', () => {
    it('creates a template and auto-extracts variables', async () => {
      const { app, prisma } = createApp();
      prisma.campaignTemplate.create.mockResolvedValue({
        id: 't1',
        projectId: 'p1',
        name: 'Bienvenida',
        body: 'Hola {{nombre}}, tu pedido {{pedido}}',
        variables: ['nombre', 'pedido'],
        channel: 'whatsapp',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/projects/p1/campaign-templates',
        payload: {
          name: 'Bienvenida',
          body: 'Hola {{nombre}}, tu pedido {{pedido}}',
          channel: 'whatsapp',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ success: boolean; data: { variables: string[] } }>();
      expect(body.success).toBe(true);
      expect(body.data.variables).toContain('nombre');
      expect(body.data.variables).toContain('pedido');

      const callArg = prisma.campaignTemplate.create.mock.calls[0]?.[0] as {
        data: { variables: string[] };
      };
      expect(callArg.data.variables.sort()).toEqual(['nombre', 'pedido']);
    });

    it('rejects invalid channel', async () => {
      const { app } = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/projects/p1/campaign-templates',
        payload: {
          name: 'T',
          body: 'Hola',
          channel: 'sms',
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /projects/:projectId/campaign-templates', () => {
    it('lists templates for a project', async () => {
      const { app, prisma } = createApp();
      prisma.campaignTemplate.findMany.mockResolvedValue([
        { id: 't1', projectId: 'p1', name: 'A' },
        { id: 't2', projectId: 'p1', name: 'B' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/p1/campaign-templates',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { total: number; items: unknown[] } }>();
      expect(body.data.total).toBe(2);
      expect(body.data.items).toHaveLength(2);
    });
  });

  describe('GET /projects/:projectId/campaign-templates/:id', () => {
    it('returns 404 when template does not belong to project', async () => {
      const { app, prisma } = createApp();
      prisma.campaignTemplate.findUnique.mockResolvedValue({
        id: 't1',
        projectId: 'other',
      });
      const response = await app.inject({
        method: 'GET',
        url: '/projects/p1/campaign-templates/t1',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /projects/:projectId/campaign-templates/:id', () => {
    it('deletes and returns 204', async () => {
      const { app, prisma } = createApp();
      prisma.campaignTemplate.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.campaignTemplate.delete.mockResolvedValue({});
      const response = await app.inject({
        method: 'DELETE',
        url: '/projects/p1/campaign-templates/t1',
      });
      expect(response.statusCode).toBe(204);
      expect(prisma.campaignTemplate.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });
});
