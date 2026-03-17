/**
 * Tests for the provisioning module: types, service, and routes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  CreateClientRequestSchema,
  ProvisioningResultSchema,
  ClientContainerStatusSchema,
} from '@/provisioning/provisioning-types.js';
import type {
  CreateClientRequest,
  ProvisioningResult,
  ClientContainerStatus,
} from '@/provisioning/provisioning-types.js';
import type { ProvisioningService } from '@/provisioning/provisioning-service.js';
import { ProvisioningError, ClientNotFoundError } from '@/provisioning/provisioning-service.js';
import type { DokployService } from '@/provisioning/dokploy-service.js';
import { provisioningRoutes } from '@/api/routes/provisioning.js';
import type { ProvisioningRouteDeps } from '@/api/routes/provisioning.js';
import { registerErrorHandler } from '@/api/error-handler.js';

// ─── Mock Factories ─────────────────────────────────────────────

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

function createMockProvisioningService(): {
  [K in keyof ProvisioningService]: ReturnType<typeof vi.fn>;
} {
  return {
    provisionClient: vi.fn(),
    deprovisionClient: vi.fn(),
    getClientStatus: vi.fn(),
  };
}

function createMockDokployService(): {
  [K in keyof DokployService]: ReturnType<typeof vi.fn>;
} {
  return {
    createClientContainer: vi.fn(),
    destroyClientContainer: vi.fn(),
    getContainerStatus: vi.fn(),
    listClientContainers: vi.fn(),
  };
}

// ─── Sample Data ────────────────────────────────────────────────

const sampleRequest: CreateClientRequest = {
  clientId: 'client-1',
  clientName: 'Test Client',
  channels: ['whatsapp'],
  agentConfig: {
    model: 'gpt-4o',
    provider: 'openai',
  },
};

const sampleResult: ProvisioningResult = {
  success: true,
  containerId: 'abc123',
  containerName: 'fomo-client-client-1',
};

const sampleStatus: ClientContainerStatus = {
  clientId: 'client-1',
  containerId: 'abc123',
  status: 'running',
  uptime: 3600,
};

// ─── Schema Tests ───────────────────────────────────────────────

describe('provisioning schemas', () => {
  describe('CreateClientRequestSchema', () => {
    it('validates a valid request', () => {
      const result = CreateClientRequestSchema.safeParse(sampleRequest);
      expect(result.success).toBe(true);
    });

    it('requires clientId', () => {
      const result = CreateClientRequestSchema.safeParse({
        clientName: 'Test',
        channels: ['whatsapp'],
        agentConfig: { model: 'gpt-4o' },
      });
      expect(result.success).toBe(false);
    });

    it('requires at least one channel', () => {
      const result = CreateClientRequestSchema.safeParse({
        clientId: 'c1',
        clientName: 'Test',
        channels: [],
        agentConfig: { model: 'gpt-4o' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid channel names', () => {
      const result = CreateClientRequestSchema.safeParse({
        clientId: 'c1',
        clientName: 'Test',
        channels: ['email'],
        agentConfig: { model: 'gpt-4o' },
      });
      expect(result.success).toBe(false);
    });

    it('requires agentConfig.model', () => {
      const result = CreateClientRequestSchema.safeParse({
        clientId: 'c1',
        clientName: 'Test',
        channels: ['slack'],
        agentConfig: {},
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional agentConfig fields', () => {
      const result = CreateClientRequestSchema.safeParse({
        clientId: 'c1',
        clientName: 'Test',
        channels: ['telegram'],
        agentConfig: {
          model: 'claude-sonnet-4-5-20250929',
          provider: 'anthropic',
          systemPrompt: 'You are a helpful assistant.',
          maxTokens: 2048,
          temperature: 0.7,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ProvisioningResultSchema', () => {
    it('validates a success result', () => {
      const result = ProvisioningResultSchema.safeParse(sampleResult);
      expect(result.success).toBe(true);
    });

    it('validates a failure result', () => {
      const result = ProvisioningResultSchema.safeParse({
        success: false,
        containerName: 'fomo-client-c1',
        error: 'Image not found',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ClientContainerStatusSchema', () => {
    it('validates a running container status', () => {
      const result = ClientContainerStatusSchema.safeParse(sampleStatus);
      expect(result.success).toBe(true);
    });

    it('validates a stopped container without uptime', () => {
      const result = ClientContainerStatusSchema.safeParse({
        clientId: 'client-1',
        containerId: 'abc123',
        status: 'stopped',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid status values', () => {
      const result = ClientContainerStatusSchema.safeParse({
        clientId: 'client-1',
        containerId: 'abc123',
        status: 'unknown',
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Provisioning Service Error Tests ───────────────────────────

describe('provisioning errors', () => {
  it('ProvisioningError has correct code and status', () => {
    const err = new ProvisioningError('test', 'client-1');
    expect(err.code).toBe('PROVISIONING_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toContain('client-1');
  });

  it('ClientNotFoundError has correct code and status', () => {
    const err = new ClientNotFoundError('client-1');
    expect(err.code).toBe('CLIENT_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('client-1');
  });
});

// ─── Route Tests ────────────────────────────────────────────────

describe('provisioning routes', () => {
  let app: FastifyInstance;
  let mockProvisioningService: ReturnType<typeof createMockProvisioningService>;
  let mockDokployService: ReturnType<typeof createMockDokployService>;

  beforeEach(() => {
    mockProvisioningService = createMockProvisioningService();
    mockDokployService = createMockDokployService();

    app = Fastify();
    registerErrorHandler(app);

    const deps: ProvisioningRouteDeps = {
      provisioningService: mockProvisioningService,
      dokployService: mockDokployService,
      logger: createMockLogger(),
    };
    provisioningRoutes(app, deps);
  });

  // ── POST /api/v1/provisioning/create ──────────────────────

  describe('POST /api/v1/provisioning/create', () => {
    it('returns 201 on successful provisioning', async () => {
      mockProvisioningService.provisionClient.mockResolvedValue(sampleResult);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/provisioning/create',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sampleRequest),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { success: boolean; data: ProvisioningResult };
      expect(body.success).toBe(true);
      expect(body.data.containerId).toBe('abc123');
    });

    it('returns 400 on invalid request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/provisioning/create',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'c1' }),
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when provisioning service throws', async () => {
      mockProvisioningService.provisionClient.mockRejectedValue(
        new ProvisioningError('Dokploy unavailable', 'client-1'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/provisioning/create',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sampleRequest),
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PROVISIONING_ERROR');
    });
  });

  // ── DELETE /api/v1/provisioning/:clientId ──────────────────

  describe('DELETE /api/v1/provisioning/:clientId', () => {
    it('returns 200 on successful deprovisioning', async () => {
      mockProvisioningService.deprovisionClient.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/provisioning/client-1',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('returns 404 when client not found', async () => {
      mockProvisioningService.deprovisionClient.mockRejectedValue(
        new ClientNotFoundError('missing-client'),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/provisioning/missing-client',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CLIENT_NOT_FOUND');
    });
  });

  // ── GET /api/v1/provisioning/:clientId/status ─────────────

  describe('GET /api/v1/provisioning/:clientId/status', () => {
    it('returns container status', async () => {
      mockProvisioningService.getClientStatus.mockResolvedValue(sampleStatus);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/provisioning/client-1/status',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; data: ClientContainerStatus };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('running');
      expect(body.data.uptime).toBe(3600);
    });

    it('returns 404 when client not found', async () => {
      mockProvisioningService.getClientStatus.mockRejectedValue(
        new ClientNotFoundError('missing'),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/provisioning/missing/status',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/provisioning ──────────────────────────────

  describe('GET /api/v1/provisioning', () => {
    it('returns list of containers', async () => {
      mockDokployService.listClientContainers.mockResolvedValue([sampleStatus]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/provisioning',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; data: ClientContainerStatus[] };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.clientId).toBe('client-1');
    });

    it('returns empty array when no containers exist', async () => {
      mockDokployService.listClientContainers.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/provisioning',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; data: ClientContainerStatus[] };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });
});
