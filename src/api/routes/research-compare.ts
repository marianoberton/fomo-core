/**
 * Research Intelligence Compare route.
 *
 * All routes require super_admin (guard applied in index.ts scope).
 *
 * GET /research/compare?targetIds=a,b,c  → comparative analysis data for up to 8 targets
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';

// ─── Schemas ──────────────────────────────────────────────────────

const compareQuerySchema = z.object({
  targetIds: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(
      z.array(z.string().min(1)).min(1, 'At least 1 target required').max(8, 'Maximum 8 targets'),
    ),
});

// ─── Plugin ───────────────────────────────────────────────────────

export function researchCompareRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;

  // ─── GET /research/compare ────────────────────────────────────
  fastify.get(
    '/research/compare',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = compareQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { targetIds } = parsed.data;

      // Load targets with their latest analysis
      const targets = await prisma.researchTarget.findMany({
        where: {
          id: { in: targetIds },
          dsarDeletedAt: null,
        },
        include: {
          vertical: { select: { slug: true, name: true } },
          sessions: {
            where: { status: 'completed' },
            include: {
              analysis: true,
              script: { select: { level: true, name: true } },
            },
            orderBy: { completedAt: 'desc' },
          },
        },
      });

      // Build compare payload per target
      const compareData = targets.map((target) => {
        // Find the session with the best (most recent highest-level) analysis
        const sessionsWithAnalysis = target.sessions.filter((s) => s.analysis !== null);

        // Pick latest analysis as the "canonical" one for comparison
        const latestSession = sessionsWithAnalysis[0];
        const analysis = latestSession?.analysis ?? null;

        return {
          targetId: target.id,
          name: target.name,
          company: target.company,
          verticalSlug: target.verticalSlug,
          verticalName: target.vertical.name,
          status: target.status,
          totalSessions: target.sessions.length,
          // Latest analysis summary
          analysis: analysis
            ? {
                id: analysis.id,
                level: latestSession?.script?.level ?? null,
                scoreTotal: analysis.scoreTotal !== null ? Number(analysis.scoreTotal) : null,
                scores: analysis.scores,
                estimatedLlm: analysis.estimatedLlm,
                hasRag: analysis.hasRag,
                hasFunctionCalling: analysis.hasFunctionCalling,
                hasCrossSessionMemory: analysis.hasCrossSessionMemory,
                responseTimeP50Ms: analysis.responseTimeP50Ms,
                responseTimeP95Ms: analysis.responseTimeP95Ms,
                promptInjectionResistance: analysis.promptInjectionResistance,
                consistencyScore: analysis.consistencyScore,
                toneProfile: analysis.toneProfile,
                keyStrengths: analysis.keyStrengths,
                keyWeaknesses: analysis.keyWeaknesses,
                thingsToReplicate: analysis.thingsToReplicate,
                thingsToAvoid: analysis.thingsToAvoid,
                executiveSummary: analysis.executiveSummary,
                analyzedAt: analysis.analyzedAt,
              }
            : null,
        };
      });

      logger.info('research compare: targets fetched', {
        component: 'research-compare',
        targetCount: compareData.length,
      });

      await sendSuccess(reply, { targets: compareData });
    },
  );
}
