/**
 * Research Session routes — lifecycle management for probe sessions.
 *
 * All routes require super_admin (guard is applied at the plugin scope in
 * src/api/routes/index.ts — see CLAUDE.md Fastify Hook Scope Rule).
 *
 * GET    /research/sessions              — list with filters
 * POST   /research/sessions              — create + queue session
 * POST   /research/sessions/batch        — batch-create for a target × level
 * GET    /research/sessions/:id          — detail + turns
 * GET    /research/sessions/:id/transcript — human-readable transcript
 * POST   /research/sessions/:id/pause    — pause active session
 * POST   /research/sessions/:id/resume   — resume paused session
 * POST   /research/sessions/:id/abort    — cancel active session
 * POST   /research/sessions/:id/retry    — retry failed session (§3.3a policy)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { $Enums } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import {
  createResearchSessionRepository,
  type CreateSessionInput,
} from '@/research/repositories/session-repository.js';
import type { ResearchSessionId } from '@/research/types.js';

// ─── Schemas ─────────────────────────────────────────────────────

const probeLevelEnum = z.enum([
  'L1_SURFACE',
  'L2_CAPABILITIES',
  'L3_ARCHITECTURE',
  'L4_ADVERSARIAL',
  'L5_LONGITUDINAL',
]);

const researchSessionStatusEnum = z.enum([
  'queued',
  'running',
  'waiting_response',
  'paused',
  'completed',
  'failed',
  'aborted',
]);

const listQuerySchema = z.object({
  targetId: z.string().optional(),
  phoneId: z.string().optional(),
  status: researchSessionStatusEnum.optional(),
  scriptLevel: probeLevelEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBodySchema = z.object({
  targetId: z.string().min(1),
  phoneId: z.string().min(1),
  scriptId: z.string().min(1),
  scheduleId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const batchBodySchema = z.object({
  targetId: z.string().min(1),
  phoneId: z.string().min(1),
  /** Run all active scripts at this level within the target's vertical. */
  level: probeLevelEnum,
});

// Non-retryable codes per §3.3a
const NON_RETRYABLE_CODES = new Set(['OPT_OUT_DETECTED', 'TARGET_BANNED', 'COMPLIANCE_BLOCKED']);
const MAX_RETRIES = 2;

// ─── Plugin ───────────────────────────────────────────────────────

