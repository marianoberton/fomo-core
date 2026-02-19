/**
 * Tests for channel integration CRUD routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { integrationRoutes } from './integrations.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

// ─── App Factory ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createApp() {
  const deps = createMockDeps();
  const app = Fastify();
  registerErrorHandler(app);
  integrationRoutes(app, deps);
  return { app, deps };
}

// ─── Fixtures ──────────────────────────────────────────────────

const sampleIntegration = {
  id: 'int-1',
  projectId: 'proj-1',
  provider: 'telegram',
  config: { botTokenSecretKey: 'tg-token' },
  status: 'active',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────

describe('integrationRoutes', () => {
  let app: FastifyInstance;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    ({ app, deps } = createApp());
  });

  describe('GET /projects/:projectId/integrations', () => {
    it('returns empty list when no integrations', async () => {
      deps.channelIntegrationRepository.findByProject.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { items: unknown[]; total: number } }>();
      expect(body.success).toBe(true);
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('returns integrations with webhook URLs', async () => {
      deps.channelIntegrationRepository.findByProject.mockResolvedValue([sampleIntegration]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { items: Record<string, unknown>[] } }>();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.['webhookUrl']).toBe('/api/v1/webhooks/telegram/int-1');
    });

    it('returns Chatwoot webhook URL for chatwoot provider', async () => {
      deps.channelIntegrationRepository.findByProject.mockResolvedValue([
        { ...sampleIntegration, provider: 'chatwoot' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations',
      });

      const body = response.json<{ data: { items: Record<string, unknown>[] } }>();
      expect(body.data.items[0]?.['webhookUrl']).toBe('/api/v1/webhooks/chatwoot');
    });
  });

  describe('POST /projects/:projectId/integrations', () => {
    it('creates a Telegram integration', async () => {
      deps.secretService.exists.mockResolvedValue(true);
      deps.channelIntegrationRepository.create.mockResolvedValue(sampleIntegration);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/integrations',
        payload: {
          provider: 'telegram',
          config: { botTokenSecretKey: 'tg-token' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.success).toBe(true);
      expect(body.data['provider']).toBe('telegram');
    });

    it('validates secret keys exist before creating', async () => {
      deps.secretService.exists.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/integrations',
        payload: {
          provider: 'telegram',
          config: { botTokenSecretKey: 'missing-secret' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('SECRET_NOT_FOUND');
    });

    it('rejects invalid provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/integrations',
        payload: {
          provider: 'discord',
          config: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing config fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/integrations',
        payload: {
          provider: 'telegram',
          config: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('invalidates resolver cache after creation', async () => {
      deps.secretService.exists.mockResolvedValue(true);
      deps.channelIntegrationRepository.create.mockResolvedValue(sampleIntegration);

      await app.inject({
        method: 'POST',
        url: '/projects/proj-1/integrations',
        payload: {
          provider: 'telegram',
          config: { botTokenSecretKey: 'tg-token' },
        },
      });

       
      expect(deps.channelResolver.invalidate).toHaveBeenCalledWith('proj-1');
    });
  });

  describe('GET /projects/:projectId/integrations/:integrationId', () => {
    it('returns integration by ID', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(sampleIntegration);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations/int-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.success).toBe(true);
      expect(body.data['id']).toBe('int-1');
    });

    it('returns 404 when not found', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when project does not match', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue({
        ...sampleIntegration,
        projectId: 'other-project',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations/int-1',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /projects/:projectId/integrations/:integrationId', () => {
    it('updates integration status', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(sampleIntegration);
      deps.channelIntegrationRepository.update.mockResolvedValue({
        ...sampleIntegration,
        status: 'paused',
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/projects/proj-1/integrations/int-1',
        payload: { status: 'paused' },
      });

      expect(response.statusCode).toBe(200);
       
      expect(deps.channelResolver.invalidate).toHaveBeenCalledWith('proj-1');
    });

    it('returns 404 when integration not found', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PUT',
        url: '/projects/proj-1/integrations/nonexistent',
        payload: { status: 'paused' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /projects/:projectId/integrations/:integrationId', () => {
    it('deletes integration and invalidates cache', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(sampleIntegration);
      deps.channelIntegrationRepository.delete.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/projects/proj-1/integrations/int-1',
      });

      expect(response.statusCode).toBe(200);
       
      expect(deps.channelIntegrationRepository.delete).toHaveBeenCalledWith('int-1');
       
      expect(deps.channelResolver.invalidate).toHaveBeenCalledWith('proj-1');
    });

    it('returns 404 when not found', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: '/projects/proj-1/integrations/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /projects/:projectId/integrations/:integrationId/health', () => {
    it('returns healthy=true when adapter health check passes', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(sampleIntegration);
      const mockAdapter = {
        channelType: 'telegram',
        send: vi.fn(),
        parseInbound: vi.fn(),
        isHealthy: vi.fn(() => Promise.resolve(true)),
      };
      deps.channelResolver.resolveAdapter.mockResolvedValue(mockAdapter);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations/int-1/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { healthy: boolean } }>();
      expect(body.data.healthy).toBe(true);
    });

    it('returns healthy=false when adapter cannot be resolved', async () => {
      deps.channelIntegrationRepository.findById.mockResolvedValue(sampleIntegration);
      deps.channelResolver.resolveAdapter.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/integrations/int-1/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { healthy: boolean; error?: string } }>();
      expect(body.data.healthy).toBe(false);
      expect(body.data.error).toContain('Failed to resolve adapter');
    });
  });
});
