/**
 * Tests for the provisioning service orchestrator.
 * Mocks the DockerSocketService to isolate orchestrator logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProvisioningService, ProvisioningError, ClientNotFoundError } from '@/provisioning/provisioning-service.js';
import type { ProvisioningService } from '@/provisioning/provisioning-service.js';
import type { DockerSocketService } from '@/provisioning/docker-socket-service.js';
import type { Logger } from '@/observability/logger.js';
import type { CreateClientRequest } from '@/provisioning/provisioning-types.js';

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

function createMockDockerService(): {
  [K in keyof DockerSocketService]: ReturnType<typeof vi.fn>;
} {
  return {
    createClientContainer: vi.fn(),
    destroyClientContainer: vi.fn(),
    getContainerStatus: vi.fn(),
    listClientContainers: vi.fn(),
  };
}

function makeRequest(overrides?: Partial<CreateClientRequest>): CreateClientRequest {
  return {
    clientId: 'client-001',
    clientName: 'Acme Corp',
    channels: ['whatsapp'],
    agentConfig: { model: 'gpt-4o' },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ProvisioningService', () => {
  let service: ProvisioningService;
  let dockerService: ReturnType<typeof createMockDockerService>;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerService = createMockDockerService();
    logger = createMockLogger();
    service = createProvisioningService({
      dockerSocketService: dockerService as unknown as DockerSocketService,
      logger,
    });
  });

  // ─── provisionClient ───────────────────────────────────────

  describe('provisionClient', () => {
    it('delegates to dockerSocketService and returns result', async () => {
      const expected = {
        success: true,
        containerId: 'abc123',
        containerName: 'fomo-client-client-001',
      };
      dockerService.createClientContainer.mockResolvedValue(expected);

      const result = await service.provisionClient(makeRequest());

      expect(result).toEqual(expected);
      expect(dockerService.createClientContainer).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-001' }),
      );
    });

    it('throws ProvisioningError when Docker returns failure', async () => {
      dockerService.createClientContainer.mockResolvedValue({
        success: false,
        containerName: 'fomo-client-client-001',
        error: 'Image not found',
      });

      await expect(service.provisionClient(makeRequest())).rejects.toThrow(ProvisioningError);
    });

    it('throws ProvisioningError on validation failure', async () => {
      const invalidReq = makeRequest({ clientId: '' });

      await expect(service.provisionClient(invalidReq)).rejects.toThrow(ProvisioningError);
      expect(dockerService.createClientContainer).not.toHaveBeenCalled();
    });

    it('throws ProvisioningError with empty channels', async () => {
      const invalidReq = makeRequest({ channels: [] as unknown as CreateClientRequest['channels'] });

      await expect(service.provisionClient(invalidReq)).rejects.toThrow(ProvisioningError);
    });

    it('wraps unexpected errors in ProvisioningError', async () => {
      dockerService.createClientContainer.mockRejectedValue(new Error('ENOENT'));

      await expect(service.provisionClient(makeRequest())).rejects.toThrow(ProvisioningError);
    });

    it('logs provisioning request', async () => {
      dockerService.createClientContainer.mockResolvedValue({
        success: true,
        containerId: 'abc123',
        containerName: 'fomo-client-client-001',
      });

      await service.provisionClient(makeRequest());

      expect(logger.info).toHaveBeenCalledWith(
        'Provisioning client',
        expect.objectContaining({ component: 'provisioning-service', clientId: 'client-001' }),
      );
    });
  });

  // ─── deprovisionClient ─────────────────────────────────────

  describe('deprovisionClient', () => {
    it('delegates to dockerSocketService.destroyClientContainer', async () => {
      dockerService.destroyClientContainer.mockResolvedValue(undefined);

      await service.deprovisionClient('client-001');

      expect(dockerService.destroyClientContainer).toHaveBeenCalledWith('client-001');
    });

    it('throws ClientNotFoundError when container not found', async () => {
      dockerService.destroyClientContainer.mockRejectedValue(
        new Error('Container for client "client-999" not found'),
      );

      await expect(service.deprovisionClient('client-999')).rejects.toThrow(ClientNotFoundError);
    });

    it('throws ProvisioningError on unexpected failure', async () => {
      dockerService.destroyClientContainer.mockRejectedValue(new Error('Permission denied'));

      await expect(service.deprovisionClient('client-001')).rejects.toThrow(ProvisioningError);
    });

    it('logs deprovision request', async () => {
      dockerService.destroyClientContainer.mockResolvedValue(undefined);

      await service.deprovisionClient('client-001');

      expect(logger.info).toHaveBeenCalledWith(
        'Deprovisioning client',
        expect.objectContaining({ component: 'provisioning-service', clientId: 'client-001' }),
      );
    });
  });

  // ─── getClientStatus ───────────────────────────────────────

  describe('getClientStatus', () => {
    it('returns container status from docker service', async () => {
      const status = {
        clientId: 'client-001',
        containerId: 'abc123',
        status: 'running' as const,
        uptime: 3600,
      };
      dockerService.getContainerStatus.mockResolvedValue(status);

      const result = await service.getClientStatus('client-001');

      expect(result).toEqual(status);
    });

    it('throws ClientNotFoundError when container not found', async () => {
      dockerService.getContainerStatus.mockRejectedValue(
        new Error('Container for client "client-999" not found'),
      );

      await expect(service.getClientStatus('client-999')).rejects.toThrow(ClientNotFoundError);
    });

    it('throws ProvisioningError on unexpected failure', async () => {
      dockerService.getContainerStatus.mockRejectedValue(new Error('Socket timeout'));

      await expect(service.getClientStatus('client-001')).rejects.toThrow(ProvisioningError);
    });
  });
});
