/**
 * Scheduled Tasks routes — CRUD + lifecycle for scheduled tasks and runs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { paginationSchema, paginate } from '../pagination.js';

// ─── Schemas ────────────────────────────────────────────────────

const createTaskSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  cronExpression: z.string().min(9).max(100),
  taskPayload: z.object({
    message: z.string().min(1).max(2000),
    metadata: z.record(z.unknown()).optional(),
  }),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  budgetPerRunUSD: z.number().min(0.01).max(100).optional(),
  maxDurationMinutes: z.number().int().min(1).max(120).optional(),
  maxTurns: z.number().int().min(1).max(50).optional(),
  maxRuns: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

const approveSchema = z.object({
  approvedBy: z.string().min(1),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register scheduled task routes on a Fastify instance. */
export function scheduledTaskRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { taskManager } = opts;

  // GET /projects/:projectId/scheduled-tasks
  const taskListQuerySchema = z.object({ status: z.string().optional() });

  fastify.get(
    '/projects/:projectId/scheduled-tasks',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const { projectId } = request.params;
      const query = paginationSchema.merge(taskListQuerySchema).parse(request.query);
      const { limit, offset, status } = query;
      const tasks = await taskManager.listTasks(
        projectId as Parameters<typeof taskManager.listTasks>[0],
        status,
      );
      await sendSuccess(reply, paginate(tasks, limit, offset));
    },
  );

  // GET /scheduled-tasks/:id
  fastify.get(
    '/scheduled-tasks/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const task = await taskManager.getTask(
        request.params.id as Parameters<typeof taskManager.getTask>[0],
      );
      if (!task) {
        await sendNotFound(reply, 'ScheduledTask', request.params.id);
        return;
      }
      await sendSuccess(reply, task);
    },
  );

  // POST /projects/:projectId/scheduled-tasks
  fastify.post(
    '/projects/:projectId/scheduled-tasks',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = createTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const { projectId } = request.params;
      const body = parseResult.data;

      const result = await taskManager.createTask({
        projectId: projectId as Parameters<typeof taskManager.createTask>[0]['projectId'],
        name: body.name,
        description: body.description,
        cronExpression: body.cronExpression,
        taskPayload: body.taskPayload,
        origin: 'static',
        maxRetries: body.maxRetries,
        timeoutMs: body.timeoutMs,
        budgetPerRunUSD: body.budgetPerRunUSD,
        maxDurationMinutes: body.maxDurationMinutes,
        maxTurns: body.maxTurns,
        maxRuns: body.maxRuns,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value, 201);
    },
  );

  // POST /scheduled-tasks/:id/approve
  fastify.post(
    '/scheduled-tasks/:id/approve',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = approveSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const result = await taskManager.approveTask(
        request.params.id as Parameters<typeof taskManager.approveTask>[0],
        parseResult.data.approvedBy,
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // POST /scheduled-tasks/:id/reject
  fastify.post(
    '/scheduled-tasks/:id/reject',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await taskManager.rejectTask(
        request.params.id as Parameters<typeof taskManager.rejectTask>[0],
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // POST /scheduled-tasks/:id/pause
  fastify.post(
    '/scheduled-tasks/:id/pause',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await taskManager.pauseTask(
        request.params.id as Parameters<typeof taskManager.pauseTask>[0],
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // POST /scheduled-tasks/:id/resume
  fastify.post(
    '/scheduled-tasks/:id/resume',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const result = await taskManager.resumeTask(
        request.params.id as Parameters<typeof taskManager.resumeTask>[0],
      );

      if (!result.ok) {
        await sendError(reply, result.error.code, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // GET /scheduled-tasks/:id/runs
  fastify.get(
    '/scheduled-tasks/:id/runs',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const runs = await taskManager.listRuns(
        request.params.id as Parameters<typeof taskManager.listRuns>[0],
        limit,
      );
      await sendSuccess(reply, runs);
    },
  );
}
