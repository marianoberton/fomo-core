/**
 * Client Monitor — periodic job that checks provisioned container health
 * and auto-restarts crashed containers (up to 3 attempts).
 */
import type { Logger } from '@/observability/logger.js';
import type { DockerSocketService } from '@/provisioning/docker-socket-service.js';

// ─── Types ──────────────────────────────────────────────────────

export type ContainerEvent =
  | 'container_started'
  | 'container_stopped'
  | 'container_restarted'
  | 'container_failed';

export interface ClientMonitorDeps {
  dockerSocketService: DockerSocketService;
  logger: Logger;
  /** Check interval in milliseconds. Defaults to 30_000. */
  intervalMs?: number;
  /** Max restart attempts per container before giving up. Defaults to 3. */
  maxRestartAttempts?: number;
}

export interface ClientMonitor {
  /** Start the periodic monitoring loop. */
  start(): void;
  /** Stop the monitoring loop. */
  stop(): void;
}

// ─── Factory ────────────────────────────────────────────────────

const COMPONENT = 'client-monitor';

/** Create a client container monitor that checks health every intervalMs. */
export function createClientMonitor(deps: ClientMonitorDeps): ClientMonitor {
  const {
    dockerSocketService,
    logger,
    intervalMs = 30_000,
    maxRestartAttempts = 3,
  } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;

  /** Track restart attempts per clientId. */
  const restartCounts = new Map<string, number>();

  /** Attempt to restart a container by stopping and starting it. */
  async function restartContainer(clientId: string, containerId: string): Promise<boolean> {
    try {
      // Use Docker API directly to restart (via the docker-socket-service's
      // underlying HTTP calls). Since DockerSocketService doesn't expose a
      // restart method, we re-use getContainerStatus after Docker auto-restart
      // policy kicks in, or we do a manual start.
      const http = await import('node:http');
      const result = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            socketPath: '/var/run/docker.sock',
            path: `/containers/${encodeURIComponent(containerId)}/restart?t=10`,
            method: 'POST',
            timeout: 30_000,
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 500));
          },
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('restart timeout')); });
        req.end();
      });

      return result === 204;
    } catch (e) {
      logger.error('Container restart failed', {
        component: COMPONENT,
        clientId,
        containerId,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  /** Single monitoring pass: check all containers and restart downed ones. */
  async function checkContainers(): Promise<void> {
    try {
      const containers = await dockerSocketService.listClientContainers();

      for (const container of containers) {
        if (container.status === 'running') {
          // Reset restart count on healthy containers
          if (restartCounts.has(container.clientId)) {
            restartCounts.delete(container.clientId);
            logger.info('Container recovered', {
              component: COMPONENT,
              clientId: container.clientId,
              event: 'container_started' satisfies ContainerEvent,
            });
          }
          continue;
        }

        // Container is stopped or errored
        logger.warn('Container down', {
          component: COMPONENT,
          clientId: container.clientId,
          containerId: container.containerId,
          containerStatus: container.status,
          event: 'container_stopped' satisfies ContainerEvent,
        });

        const attempts = restartCounts.get(container.clientId) ?? 0;

        if (attempts >= maxRestartAttempts) {
          logger.error('Container exceeded max restart attempts', {
            component: COMPONENT,
            clientId: container.clientId,
            attempts,
            maxRestartAttempts,
            event: 'container_failed' satisfies ContainerEvent,
          });
          continue;
        }

        // Attempt restart
        logger.info('Attempting container restart', {
          component: COMPONENT,
          clientId: container.clientId,
          containerId: container.containerId,
          attempt: attempts + 1,
          maxRestartAttempts,
        });

        const success = await restartContainer(container.clientId, container.containerId);
        restartCounts.set(container.clientId, attempts + 1);

        if (success) {
          logger.info('Container restarted successfully', {
            component: COMPONENT,
            clientId: container.clientId,
            attempt: attempts + 1,
            event: 'container_restarted' satisfies ContainerEvent,
          });
        } else {
          logger.error('Container restart attempt failed', {
            component: COMPONENT,
            clientId: container.clientId,
            attempt: attempts + 1,
            event: 'container_failed' satisfies ContainerEvent,
          });
        }
      }
    } catch (e) {
      logger.error('Client monitor check failed', {
        component: COMPONENT,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    start(): void {
      if (timer) return;
      logger.info('Client monitor started', { component: COMPONENT, intervalMs });
      // Run the first check immediately, then on interval
      void checkContainers();
      timer = setInterval(() => void checkContainers(), intervalMs);
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info('Client monitor stopped', { component: COMPONENT });
      }
    },
  };
}
