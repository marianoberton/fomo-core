import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '@/api/types.js';
import { sendSuccess, sendError, sendNotFound } from '@/api/error-handler.js';

/** Schema for creating a project-scoped API key. */
const createProjectKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(['*']),
  expiresAt: z.string().datetime().optional(),
});

/** Schema for creating a master key. */
const createMasterKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(['*']),
  expiresAt: z.string().datetime().optional(),
});

/**
 * API key management routes.
 *
 * Provides CRUD endpoints for creating, listing, and revoking API keys.
 * Project-scoped keys are restricted to their project.
 * Master keys (projectId === null) require admin access.
 */
export function apiKeyRoutes(
  fastify: FastifyInstance,
  deps: Pick<RouteDependencies, 'apiKeyService' | 'logger'>,
): void {
  const { apiKeyService, logger } = deps;

  /**
   * Verify that the caller has access to a project.
   * Returns true if:
   *   - Caller has a master key (request.apiKeyProjectId === null)
   *   - Caller has a project-scoped key for this project
   *   - Caller has undefined projectId (env-var auth or disabled — treated as full access for backward compat)
   */
  function hasProjectAccess(
    callerProjectId: string | null | undefined,
    targetProjectId: string,
  ): boolean {
    // undefined = env-var path or auth disabled → full access
    if (callerProjectId === undefined) return true;
    // null = master key → full access
    if (callerProjectId === null) return true;
    // string = project-scoped key → must match project
    return callerProjectId === targetProjectId;
  }

  /**
   * Verify that the caller is a master key holder.
   * Returns true if:
   *   - Caller has a master key (request.apiKeyProjectId === null)
   *   - Caller has undefined projectId (env-var auth or disabled — treated as full access for backward compat)
   */
  function isMasterKeyHolder(callerProjectId: string | null | undefined): boolean {
    // undefined = env-var path or auth disabled → full access
    if (callerProjectId === undefined) return true;
    // null = master key
    return callerProjectId === null;
  }

  /**
   * POST /projects/:projectId/api-keys
   * Create a new API key for the project.
   * Requires: master key OR project-scoped key for the same project.
   */
  fastify.post(
    '/projects/:projectId/api-keys',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { projectId } = request.params as { projectId: string };

      // Check project access
      if (!hasProjectAccess(request.apiKeyProjectId, projectId)) {
        await sendError(reply, 'FORBIDDEN', 'You do not have access to this project', 403);
        return;
      }

      // Validate body
      const bodyResult = createProjectKeySchema.safeParse(request.body);
      if (!bodyResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400);
        return;
      }

      const { name, scopes, expiresAt } = bodyResult.data;

      const { plaintext, meta } = await apiKeyService.generateApiKey({
        projectId,
        scopes,
        name,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      logger.info('API key created for project', {
        component: 'api-keys',
        projectId,
        name,
      });

      await sendSuccess(
        reply,
        {
          ...meta,
          plaintext, // Only time the plaintext is exposed
        },
        201,
      );
      return;
    },
  );

  /**
   * GET /projects/:projectId/api-keys
   * List all API keys for the project.
   * Requires: master key OR project-scoped key for the same project.
   */
  fastify.get(
    '/projects/:projectId/api-keys',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { projectId } = request.params as { projectId: string };

      // Check project access
      if (!hasProjectAccess(request.apiKeyProjectId, projectId)) {
        await sendError(reply, 'FORBIDDEN', 'You do not have access to this project', 403);
        return;
      }

      const keys = await apiKeyService.listApiKeys(projectId);

      await sendSuccess(reply, { keys });
      return;
    },
  );

  /**
   * DELETE /projects/:projectId/api-keys/:id
   * Revoke an API key.
   * Requires: master key OR project-scoped key for the same project.
   */
  fastify.delete(
    '/projects/:projectId/api-keys/:id',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { projectId, id } = request.params as { projectId: string; id: string };

      // Check project access
      if (!hasProjectAccess(request.apiKeyProjectId, projectId)) {
        await sendError(reply, 'FORBIDDEN', 'You do not have access to this project', 403);
        return;
      }

      const revoked = await apiKeyService.revokeApiKey(id);
      if (!revoked) {
        await sendNotFound(reply, 'API key', id);
        return;
      }

      logger.info('API key revoked', {
        component: 'api-keys',
        projectId,
        apiKeyId: id,
      });

      await sendSuccess(reply, { success: true });
      return;
    },
  );

  /**
   * POST /api-keys
   * Create a new master API key.
   * Requires: master key holder only.
   */
  fastify.post(
    '/api-keys',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Only master keys can create master keys
      if (!isMasterKeyHolder(request.apiKeyProjectId)) {
        await sendError(
          reply,
          'FORBIDDEN',
          'Master key required for this operation',
          403,
        );
        return;
      }

      // Validate body
      const bodyResult = createMasterKeySchema.safeParse(request.body);
      if (!bodyResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400);
        return;
      }

      const { name, scopes, expiresAt } = bodyResult.data;

      const { plaintext, meta } = await apiKeyService.generateApiKey({
        scopes,
        name,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      logger.info('Master API key created', {
        component: 'api-keys',
        name,
      });

      await sendSuccess(
        reply,
        {
          ...meta,
          plaintext, // Only time the plaintext is exposed
        },
        201,
      );
      return;
    },
  );

  /**
   * GET /api-keys
   * List all API keys (master and project-scoped).
   * Requires: master key holder only.
   */
  fastify.get(
    '/api-keys',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Only master keys can list all keys
      if (!isMasterKeyHolder(request.apiKeyProjectId)) {
        await sendError(
          reply,
          'FORBIDDEN',
          'Master key required for this operation',
          403,
        );
        return;
      }

      const keys = await apiKeyService.listApiKeys();

      await sendSuccess(reply, { keys });
      return;
    },
  );
}
