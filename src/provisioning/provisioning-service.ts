/**
 * Provisioning Service — orchestrator for client container lifecycle.
 * Wraps DokployService with validation, logging, and error handling.
 */
import { NexusError } from '@/core/errors.js';
import type { Logger } from '@/observability/logger.js';
import type { DokployService } from './dokploy-service.js';
import { CreateClientRequestSchema } from './provisioning-types.js';
import type {
  CreateClientRequest,
  ProvisioningResult,
  ClientContainerStatus,
} from './provisioning-types.js';

// ─── Errors ─────────────────────────────────────────────────────

/** Thrown when a provisioning operation fails. */
export class ProvisioningError extends NexusError {
  constructor(message: string, clientId: string, cause?: Error) {
    super({
      message: `Provisioning failed for client "${clientId}": ${message}`,
      code: 'PROVISIONING_ERROR',
      statusCode: 500,
      cause,
      context: { clientId },
    });
    this.name = 'ProvisioningError';
  }
}

/** Thrown when a client container is not found. */
export class ClientNotFoundError extends NexusError {
  constructor(clientId: string) {
    super({
      message: `Client container "${clientId}" not found`,
      code: 'CLIENT_NOT_FOUND',
      statusCode: 404,
      context: { clientId },
    });
    this.name = 'ClientNotFoundError';
  }
}

// ─── Service Interface ──────────────────────────────────────────

/** High-level provisioning orchestrator. */
export interface ProvisioningService {
  /** Provision a new client: validate input, create container, start it. */
  provisionClient(req: CreateClientRequest): Promise<ProvisioningResult>;
  /** Tear down a client's container entirely. */
  deprovisionClient(clientId: string): Promise<void>;
  /** Get the runtime status of a client's container. */
  getClientStatus(clientId: string): Promise<ClientContainerStatus>;
}

// ─── Dependencies ───────────────────────────────────────────────

/** Dependencies for the provisioning orchestrator. */
export interface ProvisioningServiceDeps {
  dokployService: DokployService;
  logger: Logger;
}

// ─── Service Factory ────────────────────────────────────────────

/** Create the provisioning orchestrator service. */
export function createProvisioningService(deps: ProvisioningServiceDeps): ProvisioningService {
  const { dokployService, logger } = deps;
  const COMPONENT = 'provisioning-service';

  return {
    async provisionClient(req: CreateClientRequest): Promise<ProvisioningResult> {
      // Validate input
      const parsed = CreateClientRequestSchema.safeParse(req);
      if (!parsed.success) {
        logger.warn('Invalid provisioning request', {
          component: COMPONENT,
          clientId: req.clientId,
          issues: parsed.error.issues,
        });
        throw new ProvisioningError(
          `Validation failed: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
          req.clientId,
        );
      }

      logger.info('Provisioning client', {
        component: COMPONENT,
        clientId: req.clientId,
        clientName: req.clientName,
        channels: req.channels,
      });

      try {
        const result = await dokployService.createClientContainer(parsed.data);

        if (!result.success) {
          throw new ProvisioningError(result.error ?? 'Unknown Dokploy error', req.clientId);
        }

        logger.info('Client provisioned successfully', {
          component: COMPONENT,
          clientId: req.clientId,
          containerId: result.containerId,
          containerName: result.containerName,
        });

        return result;
      } catch (err) {
        if (err instanceof NexusError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new ProvisioningError(message, req.clientId, err instanceof Error ? err : undefined);
      }
    },

    async deprovisionClient(clientId: string): Promise<void> {
      logger.info('Deprovisioning client', { component: COMPONENT, clientId });

      try {
        await dokployService.destroyClientContainer(clientId);
        logger.info('Client deprovisioned successfully', { component: COMPONENT, clientId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found')) {
          throw new ClientNotFoundError(clientId);
        }
        throw new ProvisioningError(message, clientId, err instanceof Error ? err : undefined);
      }
    },

    async getClientStatus(clientId: string): Promise<ClientContainerStatus> {
      logger.debug('Getting client status', { component: COMPONENT, clientId });

      try {
        return await dokployService.getContainerStatus(clientId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found')) {
          throw new ClientNotFoundError(clientId);
        }
        throw new ProvisioningError(message, clientId, err instanceof Error ? err : undefined);
      }
    },
  };
}
