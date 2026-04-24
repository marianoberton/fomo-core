/**
 * Agent Template routes — read-only access to the global catalog of agent archetypes.
 *
 * GET    /agent-templates         — list templates (filters: type, tag, q, isOfficial)
 * GET    /agent-templates/:slug   — get template by slug (404 if missing)
 *
 * POST   /agent-templates         — 501 (TODO v2: create custom non-official)
 * PUT    /agent-templates/:slug   — 501 (TODO v2: update non-official)
 * DELETE /agent-templates/:slug   — 501 (TODO v2: delete non-official)
 *
 * Templates are global (no projectId). Materialization into a project's agent
 * is handled by `POST /projects/:projectId/agents/from-template` (see agents.ts).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createAgentTemplateRepository } from '@/infrastructure/repositories/agent-template-repository.js';
import type {
  AgentTemplateFilters,
  AgentTemplateType,
} from '@/infrastructure/repositories/agent-template-repository.js';

// ─── Schemas ────────────────────────────────────────────────────

const agentTypeEnum = z.enum(['conversational', 'process', 'backoffice']);

const listQuerySchema = z.object({
  type: agentTypeEnum.optional(),
  tag: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(100).optional(),
  isOfficial: z.coerce.boolean().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register agent-template routes on a Fastify instance. */
export function agentTemplateRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;
  const repo = createAgentTemplateRepository(prisma);

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

  // ─── v2 stubs ───────────────────────────────────────────────

  const notImplemented = async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    await sendError(
      reply,
      'NOT_IMPLEMENTED',
      'Custom (non-official) AgentTemplate CRUD is planned for v2',
      501,
    );
  };

  fastify.post('/agent-templates', notImplemented);
  fastify.put('/agent-templates/:slug', notImplemented);
  fastify.delete('/agent-templates/:slug', notImplemented);

  logger.debug('Agent template routes registered', {
    component: 'agent-template-routes',
  });
}
