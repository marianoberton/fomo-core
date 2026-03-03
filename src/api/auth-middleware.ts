/**
 * API Key authentication middleware for Nexus Core.
 *
 * Protects all /api/v1/* endpoints with a Bearer token.
 *
 * EXEMPT routes (they carry their own auth — HMAC signatures, Telegram tokens, etc.):
 *   - /api/v1/webhooks/*    (channel webhooks, Chatwoot, Telegram approval)
 *
 * Configuration:
 *   NEXUS_API_KEY env var — if absent, auth is DISABLED with a loud warning.
 *   Set on both sides:
 *     - fomo-core .env:             NEXUS_API_KEY=<token>
 *     - marketpaper-demo .env:      FOMO_API_KEY=<same token>
 *
 * Token format: any secure random string ≥ 32 chars.
 * Recommended: `openssl rand -hex 32`
 */
import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '@/observability/logger.js';

/** Paths (without /api/v1 prefix) that skip API key validation. */
const WEBHOOK_PREFIX = '/api/v1/webhooks/';

/**
 * Register the Bearer-token auth hook on the given Fastify scope.
 * Must be called inside the /api/v1 prefixed plugin — BEFORE routes are registered.
 *
 * @param fastify  The prefixed Fastify scope (routes live under /api/v1).
 * @param apiKey   Value of NEXUS_API_KEY env var. Empty string = auth disabled.
 * @param logger   Pino logger instance.
 */
export function registerAuthMiddleware(
  fastify: FastifyInstance,
  apiKey: string,
  logger: Logger,
): void {
  if (!apiKey) {
    logger.warn(
      'NEXUS_API_KEY is not set — API is open to unauthenticated requests. ' +
      'Set NEXUS_API_KEY in .env to secure the server.',
      { component: 'auth-middleware' },
    );
    // Do not register the hook — allow all requests (backward compat).
    return;
  }

  logger.info('API key authentication enabled for /api/v1/* (webhooks exempt)', {
    component: 'auth-middleware',
  });

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const pathname = request.url.split('?')[0] ?? '';

      // Webhooks carry their own HMAC / provider-specific auth — skip Bearer check.
      if (pathname.startsWith(WEBHOOK_PREFIX)) {
        return;
      }

      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        await reply.code(401).send({ error: 'Missing Authorization header' });
        return;
      }

      // Expect: "Bearer <token>"
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
        await reply.code(401).send({ error: 'Invalid Authorization format — expected: Bearer <token>' });
        return;
      }

      const token = parts[1];
      if (!token || !timingSafeEqual(token, apiKey)) {
        logger.warn('Rejected request with invalid API key', {
          component: 'auth-middleware',
          url: pathname,
          ip: request.ip,
        });
        await reply.code(401).send({ error: 'Invalid API key' });
        return;
      }
    },
  );
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings are padded to the same length before comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Use Node's built-in crypto.timingSafeEqual on Buffer representations.
  // If lengths differ the comparison still runs on the padded version,
  // but we track the mismatch separately to avoid short-circuit leaks.
  const aLen = a.length;
  const bLen = b.length;
  const maxLen = Math.max(aLen, bLen);

  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);

  // timingSafeEqual requires equal-length buffers.
  const equal = cryptoTimingSafeEqual(aBuf, bBuf);
  // Even if byte content matches, different lengths mean different tokens.
  return equal && aLen === bLen;
}
