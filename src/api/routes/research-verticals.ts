/**
 * Research Vertical routes (super_admin only).
 *
 * GET    /research/verticals              — list all (active + inactive)
 * POST   /research/verticals             — create new vertical
 * PATCH  /research/verticals/:slug       — edit name, description, rubric, instructions
 * POST   /research/verticals/:slug/activate   — activate
 * POST   /research/verticals/:slug/deactivate — deactivate
 *
 * All routes are guarded by `requireSuperAdmin` (applied at plugin scope).
 * Weights in scoringRubric must sum to 1.0 (validated by Zod refine).
 * See NEXUS_INTELLIGENCE_PLAN.md §Fase 1.2.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createResearchVerticalRepository } from '@/research/repositories/vertical-repository.js';
import { createSynthesizer } from '@/research/synthesis/synthesizer.js';
import type { ResearchSynthesizeVerticalPayload } from '@/research/jobs/research-synthesize-vertical.js';
import type { Queue } from 'bullmq';

// ─── Schemas ─────────────────────────────────────────────────────

const scoringDimensionSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  weight: z.number().gt(0).lte(1),
});

const scoringRubricSchema = z.object({
  dimensions: z
    .array(scoringDimensionSchema)
    .min(1)
    .max(12)
    .refine(
      (dims) => {
        const sum = dims.reduce((acc, d) => acc + d.weight, 0);
        // Allow small floating-point drift (±0.001)
        return Math.abs(sum - 1) < 0.001;
      },
      { message: 'scoringRubric weights must sum to 1.0' },
    ),
});

const createVerticalSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab-case'),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  scoringRubric: scoringRubricSchema,
  analysisInstructions: z.string().min(10).max(4000),
});

const updateVerticalSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  scoringRubric: scoringRubricSchema.optional(),
  analysisInstructions: z.string().min(10).max(4000).optional(),
});

// ─── Route factory ────────────────────────────────────────────────

/** Register research vertical routes inside a scoped Fastify plugin. */
export function researchVerticalsRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
  extra?: { synthesisQueue?: Queue<ResearchSynthesizeVerticalPayload> },
): void {
  const { prisma, logger } = opts;
  const repo = createResearchVerticalRepository(prisma);
  const synthesisQueue = extra?.synthesisQueue ?? null;

  // Apply super_admin guard to all routes in this scope
  fastify.addHook('preHandler', requireSuperAdmin({ logger }));

  // GET /research/verticals
  fastify.get('/research/verticals', async (_request: FastifyRequest, reply: FastifyReply) => {
    const verticals = await repo.findAll();
    await sendSuccess(reply, { items: verticals, total: verticals.length });
  });

  // POST /research/verticals
  fastify.post(
    '/research/verticals',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createVerticalSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';

      // Check slug uniqueness ourselves for a nicer error than a Prisma throw
      const existing = await repo.findBySlug(parsed.data.slug);
      if (existing) {
        await sendError(
          reply,
          'CONFLICT',
          `Vertical with slug "${parsed.data.slug}" already exists`,
          409,
        );
        return;
      }

      const vertical = await repo.create({
        ...parsed.data,
        createdBy: actorEmail,
      });

      logger.info('research: vertical created', {
        component: 'research-compliance',
        slug: vertical.slug,
        actor: actorEmail,
      });

      await sendSuccess(reply, { vertical }, 201);
    },
  );

  // PATCH /research/verticals/:slug
  fastify.patch(
    '/research/verticals/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;

      const parsed = updateVerticalSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const existing = await repo.findBySlug(slug);
      if (!existing) {
        await sendNotFound(reply, 'ResearchVertical', slug);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const vertical = await repo.update(slug, {
        ...parsed.data,
        updatedBy: actorEmail,
      });

      logger.info('research: vertical updated', {
        component: 'research-compliance',
        slug,
        actor: actorEmail,
      });

      await sendSuccess(reply, { vertical });
    },
  );

  // POST /research/verticals/:slug/activate
  fastify.post(
    '/research/verticals/:slug/activate',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;

      const existing = await repo.findBySlug(slug);
      if (!existing) {
        await sendNotFound(reply, 'ResearchVertical', slug);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const vertical = await repo.activate(slug, actorEmail);

      logger.info('research: vertical activated', {
        component: 'research-compliance',
        slug,
        actor: actorEmail,
      });

      await sendSuccess(reply, { vertical });
    },
  );

  // POST /research/verticals/:slug/deactivate
  fastify.post(
    '/research/verticals/:slug/deactivate',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;

      const existing = await repo.findBySlug(slug);
      if (!existing) {
        await sendNotFound(reply, 'ResearchVertical', slug);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const vertical = await repo.deactivate(slug, actorEmail);

      logger.info('research: vertical deactivated', {
        component: 'research-compliance',
        slug,
        actor: actorEmail,
      });

      await sendSuccess(reply, { vertical });
    },
  );

  // POST /research/verticals/:slug/synthesize
  fastify.post(
    '/research/verticals/:slug/synthesize',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;
      const actor = request.superAdminEmail ?? 'api-key';

      const existing = await repo.findBySlug(slug);
      if (!existing) {
        await sendNotFound(reply, 'ResearchVertical', slug);
        return;
      }

      // If a BullMQ queue is wired up, enqueue the job (async)
      if (synthesisQueue) {
        await synthesisQueue.add('research-synthesize-vertical', {
          verticalSlug: slug,
          triggeredBy: actor,
        });

        logger.info('research: synthesis job enqueued', {
          component: 'research-synthesizer',
          slug,
          actor,
        });

        await sendSuccess(reply, { queued: true, verticalSlug: slug }, 202);
        return;
      }

      // Fallback: run inline (no Redis)
      const synthesizer = createSynthesizer({ prisma, logger });
      const result = await synthesizer.synthesizeVertical(slug);

      if (!result.ok) {
        await sendError(reply, result.error.researchCode, result.error.message, result.error.statusCode ?? 500);
        return;
      }

      logger.info('research: synthesis completed inline', {
        component: 'research-synthesizer',
        slug,
        actor,
        insightCount: result.value.insightIds.length,
        patternCount: result.value.patternIds.length,
      });

      await sendSuccess(reply, {
        queued: false,
        verticalSlug: slug,
        insightIds: result.value.insightIds,
        patternIds: result.value.patternIds,
      });
    },
  );
}
