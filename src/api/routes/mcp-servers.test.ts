/**
 * Tests for the MCP Server routes.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mcpServerRoutes } from './mcp-servers.js';
import { registerErrorHandler } from '../error-handler.js';
import type { MCPServerRepository, MCPServerTemplate, MCPServerInstance } from '@/infrastructure/repositories/mcp-server-repository.js';
import type { ProjectId } from '@/core/types.js';

// ─── Mock Repository ────────────────────────────────────────────

function createMockRepo(): { [K in keyof MCPServerRepository]: ReturnType<typeof vi.fn> } {
  return {
    listTemplates: vi.fn().mockResolvedValue([]),
    findTemplateById: vi.fn().mockResolvedValue(null),
    findTemplateByName: vi.fn().mockResolvedValue(null),
    createTemplate: vi.fn(),
    listInstances: vi.fn().mockResolvedValue([]),
    findInstanceById: vi.fn().mockResolvedValue(null),
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
  };
}

// ─── Test Data ──────────────────────────────────────────────────

const sampleTemplate: MCPServerTemplate = {
  id: 'tmpl-1',
  name: 'odoo-erp',
  displayName: 'Odoo ERP',
  description: 'Odoo ERP connector',
  category: 'erp',
  transport: 'sse',
  command: undefined,
  args: [],
  defaultEnv: undefined,
  url: 'http://localhost:8069/mcp',
  toolPrefix: 'odoo',
  requiredSecrets: ['ODOO_URL', 'ODOO_API_KEY'],
  isOfficial: true,
  createdAt: new Date('2026-02-20T00:00:00Z'),
  updatedAt: new Date('2026-02-20T00:00:00Z'),
};

const sampleInstance: MCPServerInstance = {
  id: 'inst-1',
  projectId: 'proj-1' as ProjectId,
  templateId: 'tmpl-1',
  name: 'my-odoo',
  displayName: 'My Odoo Server',
  description: 'Odoo instance for project',
  transport: 'sse',
  command: undefined,
  args: [],
  envSecretKeys: { ODOO_URL: 'ODOO_URL_PROJ1', ODOO_API_KEY: 'ODOO_KEY_PROJ1' },
  url: 'http://odoo.example.com/mcp',
  toolPrefix: 'odoo',
  status: 'active',
  createdAt: new Date('2026-02-20T00:00:00Z'),
  updatedAt: new Date('2026-02-20T00:00:00Z'),
};

// ─── Logger ─────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ─── Server Setup ───────────────────────────────────────────────

let server: FastifyInstance;
let repo: ReturnType<typeof createMockRepo>;

async function buildServer() {
  repo = createMockRepo();
  const logger = createMockLogger();

  server = Fastify({ logger: false });
  registerErrorHandler(server);
  await server.register(
    async (prefixed) => {
      mcpServerRoutes(prefixed, { mcpServerRepository: repo, logger });
    },
    { prefix: '/api/v1' },
  );
  await server.ready();
  return server;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('mcp-server routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    server = await buildServer();
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  // ─── Templates ──────────────────────────────────────────────

  describe('GET /mcp-server-templates', () => {
    it('returns empty template list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/mcp-server-templates',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('returns templates', async () => {
      repo.listTemplates.mockResolvedValue([sampleTemplate]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/mcp-server-templates',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: MCPServerTemplate[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe('odoo-erp');
    });

    it('passes category filter', async () => {
      repo.listTemplates.mockResolvedValue([]);

      await server.inject({
        method: 'GET',
        url: '/api/v1/mcp-server-templates?category=erp',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.listTemplates).toHaveBeenCalledWith('erp');
    });
  });

  describe('GET /mcp-server-templates/:id', () => {
    it('returns template by id', async () => {
      repo.findTemplateById.mockResolvedValue(sampleTemplate);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/mcp-server-templates/tmpl-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: MCPServerTemplate };
      expect(body.data.name).toBe('odoo-erp');
    });

    it('returns 404 for unknown template', async () => {
      repo.findTemplateById.mockResolvedValue(null);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/mcp-server-templates/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Instances ──────────────────────────────────────────────

  describe('GET /projects/:projectId/mcp-servers', () => {
    it('returns empty instance list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/mcp-servers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('returns instances', async () => {
      repo.listInstances.mockResolvedValue([sampleInstance]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/mcp-servers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: MCPServerInstance[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe('my-odoo');
    });

    it('passes status filter', async () => {
      repo.listInstances.mockResolvedValue([]);

      await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/mcp-servers?status=active',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.listInstances).toHaveBeenCalledWith('proj-1', 'active');
    });
  });

  describe('GET /projects/:projectId/mcp-servers/:id', () => {
    it('returns instance by id', async () => {
      repo.findInstanceById.mockResolvedValue(sampleInstance);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/mcp-servers/inst-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: MCPServerInstance };
      expect(body.data.name).toBe('my-odoo');
    });

    it('returns 404 for unknown instance', async () => {
      repo.findInstanceById.mockResolvedValue(null);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/mcp-servers/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /projects/:projectId/mcp-servers', () => {
    it('creates instance', async () => {
      repo.createInstance.mockResolvedValue(sampleInstance);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-1/mcp-servers',
        payload: {
          name: 'my-odoo',
          transport: 'sse',
          url: 'http://odoo.example.com/mcp',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as { data: MCPServerInstance };
      expect(body.data.name).toBe('my-odoo');
    });

    it('creates instance from template', async () => {
      repo.findTemplateById.mockResolvedValue(sampleTemplate);
      repo.createInstance.mockResolvedValue(sampleInstance);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-1/mcp-servers',
        payload: {
          templateId: 'tmpl-1',
          name: 'my-odoo',
          transport: 'sse',
        },
      });

      expect(response.statusCode).toBe(201);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'tmpl-1',
          name: 'my-odoo',
          transport: 'sse',
          url: 'http://localhost:8069/mcp',
          toolPrefix: 'odoo',
        }),
      );
    });

    it('returns 404 when template not found', async () => {
      repo.findTemplateById.mockResolvedValue(null);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-1/mcp-servers',
        payload: {
          templateId: 'nonexistent',
          name: 'my-server',
          transport: 'sse',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for invalid input', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-1/mcp-servers',
        payload: {
          // Missing required 'name' and 'transport'
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 409 on duplicate name', async () => {
      repo.createInstance.mockRejectedValue(new Error('Unique constraint violation'));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-1/mcp-servers',
        payload: {
          name: 'duplicate-name',
          transport: 'sse',
        },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('PATCH /projects/:projectId/mcp-servers/:id', () => {
    it('updates instance', async () => {
      const updated = { ...sampleInstance, displayName: 'Updated Name' };
      repo.updateInstance.mockResolvedValue(updated);

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/projects/proj-1/mcp-servers/inst-1',
        payload: {
          displayName: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: MCPServerInstance };
      expect(body.data.displayName).toBe('Updated Name');
    });

    it('returns 404 for unknown instance', async () => {
      repo.updateInstance.mockRejectedValue(new Error('Record not found'));

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/projects/proj-1/mcp-servers/nonexistent',
        payload: {
          displayName: 'Test',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for invalid status', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/projects/proj-1/mcp-servers/inst-1',
        payload: {
          status: 'invalid-status',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /projects/:projectId/mcp-servers/:id', () => {
    it('deletes instance', async () => {
      repo.deleteInstance.mockResolvedValue(undefined);

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/projects/proj-1/mcp-servers/inst-1',
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 404 for unknown instance', async () => {
      repo.deleteInstance.mockRejectedValue(new Error('Record not found'));

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/projects/proj-1/mcp-servers/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
