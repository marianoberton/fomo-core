/**
 * Tests for the Docker socket service.
 * Mocks the Node.js http module to simulate Docker Engine API responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createDockerSocketService } from '@/provisioning/docker-socket-service.js';
import type { DockerSocketService } from '@/provisioning/docker-socket-service.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('node:http');

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

/** Create a mock HTTP response that emits data then ends. */
function mockHttpResponse(statusCode: number, body: unknown): void {
  const mockResponse = new EventEmitter() as EventEmitter & { statusCode: number };
  mockResponse.statusCode = statusCode;

  const mockRequest = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  mockRequest.write = vi.fn();
  mockRequest.end = vi.fn();

  vi.mocked(http.request).mockImplementation((_options, callback) => {
    if (callback) {
      (callback as (res: typeof mockResponse) => void)(mockResponse);
    }

    // Emit data + end asynchronously
    process.nextTick(() => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      mockResponse.emit('data', Buffer.from(payload));
      mockResponse.emit('end');
    });

    return mockRequest as unknown as http.ClientRequest;
  });
}

/** Chain multiple mock responses for sequential Docker API calls. */
function mockHttpResponses(responses: Array<{ statusCode: number; body: unknown }>): void {
  let callIndex = 0;

  vi.mocked(http.request).mockImplementation((_options, callback) => {
    const response = responses[callIndex] ?? { statusCode: 500, body: { message: 'No more mocked responses' } };
    callIndex++;

    const mockResponse = new EventEmitter() as EventEmitter & { statusCode: number };
    mockResponse.statusCode = response.statusCode;

    const mockRequest = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    mockRequest.write = vi.fn();
    mockRequest.end = vi.fn();

    if (callback) {
      (callback as (res: typeof mockResponse) => void)(mockResponse);
    }

    process.nextTick(() => {
      const payload = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      mockResponse.emit('data', Buffer.from(payload));
      mockResponse.emit('end');
    });

    return mockRequest as unknown as http.ClientRequest;
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DockerSocketService', () => {
  let service: DockerSocketService;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    service = createDockerSocketService({ logger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── createClientContainer ─────────────────────────────────

  describe('createClientContainer', () => {
    const request = {
      clientId: 'client-001',
      clientName: 'Acme Corp',
      channels: ['whatsapp' as const],
      agentConfig: { model: 'gpt-4o' },
    };

    it('creates and starts container successfully', async () => {
      mockHttpResponses([
        { statusCode: 200, body: [] }, // allocatePort — list containers
        { statusCode: 201, body: { Id: 'container-abc123' } }, // create
        { statusCode: 204, body: '' }, // start
      ]);

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(true);
      expect(result.containerId).toBe('container-abc123');
      expect(result.containerName).toBe('fomo-client-client-001');
    });

    it('returns failure when container creation fails', async () => {
      mockHttpResponses([
        { statusCode: 200, body: [] }, // allocatePort
        { statusCode: 409, body: { message: 'Conflict — container already exists' } },
      ]);

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Conflict');
    });

    it('returns failure when container start fails', async () => {
      mockHttpResponses([
        { statusCode: 200, body: [] }, // allocatePort
        { statusCode: 201, body: { Id: 'container-abc123' } }, // create
        { statusCode: 500, body: { message: 'Cannot start container' } }, // start
      ]);

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(false);
      expect(result.containerId).toBe('container-abc123');
      expect(result.error).toContain('failed to start');
    });

    it('returns failure on socket error', async () => {
      const mockRequest = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockRequest.write = vi.fn();
      mockRequest.end = vi.fn();

      vi.mocked(http.request).mockImplementation(() => {
        process.nextTick(() => {
          mockRequest.emit('error', new Error('ENOENT: Docker socket not found'));
        });
        return mockRequest as unknown as http.ClientRequest;
      });

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('logs container creation', async () => {
      mockHttpResponses([
        { statusCode: 200, body: [] }, // allocatePort
        { statusCode: 201, body: { Id: 'container-abc123' } },
        { statusCode: 204, body: '' },
      ]);

      await service.createClientContainer(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating client container',
        expect.objectContaining({ component: 'docker-socket-service', clientId: 'client-001' }),
      );
    });
  });

  // ─── destroyClientContainer ────────────────────────────────

  describe('destroyClientContainer', () => {
    it('stops and removes container successfully', async () => {
      mockHttpResponses([
        { statusCode: 204, body: '' }, // stop
        { statusCode: 204, body: '' }, // remove
      ]);

      await expect(service.destroyClientContainer('client-001')).resolves.toBeUndefined();
    });

    it('succeeds even if stop fails (container already stopped)', async () => {
      mockHttpResponses([
        { statusCode: 304, body: '' }, // stop (already stopped)
        { statusCode: 204, body: '' }, // remove
      ]);

      await expect(service.destroyClientContainer('client-001')).resolves.toBeUndefined();
    });

    it('succeeds if container is 404 on remove (already gone)', async () => {
      mockHttpResponses([
        { statusCode: 204, body: '' }, // stop
        { statusCode: 404, body: '' }, // remove (already gone)
      ]);

      await expect(service.destroyClientContainer('client-001')).resolves.toBeUndefined();
    });

    it('throws on remove failure', async () => {
      mockHttpResponses([
        { statusCode: 204, body: '' }, // stop
        { statusCode: 500, body: { message: 'Internal server error' } }, // remove
      ]);

      await expect(service.destroyClientContainer('client-001')).rejects.toThrow('Failed to destroy');
    });
  });

  // ─── getContainerStatus ────────────────────────────────────

  describe('getContainerStatus', () => {
    it('returns running status with uptime', async () => {
      const startedAt = new Date(Date.now() - 3600_000).toISOString();
      mockHttpResponse(200, {
        Id: 'container-abc123',
        State: { Status: 'running', StartedAt: startedAt },
      });

      const status = await service.getContainerStatus('client-001');

      expect(status.clientId).toBe('client-001');
      expect(status.containerId).toBe('container-abc123');
      expect(status.status).toBe('running');
      expect(status.uptime).toBeGreaterThanOrEqual(3599);
      expect(status.uptime).toBeLessThanOrEqual(3601);
    });

    it('returns stopped status without uptime', async () => {
      mockHttpResponse(200, {
        Id: 'container-abc123',
        State: { Status: 'exited' },
      });

      const status = await service.getContainerStatus('client-001');

      expect(status.status).toBe('stopped');
      expect(status.uptime).toBeUndefined();
    });

    it('throws when container not found', async () => {
      mockHttpResponse(404, { message: 'No such container' });

      await expect(service.getContainerStatus('client-999')).rejects.toThrow('not found');
    });
  });

  // ─── listClientContainers ──────────────────────────────────

  describe('listClientContainers', () => {
    it('returns list of managed containers', async () => {
      mockHttpResponse(200, [
        {
          Id: 'container-abc',
          State: 'running',
          Status: 'Up 2 hours',
          Created: Math.floor(Date.now() / 1000) - 7200,
          Labels: { 'fomo.client-id': 'client-001', 'fomo.managed': 'true' },
        },
        {
          Id: 'container-def',
          State: 'exited',
          Status: 'Exited (0) 1 hour ago',
          Created: Math.floor(Date.now() / 1000) - 3600,
          Labels: { 'fomo.client-id': 'client-002', 'fomo.managed': 'true' },
        },
      ]);

      const containers = await service.listClientContainers();

      expect(containers).toHaveLength(2);
      expect(containers[0]?.clientId).toBe('client-001');
      expect(containers[0]?.status).toBe('running');
      expect(containers[1]?.clientId).toBe('client-002');
      expect(containers[1]?.status).toBe('stopped');
    });

    it('returns empty array on Docker API error', async () => {
      mockHttpResponse(500, { message: 'Internal error' });

      const containers = await service.listClientContainers();

      expect(containers).toEqual([]);
    });

    it('returns "unknown" clientId when label missing', async () => {
      mockHttpResponse(200, [
        {
          Id: 'container-xyz',
          State: 'running',
          Created: Math.floor(Date.now() / 1000),
          Labels: { 'fomo.managed': 'true' },
        },
      ]);

      const containers = await service.listClientContainers();

      expect(containers[0]?.clientId).toBe('unknown');
    });
  });
});
