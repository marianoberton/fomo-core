/**
 * Tests for the Dokploy service.
 * Mocks the global fetch to simulate Dokploy API responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDokployService } from '@/provisioning/dokploy-service.js';
import type { DokployService } from '@/provisioning/dokploy-service.js';
import type { Logger } from '@/observability/logger.js';

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

const DOKPLOY_URL = 'https://panel.fomo.com.ar';
const DOKPLOY_API_KEY = 'test-api-key';
const DOKPLOY_PROJECT_ID = 'FB8vO-CROjg6mBFpnsuyU';

// ─── Tests ──────────────────────────────────────────────────────

describe('DokployService', () => {
  let service: DokployService;
  let logger: Logger;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = createDokployService({
      logger,
      dokployUrl: DOKPLOY_URL,
      dokployApiKey: DOKPLOY_API_KEY,
      dokployProjectId: DOKPLOY_PROJECT_ID,
    });
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

    it('creates, configures, and deploys application successfully', async () => {
      // Mock 4 sequential API calls: create, saveBuildType, saveEnvironment, deploy
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            0: { result: { data: { applicationId: 'app-abc123', appName: 'fomo-client-client-001' } } },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 0: { result: { data: {} } } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 0: { result: { data: {} } } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 0: { result: { data: {} } } }),
        });

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(true);
      expect(result.containerId).toBe('app-abc123');
      expect(result.containerName).toBe('fomo-client-client-001');

      // Verify all 4 API calls were made
      expect(fetchMock).toHaveBeenCalledTimes(4);

      // Verify auth header on first call
      const firstCallArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(firstCallArgs[0]).toBe(`${DOKPLOY_URL}/api/trpc/application.create?batch=1`);
      expect((firstCallArgs[1].headers as Record<string, string>)['x-api-key']).toBe(DOKPLOY_API_KEY);
    });

    it('returns failure when Dokploy API returns error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(result.containerName).toBe('fomo-client-client-001');
    });

    it('returns failure on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.createClientContainer(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('logs container creation', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            0: { result: { data: { applicationId: 'app-abc123', appName: 'fomo-client-client-001' } } },
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ 0: { result: { data: {} } } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ 0: { result: { data: {} } } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ 0: { result: { data: {} } } }) });

      await service.createClientContainer(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating client application via Dokploy',
        expect.objectContaining({ component: 'dokploy-service', clientId: 'client-001' }),
      );
    });
  });

  // ─── destroyClientContainer ────────────────────────────────

  describe('destroyClientContainer', () => {
    it('finds and deletes application successfully', async () => {
      // Mock project.all to find the app
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            {
              projectId: DOKPLOY_PROJECT_ID,
              name: 'Tools',
              applications: [
                { applicationId: 'app-abc123', appName: 'fomo-client-client-001', name: 'fomo-client-client-001', applicationStatus: 'done', createdAt: new Date().toISOString() },
              ],
            },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 0: { result: { data: {} } } }),
        });

      await expect(service.destroyClientContainer('client-001')).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when application not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            projectId: DOKPLOY_PROJECT_ID,
            name: 'Tools',
            applications: [],
          },
        ]),
      });

      await expect(service.destroyClientContainer('client-999')).rejects.toThrow('not found');
    });
  });

  // ─── getContainerStatus ────────────────────────────────────

  describe('getContainerStatus', () => {
    it('returns running status', async () => {
      const createdAt = new Date(Date.now() - 3600_000).toISOString();

      // Mock project.all to find the app
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            {
              projectId: DOKPLOY_PROJECT_ID,
              name: 'Tools',
              applications: [
                { applicationId: 'app-abc123', appName: 'fomo-client-client-001', name: 'fomo-client-client-001', applicationStatus: 'done', createdAt },
              ],
            },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            0: {
              result: {
                data: { applicationId: 'app-abc123', appName: 'fomo-client-client-001', applicationStatus: 'done', createdAt },
              },
            },
          }),
        });

      const status = await service.getContainerStatus('client-001');

      expect(status.clientId).toBe('client-001');
      expect(status.containerId).toBe('app-abc123');
      expect(status.status).toBe('running');
      expect(status.uptime).toBeGreaterThanOrEqual(3599);
    });

    it('returns stopped status when idle', async () => {
      const createdAt = new Date().toISOString();

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            {
              projectId: DOKPLOY_PROJECT_ID,
              name: 'Tools',
              applications: [
                { applicationId: 'app-abc123', appName: 'fomo-client-client-001', name: 'fomo-client-client-001', applicationStatus: 'idle', createdAt },
              ],
            },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            0: {
              result: {
                data: { applicationId: 'app-abc123', appName: 'fomo-client-client-001', applicationStatus: 'idle', createdAt },
              },
            },
          }),
        });

      const status = await service.getContainerStatus('client-001');

      expect(status.status).toBe('stopped');
      expect(status.uptime).toBeUndefined();
    });

    it('throws when application not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            projectId: DOKPLOY_PROJECT_ID,
            name: 'Tools',
            applications: [],
          },
        ]),
      });

      await expect(service.getContainerStatus('client-999')).rejects.toThrow('not found');
    });
  });

  // ─── listClientContainers ──────────────────────────────────

  describe('listClientContainers', () => {
    it('returns list of managed applications', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            projectId: DOKPLOY_PROJECT_ID,
            name: 'Tools',
            applications: [
              { applicationId: 'app-abc', appName: 'fomo-client-client-001', name: 'fomo-client-client-001', applicationStatus: 'done', createdAt: new Date().toISOString() },
              { applicationId: 'app-def', appName: 'fomo-client-client-002', name: 'fomo-client-client-002', applicationStatus: 'error', createdAt: new Date().toISOString() },
              { applicationId: 'app-xyz', appName: 'other-app', name: 'other-app', applicationStatus: 'done', createdAt: new Date().toISOString() },
            ],
          },
        ]),
      });

      const containers = await service.listClientContainers();

      expect(containers).toHaveLength(2);
      expect(containers[0]?.clientId).toBe('client-001');
      expect(containers[0]?.status).toBe('running');
      expect(containers[1]?.clientId).toBe('client-002');
      expect(containers[1]?.status).toBe('error');
    });

    it('returns empty array on Dokploy API error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

      const containers = await service.listClientContainers();

      expect(containers).toEqual([]);
    });

    it('returns empty array when project not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { projectId: 'other-project', name: 'Other', applications: [] },
        ]),
      });

      const containers = await service.listClientContainers();

      expect(containers).toEqual([]);
    });
  });
});
