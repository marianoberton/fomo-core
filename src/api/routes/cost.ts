/**
 * Cost monitoring routes - provides cost aggregation by agent and client.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess } from '../error-handler.js';
import { createPrismaUsageStore } from '@/cost/prisma-usage-store.js';
import type { ProjectId } from '@/core/types.js';
import {
  requireClientAccess,
  requireAgentAccess,
  ProjectAccessDeniedError,
  ResourceNotFoundError,
} from '../middleware/require-project-access.js';

const periodSchema = z.enum(['today', 'week', 'month']).default('month');

/**
 * Register cost monitoring routes.
 */
export function costRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma } = deps;
  const store = createPrismaUsageStore(prisma);

  function isGuardError(e: unknown): boolean {
    return e instanceof ProjectAccessDeniedError || e instanceof ResourceNotFoundError;
  }

  // GET /api/v1/cost/summary?period=month
  fastify.get('/summary', async (request, reply) => {
    const query = z
      .object({
        period: periodSchema.optional(),
        projectId: z.string().optional(),
      })
      .parse(request.query);

    const period = query.period ?? 'month';
    const projectId = query.projectId as ProjectId | undefined;
    const summary = await store.getCostSummary(period, projectId);
    return sendSuccess(reply, summary);
  });

  // GET /api/v1/cost/agents?period=today
  fastify.get('/agents', async (request, reply) => {
    const query = z
      .object({
        period: periodSchema.optional(),
        projectId: z.string().optional(),
      })
      .parse(request.query);

    const period = query.period ?? 'month';
    const projectId = query.projectId as ProjectId | undefined;
    const summary = await store.getCostSummary(period, projectId);
    return sendSuccess(reply, summary.byAgent);
  });

  // GET /api/v1/cost/clients?period=today
  fastify.get('/clients', async (request, reply) => {
    const query = z
      .object({
        period: periodSchema.optional(),
        projectId: z.string().optional(),
      })
      .parse(request.query);

    const period = query.period ?? 'month';
    const projectId = query.projectId as ProjectId | undefined;
    const summary = await store.getCostSummary(period, projectId);
    return sendSuccess(reply, summary.byClient);
  });

  // GET /api/v1/cost/clients/:clientId
  fastify.get('/clients/:clientId', async (request, reply) => {
    const { clientId } = z
      .object({
        clientId: z.string(),
      })
      .parse(request.params);

    try {
      await requireClientAccess(request, reply, clientId, prisma);
    } catch (e) {
      if (isGuardError(e)) return;
      throw e;
    }

    const query = z
      .object({
        period: periodSchema.optional(),
        projectId: z.string().optional(),
      })
      .parse(request.query);

    const period = query.period ?? 'month';
    const projectId = query.projectId as ProjectId | undefined;
    const detail = await store.getClientSpend(clientId, period, projectId);
    return sendSuccess(reply, detail);
  });

  // GET /api/v1/cost/agents/:agentId
  fastify.get('/agents/:agentId', async (request, reply) => {
    const { agentId } = z
      .object({
        agentId: z.string(),
      })
      .parse(request.params);

    try {
      await requireAgentAccess(request, reply, agentId, prisma);
    } catch (e) {
      if (isGuardError(e)) return;
      throw e;
    }

    const query = z
      .object({
        period: periodSchema.optional(),
        projectId: z.string().optional(),
      })
      .parse(request.query);

    const period = query.period ?? 'month';
    const projectId = query.projectId as ProjectId | undefined;
    const detail = await store.getAgentSpend(agentId, period, projectId);
    return sendSuccess(reply, detail);
  });

  // GET /api/v1/cost/projects?period=month
  fastify.get('/projects', async (request, reply) => {
    const query = z
      .object({ period: periodSchema.optional() })
      .parse(request.query);
    const summary = await store.getCostSummary(query.period ?? 'month');
    return sendSuccess(reply, summary.byProject);
  });

  // GET /api/v1/cost/projects/:projectId
  fastify.get('/projects/:projectId', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ period: periodSchema.optional() }).parse(request.query);
    const summary = await store.getCostSummary(query.period ?? 'month', projectId as ProjectId);
    const project = summary.byProject.find((p) => p.projectId === projectId);
    return sendSuccess(reply, project ?? { projectId, totalCostUSD: 0, requestCount: 0, agents: [], clients: [] });
  });

  // POST /api/v1/cost/clients/:clientId/budget
  fastify.post('/clients/:clientId/budget', async (request, reply) => {
    const { clientId } = z
      .object({
        clientId: z.string(),
      })
      .parse(request.params);

    try {
      await requireClientAccess(request, reply, clientId, prisma);
    } catch (e) {
      if (isGuardError(e)) return;
      throw e;
    }

    const body = z
      .object({
        budgetUSD: z.number().positive(),
      })
      .parse(request.body);

    await prisma.client.update({
      where: { id: clientId },
      data: { monthlyBudgetUSD: body.budgetUSD },
    });

    return sendSuccess(reply, { ok: true });
  });
}
