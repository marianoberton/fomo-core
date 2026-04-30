/**
 * Research Schedule routes (§5.5).
 *
 * All routes require super_admin (guard applied at plugin scope in index.ts).
 *
 * GET    /research/targets/:id/schedules    — list schedules for a target
 * POST   /research/targets/:id/schedules    — create schedule
 * PATCH  /research/schedules/:id            — update frequency/phone/script
 * POST   /research/schedules/:id/activate   — activate paused schedule
 * POST   /research/schedules/:id/deactivate — pause without deleting
 * DELETE /research/schedules/:id            — delete schedule
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createResearchScheduleRepository } from '@/research/repositories/schedule-repository.js';
import { createScheduleManager } from '@/research/scheduling/schedule-manager.js';
import type { ResearchSessionScheduleId } from '@/research/types.js';

// ─── Schemas ──────────────────────────────────────────────────────

const createScheduleBodySchema = z.object({
  scriptId: z.string().min(1),
  phoneId: z.string().min(1),
  /** Milliseconds between runs. Default: 14 days (L1 baseline). */
  intervalMs: z.number().int().positive().optional().default(14 * 24 * 60 * 60 * 1000),
  /** Cron expression (alternative to intervalMs). */
  cronExpr: z.string().optional(),
  /** Jitter in ms — ±jitterMs applied to nextRunAt. Default: 2h. */
  jitterMs: z.number().int().min(0).optional(),
});

const updateScheduleBodySchema = z.object({
  intervalMs: z.number().int().positive().optional(),
  cronExpr: z.string().optional(),
  jitterMs: z.number().int().min(0).optional(),
  phoneId: z.string().min(1).optional(),
  scriptId: z.string().min(1).optional(),
});

// ─── Serialization helper ─────────────────────────────────────────
//
// Prisma stores intervalMs as BigInt. JSON.stringify throws on BigInt,
// so we convert to number (safe — max interval is 30d = 2_592_000_000,
// within Number.MAX_SAFE_INTEGER).

function serializeSchedule(s: import('@prisma/client').ResearchSessionSchedule) {
  return {
    ...s,
    intervalMs: s.intervalMs !== null ? Number(s.intervalMs) : null,
  };
}

// ─── Plugin ───────────────────────────────────────────────────────

export function researchSchedulesRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;
  const scheduleRepo = createResearchScheduleRepository(prisma);
  const scheduleManager = createScheduleManager({ prisma, scheduleRepo, logger });

  // ─── GET /research/targets/:id/schedules ────────────────────────
  fastify.get(
    '/research/targets/:id/schedules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const schedules = await scheduleRepo.listByTarget(id);
      await sendSuccess(reply, { items: schedules.map(serializeSchedule), total: schedules.length });
    },
  );

  // ─── POST /research/targets/:id/schedules ───────────────────────
  fastify.post(
    '/research/targets/:id/schedules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: targetId } = request.params as { id: string };
      const parsed = createScheduleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { scriptId, phoneId, intervalMs, cronExpr, jitterMs } = parsed.data;

      // Compute initial nextRunAt from now + intervalMs (or cron)
      const now = new Date();
      let nextRunAt: Date;
      if (cronExpr) {
        const { CronExpressionParser } = await import('cron-parser');
        nextRunAt = CronExpressionParser.parse(cronExpr, { currentDate: now }).next().toDate();
      } else {
        nextRunAt = new Date(now.getTime() + intervalMs);
      }

      const result = await scheduleManager.createSchedule({
        targetId,
        scriptId,
        phoneId,
        nextRunAt,
        intervalMs: cronExpr ? undefined : intervalMs,
        cronExpr,
        jitterMs,
      });

      if (!result.ok) {
        await sendError(reply, result.error.researchCode, result.error.message, result.error.statusCode);
        return;
      }

      await sendSuccess(reply, serializeSchedule(result.value), 201);
    },
  );

  // ─── PATCH /research/schedules/:id ──────────────────────────────
  fastify.patch(
    '/research/schedules/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = updateScheduleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const existing = await scheduleRepo.findById(id as ResearchSessionScheduleId);
      if (!existing) {
        await sendNotFound(reply, 'Schedule', id);
        return;
      }

      const updated = await scheduleRepo.update(id as ResearchSessionScheduleId, parsed.data);
      await sendSuccess(reply, serializeSchedule(updated));
    },
  );

  // ─── POST /research/schedules/:id/activate ──────────────────────
  fastify.post(
    '/research/schedules/:id/activate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const existing = await scheduleRepo.findById(id as ResearchSessionScheduleId);
      if (!existing) {
        await sendNotFound(reply, 'Schedule', id);
        return;
      }

      await scheduleManager.activateSchedule(id as ResearchSessionScheduleId);
      const updated = await scheduleRepo.findById(id as ResearchSessionScheduleId);
      await sendSuccess(reply, updated ? serializeSchedule(updated) : null);
    },
  );

  // ─── POST /research/schedules/:id/deactivate ────────────────────
  fastify.post(
    '/research/schedules/:id/deactivate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const existing = await scheduleRepo.findById(id as ResearchSessionScheduleId);
      if (!existing) {
        await sendNotFound(reply, 'Schedule', id);
        return;
      }

      await scheduleManager.deactivateSchedule(id as ResearchSessionScheduleId);
      const updated = await scheduleRepo.findById(id as ResearchSessionScheduleId);
      await sendSuccess(reply, updated ? serializeSchedule(updated) : null);
    },
  );

  // ─── DELETE /research/schedules/:id ─────────────────────────────
  fastify.delete(
    '/research/schedules/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const existing = await scheduleRepo.findById(id as ResearchSessionScheduleId);
      if (!existing) {
        await sendNotFound(reply, 'Schedule', id);
        return;
      }

      await prisma.researchSessionSchedule.delete({ where: { id } });

      logger.info('research schedules: schedule deleted', {
        component: 'research-schedules',
        scheduleId: id,
      });

      reply.code(204);
      await reply.send();
    },
  );
}
