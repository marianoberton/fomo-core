/**
 * Provisioning routes — container lifecycle endpoints for client provisioning.
 *
 * POST   /api/v1/provisioning/create            — provision a new client container
 * DELETE /api/v1/provisioning/:clientId          — deprovision a client container
 * GET    /api/v1/provisioning/:clientId/status   — get client container status
 * GET    /api/v1/provisioning                    — list all client containers
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '@/observability/logger.js';
import type { ProvisioningService } from '@/provisioning/provisioning-service.js';
import type { DokployService } from '@/provisioning/dokploy-service.js';
import { CreateClientRequestSchema } from '@/provisioning/provisioning-types.js';
import { sendSuccess, sendError } from '../error-handler.js';

// ─── Route Dependencies ─────────────────────────────────────────

/** Dependencies for provisioning routes. */
export interface ProvisioningRouteDeps {
  provisioningService: ProvisioningService;
  dokployService: DokployService;
  logger: Logger;
}

// ─── Routes ─────────────────────────────────────────────────────

/** Register provisioning routes on a Fastify instance. */
export function provisioningRoutes(
  fastify: FastifyInstance,
  deps: ProvisioningRouteDeps,
): void {
  const { provisioningService, dokployService, logger } = deps;

  // ─── POST /api/v1/provisioning/create ───────────────────────
  fastify.post(
    '/api/v1/provisioning/create',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateClientRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400, {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
        return;
      }

      logger.info('Provisioning request received', {
        component: 'provisioning-routes',
        clientId: parsed.data.clientId,
      });

      const result = await provisioningService.provisionClient(parsed.data);
      await sendSuccess(reply, result, 201);
    },
  );

  // ─── DELETE /api/v1/provisioning/:clientId ──────────────────
  fastify.delete<{ Params: { clientId: string } }>(
    '/api/v1/provisioning/:clientId',
    async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
      const { clientId } = request.params;

      logger.info('Deprovision request received', {
        component: 'provisioning-routes',
        clientId,
      });

      await provisioningService.deprovisionClient(clientId);
      await sendSuccess(reply, { deleted: true });
    },
  );

  // ─── GET /api/v1/provisioning/:clientId/status ──────────────
  fastify.get<{ Params: { clientId: string } }>(
    '/api/v1/provisioning/:clientId/status',
    async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
      const { clientId } = request.params;

      const status = await provisioningService.getClientStatus(clientId);
      await sendSuccess(reply, status);
    },
  );

  // ─── GET /api/v1/provisioning ─────────────────────────────────
  fastify.get(
    '/api/v1/provisioning',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const containers = await dokployService.listClientContainers();
      await sendSuccess(reply, containers);
    },
  );
}