export function researchSessionsRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { prisma, logger } = deps;
  const sessionRepo = createResearchSessionRepository(prisma);

  // ─── GET /research/sessions ────────────────────────────────────
  fastify.get(
    '/research/sessions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { targetId, phoneId, status, scriptLevel, limit, offset } = parsed.data;

      // Fetch sessions + enrich with related names in one query
      const sessions = await prisma.researchSession.findMany({
        where: {
          ...(targetId !== undefined && { targetId }),
          ...(phoneId !== undefined && { phoneId }),
          ...(status !== undefined && { status }),
          ...(scriptLevel !== undefined && {
            script: { level: scriptLevel as $Enums.ProbeLevel },
          }),
        },
        include: {
          target: { select: { name: true, company: true, verticalSlug: true } },
          phone: { select: { label: true } },
          script: { select: { name: true, level: true, estimatedMinutes: true } },
          analysis: { select: { id: true, scoreTotal: true, analyzedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      await sendSuccess(reply, { items: sessions, total: sessions.length });
    },
  );

  // ─── POST /research/sessions ───────────────────────────────────
  fastify.post(
    '/research/sessions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'master-key';
      const { targetId, phoneId, scriptId, scheduleId, notes } = parsed.data;

      // Verify target + phone + script exist
      const [target, phone, script] = await Promise.all([
        prisma.researchTarget.findUnique({ where: { id: targetId } }),
        prisma.researchPhone.findUnique({ where: { id: phoneId } }),
        prisma.probeScript.findUnique({ where: { id: scriptId } }),
      ]);

      if (!target) {
        await sendNotFound(reply, 'ResearchTarget', targetId);
        return;
      }
      if (!phone) {
        await sendNotFound(reply, 'ResearchPhone', phoneId);
        return;
      }
      if (!script) {
        await sendNotFound(reply, 'ProbeScript', scriptId);
        return;
      }

      const input: CreateSessionInput = {
        targetId,
        phoneId,
        scriptId,
        scheduleId,
        triggeredBy: actorEmail,
        notes,
      };

      const session = await sessionRepo.create(input);

      logger.info('research: session created', {
        component: 'research-sessions',
        sessionId: session.id,
        targetId,
        phoneId,
        scriptId,
        actorEmail,
      });

      // TODO(integration-2): enqueue research-probe-run job
      // await researchProbesQueue.add('research-probe-run', { sessionId: session.id })

      await sendSuccess(reply, session, 201);
    },
  );

  // ─── POST /research/sessions/batch ────────────────────────────
  // Must be registered BEFORE /:id to avoid route conflict
  fastify.post(
    '/research/sessions/batch',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = batchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'master-key';
      const { targetId, phoneId, level } = parsed.data;

      const target = await prisma.researchTarget.findUnique({ where: { id: targetId } });
      if (!target) {
        await sendNotFound(reply, 'ResearchTarget', targetId);
        return;
      }
      const phone = await prisma.researchPhone.findUnique({ where: { id: phoneId } });
      if (!phone) {
        await sendNotFound(reply, 'ResearchPhone', phoneId);
        return;
      }

      // Find all active scripts for this vertical + universal at the requested level
      const scripts = await prisma.probeScript.findMany({
        where: {
          isActive: true,
          level: level as $Enums.ProbeLevel,
          OR: [
            { verticalSlug: target.verticalSlug },
            { verticalSlug: 'universal' },
          ],
        },
        orderBy: { name: 'asc' },
      });

      if (scripts.length === 0) {
        await sendError(
          reply,
          'NOT_FOUND',
          `No active scripts found for vertical '${target.verticalSlug}' at level ${level}`,
          404,
        );
        return;
      }

      const created = await Promise.all(
        scripts.map((script) =>
          sessionRepo.create({
            targetId,
            phoneId,
            scriptId: script.id,
            triggeredBy: actorEmail,
          }),
        ),
      );

      logger.info('research: batch sessions created', {
        component: 'research-sessions',
        count: created.length,
        targetId,
        phoneId,
        level,
        actorEmail,
      });

      // TODO(integration-2): enqueue research-probe-run job for each session
      // for (const s of created) { await researchProbesQueue.add(...) }

      await sendSuccess(reply, { sessions: created, count: created.length }, 201);
    },
  );

  // ─── GET /research/sessions/:id ───────────────────────────────
  fastify.get(
    '/research/sessions/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const session = await prisma.researchSession.findUnique({
        where: { id },
        include: {
          target: { select: { name: true, company: true, verticalSlug: true, phoneNumber: true } },
          phone: { select: { label: true, wahaSession: true } },
          script: { select: { name: true, level: true, objective: true, estimatedMinutes: true } },
          turns: { orderBy: [{ turnOrder: 'asc' }, { direction: 'asc' }] },
          analysis: true,
        },
      });

      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      await sendSuccess(reply, session);
    },
  );

  // ─── GET /research/sessions/:id/transcript ────────────────────
  fastify.get(
    '/research/sessions/:id/transcript',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const session = await prisma.researchSession.findUnique({
        where: { id },
        include: {
          target: { select: { name: true, company: true } },
          script: { select: { name: true, level: true, turns: true } },
          turns: { orderBy: [{ turnOrder: 'asc' }, { direction: 'asc' }] },
        },
      });

      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      // Build transcript items with display metadata
      const items = session.turns.map((turn) => ({
        id: turn.id,
        turnOrder: turn.turnOrder,
        direction: turn.direction,
        message: turn.message,
        timestamp: turn.timestamp,
        latencyMs: turn.latencyMs,
        isTimeout: turn.isTimeout,
        sanitized: turn.sanitized,
        redactionsCount: turn.redactionsCount,
      }));

      await sendSuccess(reply, {
        sessionId: id,
        target: session.target,
        script: { name: session.script.name, level: session.script.level },
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        turns: items,
      });
    },
  );

  // ─── POST /research/sessions/:id/pause ────────────────────────
  fastify.post(
    '/research/sessions/:id/pause',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const session = await sessionRepo.findById(id as ResearchSessionId);
      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      if (!['queued', 'running', 'waiting_response'].includes(session.status)) {
        await sendError(
          reply,
          'CONFLICT',
          `Session is in '${session.status}' state and cannot be paused`,
          409,
        );
        return;
      }

      const updated = await sessionRepo.updateStatus(id as ResearchSessionId, 'paused');
      logger.info('research: session paused', {
        component: 'research-sessions',
        sessionId: id,
        actor: request.superAdminEmail,
      });
      await sendSuccess(reply, updated);
    },
  );

  // ─── POST /research/sessions/:id/resume ───────────────────────
  fastify.post(
    '/research/sessions/:id/resume',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const session = await sessionRepo.findById(id as ResearchSessionId);
      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      if (session.status !== 'paused') {
        await sendError(
          reply,
          'CONFLICT',
          `Session is in '${session.status}' state and cannot be resumed`,
          409,
        );
        return;
      }

      const updated = await sessionRepo.updateStatus(id as ResearchSessionId, 'queued');
      logger.info('research: session resumed', {
        component: 'research-sessions',
        sessionId: id,
        actor: request.superAdminEmail,
      });

      // TODO(integration-2): re-enqueue research-probe-run job
      await sendSuccess(reply, updated);
    },
  );

  // ─── POST /research/sessions/:id/abort ────────────────────────
  fastify.post(
    '/research/sessions/:id/abort',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const session = await sessionRepo.findById(id as ResearchSessionId);
      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      if (['completed', 'failed', 'aborted'].includes(session.status)) {
        await sendError(
          reply,
          'CONFLICT',
          `Session is already in terminal state '${session.status}'`,
          409,
        );
        return;
      }

      const updated = await sessionRepo.abort(id as ResearchSessionId, 'MANUAL_ABORT');
      logger.info('research: session aborted', {
        component: 'research-sessions',
        sessionId: id,
        actor: request.superAdminEmail,
      });
      await sendSuccess(reply, updated);
    },
  );

  // ─── POST /research/sessions/:id/retry ────────────────────────
  fastify.post(
    '/research/sessions/:id/retry',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const actorEmail = request.superAdminEmail ?? 'master-key';

      const session = await sessionRepo.findById(id as ResearchSessionId);
      if (!session) {
        await sendNotFound(reply, 'ResearchSession', id);
        return;
      }

      // Only failed sessions can be retried
      if (session.status !== 'failed') {
        await sendError(
          reply,
          'CONFLICT',
          `Only 'failed' sessions can be retried — current status: '${session.status}'`,
          409,
        );
        return;
      }

      // Non-retryable codes (§3.3a)
      if (session.failCode !== null && NON_RETRYABLE_CODES.has(session.failCode)) {
        await sendError(
          reply,
          'CONFLICT',
          `Sessions with failCode '${session.failCode}' cannot be retried`,
          409,
        );
        return;
      }

      // Retry count cap
      if (session.retryCount >= MAX_RETRIES) {
        await sendError(
          reply,
          'CONFLICT',
          `Session has already been retried ${session.retryCount} time(s) — max is ${MAX_RETRIES}`,
          409,
        );
        return;
      }

      // Clone the session with retryCount + 1
      const newSession = await sessionRepo.create({
        targetId: session.targetId,
        phoneId: session.phoneId,
        scriptId: session.scriptId,
        scheduleId: session.scheduleId ?? undefined,
        triggeredBy: actorEmail,
        notes: `retry-of:${id}`,
      });

      await sessionRepo.incrementRetryCount(newSession.id as ResearchSessionId);

      logger.info('research: session retry created', {
        component: 'research-sessions',
        originalSessionId: id,
        newSessionId: newSession.id,
        retryCount: session.retryCount + 1,
        actorEmail,
      });

      // TODO(integration-2): enqueue research-probe-run job for newSession.id

      await sendSuccess(reply, { original: { id, status: session.status }, retry: newSession }, 201);
    },
  );

}
