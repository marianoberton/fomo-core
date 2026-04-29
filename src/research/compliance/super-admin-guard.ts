/**
 * Fastify preHandler that gates research routes to super_admin callers.
 *
 * Resolution order (first match wins):
 *   1. Master API key (`apiKeyProjectId === null`)  → bypass.
 *   2. `x-user-email` header ∈ SUPER_ADMIN_EMAILS    → bypass, attach email.
 *   3. Anything else                                 → 403 NOT_SUPER_ADMIN.
 *
 * Also rejects all requests when RESEARCH_MODULE_ENABLED is false
 * (returns 404 to hide the module's existence).
 *
 * NOTE: research routes have no `:projectId` (the module is global), so
 * `requireProjectRole` is not a fit — this guard takes its place.
 * Documented as outstanding RBAC tech debt in `RBAC_DEBT.md`.
 */
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { Logger } from '@/observability/logger.js';
import { getSuperAdminEmails, isResearchModuleEnabled } from './feature-flag.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Email of the authenticated super_admin (if resolved by guard). */
    superAdminEmail?: string;
  }
}

export interface RequireSuperAdminDeps {
  logger: Logger;
}

/**
 * Build a Fastify preHandler enforcing super_admin access for every
 * request flowing through it. Apply at the plugin scope that registers
 * `/research/*` routes, NOT per-route (avoid hook bleed — see CLAUDE.md).
 */
export function requireSuperAdmin(deps: RequireSuperAdminDeps): preHandlerHookHandler {
  const { logger } = deps;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // (0) Module-wide kill switch.
    if (!isResearchModuleEnabled()) {
      await reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
      });
      return;
    }

    // (1) Master API key — full access.
    if (request.apiKeyProjectId === null) {
      return;
    }

    // (2) x-user-email header — must match SUPER_ADMIN_EMAILS allowlist.
    const rawEmail = request.headers['x-user-email'];
    const email = (Array.isArray(rawEmail) ? rawEmail[0] : rawEmail)?.trim().toLowerCase();
    if (email && getSuperAdminEmails().includes(email)) {
      request.superAdminEmail = email;
      return;
    }

    // (3) Reject.
    logger.warn('research: super_admin guard rejected request', {
      component: 'research-compliance',
      url: request.url,
      hasMasterKey: request.apiKeyProjectId === null,
      hasEmail: Boolean(email),
      ip: request.ip,
    });
    await reply.code(403).send({
      success: false,
      error: {
        code: 'NOT_SUPER_ADMIN',
        message: 'Research module requires super_admin access',
      },
    });
  };
}
