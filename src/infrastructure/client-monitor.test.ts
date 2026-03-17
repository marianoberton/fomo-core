/**
 * Tests for the client container monitor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClientMonitor } from './client-monitor.js';
import type { Logger } from '@/observability/logger.js';
import type { DockerSocketService } from '@/provisioning/docker-socket-service.js';

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

function createMockDockerSocketService(): DockerSocketService {
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
  let dockerSocketService: DockerSocketService;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createMockLogger();
    dockerSocketService = createMockDockerSocketService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and stops without errors', () => {
    const monitor = createClientMonitor({
      dockerSocketService,
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
    vi.mocked(dockerSocketService.listClientContainers).mockResolvedValue([
      { clientId: 'c1', containerId: 'id1', status: 'running', uptime: 100 },
    ]);

    const monitor = createClientMonitor({
      dockerSocketService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();

    // First call happens immediately on start
    await vi.advanceTimersByTimeAsync(0);
    expect(dockerSocketService.listClientContainers).toHaveBeenCalledTimes(1);

    // Second call after interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(dockerSocketService.listClientContainers).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it('logs warning when a container is stopped', async () => {
    vi.mocked(dockerSocketService.listClientContainers).mockResolvedValue([
      { clientId: 'c1', containerId: 'id1', status: 'stopped', uptime: undefined },
    ]);

    const monitor = createClientMonitor({
      dockerSocketService,
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
    vi.mocked(dockerSocketService.listClientContainers).mockResolvedValue([
      { clientId: 'c1', containerId: 'id1', status: 'stopped', uptime: undefined },
    ]);

    const monitor = createClientMonitor({
      dockerSocketService,
      logger,
      intervalMs: 1000,
      maxRestartAttempts: 2,
    });

    monitor.start();

    // Tick 1 — first restart attempt
    await vi.advanceTimersByTimeAsync(0);

    // Tick 2 — second restart attempt
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

  it('handles docker service errors gracefully', async () => {
    vi.mocked(dockerSocketService.listClientContainers).mockRejectedValue(
      new Error('Docker socket unavailable'),
    );

    const monitor = createClientMonitor({
      dockerSocketService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith(
      'Client monitor check failed',
      expect.objectContaining({
        component: 'client-monitor',
        error: 'Docker socket unavailable',
      }),
    );

    monitor.stop();
  });

  it('does not start twice', () => {
    const monitor = createClientMonitor({
      dockerSocketService,
      logger,
      intervalMs: 1000,
    });

    monitor.start();
    monitor.start(); // Should be a no-op

    // listClientContainers called only once (from first start)
    expect(dockerSocketService.listClientContainers).toHaveBeenCalledTimes(1);

    monitor.stop();
  });
});
