/**
 * Project Access Guard — enforces tenant isolation for project-scoped API keys.
 *
 * When a request is authenticated with a project-scoped API key
 * (request.apiKeyProjectId is a non-null string), this guard ensures
 * the requested resource belongs to that project.
 *
 * Master keys (apiKeyProjectId === null) bypass the check entirely.
 *
 * Also provides scope enforcement: API keys with limited scopes
 * (e.g. ["chat"]) can only access matching endpoint categories.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Fastify preHandler that blocks project-scoped keys from accessing
 * resources outside their bound project.
 *
 * Extracts `projectId` from:
 *   1. `request.params.projectId`
 *   2. `request.body.projectId`  (POST/PUT)
 *   3. `request.query.projectId` (GET with query)
 *
 * If the request has no projectId at all, it is allowed through
 * (the route is not project-scoped, e.g. listing all projects).
 */
export async function requireProjectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const keyProjectId = request.apiKeyProjectId;

  // Master key or unauthenticated (auth might be disabled) → allow
  if (keyProjectId === null || keyProjectId === undefined) {
    return;
  }

  // Extract projectId from the request
  const params = request.params as Record<string, string> | undefined;
  const body = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, string> | undefined;

  const resourceProjectId =
    params?.['projectId'] ??
    (body?.['projectId'] as string | undefined) ??
    query?.['projectId'];

  // Route has no projectId — for listing endpoints, restrict to own project.
  // The route handler is responsible for filtering by keyProjectId.
  if (!resourceProjectId) {
    return;
  }

  if (resourceProjectId !== keyProjectId) {
    await reply.code(403).send({
      success: false,
      error: {
        code: 'PROJECT_ACCESS_DENIED',
        message: 'API key does not have access to this project',
      },
    });
  }
}

// ─── Scope-based endpoint mapping ──────────────────────────────

/**
 * Map URL path patterns to the scope required to access them.
 * A scope of "*" means the endpoint is unrestricted.
 * Routes not matching any pattern require "*" (full access).
 */
const SCOPE_MAP: Array<{ pattern: RegExp; scope: string }> = [
  { pattern: /\/chat/, scope: 'chat' },
  { pattern: /\/sessions/, scope: 'chat' },
  { pattern: /\/agents\/[^/]+\/invoke/, scope: 'chat' },
  { pattern: /\/projects/, scope: 'read' },
  { pattern: /\/agents/, scope: 'read' },
  { pattern: /\/contacts/, scope: 'read' },
  { pattern: /\/traces/, scope: 'read' },
  { pattern: /\/usage/, scope: 'read' },
  { pattern: /\/cost/, scope: 'read' },
  { pattern: /\/models/, scope: 'read' },
  { pattern: /\/knowledge/, scope: 'read' },
];

/**
 * Determine the scope required for a given URL path.
 * Returns "*" if no specific scope is mapped (requires full access).
 */
function requiredScope(path: string): string {
  for (const entry of SCOPE_MAP) {
    if (entry.pattern.test(path)) {
      return entry.scope;
    }
  }
  return '*'; // unmatched routes require full access
}

/**
 * Fastify preHandler that enforces API key scopes.
 *
 * Keys with scope ["*"] have full access.
 * Keys with limited scopes (e.g. ["chat"]) can only access matching endpoints.
 */
export async function requireScope(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const scopes = request.apiKeyScopes;

  // No scopes set (auth disabled / env-var key without scopes) → allow
  if (!scopes || scopes.length === 0) return;

  // Wildcard = full access
  if (scopes.includes('*')) return;

  const pathname = request.url.split('?')[0] ?? '';
  const required = requiredScope(pathname);

  // If the required scope is "*" and the key doesn't have it → deny
  if (required === '*' && !scopes.includes('*')) {
    await reply.code(403).send({
      success: false,
      error: {
        code: 'SCOPE_DENIED',
        message: `API key does not have the required scope for this endpoint`,
      },
    });
    return;
  }

  // Check if the key has the required scope
  if (!scopes.includes(required)) {
    await reply.code(403).send({
      success: false,
      error: {
        code: 'SCOPE_DENIED',
        message: `API key requires scope "${required}" to access this endpoint`,
      },
    });
  }
}
