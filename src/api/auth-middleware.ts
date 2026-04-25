/**
 * API Key authentication middleware for Nexus Core.
 *
 * Protects all /api/v1/* endpoints with a Bearer token.
 *
 * EXEMPT routes (they carry their own auth — HMAC signatures, Telegram tokens, etc.):
 *   - /api/v1/webhooks/*    (channel webhooks, Chatwoot, Telegram approval)
 *   - /api/v1/ws            (WebSocket — browsers cannot send Authorization headers on upgrade)
 *
 * Configuration:
 *   NEXUS_API_KEY env var — if absent, DB-backed keys only OR auth is DISABLED with a loud warning.
 *   Set on both sides:
 *     - fomo-core .env:             NEXUS_API_KEY=<token>
 *     - marketpaper-demo .env:      FOMO_API_KEY=<same token>
 *
 * Token format: any secure random string ≥ 32 chars.
 * Recommended: `openssl rand -hex 32`
 *
 * AUTHENTICATION FLOW:
 * 1. If apiKeyService provided → validate against DB (per-project keys)
 * 2. Else if NEXUS_API_KEY env var set → validate against static key (backward compat)
 * 3. Else → auth disabled (backward compat)
 *
 * On successful auth, sets request.apiKeyProjectId:
 *   - null  = master key (full access)
 *   - string = project-scoped (access restricted to that project)
 */
import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { ProjectRole } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApiKeyService } from '@/security/api-key-service.js';
import type { MemberRepository } from '@/infrastructure/repositories/member-repository.js';
import { requireProjectAccess, requireScope } from './project-access.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The projectId bound to the API key used for this request.
     * - null = authenticated via master key or env-var key (full access)
     * - string = authenticated via project-scoped key (access restricted to that project)
     * - undefined = auth was skipped (env-var path unavailable or auth disabled)
     */
    apiKeyProjectId?: string | null;
    /**
     * Scopes granted by the API key (e.g. ["*"], ["chat"], ["read"]).
     * "*" = full access.  Empty array or undefined = no scope filtering.
     */
    apiKeyScopes?: string[];
    /**
     * Resolved ProjectMember role for the current (projectId, x-user-email) pair.
     * Populated by `requireProjectRole` — used by handlers that need to
     * branch on role beyond a simple pass/fail.
     */
    projectRole?: ProjectRole;
  }
}

/** Path prefixes/exact paths that skip API key validation. */
const WEBHOOK_PREFIX = '/api/v1/webhooks/';
const WS_PATH = '/api/v1/ws';
/** Project live-events WS — auth handled inside the handler via query/header. */
const WS_PROJECT_PREFIX = '/api/v1/ws/project/';

/**
 * Register the Bearer-token auth hook on the given Fastify scope.
 * Must be called inside the /api/v1 prefixed plugin — BEFORE routes are registered.
 *
 * @param fastify  The prefixed Fastify scope (routes live under /api/v1).
 * @param apiKey   Value of NEXUS_API_KEY env var. Empty string = fall back to DB or disabled.
 * @param logger   Pino logger instance.
 * @param apiKeyService Optional DB-backed API key validator. If provided, DB keys are tried first.
 */
export function registerAuthMiddleware(
  fastify: FastifyInstance,
  apiKey: string,
  logger: Logger,
  apiKeyService?: ApiKeyService,
): void {
  const authEnabled = apiKey || apiKeyService;

  if (!authEnabled) {
    logger.warn(
      'NEXUS_API_KEY is not set and apiKeyService not provided — API is open to unauthenticated requests. ' +
      'Set NEXUS_API_KEY in .env or provide apiKeyService to secure the server.',
      { component: 'auth-middleware' },
    );
    // Do not register the hook — allow all requests (backward compat).
    return;
  }

  logger.info('API key authentication enabled for /api/v1/* (webhooks + ws exempt)', {
    component: 'auth-middleware',
  });

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const pathname = request.url.split('?')[0] ?? '';

      // Webhooks carry their own HMAC / provider-specific auth — skip Bearer check.
      // WebSocket upgrade requests also skip: browsers cannot send Authorization on WS handshake.
      if (
        pathname.startsWith(WEBHOOK_PREFIX) ||
        pathname === WS_PATH ||
        pathname.startsWith(`${WS_PATH}?`) ||
        pathname.startsWith(WS_PROJECT_PREFIX)
      ) {
        return;
      }

      const authHeader = request.headers.authorization;
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
      if (!token) {
        await reply.code(401).send({ error: 'Invalid Authorization format — token is empty' });
        return;
      }

      // 1. Try DB-backed validation first (if apiKeyService is provided)
      if (apiKeyService) {
        const result = await apiKeyService.validateApiKey(token);
        if (result.valid) {
          request.apiKeyProjectId = result.projectId; // null = master, string = project-scoped
          request.apiKeyScopes = result.scopes;
          return; // authenticated via DB key
        }
      }

      // 2. Fall back to static NEXUS_API_KEY (backward compat)
      if (apiKey && timingSafeEqual(token, apiKey)) {
        request.apiKeyProjectId = null; // env-var key = master = full access
        request.apiKeyScopes = ['*']; // env-var key has full access
        return; // authenticated via env-var key
      }

      // 3. Both failed or not attempted → reject
      logger.warn('Rejected request with invalid API key', {
        component: 'auth-middleware',
        url: pathname,
        ip: request.ip,
      });
      await reply.code(401).send({ error: 'Invalid API key' });
    },
  );

  // ─── Project isolation guard ──────────────────────────────────
  // Runs after the auth hook.  If the API key is project-scoped,
  // this prevents it from accessing resources in other projects.
  fastify.addHook('onRequest', requireProjectAccess);

  // ─── Scope enforcement ───────────────────────────────────────
  // Ensures API keys with limited scopes (e.g. ["chat"]) can only
  // access matching endpoint categories.
  fastify.addHook('onRequest', requireScope);
}

