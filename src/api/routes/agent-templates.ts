/**
 * Agent Template routes — global catalog of agent archetypes.
 *
 * GET    /agent-templates         — list templates (filters: type, tag, q, isOfficial)
 * GET    /agent-templates/:slug   — get template by slug (404 if missing)
 * PUT    /agent-templates/:slug   — update mutable fields (slug + type are immutable)
 * DELETE /agent-templates/:slug   — hard-delete a template
 *
 * Templates are global (no projectId). Materialization into a project's agent
 * is handled by `POST /projects/:projectId/agents/from-template` (see agents.ts).
 *
 * Authoring (POST) flows through `POST /projects/:projectId/agents/:agentId/export-as-template`
 * — there is no general-purpose "create blank template" endpoint by design.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createAgentTemplateRepository } from '@/infrastructure/repositories/agent-template-repository.js';
import type {
  AgentTemplateFilters,
  AgentTemplateType,
  UpdateAgentTemplateInput,
} from '@/infrastructure/repositories/agent-template-repository.js';
import { createPatternRepository } from '@/research/repositories/pattern-repository.js';
import { createPatternVersionRepository } from '@/research/repositories/pattern-version-repository.js';
import type { PromptPatternId } from '@/research/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const agentTypeEnum = z.enum(['conversational', 'process', 'backoffice']);

const listQuerySchema = z.object({
  type: agentTypeEnum.optional(),
  tag: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(100).optional(),
  isOfficial: z.coerce.boolean().optional(),
});

const suggestionsQuerySchema = z.object({
  verticalSlug: z.string().min(1),
  category: z.string().optional(),
});

const promptConfigSchema = z.object({
  identity: z.string().min(1),
  instructions: z.string(),
  safety: z.string(),
});

const llmConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
}).nullable();

const updateTemplateSchema = z.object({
  // Identity-shaping fields
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
  icon: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  isOfficial: z.boolean().optional(),
  // Prompt + suggestions
  promptConfig: promptConfigSchema.optional(),
  suggestedTools: z.array(z.string().min(1)).optional(),
  suggestedLlm: llmConfigSchema.optional(),
  suggestedModes: z.array(z.unknown()).nullable().optional(),
  suggestedChannels: z.array(z.string().min(1)).optional(),
  suggestedMcps: z.array(z.unknown()).nullable().optional(),
  suggestedSkillSlugs: z.array(z.string().min(1)).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  // Limits
  maxTurns: z.number().int().min(1).max(100).optional(),
  maxTokensPerTurn: z.number().int().min(100).max(32000).optional(),
  budgetPerDayUsd: z.number().min(0).max(1000).optional(),
}).strict();

// ─── Routes ─────────────────────────────────────────────────────

/** Register agent-template routes on a Fastify instance. */
export function agentTemplateRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;
  const repo = createAgentTemplateRepository(prisma);
  const patternRepo = createPatternRepository(prisma);
  const versionRepo = createPatternVersionRepository(prisma);

  // GET /agent-templates
  fastify.get(
    '/agent-templates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const filters: AgentTemplateFilters = {
        ...(parsed.data.type !== undefined && {
          type: parsed.data.type as AgentTemplateType,
        }),
        ...(parsed.data.tag !== undefined && { tag: parsed.data.tag }),
        ...(parsed.data.q !== undefined && { q: parsed.data.q }),
        ...(parsed.data.isOfficial !== undefined && {
          isOfficial: parsed.data.isOfficial,
        }),
      };

      const items = await repo.list(filters);
      await sendSuccess(reply, { items, total: items.length });
    },
  );

  // GET /agent-templates/:slug
  fastify.get(
    '/agent-templates/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;
      const template = await repo.findBySlug(slug);
      if (!template) {
        await sendNotFound(reply, 'AgentTemplate', slug);
        return;
      }
      await sendSuccess(reply, template);
    },
  );

  // GET /agent-templates/suggestions — approved patterns by vertical (for editor)
  fastify.get(
    '/agent-templates/suggestions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = suggestionsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const { verticalSlug, category } = parsed.data;

      const patterns = await patternRepo.listByVertical(verticalSlug, {
        ...(category !== undefined && { category }),
        status: 'approved',
      });

      // Attach current version text to each pattern
      const enriched = await Promise.all(
        patterns.map(async (p) => {
          const currentVersion = await versionRepo.findCurrent(p.id as PromptPatternId);
          return { ...p, currentVersion };
        }),
      );

      await sendSuccess(reply, { items: enriched, total: enriched.length });
    },
  );

  // ─── POST stub — authoring goes through export-as-template ──

  fastify.post(
    '/agent-templates',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      await sendError(
        reply,
        'NOT_IMPLEMENTED',
        'Use POST /projects/:projectId/agents/:agentId/export-as-template to author a template from an existing agent',
        501,
      );
    },
  );

  // PUT /agent-templates/:slug — update mutable fields
  fastify.put(
    '/agent-templates/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;
      const parsed = updateTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }
      const body = parsed.data;

      const existing = await repo.findBySlug(slug);
      if (!existing) {
        await sendNotFound(reply, 'AgentTemplate', slug);
        return;
      }

      // isOfficial is admin-only (master-key). Project-scoped keys silently lose
      // the flag from their payload — we never elevate without proof of admin.
      const isMaster = request.apiKeyProjectId === null;
      const patch: UpdateAgentTemplateInput = { ...body };
      if (patch.isOfficial !== undefined && !isMaster) {
        await sendError(
          reply,
          'FORBIDDEN',
          'Only master keys can flip isOfficial on an AgentTemplate',
          403,
        );
        return;
      }

      const updated = await repo.update(slug, patch);
      if (!updated) {
        await sendNotFound(reply, 'AgentTemplate', slug);
        return;
      }

      logger.info('AgentTemplate updated', {
        component: 'agent-template-routes',
        slug,
        isMaster,
      });

      await sendSuccess(reply, updated);
    },
  );

  // DELETE /agent-templates/:slug — hard delete
  fastify.delete(
    '/agent-templates/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;
      const existing = await repo.findBySlug(slug);
      if (!existing) {
        await sendNotFound(reply, 'AgentTemplate', slug);
        return;
      }

      // Official templates can only be deleted by master keys — they're shared
      // across the whole platform, not owned by any single project.
      const isMaster = request.apiKeyProjectId === null;
      if (existing.isOfficial && !isMaster) {
        await sendError(
          reply,
          'FORBIDDEN',
          `Official AgentTemplate "${slug}" can only be deleted by master keys`,
          403,
        );
        return;
      }

      const ok = await repo.delete(slug);
      if (!ok) {
        await sendNotFound(reply, 'AgentTemplate', slug);
        return;
      }

      logger.info('AgentTemplate deleted', {
        component: 'agent-template-routes',
        slug,
        wasOfficial: existing.isOfficial,
      });

      await reply.status(204).send();
    },
  );

  logger.debug('Agent template routes registered', {
    component: 'agent-template-routes',
  });
}
