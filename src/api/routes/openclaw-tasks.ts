/**
 * OpenClaw Task Orchestration Routes — Health, task lifecycle, and status.
 *
 * Endpoints for OpenClaw Manager to:
 * - Query agent availability and health
 * - Check task status and partial results
 * - Cancel running tasks
 * - List active tasks
 *
 * Auth: Bearer token (project-scoped or master) via auth middleware.
 * Backward compat: X-OpenClaw-Key header fallback.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AgentRepository } from '@/agents/types.js';
import type { TaskRegistry } from '@/channels/openclaw-task-registry.js';
import type { Logger } from '@/observability/logger.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { resolveOpenClawScope, scopedProjectId } from '../openclaw-auth.js';

// ─── Types ──────────────────────────────────────────────────────

/** Dependencies for OpenClaw task routes. */
export interface OpenClawTaskDeps {
  /** Optional fallback key for backward compat (OPENCLAW_INTERNAL_KEY). */
  openclawInternalKey?: string;
  /** Agent repository for querying agent info. */
  agentRepository: AgentRepository;
  /** Task registry for lifecycle management. */
  taskRegistry: TaskRegistry;
  logger: Logger;
}

// ─── Schemas ────────────────────────────────────────────────────

const taskListQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

/**
 * Register OpenClaw orchestration routes on a Fastify instance.
 *
 * @param fastify - Fastify instance (already prefixed with /api/v1).
 * @param deps - Route dependencies.
 */
export function openclawTaskRoutes(
  fastify: FastifyInstance,
  deps: OpenClawTaskDeps,
): void {
  const { openclawInternalKey, agentRepository, taskRegistry, logger } = deps;

  // ─── Agent Health / Status ─────────────────────────────────────

  /**
   * GET /api/v1/openclaw/agents/status
   *
   * Returns availability, load, and health of agents.
   * Project-scoped keys only see their project's agents.
   */
  fastify.get(
    '/openclaw/agents/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const projectId = scopedProjectId(scope);
      const agents = projectId
        ? await agentRepository.list(projectId)
        : await agentRepository.listAll();

      const statuses = agents.map((agent) => {
        const activeTasks = taskRegistry.countActive(agent.id);
        const health = agent.status === 'active'
          ? (activeTasks > 5 ? 'degraded' : 'healthy')
          : 'unavailable';

        return {
          agentId: agent.id,
          name: agent.name,
          status: agent.status,
          type: agent.type,
          projectId: agent.projectId,
          activeTasks,
          health,
        };
      });

      return sendSuccess(reply, statuses);
    },
  );

  // ─── Get Task Status ───────────────────────────────────────────

  /**
   * GET /api/v1/openclaw/tasks/:taskId
   *
   * Returns current status, events, and result (if completed) for a task.
   */
  fastify.get(
    '/openclaw/tasks/:taskId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const { taskId } = request.params as { taskId: string };

      const entry = taskRegistry.get(taskId);
      if (!entry) {
        return sendNotFound(reply, 'Task', taskId);
      }

      // Project scoping: verify the task belongs to the caller's project
      if (!scope.isMaster && scope.projectId !== entry.projectId) {
        return sendNotFound(reply, 'Task', taskId);
      }

      return sendSuccess(reply, {
        taskId: entry.taskId,
        agentId: entry.agentId,
        projectId: entry.projectId,
        status: entry.status,
        createdAt: entry.createdAt.toISOString(),
        completedAt: entry.completedAt?.toISOString(),
        result: entry.result,
        error: entry.error,
        eventCount: entry.events.length,
        lastEvent: entry.events.length > 0
          ? entry.events[entry.events.length - 1]
          : undefined,
      });
    },
  );

  // ─── List Tasks ────────────────────────────────────────────────

  /**
   * GET /api/v1/openclaw/tasks
   *
   * List all tracked tasks, optionally filtered by agentId and/or status.
   * Project-scoped keys only see their project's tasks.
   */
  fastify.get(
    '/openclaw/tasks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const query = taskListQuerySchema.parse(request.query);

      const entries = taskRegistry.list({
        ...query,
        projectId: scopedProjectId(scope),
      });

      const items = entries.map((e) => ({
        taskId: e.taskId,
        agentId: e.agentId,
        projectId: e.projectId,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        completedAt: e.completedAt?.toISOString(),
        eventCount: e.events.length,
        hasResult: !!e.result,
        error: e.error,
      }));

      return sendSuccess(reply, items);
    },
  );

  // ─── Cancel Task ───────────────────────────────────────────────

  /**
   * POST /api/v1/openclaw/tasks/:taskId/cancel
   *
   * Cancels a running task. The agent runner's AbortSignal is triggered,
   * which cleanly stops the LLM loop.
   */
  fastify.post(
    '/openclaw/tasks/:taskId/cancel',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const { taskId } = request.params as { taskId: string };

      const entry = taskRegistry.get(taskId);
      if (!entry) {
        return sendNotFound(reply, 'Task', taskId);
      }

      // Project scoping
      if (!scope.isMaster && scope.projectId !== entry.projectId) {
        return sendNotFound(reply, 'Task', taskId);
      }

      const cancelled = taskRegistry.cancel(taskId);
      if (!cancelled) {
        return sendError(
          reply,
          'TASK_NOT_RUNNING',
          `Task "${taskId}" is ${entry.status}, cannot cancel`,
          409,
        );
      }

      logger.info('Task cancelled via API', { component: 'openclaw-tasks', taskId });

      return sendSuccess(reply, { taskId, status: 'cancelled' });
    },
  );

  // ─── Get Task Events (stream replay) ──────────────────────────

  /**
   * GET /api/v1/openclaw/tasks/:taskId/events
   *
   * Returns buffered events for a task (useful for replaying what happened).
   */
  fastify.get(
    '/openclaw/tasks/:taskId/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = resolveOpenClawScope(request, openclawInternalKey);
      if (!scope) {
        return sendError(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const { taskId } = request.params as { taskId: string };

      const entry = taskRegistry.get(taskId);
      if (!entry) {
        return sendNotFound(reply, 'Task', taskId);
      }

      // Project scoping
      if (!scope.isMaster && scope.projectId !== entry.projectId) {
        return sendNotFound(reply, 'Task', taskId);
      }

      return sendSuccess(reply, {
        taskId: entry.taskId,
        status: entry.status,
        events: entry.events,
        totalEvents: entry.events.length,
      });
    },
  );
}
