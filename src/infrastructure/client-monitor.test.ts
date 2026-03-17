/**
 * Tests for the client container monitor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClientMonitor } from './client-monitor.js';
import type { Logger } from '@/observability/logger.js';
import type { DokployService } from '@/provisioning/dokploy-service.js';

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

function createMockDokployService(): DokployService {
  return {
    createClientContainer: vi.fn(),
    destroyClientContainer: vi.fn(),
    getContainerStatus: vi.fn(),
    listClientContainers: vi.fn().mockResolvedValue([]),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('createClientMonitor', () => {
  let logger: Logger;
  let dokployService: DokployService;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createMockLogger();
    dokployService = createMockDokployService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and stops without errors', () => {
    const monitor = createClientMonitor({
      dokployService,
      logger,
      intervalMs: 5000,
    });

    monitor.start();
    expect(logger.info).toHaveBeenCalledWith(
      'Client monitor started',
      expect.objectContaining({ component: 'client-monitor' }),
    );

    monitor.stop();
    expect(logger.info).toHaveBeenCalledWith(
      'Client monitor stopped',
      expect.objectContaining({ component: 'client-monitor' }),
    );
  });

  it('calls listClientContainers on each tick', async () => {
    vi.mocked(dokployService.listClientContainers).mockResolvedValue([
      { clientId: 'c1', containerId: 'id1', status: 'running', uptime: 100 },
    ]);

    const monitor = createClientMonitor({
      dokployService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();

    // First call happens immediately on start
    await vi.advanceTimersByTimeAsync(0);
    expect(dokployService.listClientContainers).toHaveBeenCalledTimes(1);

    // Second call after interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(dokployService.listClientContainers).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it('logs warning when a container is stopped', async () => {
    vi.mocked(dokployService.listClientContainers).mockResolvedValue([
      { clientId: 'c1', containerId: 'id1', status: 'stopped', uptime: undefined },
    ]);

    const monitor = createClientMonitor({
      dokployService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledWith(
      'Container down',
      expect.objectContaining({
        component: 'client-monitor',
        clientId: 'c1',
        event: 'container_stopped',
      }),
    );

    monitor.stop();
  });

  it('does not exceed max restart attempts', async () => {
    vi.mocked(dokployService.listClientContainers).mockResolvedValue([
      { clientId: 'c1', containerId: 'id1', status: 'stopped', uptime: undefined },
    ]);

    const monitor = createClientMonitor({
      dokployService,
      logger,
      intervalMs: 1000,
      maxRestartAttempts: 2,
    });

    monitor.start();

    // Tick 1 — first attempt logged
    await vi.advanceTimersByTimeAsync(0);

    // Tick 2 — second attempt logged
    await vi.advanceTimersByTimeAsync(1000);

    // Tick 3 — should hit max attempts, log error instead of trying again
    await vi.advanceTimersByTimeAsync(1000);

    expect(logger.error).toHaveBeenCalledWith(
      'Container exceeded max restart attempts',
      expect.objectContaining({
        component: 'client-monitor',
        clientId: 'c1',
        event: 'container_failed',
      }),
    );

    monitor.stop();
  });

  it('handles dokploy service errors gracefully', async () => {
    vi.mocked(dokployService.listClientContainers).mockRejectedValue(
      new Error('Dokploy API unavailable'),
    );

    const monitor = createClientMonitor({
      dokployService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith(
      'Client monitor check failed',
      expect.objectContaining({
        component: 'client-monitor',
        error: 'Dokploy API unavailable',
      }),
    );

    monitor.stop();
  });

  it('does not start twice', () => {
    const monitor = createClientMonitor({
      dokployService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();
    monitor.start(); // Should be a no-op

    // listClientContainers called only once (from first start)
    expect(dokployService.listClientContainers).toHaveBeenCalledTimes(1);

    monitor.stop();
  });
});
