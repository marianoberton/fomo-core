/**
 * Campaign Template routes — CRUD for reusable campaign templates.
 *
 * POST   /projects/:projectId/campaign-templates       — create template
 * GET    /projects/:projectId/campaign-templates       — list templates
 * GET    /projects/:projectId/campaign-templates/:id   — get template
 * PUT    /projects/:projectId/campaign-templates/:id   — update template
 * DELETE /projects/:projectId/campaign-templates/:id   — delete template
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';

// ─── Schemas ────────────────────────────────────────────────────

const channelEnum = z.enum(['whatsapp', 'telegram', 'slack', 'email']);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  variables: z.array(z.string().min(1).max(100)).max(50).optional(),
  channel: channelEnum,
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(10_000).optional(),
  variables: z.array(z.string().min(1).max(100)).max(50).optional(),
  channel: channelEnum.optional(),
  description: z.string().max(500).nullable().optional(),
});

/** Extract {{variable}} placeholders from the body if none provided. */
function extractVariables(body: string): string[] {
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) found.add(m[1]);
  }
  return [...found];
}

// ─── Routes ─────────────────────────────────────────────────────

/** Register campaign-template routes on a Fastify instance. */
export function campaignTemplateRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, logger } = opts;

  // POST /projects/:projectId/campaign-templates
  fastify.post(
    '/projects/:projectId/campaign-templates',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }
      const { projectId } = request.params;
      const data = parsed.data;
      const variables =
        data.variables && data.variables.length > 0
          ? data.variables
          : extractVariables(data.body);

      try {
        const template = await prisma.campaignTemplate.create({
          data: {
            projectId,
            name: data.name,
            body: data.body,
            variables,
            channel: data.channel,
            ...(data.description !== undefined && { description: data.description }),
          },
        });
        logger.info('Campaign template created', {
          component: 'campaign-template-routes',
          templateId: template.id,
          projectId,
        });
        await sendSuccess(reply, template, 201);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          await sendError(
            reply,
            'CONFLICT',
            `Template name "${data.name}" already exists for this project`,
            409,
          );
          return;
        }
        throw error;
      }
    },
  );

  // GET /projects/:projectId/campaign-templates
  fastify.get(
    '/projects/:projectId/campaign-templates',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const templates = await prisma.campaignTemplate.findMany({
        where: { projectId: request.params.projectId },
        orderBy: { updatedAt: 'desc' },
      });
      await sendSuccess(reply, { items: templates, total: templates.length });
    },
  );

  // GET /projects/:projectId/campaign-templates/:id
  fastify.get(
    '/projects/:projectId/campaign-templates/:id',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const template = await prisma.campaignTemplate.findUnique({
        where: { id: request.params.id },
      });
      if (!template || template.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'CampaignTemplate', request.params.id);
        return;
      }
      await sendSuccess(reply, template);
    },
  );

  // PUT /projects/:projectId/campaign-templates/:id
  fastify.put(
    '/projects/:projectId/campaign-templates/:id',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', parsed.error.message, 400);
        return;
      }

      const existing = await prisma.campaignTemplate.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'CampaignTemplate', request.params.id);
        return;
      }

      const data = parsed.data;
      const nextBody = data.body ?? existing.body;
      const nextVars =
        data.variables && data.variables.length > 0
          ? data.variables
          : data.body !== undefined
            ? extractVariables(nextBody)
            : existing.variables;

      try {
        const updated = await prisma.campaignTemplate.update({
          where: { id: request.params.id },
          data: {
            ...(data.name !== undefined && { name: data.name }),
            ...(data.body !== undefined && { body: data.body }),
            variables: nextVars,
            ...(data.channel !== undefined && { channel: data.channel }),
            ...(data.description !== undefined && { description: data.description }),
          },
        });
        await sendSuccess(reply, updated);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          await sendError(
            reply,
            'CONFLICT',
            `Template name "${data.name ?? ''}" already exists for this project`,
            409,
          );
          return;
        }
        throw error;
      }
    },
  );

  // DELETE /projects/:projectId/campaign-templates/:id
  fastify.delete(
    '/projects/:projectId/campaign-templates/:id',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const existing = await prisma.campaignTemplate.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'CampaignTemplate', request.params.id);
        return;
      }
      await prisma.campaignTemplate.delete({ where: { id: request.params.id } });
      await reply.status(204).send();
    },
  );
}
