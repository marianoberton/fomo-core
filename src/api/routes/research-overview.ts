/**
 * Research Intelligence Overview routes.
 *
 * All routes require super_admin (guard applied in index.ts scope).
 *
 * GET /research/overview/stats          → system totals
 * GET /research/overview/coverage       → heat map data (vertical × level)
 * GET /research/overview/top-performers → top 3 per vertical
 * GET /research/overview/activity       → recent activity feed
 * GET /research/overview/suggestions    → pipeline suggestions based on coverage gaps
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import { createIntelligenceStatsRepository } from '@/research/repositories/intelligence-stats-repository.js';

// ─── Schemas ──────────────────────────────────────────────────────

const topPerformersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── Plugin ───────────────────────────────────────────────────────

export function researchOverviewRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;
  const statsRepo = createIntelligenceStatsRepository(prisma);

  // ─── GET /research/overview/stats ─────────────────────────────
  fastify.get(
    '/research/overview/stats',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = await statsRepo.getSystemStats();
      logger.info('research overview: stats fetched', { component: 'research-overview' });
      await sendSuccess(reply, stats);
    },
  );

  // ─── GET /research/overview/coverage ──────────────────────────
  fastify.get(
    '/research/overview/coverage',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const verticals = await statsRepo.getAllVerticalStats();
      logger.info('research overview: coverage fetched', {
        component: 'research-overview',
        verticalCount: verticals.length,
      });
      await sendSuccess(reply, { verticals });
    },
  );

  // ─── GET /research/overview/top-performers ────────────────────
  fastify.get(
    '/research/overview/top-performers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = topPerformersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      // Fetch all active verticals
      const verticals = await prisma.researchVertical.findMany({
        where: { isActive: true },
        select: { slug: true, name: true },
        orderBy: { name: 'asc' },
      });

      const results = await Promise.all(
        verticals.map(async (v) => {
          const performers = await statsRepo.getTopPerformers(v.slug, parsed.data.limit);
          return { verticalSlug: v.slug, verticalName: v.name, performers };
        }),
      );

      logger.info('research overview: top performers fetched', {
        component: 'research-overview',
        verticalCount: verticals.length,
      });

      await sendSuccess(reply, { byVertical: results });
    },
  );

  // ─── GET /research/overview/activity ──────────────────────────
  fastify.get(
    '/research/overview/activity',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = activityQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const activity = await statsRepo.getRecentActivity(parsed.data.limit);
      await sendSuccess(reply, { items: activity });
    },
  );

  // ─── GET /research/overview/suggestions ───────────────────────
  fastify.get(
    '/research/overview/suggestions',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const suggestions = await statsRepo.getCoverageGaps();
      await sendSuccess(reply, { items: suggestions });
    },
  );
}
