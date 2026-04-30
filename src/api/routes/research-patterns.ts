/**
 * Research Patterns routes (super_admin only).
 *
 * GET    /research/patterns            — list with filters
 * GET    /research/patterns/:id        — detail including versions
 * PATCH  /research/patterns/:id        — edit text (creates new version, resets to pending)
 * PATCH  /research/patterns/:id/approve    — approve for template use
 * PATCH  /research/patterns/:id/supersede  — manually supersede
 * POST   /research/patterns/:id/uses       — register a pattern use (open auth — called from agent editor)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createPatternRepository } from '@/research/repositories/pattern-repository.js';
import { createPatternVersionRepository } from '@/research/repositories/pattern-version-repository.js';
import { createPatternUseRepository } from '@/research/repositories/pattern-use-repository.js';
import { createResearchAuditLogRepository } from '@/research/repositories/audit-log-repository.js';
import type { PromptPatternId } from '@/research/types.js';

// ─── Schemas ─────────────────────────────────────────────────────

const listQuerySchema = z.object({
  vertical: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'superseded']).optional(),
});

const editBodySchema = z.object({
  patternText: z.string().min(1).max(5000),
  patternVariables: z.array(z.string()).optional(),
  notes: z.string().max(1000).optional(),
});

const registerUseBodySchema = z.object({
  patternVersionId: z.string().min(1),
  agentTemplateSlug: z.string().min(1),
  insertedBy: z.string().optional(),
  scoreAtInsertion: z.number().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

export function researchPatternsRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;
  const patternRepo = createPatternRepository(prisma);
  const versionRepo = createPatternVersionRepository(prisma);
  const useRepo = createPatternUseRepository(prisma);
  const auditRepo = createResearchAuditLogRepository(prisma);

  fastify.addHook('preHandler', requireSuperAdmin({ logger }));

  // GET /research/patterns
  fastify.get(
    '/research/patterns',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { vertical, category, status } = parsed.data;

      const items = await patternRepo.list({
        ...(vertical !== undefined && { verticalSlug: vertical }),
        ...(category !== undefined && { category }),
        ...(status !== undefined && { status }),
      });

      // Attach current version to each pattern
      const enriched = await Promise.all(
        items.map(async (p) => {
          const currentVersion = await versionRepo.findCurrent(p.id as PromptPatternId);
          return { ...p, currentVersion };
        }),
      );

      await sendSuccess(reply, { items: enriched, total: enriched.length });
    },
  );

  // GET /research/patterns/:id
  fastify.get(
    '/research/patterns/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const pattern = await patternRepo.findById(id as PromptPatternId);
      if (!pattern) {
        await sendNotFound(reply, 'PromptPattern', id);
        return;
      }

      const versions = await versionRepo.listByPattern(id as PromptPatternId);
      await sendSuccess(reply, { pattern, versions });
    },
  );

  // PATCH /research/patterns/:id — edit text → new version + reset to pending
  fastify.patch(
    '/research/patterns/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const actor = request.superAdminEmail ?? 'api-key';

      const bodyParsed = editBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.message, 400);
        return;
      }

      const existing = await patternRepo.findById(id as PromptPatternId);
      if (!existing) {
        await sendNotFound(reply, 'PromptPattern', id);
        return;
      }

      // Create new version (auto-bumps number, flips isCurrent)
      const newVersion = await versionRepo.create({
        patternId: id as PromptPatternId,
        patternText: bodyParsed.data.patternText,
        patternVariables: bodyParsed.data.patternVariables,
        notes: bodyParsed.data.notes,
        editedBy: actor,
      });

      // Reset pattern to pending (requires re-approval per §6.4b)
      const pattern = await prisma.promptPattern.update({
        where: { id },
        data: { status: 'pending', approvedBy: null, approvedAt: null },
      });

      await auditRepo.log({
        actorEmail: actor,
        action: 'pattern.edit',
        entityType: 'PromptPattern',
        entityId: id,
        payload: { newVersionNumber: newVersion.versionNumber },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: pattern version created', {
        component: 'research-patterns',
        patternId: id,
        versionNumber: newVersion.versionNumber,
        actor,
      });

      await sendSuccess(reply, { pattern, version: newVersion });
    },
  );

  // PATCH /research/patterns/:id/approve
  fastify.patch(
    '/research/patterns/:id/approve',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const actor = request.superAdminEmail ?? 'api-key';

      const existing = await patternRepo.findById(id as PromptPatternId);
      if (!existing) {
        await sendNotFound(reply, 'PromptPattern', id);
        return;
      }

      const pattern = await patternRepo.markApproved(id as PromptPatternId, actor);

      await auditRepo.log({
        actorEmail: actor,
        action: 'pattern.approve',
        entityType: 'PromptPattern',
        entityId: id,
        payload: { verticalSlug: existing.verticalSlug, category: existing.category },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: pattern approved', {
        component: 'research-patterns',
        patternId: id,
        actor,
      });

      await sendSuccess(reply, { pattern });
    },
  );

  // PATCH /research/patterns/:id/supersede
  fastify.patch(
    '/research/patterns/:id/supersede',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const actor = request.superAdminEmail ?? 'api-key';

      const existing = await patternRepo.findById(id as PromptPatternId);
      if (!existing) {
        await sendNotFound(reply, 'PromptPattern', id);
        return;
      }

      const pattern = await patternRepo.markSuperseded(id as PromptPatternId);

      await auditRepo.log({
        actorEmail: actor,
        action: 'pattern.supersede',
        entityType: 'PromptPattern',
        entityId: id,
        payload: { manual: true },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('research: pattern superseded (manual)', {
        component: 'research-patterns',
        patternId: id,
        actor,
      });

      await sendSuccess(reply, { pattern });
    },
  );

  // POST /research/patterns/:id/uses — track that a pattern was inserted into an agent prompt
  fastify.post(
    '/research/patterns/:id/uses',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const bodyParsed = registerUseBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.message, 400);
        return;
      }

      const { patternVersionId, agentTemplateSlug, insertedBy, scoreAtInsertion } = bodyParsed.data;

      const use = await useRepo.create({
        patternId: id as PromptPatternId,
        patternVersionId,
        agentTemplateSlug,
        insertedBy,
        scoreAtInsertion,
      });

      logger.info('research: pattern use registered', {
        component: 'research-patterns',
        patternId: id,
        agentTemplateSlug,
      });

      await sendSuccess(reply, { id: use.id }, 201);
    },
  );
}
