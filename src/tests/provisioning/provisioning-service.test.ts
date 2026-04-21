/**
 * Tests for the provisioning service orchestrator.
 * Mocks the DokployService to isolate orchestrator logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProvisioningService, ProvisioningError, ClientNotFoundError } from '@/provisioning/provisioning-service.js';
import type { ProvisioningService } from '@/provisioning/provisioning-service.js';
import type { DokployService } from '@/provisioning/dokploy-service.js';
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

function createMockDokployService(): {
  [K in keyof DokployService]: ReturnType<typeof vi.fn>;
} {
  return {
    createClientContainer: vi.fn(),
    destroyClientContainer: vi.fn(),
    getContainerStatus: vi.fn(),
    listClientContainers: vi.fn(),
    redeployClient: vi.fn(),
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
  let dokployService: ReturnType<typeof createMockDokployService>;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    dokployService = createMockDokployService();
    logger = createMockLogger();
    service = createProvisioningService({
      dokployService: dokployService as unknown as DokployService,
      logger,
    });
  });

  // ─── provisionClient ───────────────────────────────────────

  describe('provisionClient', () => {
    it('delegates to dokployService and returns result', async () => {
      const expected = {
        success: true,
        containerId: 'abc123',
        containerName: 'fomo-client-client-001',
      };
      dokployService.createClientContainer.mockResolvedValue(expected);

      const result = await service.provisionClient(makeRequest());

      expect(result).toEqual(expected);
      expect(dokployService.createClientContainer).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-001' }),
      );
    });

    it('throws ProvisioningError when Dokploy returns failure', async () => {
      dokployService.createClientContainer.mockResolvedValue({
        success: false,
        containerName: 'fomo-client-client-001',
        error: 'Image not found',
      });

      await expect(service.provisionClient(makeRequest())).rejects.toThrow(ProvisioningError);
    });

    it('throws ProvisioningError on validation failure', async () => {
      const invalidReq = makeRequest({ clientId: '' });

      await expect(service.provisionClient(invalidReq)).rejects.toThrow(ProvisioningError);
      expect(dokployService.createClientContainer).not.toHaveBeenCalled();
    });

    it('throws ProvisioningError with empty channels', async () => {
      const invalidReq = makeRequest({ channels: [] as unknown as CreateClientRequest['channels'] });

      await expect(service.provisionClient(invalidReq)).rejects.toThrow(ProvisioningError);
    });

    it('wraps unexpected errors in ProvisioningError', async () => {
      dokployService.createClientContainer.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.provisionClient(makeRequest())).rejects.toThrow(ProvisioningError);
    });

    it('logs provisioning request', async () => {
      dokployService.createClientContainer.mockResolvedValue({
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
    it('delegates to dokployService.destroyClientContainer', async () => {
      dokployService.destroyClientContainer.mockResolvedValue(undefined);

      await service.deprovisionClient('client-001');

      expect(dokployService.destroyClientContainer).toHaveBeenCalledWith('client-001');
    });

    it('throws ClientNotFoundError when container not found', async () => {
      dokployService.destroyClientContainer.mockRejectedValue(
        new Error('Application for client "client-999" not found'),
      );

      await expect(service.deprovisionClient('client-999')).rejects.toThrow(ClientNotFoundError);
    });

    it('throws ProvisioningError on unexpected failure', async () => {
      dokployService.destroyClientContainer.mockRejectedValue(new Error('Permission denied'));

      await expect(service.deprovisionClient('client-001')).rejects.toThrow(ProvisioningError);
    });

    it('logs deprovision request', async () => {
      dokployService.destroyClientContainer.mockResolvedValue(undefined);

      await service.deprovisionClient('client-001');

      expect(logger.info).toHaveBeenCalledWith(
        'Deprovisioning client',
        expect.objectContaining({ component: 'provisioning-service', clientId: 'client-001' }),
      );
    });
  });

  // ─── getClientStatus ───────────────────────────────────────

  describe('getClientStatus', () => {
    it('returns container status from dokploy service', async () => {
      const status = {
        clientId: 'client-001',
        containerId: 'abc123',
        status: 'running' as const,
        uptime: 3600,
      };
      dokployService.getContainerStatus.mockResolvedValue(status);

      const result = await service.getClientStatus('client-001');

      expect(result).toEqual(status);
    });

    it('throws ClientNotFoundError when container not found', async () => {
      dokployService.getContainerStatus.mockRejectedValue(
        new Error('Container for client "client-999" not found'),
      );

      await expect(service.getClientStatus('client-999')).rejects.toThrow(ClientNotFoundError);
    });

    it('throws ProvisioningError on unexpected failure', async () => {
      dokployService.getContainerStatus.mockRejectedValue(new Error('Socket timeout'));

      await expect(service.getClientStatus('client-001')).rejects.toThrow(ProvisioningError);
    });
  });
});
