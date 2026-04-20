/**
 * Admin authentication guard.
 *
 * Ensures the request is authenticated with a master API key
 * (projectId === null). Project-scoped keys get 403.
 *
 * Usage in route:
 *   fastify.addHook('preHandler', createAdminAuthHook(deps.apiKeyService));
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ApiKeyService } from '@/security/api-key-service.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'admin-auth' });

/** Validated admin auth info attached to the request. */
export interface AdminAuthInfo {
  keyId: string;
  actor: string;
}

/** Augment Fastify request with admin auth. */
declare module 'fastify' {
  interface FastifyRequest {
    adminAuth?: AdminAuthInfo;
  }
}

/**
 * Create a Fastify preHandler hook that validates master-key auth.
 *
 * Extracts the Bearer token, validates it via ApiKeyService,
 * and rejects project-scoped keys with 403.
 */
export function createAdminAuthHook(
  apiKeyService: ApiKeyService,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn('Admin request without Bearer token', { component: 'admin-auth' });
      await reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Bearer token required' },
      });
      return;
    }

    const token = authHeader.slice(7);

    try {
      const validation = await apiKeyService.validateApiKey(token);

      if (!validation.valid) {
        logger.warn('Admin request with invalid key', { component: 'admin-auth' });
        await reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
        });
        return;
      }

      // Master keys have projectId === null
      if (validation.projectId !== null) {
        logger.warn('Admin request with project-scoped key', {
          component: 'admin-auth',
          projectId: validation.projectId,
        });
        await reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Admin endpoints require a master API key (not project-scoped)',
          },
        });
        return;
      }

      // Attach admin auth info to request
      request.adminAuth = {
        keyId: 'master',
        actor: 'admin',
      };
    } catch (e) {
      logger.error('Admin auth error', {
        component: 'admin-auth',
        error: e instanceof Error ? e.message : String(e),
      });
      await reply.status(500).send({
        success: false,
        error: { code: 'AUTH_ERROR', message: 'Authentication check failed' },
      });
    }
  };
}
