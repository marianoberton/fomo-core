/**
 * Secrets routes — encrypted per-project credential management.
 * Values are NEVER returned in API responses; only metadata (key, description, timestamps).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';

// ─── Request Schemas ─────────────────────────────────────────────

const SetSecretSchema = z.object({
  key: z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/, 'Key must be uppercase alphanumeric + underscore'),
  value: z.string().min(1),
  description: z.string().max(500).optional(),
});

const UpdateSecretSchema = z.object({
  value: z.string().min(1),
  description: z.string().max(500).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export function secretRoutes(fastify: FastifyInstance, deps: RouteDependencies): void {
  const { secretService, logger } = deps;

  // ─── GET /projects/:projectId/secrets ───────────────────────────
  // List all secret keys for a project (no values, ever)

  fastify.get(
    '/projects/:projectId/secrets',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const secrets = await secretService.list(projectId);
      await sendSuccess(reply, secrets);
    },
  );

  // ─── POST /projects/:projectId/secrets ──────────────────────────
  // Create or overwrite a secret

  fastify.post(
    '/projects/:projectId/secrets',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const body = SetSecretSchema.parse(request.body);

      const metadata = await secretService.set(projectId, body.key, body.value, body.description);

      logger.info('Secret set', { component: 'secrets-routes', projectId, key: body.key });
      await sendSuccess(reply, metadata, 201);
    },
  );

  // ─── PUT /projects/:projectId/secrets/:key ──────────────────────
  // Update an existing secret value

  fastify.put(
    '/projects/:projectId/secrets/:key',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, key } = request.params as { projectId: string; key: string };

      const exists = await secretService.exists(projectId, key);
      if (!exists) {
        await sendError(reply, 'SECRET_NOT_FOUND', `Secret "${key}" not found`, 404);
        return;
      }

      const body = UpdateSecretSchema.parse(request.body);
      const metadata = await secretService.set(projectId, key, body.value, body.description);

      logger.info('Secret updated', { component: 'secrets-routes', projectId, key });
      await sendSuccess(reply, metadata);
    },
  );

  // ─── DELETE /projects/:projectId/secrets/:key ───────────────────

  fastify.delete(
    '/projects/:projectId/secrets/:key',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, key } = request.params as { projectId: string; key: string };

      const deleted = await secretService.delete(projectId, key);
      if (!deleted) {
        await sendError(reply, 'SECRET_NOT_FOUND', `Secret "${key}" not found`, 404);
        return;
      }

      logger.info('Secret deleted', { component: 'secrets-routes', projectId, key });
      await sendSuccess(reply, { deleted: true });
    },
  );

  // ─── GET /projects/:projectId/secrets/:key/exists ───────────────
  // Boolean check — safe to call from frontend to verify a key is configured

  fastify.get(
    '/projects/:projectId/secrets/:key/exists',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, key } = request.params as { projectId: string; key: string };
      const exists = await secretService.exists(projectId, key);
      await sendSuccess(reply, { exists });
    },
  );

}
