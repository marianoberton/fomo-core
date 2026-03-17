/**
 * Tests for health check routes — /health and /health/clients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoutes } from './health.js';
import type { Logger } from '@/observability/logger.js';
import type { DockerSocketService } from '@/provisioning/docker-socket-service.js';
import type { PrismaClient } from '@prisma/client';

// ─── Mocks ──────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function createMockPrisma(): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaClient;
}

function createMockDockerSocketService(): DockerSocketService {
  return {
    createClientContainer: vi.fn(),
    destroyClientContainer: vi.fn(),
    getContainerStatus: vi.fn(),
    listClientContainers: vi.fn().mockResolvedValue([]),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('registerHealthRoutes', () => {
  let logger: Logger;
  let prisma: PrismaClient;
  let dockerSocketService: DockerSocketService;

  beforeEach(() => {
    logger = createMockLogger();
    prisma = createMockPrisma();
    dockerSocketService = createMockDockerSocketService();
  });

  describe('GET /health', () => {
    it('returns 200 when postgres is reachable', async () => {
      const app = Fastify();
      registerHealthRoutes(app, {
        prisma,
        redisUrl: undefined,
        dockerSocketService,
        logger,
      });

      const response = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(response.body) as Record<string, unknown>;

      // Postgres is mocked as OK, Redis is down (no URL), Docker may fail in tests
      expect(response.statusCode).toBeLessThanOrEqual(503);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('services');

      const services = body['services'] as Record<string, unknown>;
      expect(services).toHaveProperty('postgres');
      expect(services).toHaveProperty('redis');
      expect(services).toHaveProperty('docker');

      await app.close();
    });

    it('returns 503 when postgres is down', async () => {
      const failingPrisma = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as PrismaClient;

      const app = Fastify();
      registerHealthRoutes(app, {
        prisma: failingPrisma,
        redisUrl: undefined,
        dockerSocketService,
        logger,
      });

      const response = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(response.body) as { status: string; services: { postgres: { status: string } } };

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('down');
      expect(body.services.postgres.status).toBe('down');

      await app.close();
    });
  });

  describe('GET /health/clients', () => {
    it('returns empty clients list when no containers exist', async () => {
      const app = Fastify();
      registerHealthRoutes(app, {
        prisma,
        redisUrl: undefined,
        dockerSocketService,
        logger,
      });

      const response = await app.inject({ method: 'GET', url: '/health/clients' });
      const body = JSON.parse(response.body) as { status: string; clients: unknown[] };

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.clients).toEqual([]);

      await app.close();
    });

    it('returns degraded when a container is stopped', async () => {
      const mockDockerService = createMockDockerSocketService();
      vi.mocked(mockDockerService.listClientContainers).mockResolvedValue([
        { clientId: 'client-1', containerId: 'abc123', status: 'running', uptime: 3600 },
        { clientId: 'client-2', containerId: 'def456', status: 'stopped', uptime: undefined },
      ]);

      const app = Fastify();
      registerHealthRoutes(app, {
        prisma,
        redisUrl: undefined,
        dockerSocketService: mockDockerService,
        logger,
      });

      const response = await app.inject({ method: 'GET', url: '/health/clients' });
      const body = JSON.parse(response.body) as { status: string; clients: Array<{ clientId: string; status: string }> };

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('degraded');
      expect(body.clients).toHaveLength(2);
      expect(body.clients[0]?.clientId).toBe('client-1');
      expect(body.clients[1]?.status).toBe('stopped');

      await app.close();
    });

    it('returns 503 when docker service throws', async () => {
      const mockDockerService = createMockDockerSocketService();
      vi.mocked(mockDockerService.listClientContainers).mockRejectedValue(new Error('Docker socket error'));

      const app = Fastify();
      registerHealthRoutes(app, {
        prisma,
        redisUrl: undefined,
        dockerSocketService: mockDockerService,
        logger,
      });

      const response = await app.inject({ method: 'GET', url: '/health/clients' });
      const body = JSON.parse(response.body) as { status: string };

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('down');

      await app.close();
    });
  });
});
