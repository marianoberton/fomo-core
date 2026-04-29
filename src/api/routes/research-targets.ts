/**
 * Research Target routes (super_admin only).
 *
 * GET    /research/targets                 — list with filters
 * POST   /research/targets                 — create single target
 * POST   /research/targets/bulk            — bulk import (JSON array or CSV)
 * GET    /research/targets/:id             — detail + sessions + audit trail
 * PATCH  /research/targets/:id             — edit metadata
 * PATCH  /research/targets/:id/status      — change status
 * DELETE /research/targets/:id?reason=dsar — DSAR delete (tombstone + cascade)
 *
 * Every mutating operation writes an entry to `research_audit_log`.
 * All routes are guarded by `requireSuperAdmin` (applied at plugin scope).
 * See NEXUS_INTELLIGENCE_PLAN.md §Fase 1.3 + §Compliance.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import {
  createResearchTargetRepository,
} from '@/research/repositories/target-repository.js';
import { createResearchVerticalRepository } from '@/research/repositories/vertical-repository.js';
import {
  validateTargetSource,
  getBlockedCountryCodes,
} from '@/research/compliance/target-validator.js';

// ─── Schemas ─────────────────────────────────────────────────────

const E164_REGEX = /^\+[1-9]\d{6,14}$/;
const BLOCKED_COUNTRIES = new Set(getBlockedCountryCodes());
const TARGET_SOURCE_TYPES = ['url', 'screenshot', 'referral', 'other'] as const;
const TARGET_STATUSES = ['pending', 'active', 'completed', 'paused', 'failed', 'banned'] as const;

const createTargetSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  phoneNumber: z
    .string()
    .regex(E164_REGEX, 'phoneNumber must be E.164 format (e.g. +5491156781234)'),
  verticalSlug: z.string().min(1).max(60),
  country: z
    .string()
    .length(2)
    .toUpperCase()
    .default('AR')
    .refine(
      (c) => !BLOCKED_COUNTRIES.has(c),
      (c) => ({ message: `Country "${c}" is blocked (GDPR/equivalent jurisdiction)` }),
    ),
  sourceType: z.enum(TARGET_SOURCE_TYPES),
  sourceValue: z.string().min(1),
  notes: z.string().max(2000).optional(),
  priority: z.number().int().min(1).max(10).default(1),
  tags: z.array(z.string().max(50)).max(20).default([]),
});

const updateTargetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  company: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const updateStatusSchema = z
  .object({
    status: z.enum(TARGET_STATUSES),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (d) => d.status !== 'banned' || (d.reason !== undefined && d.reason.length > 0),
    { message: 'reason is required when setting status to "banned"' },
  );

const listQuerySchema = z.object({
  vertical: z.string().optional(),
  status: z.enum(TARGET_STATUSES).optional(),
  country: z.string().length(2).optional(),
  priority: z.coerce.number().int().optional(),
  optedOut: z.enum(['true', 'false']).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const bulkCreateSchema = z.array(createTargetSchema).min(1).max(500);

// ─── Audit log helper ─────────────────────────────────────────────

async function writeAuditLog(
  prisma: RouteDependencies['prisma'],
  params: {
    actorEmail: string;
    action: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  await prisma.researchAuditLog.create({
    data: {
      actorEmail: params.actorEmail,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      payload: (params.payload ?? {}) as Prisma.InputJsonValue,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
  });
}

// ─── Route factory ────────────────────────────────────────────────

/** Register research target routes inside a scoped Fastify plugin. */
export function researchTargetsRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;
  const targetRepo = createResearchTargetRepository(prisma);
  const verticalRepo = createResearchVerticalRepository(prisma);

  // Apply super_admin guard to all routes in this scope
  fastify.addHook('preHandler', requireSuperAdmin({ logger }));

  // ─── GET /research/targets ──────────────────────────────────────

  fastify.get('/research/targets', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
      return;
    }

    const { vertical, status, country, priority, optedOut, q, limit, offset } =
      parsed.data;

    const targets = await targetRepo.findAll({
      verticalSlug: vertical,
      status,
      country,
      priority,
      optedOut:
        optedOut === 'true' ? true : optedOut === 'false' ? false : undefined,
      q,
      limit,
      offset,
    });

    await sendSuccess(reply, { items: targets, total: targets.length });
  });

  // ─── POST /research/targets ─────────────────────────────────────

  fastify.post('/research/targets', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createTargetSchema.safeParse(request.body);
    if (!parsed.success) {
      await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
      return;
    }

    const data = parsed.data;
    const actorEmail = request.superAdminEmail ?? 'api-key';

    // Compliance check
    const complianceResult = validateTargetSource({
      phoneNumber: data.phoneNumber,
      country: data.country,
      verticalSlug: data.verticalSlug,
      sourceType: data.sourceType,
      sourceValue: data.sourceValue,
      name: data.name,
      company: data.company,
    });
    if (!complianceResult.ok) {
      await sendError(
        reply,
        'COMPLIANCE_BLOCKED',
        complianceResult.error.message,
        403,
      );
      return;
    }

    // Vertical must exist and be active
    const vertical = await verticalRepo.findBySlug(data.verticalSlug);
    if (!vertical) {
      await sendError(reply, 'NOT_FOUND', `Vertical "${data.verticalSlug}" not found`, 404);
      return;
    }
    if (!vertical.isActive) {
      await sendError(
        reply,
        'VALIDATION_ERROR',
        `Vertical "${data.verticalSlug}" is not active`,
        400,
      );
      return;
    }

    // Duplicate phoneNumber check (nicer error than DB throw)
    const existing = await targetRepo.findByPhoneNumber(data.phoneNumber);
    if (existing) {
      await sendError(
        reply,
        'CONFLICT',
        `Target with phoneNumber "${data.phoneNumber}" already exists (id: ${existing.id})`,
        409,
      );
      return;
    }

    const target = await targetRepo.create({ ...data, createdBy: actorEmail });

    await writeAuditLog(prisma, {
      actorEmail,
      action: 'target.create',
      entityType: 'ResearchTarget',
      entityId: target.id,
      payload: {
        name: target.name,
        company: target.company,
        verticalSlug: target.verticalSlug,
        country: target.country,
      },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    logger.info('research: target created', {
      component: 'research-targets',
      targetId: target.id,
      verticalSlug: target.verticalSlug,
      actor: actorEmail,
    });

    await sendSuccess(reply, { target }, 201);
  });

  // ─── POST /research/targets/bulk ────────────────────────────────

  fastify.post(
    '/research/targets/bulk',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = bulkCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const rows = parsed.data;
      const complianceErrors: Array<{ row: number; phoneNumber: string; reason: string }> = [];
      const validItems: typeof rows = [];

      // Compliance-filter rows
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const complianceResult = validateTargetSource({
          phoneNumber: row.phoneNumber,
          country: row.country,
          verticalSlug: row.verticalSlug,
          sourceType: row.sourceType,
          sourceValue: row.sourceValue,
          name: row.name,
          company: row.company,
        });
        if (!complianceResult.ok) {
          complianceErrors.push({
            row: i + 1,
            phoneNumber: row.phoneNumber,
            reason: complianceResult.error.message,
          });
        } else {
          validItems.push(row);
        }
      }

      const result = await targetRepo.bulkCreate(
        validItems.map((r) => ({ ...r, createdBy: actorEmail })),
      );

      // Merge compliance errors + DB errors
      const allErrors = [...complianceErrors, ...result.errors];

      await writeAuditLog(prisma, {
        actorEmail,
        action: 'target.bulk_create',
        entityType: 'ResearchTarget',
        entityId: 'bulk',
        payload: {
          total: rows.length,
          created: result.created,
          skipped: result.skipped,
          errors: allErrors.length,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: bulk import completed', {
        component: 'research-targets',
        total: rows.length,
        created: result.created,
        skipped: result.skipped,
        errors: allErrors.length,
        actor: actorEmail,
      });

      await sendSuccess(reply, {
        created: result.created,
        skipped: result.skipped,
        errors: allErrors,
      }, 207);
    },
  );

  // ─── GET /research/targets/:id ──────────────────────────────────

  fastify.get(
    '/research/targets/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const target = await targetRepo.findById(id);
      if (!target) {
        await sendNotFound(reply, 'ResearchTarget', id);
        return;
      }

      // Include sessions and audit trail for the detail view
      const [sessions, auditLog] = await Promise.all([
        prisma.researchSession.findMany({
          where: { targetId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            status: true,
            currentTurn: true,
            startedAt: true,
            completedAt: true,
            failReason: true,
            triggeredBy: true,
            createdAt: true,
            script: { select: { name: true, level: true } },
            analysis: { select: { scoreTotal: true, analyzedAt: true } },
          },
        }),
        prisma.researchAuditLog.findMany({
          where: { entityType: 'ResearchTarget', entityId: id },
          orderBy: { at: 'desc' },
          take: 100,
        }),
      ]);

      await sendSuccess(reply, { target, sessions, auditLog });
    },
  );

  // ─── PATCH /research/targets/:id ────────────────────────────────

  fastify.patch(
    '/research/targets/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const parsed = updateTargetSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const target = await targetRepo.findById(id);
      if (!target) {
        await sendNotFound(reply, 'ResearchTarget', id);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const updated = await targetRepo.update(id, {
        ...parsed.data,
        updatedBy: actorEmail,
      });

      await writeAuditLog(prisma, {
        actorEmail,
        action: 'target.update',
        entityType: 'ResearchTarget',
        entityId: id,
        payload: parsed.data as Record<string, unknown>,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      await sendSuccess(reply, { target: updated });
    },
  );

  // ─── PATCH /research/targets/:id/status ─────────────────────────

  fastify.patch(
    '/research/targets/:id/status',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const parsed = updateStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const target = await targetRepo.findById(id);
      if (!target) {
        await sendNotFound(reply, 'ResearchTarget', id);
        return;
      }

      if (target.dsarDeletedAt) {
        await sendError(reply, 'GONE', 'Target has been DSAR-deleted', 410);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const updated = await targetRepo.updateStatus(
        id,
        parsed.data.status,
        parsed.data.reason,
        actorEmail,
      );

      await writeAuditLog(prisma, {
        actorEmail,
        action: 'target.status_change',
        entityType: 'ResearchTarget',
        entityId: id,
        payload: {
          previousStatus: target.status,
          newStatus: parsed.data.status,
          reason: parsed.data.reason,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: target status changed', {
        component: 'research-targets',
        targetId: id,
        from: target.status,
        to: parsed.data.status,
        actor: actorEmail,
      });

      await sendSuccess(reply, { target: updated });
    },
  );

  // ─── DELETE /research/targets/:id?reason=dsar ───────────────────

  fastify.delete(
    '/research/targets/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { reason?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const { reason } = request.query;

      if (reason !== 'dsar') {
        await sendError(
          reply,
          'BAD_REQUEST',
          'Only DSAR deletes are supported. Include ?reason=dsar in the request.',
          400,
        );
        return;
      }

      const target = await targetRepo.findById(id);
      if (!target) {
        await sendNotFound(reply, 'ResearchTarget', id);
        return;
      }

      if (target.dsarDeletedAt) {
        await sendError(reply, 'GONE', 'Target has already been DSAR-deleted', 410);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'api-key';
      const result = await targetRepo.dsarDelete(id);

      // Audit log with minimal payload (no phoneNumber per DSAR minimisation)
      await writeAuditLog(prisma, {
        actorEmail,
        action: 'target.dsar_delete',
        entityType: 'ResearchTarget',
        entityId: id,
        payload: {
          name: target.name,
          company: target.company,
          country: target.country,
          verticalSlug: target.verticalSlug,
          sessionsDeleted: result.sessionsDeleted,
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: DSAR delete completed', {
        component: 'research-targets',
        targetId: id,
        sessionsDeleted: result.sessionsDeleted,
        actor: actorEmail,
      });

      await sendSuccess(reply, {
        id,
        dsarDeletedAt: result.dsarDeletedAt,
        sessionsDeleted: result.sessionsDeleted,
      });
    },
  );
}
