/**
 * OpenClaw Connect Routes — Onboarding and identity verification.
 *
 * Endpoints for OpenClaw Manager instances to:
 * - Register on startup and get their project config + available agents
 * - Verify their API key and see their access scope
 *
 * Auth: Bearer token (project-scoped or master) via auth middleware.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { AgentRepository } from '@/agents/types.js';
import type { Logger } from '@/observability/logger.js';
import { sendSuccess, sendError } from '../error-handler.js';
import { resolveOpenClawScope, scopedProjectId } from '../openclaw-auth.js';

// ─── Types ──────────────────────────────────────────────────────

/** Dependencies for OpenClaw connect routes. */
export interface OpenClawConnectDeps {
  /** Optional fallback key for backward compat. */
  openclawInternalKey?: string;
  projectRepository: ProjectRepository;
  agentRepository: AgentRepository;
  logger: Logger;
}

// ─── Schemas ────────────────────────────────────────────────────

const connectBodySchema = z.object({
  /** OpenClaw instance identifier (e.g., hostname or container ID). */
  instanceId: z.string().min(1).max(255),
  /** OpenClaw version string. */
  version: z.string().min(1).max(64).optional(),
  /** Callback URL where fomo-core can push events. */
  callbackUrl: z.string().url().optional(),
});

// ─── Constants ──────────────────────────────────────────────────

const CAPABILITIES = [
  'sync-invoke',
  'async-invoke',
  'sse-stream',
  'task-lifecycle',
  'sandbox',
] as const;

const ENDPOINTS = {
  invoke: '/api/v1/projects/:projectId/agents/:agentId/invoke',
  inbound: '/api/v1/openclaw/inbound',
  agentStatus: '/api/v1/openclaw/agents/status',
  tasks: '/api/v1/openclaw/tasks',
  sandbox: '/api/v1/openclaw/sandbox',
  connect: '/api/v1/openclaw/connect',
  whoami: '/api/v1/openclaw/whoami',
};

// ─── Route Registration ─────────────────────────────────────────

/**
 * Register OpenClaw connect and identity routes.
 */
export function openclawConnectRoutes(
  fastify: FastifyInstance,
  deps: OpenClawConnectDeps,
): void {
  const { openclawInternalKey, projectRepository, agentRepository, logger } = deps;

  /**
   * POST /api/v1/openclaw/connect
   *
   * Called by an OpenClaw instance on startup. Returns the project config,
   * available agents, API endpoints, and supported capabilities.
   *
   * Project-scoped keys get their project's info.
   * Master keys get a list of all projects.
   */
  fastify.post(
    '/openclaw/connect',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const parsed = connectBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400, {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const { instanceId, version } = parsed.data;

      logger.info('OpenClaw connect request', {
        component: 'openclaw-connect',
        instanceId,
        version,
        scope: scope.isMaster ? 'master' : 'project',
        projectId: scope.projectId ?? undefined,
      });

      // Master key — return all projects
      if (scope.isMaster) {
        const projects = await projectRepository.list();
        const projectSummaries = await Promise.all(
          projects.map(async (p) => {
            const agents = await agentRepository.list(p.id);
            return {
              projectId: p.id,
              projectName: p.name,
              agentCount: agents.length,
            };
          }),
        );

        return sendSuccess(reply, {
          scope: 'master',
          projects: projectSummaries,
          endpoints: ENDPOINTS,
          capabilities: CAPABILITIES,
        });
      }

      // Project-scoped key
      const projectId = scope.projectId;
      if (!projectId) {
        return sendError(reply, 'INTERNAL_ERROR', 'Project scope missing', 500);
      }

      const project = await projectRepository.findById(projectId as import('@/core/types.js').ProjectId);
      if (!project) {
        return sendError(reply, 'NOT_FOUND', `Project "${projectId}" not found`, 404);
      }

      const agents = await agentRepository.list(projectId);

      return sendSuccess(reply, {
        scope: 'project',
        projectId: project.id,
        projectName: project.name,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          operatingMode: a.operatingMode,
        })),
        endpoints: ENDPOINTS,
        capabilities: CAPABILITIES,
      });
    },
  );

  /**
   * GET /api/v1/openclaw/whoami
   *
   * Lightweight key verification. Returns the scope and project ID.
   */
  fastify.get(
    '/openclaw/whoami',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      return sendSuccess(reply, {
        scope: scope.isMaster ? 'master' : 'project',
        projectId: scope.projectId,
        isMaster: scope.isMaster,
      });
    },
  );
}
