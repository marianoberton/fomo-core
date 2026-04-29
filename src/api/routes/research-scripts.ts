/**
 * ProbeScript routes — CRUD + clone for the Probe Script Library.
 *
 * All routes require super_admin (enforced by the plugin scope that registers
 * /research/* — see src/api/routes/index.ts and super-admin-guard.ts).
 *
 * GET    /research/scripts              — list with filters
 * POST   /research/scripts              — create custom script
 * GET    /research/scripts/:id          — detail with full turns
 * PATCH  /research/scripts/:id          — edit turns / metadata
 * DELETE /research/scripts/:id          — delete if no sessions
 * POST   /research/scripts/:id/clone    — clone for customization
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { $Enums } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import {
  createScriptRepository,
  type CreateScriptInput,
  type UpdateScriptInput,
} from '@/research/repositories/script-repository.js';

// ─── Zod Schemas ──────────────────────────────────────────────────

const probeLevelEnum = z.enum([
  'L1_SURFACE',
  'L2_CAPABILITIES',
  'L3_ARCHITECTURE',
  'L4_ADVERSARIAL',
  'L5_LONGITUDINAL',
]);

const probeTurnSchema = z.object({
  order: z.number().int().min(1),
  message: z.string().max(2000),
  waitForResponseMs: z.number().int().min(1000).max(300_000),
  notes: z.string().max(1000),
  isOptional: z.boolean().optional(),
  triggerKeywords: z.array(z.string()).optional(),
  continueOnTimeout: z.boolean().optional(),
});

const listQuerySchema = z.object({
  vertical: z.string().optional(),
  level: probeLevelEnum.optional(),
  isOfficial: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
});

const createBodySchema = z.object({
  name: z.string().min(2).max(100),
  verticalSlug: z.string().min(2).max(80),
  level: probeLevelEnum,
  objective: z.string().min(10).max(500),
  estimatedMinutes: z.number().int().min(1).max(120),
  turns: z.array(probeTurnSchema).min(1).max(30),
  waitMinMs: z.number().int().min(500).max(60_000).optional(),
  waitMaxMs: z.number().int().min(500).max(60_000).optional(),
});

const updateBodySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  objective: z.string().min(10).max(500).optional(),
  estimatedMinutes: z.number().int().min(1).max(120).optional(),
  turns: z.array(probeTurnSchema).min(1).max(30).optional(),
  waitMinMs: z.number().int().min(500).max(60_000).optional(),
  waitMaxMs: z.number().int().min(500).max(60_000).optional(),
  isActive: z.boolean().optional(),
});

const cloneBodySchema = z.object({
  name: z.string().min(2).max(100).optional(),
});

// ─── Plugin ───────────────────────────────────────────────────────

/** Register probe-script CRUD routes on a Fastify instance. */
export function researchScriptsRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;
  const repo = createScriptRepository(prisma);

  // GET /research/scripts
  fastify.get(
    '/research/scripts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { vertical, level, isOfficial, isActive } = parsed.data;

      const scripts = await repo.findAll({
        ...(vertical !== undefined && { verticalSlug: vertical }),
        ...(level !== undefined && { level: level as $Enums.ProbeLevel }),
        ...(isOfficial !== undefined && { isOfficial }),
        ...(isActive !== undefined && { isActive }),
      });

      await sendSuccess(reply, { items: scripts, total: scripts.length });
    },
  );

  // POST /research/scripts
  fastify.post(
    '/research/scripts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'master-key';

      const data = parsed.data;
      const input: CreateScriptInput = {
        name: data.name,
        verticalSlug: data.verticalSlug,
        level: data.level as $Enums.ProbeLevel,
        objective: data.objective,
        estimatedMinutes: data.estimatedMinutes,
        turns: data.turns,
        waitMinMs: data.waitMinMs,
        waitMaxMs: data.waitMaxMs,
        isOfficial: false,
        createdBy: actorEmail,
      };

      const script = await repo.create(input);

      logger.info('research: script created', {
        component: 'research-scripts',
        scriptId: script.id,
        actorEmail,
      });

      await reply.code(201);
      await sendSuccess(reply, script);
    },
  );

  // GET /research/scripts/:id
  fastify.get(
    '/research/scripts/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const script = await repo.findById(request.params.id);
      if (!script) {
        await sendNotFound(reply, 'ProbeScript', request.params.id);
        return;
      }
      await sendSuccess(reply, script);
    },
  );

  // PATCH /research/scripts/:id
  fastify.patch(
    '/research/scripts/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = updateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'master-key';
      const input: UpdateScriptInput = {
        ...parsed.data,
        updatedBy: actorEmail,
      };

      const result = await repo.update(request.params.id, input);
      if (!result.ok) {
        await sendNotFound(reply, 'ProbeScript', request.params.id);
        return;
      }

      logger.info('research: script updated', {
        component: 'research-scripts',
        scriptId: request.params.id,
        actorEmail,
      });

      await sendSuccess(reply, result.value);
    },
  );

  // DELETE /research/scripts/:id
  fastify.delete(
    '/research/scripts/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const result = await repo.delete(request.params.id);
      if (!result.ok) {
        const deleteErr = result.error;
        if (deleteErr.researchCode === 'SCRIPT_INVALID') {
          await sendError(
            reply,
            'SCRIPT_HAS_SESSIONS',
            deleteErr.message,
            409,
          );
          return;
        }
        await sendNotFound(reply, 'ProbeScript', request.params.id);
        return;
      }

      logger.info('research: script deleted', {
        component: 'research-scripts',
        scriptId: request.params.id,
        actorEmail: request.superAdminEmail ?? 'master-key',
      });

      await reply.code(204).send();
    },
  );

  // POST /research/scripts/:id/clone
  fastify.post(
    '/research/scripts/:id/clone',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = cloneBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'master-key';
      const result = await repo.clone(request.params.id, {
        name: parsed.data.name,
        createdBy: actorEmail,
      });

      if (!result.ok) {
        await sendNotFound(reply, 'ProbeScript', request.params.id);
        return;
      }

      logger.info('research: script cloned', {
        component: 'research-scripts',
        sourceId: request.params.id,
        clonedId: result.value.id,
        actorEmail,
      });

      await reply.code(201);
      await sendSuccess(reply, result.value);
    },
  );
}
