/**
 * Client Monitor — periodic job that checks provisioned application health
 * and logs status of downed applications.
 */
import type { Logger } from '@/observability/logger.js';
import type { DokployService } from '@/provisioning/dokploy-service.js';

// ─── Types ──────────────────────────────────────────────────────

export type ContainerEvent =
  | 'container_started'
  | 'container_stopped'
  | 'container_restarted'
  | 'container_failed';

export interface ClientMonitorDeps {
  dokployService: DokployService;
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
    dokployService,
    logger,
    intervalMs = 30_000,
    maxRestartAttempts = 3,
  } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;

  /** Track restart attempts per clientId. */
  const restartCounts = new Map<string, number>();

  /** Single monitoring pass: check all containers and log downed ones. */
  async function checkContainers(): Promise<void> {
    try {
      const containers = await dokployService.listClientContainers();

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

        restartCounts.set(container.clientId, attempts + 1);

        logger.warn('Application down — manual redeploy may be needed', {
          component: COMPONENT,
          clientId: container.clientId,
          containerId: container.containerId,
          attempt: attempts + 1,
          maxRestartAttempts,
          event: 'container_failed' satisfies ContainerEvent,
        });
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
