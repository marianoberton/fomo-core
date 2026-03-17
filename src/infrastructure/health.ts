/**
 * Health check service — exposes /health and /health/clients endpoints.
 * Checks Postgres, Redis, and Docker socket connectivity.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { Logger } from '@/observability/logger.js';
import type { DockerSocketService } from '@/provisioning/docker-socket-service.js';

// ─── Types ──────────────────────────────────────────────────────

export type ServiceStatus = 'ok' | 'degraded' | 'down';

export interface ServiceHealth {
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  status: ServiceStatus;
  timestamp: string;
  uptime: number;
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    docker: ServiceHealth;
  };
}

export interface ClientHealthEntry {
  clientId: string;
  containerId: string;
  status: 'running' | 'stopped' | 'error';
  uptime?: number;
}

export interface ClientsHealthResponse {
  status: ServiceStatus;
  timestamp: string;
  clients: ClientHealthEntry[];
}

// ─── Dependencies ───────────────────────────────────────────────

export interface HealthDeps {
  prisma: PrismaClient;
  redisUrl: string | undefined;
  dockerSocketService: DockerSocketService;
  logger: Logger;
}

// ─── Service Checks ─────────────────────────────────────────────

const COMPONENT = 'health';

/** Check Postgres connectivity via a simple query. */
async function checkPostgres(prisma: PrismaClient): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Check Redis connectivity via a PING command. */
async function checkRedis(redisUrl: string | undefined): Promise<ServiceHealth> {
  if (!redisUrl) {
    return { status: 'down', error: 'REDIS_URL not configured' };
  }

  const start = Date.now();
  try {
    const client = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000 });
    await client.connect();
    await client.ping();
    const latencyMs = Date.now() - start;
    await client.quit();
    return { status: 'ok', latencyMs };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Check Docker socket connectivity via the /_ping endpoint. */
async function checkDocker(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const http = await import('node:http');
    const result = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        { socketPath: '/var/run/docker.sock', path: '/_ping', method: 'GET', timeout: 3000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Docker socket timeout')); });
      req.end();
    });
    return { status: result === 'OK' ? 'ok' : 'degraded', latencyMs: Date.now() - start };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Derive overall status from individual service statuses. */
function deriveOverallStatus(services: Record<string, ServiceHealth>): ServiceStatus {
  const statuses = Object.values(services).map((s) => s.status);
  if (statuses.every((s) => s === 'ok')) return 'ok';
  if (statuses.some((s) => s === 'down')) {
    // Postgres down = system down. Redis/Docker down = degraded.
    if (services['postgres']?.status === 'down') return 'down';
    return 'degraded';
  }
  return 'degraded';
}

// ─── Route Registration ─────────────────────────────────────────

const startedAt = Date.now();

/** Register health check routes on the Fastify instance. */
export function registerHealthRoutes(fastify: FastifyInstance, deps: HealthDeps): void {
  const { prisma, redisUrl, dockerSocketService, logger } = deps;

  fastify.get('/health', async (_request, reply) => {
    const [postgres, redis, docker] = await Promise.all([
      checkPostgres(prisma),
      checkRedis(redisUrl),
      checkDocker(),
    ]);

    const services = { postgres, redis, docker };
    const status = deriveOverallStatus(services);

    const response: HealthResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      services,
    };

    logger.debug('Health check', { component: COMPONENT, status });
    return reply.code(status === 'down' ? 503 : 200).send(response);
  });

  fastify.get('/health/clients', async (_request, reply) => {
    try {
      const containers = await dockerSocketService.listClientContainers();

      const clients: ClientHealthEntry[] = containers.map((c) => ({
        clientId: c.clientId,
        containerId: c.containerId,
        status: c.status,
        uptime: c.uptime,
      }));

      const allRunning = clients.length > 0 && clients.every((c) => c.status === 'running');
      const anyDown = clients.some((c) => c.status === 'error' || c.status === 'stopped');
      let status: ServiceStatus = 'ok';
      if (clients.length === 0) status = 'ok';
      else if (anyDown && !allRunning) status = 'degraded';
      else if (!allRunning) status = 'degraded';

      const response: ClientsHealthResponse = {
        status,
        timestamp: new Date().toISOString(),
        clients,
      };

      return reply.code(200).send(response);
    } catch (e) {
      logger.error('Health clients check failed', {
        component: COMPONENT,
        error: e instanceof Error ? e.message : String(e),
      });
      return reply.code(503).send({
        status: 'down',
        timestamp: new Date().toISOString(),
        clients: [],
      });
    }
  });
}
