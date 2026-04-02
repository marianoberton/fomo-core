/**
 * Agent Runs routes — CRUD for generic cross-project pipeline monitoring.
 * Supports creating runs, updating status, adding/updating steps, and listing
 * runs with filters for Mission Control.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { paginationSchema } from '../pagination.js';
import type { AgentRunId, AgentRunStepId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const createRunSchema = z.object({
  projectId: z.string().min(1),
  externalProject: z.string().max(200).optional(),
  runType: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  totalSteps: z.number().int().min(1).max(100),
  metadata: z.record(z.unknown()).optional(),
});

const updateRunSchema = z.object({
  status: z.enum(['running', 'done', 'failed', 'killed']).optional(),
  currentStep: z.number().int().min(0).optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const createStepSchema = z.object({
  stepIndex: z.number().int().min(0),
  agentName: z.string().min(1).max(100),
  input: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateStepSchema = z.object({
  status: z.enum(['pending', 'working', 'done', 'failed', 'skipped']).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  output: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  externalProject: z.string().optional(),
  status: z.enum(['running', 'done', 'failed', 'killed']).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register agent run routes on a Fastify instance. */
export function agentRunRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { agentRunRepository, logger } = opts;

  // GET /agent-runs — list runs (cross-project, with filters)
  fastify.get(
    '/agent-runs',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const query = paginationSchema.merge(listQuerySchema).parse(request.query);
      const { limit, offset, ...filters } = query;
      const result = await agentRunRepository.list(filters, limit, offset);
      await sendSuccess(reply, { ...result, limit, offset });
    },
  );

  // GET /agent-runs/:id — get single run with steps
  fastify.get(
    '/agent-runs/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const run = await agentRunRepository.findById(request.params.id as AgentRunId);
      if (!run) {
        await sendNotFound(reply, 'AgentRun', request.params.id);
        return;
      }
      await sendSuccess(reply, run);
    },
  );

  // POST /agent-runs — create a new run
  fastify.post(
    '/agent-runs',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const parseResult = createRunSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const run = await agentRunRepository.create(parseResult.data);
      logger.info('Agent run created', {
        component: 'agent-runs',
        runId: run.id,
        projectId: run.projectId,
        externalProject: run.externalProject,
        runType: run.runType,
      });
      await sendSuccess(reply, run, 201);
    },
  );

  // PATCH /agent-runs/:id — update a run (status, currentStep, etc.)
  fastify.patch(
    '/agent-runs/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = updateRunSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const data = {
        ...parseResult.data,
        completedAt: parseResult.data.completedAt ? new Date(parseResult.data.completedAt) : undefined,
      };

      const run = await agentRunRepository.update(request.params.id as AgentRunId, data);
      if (!run) {
        await sendNotFound(reply, 'AgentRun', request.params.id);
        return;
      }

      logger.info('Agent run updated', {
        component: 'agent-runs',
        runId: run.id,
        status: run.status,
      });
      await sendSuccess(reply, run);
    },
  );

  // GET /agent-runs/:id/steps — list steps for a run
  fastify.get(
    '/agent-runs/:id/steps',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const steps = await agentRunRepository.listSteps(request.params.id as AgentRunId);
      await sendSuccess(reply, steps);
    },
  );

  // POST /agent-runs/:id/steps — add a step to a run
  fastify.post(
    '/agent-runs/:id/steps',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = createStepSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const step = await agentRunRepository.createStep({
        runId: request.params.id,
        ...parseResult.data,
      });
      logger.info('Agent run step created', {
        component: 'agent-runs',
        runId: request.params.id,
        stepId: step.id,
        stepIndex: step.stepIndex,
        agentName: step.agentName,
      });
      await sendSuccess(reply, step, 201);
    },
  );

  // PATCH /agent-runs/:runId/steps/:stepId — update a step
  fastify.patch(
    '/agent-runs/:runId/steps/:stepId',
    async (
      request: FastifyRequest<{ Params: { runId: string; stepId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = updateStepSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const data = {
        ...parseResult.data,
        startedAt: parseResult.data.startedAt ? new Date(parseResult.data.startedAt) : undefined,
        completedAt: parseResult.data.completedAt ? new Date(parseResult.data.completedAt) : undefined,
      };

      const step = await agentRunRepository.updateStep(
        request.params.stepId as AgentRunStepId,
        data,
      );
      if (!step) {
        await sendNotFound(reply, 'AgentRunStep', request.params.stepId);
        return;
      }

      logger.info('Agent run step updated', {
        component: 'agent-runs',
        runId: request.params.runId,
        stepId: step.id,
        status: step.status,
      });
      await sendSuccess(reply, step);
    },
  );
}