// ─── RBAC: requireProjectRole ──────────────────────────────────
//
// Gate a route by the minimum ProjectRole the caller must hold on
// the projectId targeted by the request.
//
// Bypass rules (in order):
//   1. Master API key (apiKeyProjectId === null)  → allow, no member lookup.
//   2. Project API key (apiKeyProjectId === string)
//        → treated as `owner` for the scoped project; still 403 if the
//          request targets a different projectId (already enforced by
//          requireProjectAccess, which runs before this hook).
//   3. `x-user-email` header present
//        → look up ProjectMember(projectId, email); 403 if missing or
//          role < minRole; attach `request.projectRole` and allow.
//   4. None of the above → 401.
//
// NOTE: D3 of the plan picks `x-user-email` as a *trusted* header —
// it is only safe to accept it when the request has already passed
// the master-key Bearer check OR arrives over a trusted session
// channel. Today the dashboard always runs behind the master key, so
// this is safe. Swap for a signed session token in the auth-provider
// track.

/** Precedence: higher number = more power. */
const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  operator: 2,
  owner: 3,
};

/** True when the caller's role satisfies the required minimum. */
function roleAtLeast(actual: ProjectRole, required: ProjectRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Dependencies required to resolve a member from (projectId, email). */
export interface RequireProjectRoleDeps {
  memberRepository: MemberRepository;
  logger: Logger;
}

/**
 * Build a Fastify preHandler that enforces `minRole` on the requested
 * projectId. Apply to routes that mutate project state (agents,
 * members, approvals). Read-only routes can use `viewer` as the min.
 *
 * The returned hook extracts projectId from the same sources as
 * `requireProjectAccess` (params → body → query). If no projectId is
 * present the hook passes through (list endpoints filter in-handler).
 */
export function requireProjectRole(
  minRole: ProjectRole,
  deps: RequireProjectRoleDeps,
): preHandlerHookHandler {
  const { memberRepository, logger } = deps;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // (1) Master key — bypass.
    if (request.apiKeyProjectId === null) return;

    // Extract projectId from the request (mirrors project-access.ts).
    const params = request.params as Record<string, string> | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query as Record<string, string> | undefined;
    const projectId =
      params?.['projectId'] ??
      params?.['id'] ??
      (body?.['projectId'] as string | undefined) ??
      query?.['projectId'];

    if (!projectId) {
      // No project scope on the route → defer to handler-level filtering.
      return;
    }

    // (2) Project API key — treat as owner for its scoped project.
    //     Cross-project access is already blocked by requireProjectAccess.
    if (typeof request.apiKeyProjectId === 'string') {
      request.projectRole = 'owner';
      return;
    }

    // (3) x-user-email header — look up the ProjectMember.
    const rawEmail = request.headers['x-user-email'];
    const email = Array.isArray(rawEmail) ? rawEmail[0] : rawEmail;
    if (email && email.trim().length > 0) {
      const member = await memberRepository.findByEmail(projectId, email.trim().toLowerCase());
      if (!member) {
        logger.warn('requireProjectRole: no ProjectMember for user on project', {
          component: 'auth-middleware',
          projectId,
          minRole,
        });
        await reply.code(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not a member of this project',
          },
        });
        return;
      }
      if (!roleAtLeast(member.role, minRole)) {
        logger.warn('requireProjectRole: insufficient role', {
          component: 'auth-middleware',
          projectId,
          minRole,
          actualRole: member.role,
        });
        await reply.code(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Requires at least role "${minRole}"`,
          },
        });
        return;
      }
      request.projectRole = member.role;
      return;
    }

    // (4) Auth was skipped entirely (apiKeyProjectId === undefined) AND
    //     no user-email header → 401. When apiKey auth is disabled in
    //     dev the /api/v1 hook never runs and apiKeyProjectId is
    //     undefined; we still require *some* actor claim to pass RBAC.
    await reply.code(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing authentication — provide a master key or an x-user-email header',
      },
    });
  };
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
