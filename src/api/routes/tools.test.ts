import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { toolRoutes } from './tools.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

const mockTool = {
  id: 'calculator',
  name: 'Calculator',
  description: 'Performs math',
  category: 'utility',
  riskLevel: 'low',
  requiresApproval: false,
  sideEffects: false,
};

function createApp(): { app: FastifyInstance; deps: ReturnType<typeof createMockDeps> } {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  toolRoutes(app, deps);
  return { app, deps };
}

describe('toolRoutes', () => {
  describe('GET /tools', () => {
    it('returns tool list', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.listAll.mockReturnValue(['calculator']);
      deps.toolRegistry.get.mockReturnValue(mockTool);

      const response = await app.inject({
        method: 'GET',
        url: '/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: { id: string; name: string; description: string }[];
      }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toStrictEqual(mockTool);
    });

    it('returns empty array when no tools are registered', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.listAll.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: unknown[] }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /tools/:id', () => {
    it('returns tool info', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.get.mockReturnValue(mockTool);

      const response = await app.inject({
        method: 'GET',
        url: '/tools/calculator',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: { id: string; name: string };
      }>();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('calculator');
      expect(body.data.name).toBe('Calculator');
    });

    it('returns 404 when tool is not found', async () => {
      const { app, deps } = createApp();

      deps.toolRegistry.get.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/tools/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('nonexistent');
    });
  });
});
