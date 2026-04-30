/**
 * Research Analysis routes — query and trigger analysis for completed sessions.
 *
 * All routes require super_admin (guard applied in index.ts scope).
 *
 * GET  /research/analyses              — list with filters (verticalSlug, sessionId, limit/offset)
 * GET  /research/analyses/:id          — detail
 * GET  /research/sessions/:id/analysis — analysis for a specific session
 * POST /research/sessions/:id/analyze  — trigger / re-run analysis (optional modelOverride)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createResearchAnalysisRepository } from '@/research/repositories/analysis-repository.js';
import type { ResearchAnalysisId, ResearchSessionId } from '@/research/types.js';

// ─── Schemas ──────────────────────────────────────────────────────

const listQuerySchema = z.object({
  verticalSlug: z.string().optional(),
  sessionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const analyzeBodySchema = z.object({
  modelOverride: z.string().optional(),
});

// ─── Plugin ───────────────────────────────────────────────────────

export function researchAnalysesRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;
  const analysisRepo = createResearchAnalysisRepository(prisma);

  // ─── GET /research/analyses ────────────────────────────────────
  fastify.get(
    '/research/analyses',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { verticalSlug, sessionId, limit, offset } = parsed.data;

      if (sessionId !== undefined) {
        const analysis = await analysisRepo.findBySession(sessionId);
        await sendSuccess(reply, { items: analysis ? [analysis] : [], total: analysis ? 1 : 0 });
        return;
      }

      if (verticalSlug !== undefined) {
        const items = await analysisRepo.listByVertical(verticalSlug, limit);
        await sendSuccess(reply, { items, total: items.length });
        return;
      }

      // Full list — paginated via Prisma directly
      const [items, total] = await Promise.all([
        prisma.researchAnalysis.findMany({
          include: {
            session: {
              select: {
                status: true,
                target: { select: { name: true, company: true, verticalSlug: true } },
                script: { select: { name: true, level: true } },
              },
            },
          },
          orderBy: { analyzedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.researchAnalysis.count(),
      ]);

      await sendSuccess(reply, { items, total });
    },
  );

  // ─── GET /research/analyses/:id ───────────────────────────────
  fastify.get(
    '/research/analyses/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const analysis = await prisma.researchAnalysis.findUnique({
        where: { id },
        include: {
          session: {
            include: {
              target: { select: { name: true, company: true, verticalSlug: true } },
              script: { select: { name: true, level: true, objective: true } },
              turns: { orderBy: [{ turnOrder: 'asc' }, { direction: 'asc' }] },
            },
          },
        },
      });

      if (!analysis) {
        await sendNotFound(reply, 'ResearchAnalysis', id);
        return;
      }

      await sendSuccess(reply, analysis);
    },
  );

  // ─── GET /research/sessions/:id/analysis ──────────────────────
  fastify.get(
    '/research/sessions/:id/analysis',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const session = await prisma.researchSession.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      const analysis = await analysisRepo.findBySession(id);

      if (!analysis) {
        await sendError(reply, 'NOT_FOUND', `No analysis found for session ${id}`, 404);
        return;
      }

      await sendSuccess(reply, analysis);
    },
  );

  // ─── POST /research/sessions/:id/analyze ──────────────────────
  fastify.post(
    '/research/sessions/:id/analyze',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const parsed = analyzeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const session = await prisma.researchSession.findUnique({
        where: { id },
        select: { id: true, status: true },
      });

      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      if (session.status !== 'completed') {
        await sendError(
          reply,
          'CONFLICT',
          `Session is in '${session.status}' state — only completed sessions can be analyzed`,
          409,
        );
        return;
      }

      // Enqueue analysis job or run inline if no queue
      if (deps.researchAnalysisQueue) {
        await deps.researchAnalysisQueue.add(
          'research-analyze-session',
          { sessionId: id, modelOverride: parsed.data.modelOverride },
          { attempts: 2, backoff: { type: 'exponential', delay: 10_000 } },
        );

        logger.info('research: analysis job enqueued', {
          component: 'research-analyses',
          sessionId: id,
          modelOverride: parsed.data.modelOverride,
          actor: request.superAdminEmail,
        });

        await sendSuccess(reply, { sessionId: id, status: 'queued' }, 202);
        return;
      }

      // Fallback: synchronous analysis (no queue available)
      if (!deps.researchAnalyzer) {
        await sendError(reply, 'NOT_FOUND', 'Analyzer not available (Redis not configured)', 503);
        return;
      }

      const result = await deps.researchAnalyzer.analyze(id as ResearchSessionId, {
        modelOverride: parsed.data.modelOverride,
      });

      if (!result.ok) {
        await sendError(reply, result.error.researchCode, result.error.message, 500);
        return;
      }

      logger.info('research: analysis completed (inline)', {
        component: 'research-analyses',
        sessionId: id,
        analysisId: result.value.id,
        actor: request.superAdminEmail,
      });

      await sendSuccess(reply, result.value, 201);
    },
  );
}
