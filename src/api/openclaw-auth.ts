/**
 * OpenClaw Auth — Shared authentication and project-scoping helpers.
 *
 * Replaces the per-route X-OpenClaw-Key validation with a unified approach
 * that leverages the existing Bearer token auth middleware.
 *
 * Auth flow:
 * 1. Bearer token validated by auth-middleware.ts → sets request.apiKeyProjectId
 * 2. resolveOpenClawScope() reads that field to determine scope
 * 3. Fallback: X-OpenClaw-Key header checked against OPENCLAW_INTERNAL_KEY env var (backward compat)
 *
 * Scopes:
 * - Master (projectId=null): Fomo admin — full access to all projects/agents
 * - Project (projectId=string): Client OpenClaw — restricted to one project
 */
import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { NexusError } from '@/core/errors.js';

// ─── Types ──────────────────────────────────────────────────────

/** Resolved scope for an OpenClaw request. */
export interface OpenClawScope {
  /** The project this key is scoped to, or null for master (admin) keys. */
  readonly projectId: string | null;
  /** True if this is a master key with access to all projects. */
  readonly isMaster: boolean;
}

// ─── Scope Resolution ───────────────────────────────────────────

/**
 * Resolve the OpenClaw scope from a Fastify request.
 *
 * Priority:
 * 1. request.apiKeyProjectId (set by Bearer auth middleware)
 * 2. X-OpenClaw-Key header fallback (backward compat — resolves as master scope)
 *
 * @param request - The Fastify request object.
 * @param fallbackKey - Optional OPENCLAW_INTERNAL_KEY env var for backward compat.
 * @returns The resolved scope, or null if not authenticated.
 */
export function resolveOpenClawScope(
  request: FastifyRequest,
  fallbackKey?: string,
): OpenClawScope | null {
  // 1. Bearer token auth (already validated by auth-middleware)
  if (request.apiKeyProjectId !== undefined) {
    return {
      projectId: request.apiKeyProjectId,
      isMaster: request.apiKeyProjectId === null,
    };
  }

  // 2. Fallback: X-OpenClaw-Key header (backward compat)
  if (fallbackKey) {
    const providedKey = request.headers['x-openclaw-key'] as string | undefined;
    if (providedKey && safeEqual(providedKey, fallbackKey)) {
      return { projectId: null, isMaster: true };
    }
  }

  return null;
}

// ─── Project Access Enforcement ─────────────────────────────────

/**
 * Assert that the scope has access to the target project.
 *
 * - Master keys can access any project.
 * - Project-scoped keys can only access their own project.
 *
 * @param scope - The resolved OpenClaw scope.
 * @param targetProjectId - The project being accessed.
 * @throws NexusError with code FORBIDDEN if access is denied.
 */
export function assertProjectAccess(
  scope: OpenClawScope,
  targetProjectId: string,
): void {
  if (scope.isMaster) return;

  if (scope.projectId !== targetProjectId) {
    throw new NexusError({
      code: 'FORBIDDEN',
      message: `API key is scoped to project "${scope.projectId}" — cannot access project "${targetProjectId}"`,
      statusCode: 403,
    });
  }
}

/**
 * Filter a project ID for scoped queries.
 *
 * - Master keys: returns undefined (query all projects)
 * - Project-scoped keys: returns the project ID
 */
export function scopedProjectId(scope: OpenClawScope): string | undefined {
  return scope.isMaster ? undefined : (scope.projectId ?? undefined);
}

// ─── Helpers ────────────────────────────────────────────────────

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}
