/**
 * Webhook routes — health check endpoint.
 *
 * Channel-specific webhook routes have been replaced by dynamic routes:
 *   POST /webhooks/:provider/:integrationId  (channel-webhooks.ts)
 *   GET  /webhooks/:provider/:integrationId/verify
 *
 * Chatwoot retains its dedicated routes at /webhooks/chatwoot (chatwoot-webhook.ts).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';

// ─── Route Registration ─────────────────────────────────────────

export function webhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  void deps; // deps kept for consistent route signature

  // ─── Health Check for Channels ──────────────────────────────────

  fastify.get('/webhooks/health', (_request, reply: FastifyReply) => {
    return reply.send({
      dynamic: true,
      message: 'Channel webhooks are per-project. Use /projects/:projectId/integrations/:id/health for per-integration health.',
      timestamp: new Date().toISOString(),
    });
  });
}
