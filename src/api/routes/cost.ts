/**
 * Cost monitoring routes - provides cost aggregation by agent and client.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import { createPrismaUsageStore } from '@/cost/prisma-usage-store.js';
import type { ProjectId } from '@/core/types.js';

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

  // POST /api/v1/cost/clients/:clientId/budget
  fastify.post('/clients/:clientId/budget', async (request, reply) => {
    const { clientId } = z
      .object({
        clientId: z.string(),
      })
      .parse(request.params);

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
