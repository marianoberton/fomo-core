/**
 * Campaign routes — CRUD for outbound campaigns + execution trigger.
 *
 * POST   /projects/:projectId/campaigns           — create campaign
 * GET    /projects/:projectId/campaigns           — list campaigns
 * GET    /projects/:projectId/campaigns/:id       — get campaign + send stats
 * PATCH  /projects/:projectId/campaigns/:id       — update campaign
 * POST   /projects/:projectId/campaigns/:id/execute — trigger execution
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { paginationSchema } from '../pagination.js';
import { getVariantMetrics, calculateWinner } from '../../campaigns/ab-test-engine.js';
import { getCampaignMetrics } from '@/campaigns/campaign-tracker.js';
import { interpolateTemplate } from '@/campaigns/campaign-runner.js';
import type { CampaignId, ABTestResult, AudienceFilter } from '../../campaigns/types.js';
import { calculateCost } from '@/providers/models.js';

// ─── Schemas ────────────────────────────────────────────────────

const audienceFilterSchema = z.object({
  tags: z.array(z.string()).optional(),
  role: z.string().optional(),
});

const createCampaignSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).max(200),
  template: z.string().min(1).max(10_000),
  channel: z.enum(['whatsapp', 'telegram', 'slack']),
  audienceFilter: audienceFilterSchema,
  scheduledFor: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  template: z.string().min(1).max(10_000).optional(),
  channel: z.enum(['whatsapp', 'telegram', 'slack']).optional(),
  audienceFilter: audienceFilterSchema.optional(),
  status: z.enum(['draft', 'active', 'paused']).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register campaign routes on a Fastify instance. */
export function campaignRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, campaignRunner, logger } = opts;

  // POST /projects/:projectId/campaigns
  fastify.post(
    '/projects/:projectId/campaigns',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = createCampaignSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const { projectId } = request.params;
      const body = parseResult.data;

      const campaign = await prisma.campaign.create({
        data: {
          projectId,
          agentId: body.agentId,
          name: body.name,
          template: body.template,
          channel: body.channel,
          audienceFilter: body.audienceFilter as Prisma.InputJsonValue,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
          metadata: body.metadata as Prisma.InputJsonValue,
        },
      });

      logger.info('Campaign created', {
        component: 'campaign-routes',
        campaignId: campaign.id,
        projectId,
      });

      await sendSuccess(reply, campaign, 201);
    },
  );

  // GET /projects/:projectId/campaigns
  const listQuerySchema = paginationSchema.merge(
    z.object({ status: z.string().optional() }),
  );

  fastify.get(
    '/projects/:projectId/campaigns',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      const { projectId } = request.params;
      const query = listQuerySchema.parse(request.query);
      const { limit, offset, status } = query;

      const where: Prisma.CampaignWhereInput = { projectId };
      if (status) {
        where.status = status as Prisma.CampaignWhereInput['status'];
      }

      const [campaigns, total] = await Promise.all([
        prisma.campaign.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.campaign.count({ where }),
      ]);

      await sendSuccess(reply, { items: campaigns, total, limit, offset });
    },
  );

  // GET /projects/:projectId/campaigns/:id
  fastify.get(
    '/projects/:projectId/campaigns/:id',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
        include: {
          _count: { select: { sends: true } },
          sends: {
            select: { status: true },
          },
        },
      });

      if (!campaign || campaign.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      // Aggregate send stats
      const sendStats = {
        total: campaign.sends.length,
        queued: campaign.sends.filter((s) => s.status === 'queued').length,
        sent: campaign.sends.filter((s) => s.status === 'sent').length,
        failed: campaign.sends.filter((s) => s.status === 'failed').length,
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sends: _sends, _count, ...campaignData } = campaign;
      await sendSuccess(reply, { ...campaignData, sendStats });
    },
  );

  // PATCH /projects/:projectId/campaigns/:id
  fastify.patch(
    '/projects/:projectId/campaigns/:id',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const parseResult = updateCampaignSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const existing = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });

      if (existing?.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      const body = parseResult.data;

      const updated = await prisma.campaign.update({
        where: { id: request.params.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.template !== undefined && { template: body.template }),
          ...(body.channel !== undefined && { channel: body.channel }),
          ...(body.audienceFilter !== undefined && {
            audienceFilter: body.audienceFilter as Prisma.InputJsonValue,
          }),
          ...(body.status !== undefined && { status: body.status }),
          ...(body.scheduledFor !== undefined && {
            scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
          }),
          ...(body.metadata !== undefined && {
            metadata: body.metadata as Prisma.InputJsonValue,
          }),
        },
      });

      await sendSuccess(reply, updated);
    },
  );

  // GET /projects/:projectId/campaigns/:id/ab-results
  fastify.get(
    '/projects/:projectId/campaigns/:id/ab-results',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });

      if (campaign?.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      const campaignId = campaign.id as CampaignId;
      const variantMetrics = await getVariantMetrics(prisma, campaignId);
      const { winner, confidence } = calculateWinner(variantMetrics);

      // Pull winner metadata if already persisted
      const meta = campaign.metadata as Record<string, unknown> | null;
      const abMeta = meta?.['abTest'] as Record<string, unknown> | undefined;
      const persistedWinner = (abMeta?.['winner'] as string | undefined) ?? winner;
      const winnerSelectedAt = abMeta?.['winnerSelectedAt']
        ? new Date(abMeta['winnerSelectedAt'] as string)
        : null;

      const result: ABTestResult = {
        campaignId,
        variants: variantMetrics,
        winner: persistedWinner ?? null,
        winnerSelectedAt,
        confidence,
      };

      await sendSuccess(reply, result);
    },
  );

  // GET /projects/:projectId/campaigns/:id/metrics
  fastify.get(
    '/projects/:projectId/campaigns/:id/metrics',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
        select: { id: true, projectId: true },
      });

      if (campaign?.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      const metrics = await getCampaignMetrics(prisma, campaign.id as CampaignId);
      await sendSuccess(reply, metrics);
    },
  );

  // DELETE /projects/:projectId/campaigns/:id
  fastify.delete(
    '/projects/:projectId/campaigns/:id',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const existing = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });
      if (existing?.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }
      await prisma.campaign.delete({ where: { id: request.params.id } });
      await reply.status(204).send();
    },
  );

  // POST /projects/:projectId/campaigns/:id/dry-run
  fastify.post(
    '/projects/:projectId/campaigns/:id/dry-run',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });
      if (!campaign || campaign.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      if (typeof campaign.template !== 'string' || campaign.template.length === 0) {
        await sendError(reply, 'VALIDATION_ERROR', 'Campaign has no template', 400);
        return;
      }

      const filter = campaign.audienceFilter as unknown as AudienceFilter;
      const where: Prisma.ContactWhereInput = { projectId: campaign.projectId };
      if (filter.tags && filter.tags.length > 0) {
        where.tags = { hasEvery: filter.tags };
      }
      if (filter.role) where.role = filter.role;

      const [totalAudience, withPhone, withEmail, sample] = await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.count({ where: { ...where, phone: { not: null } } }),
        prisma.contact.count({ where: { ...where, email: { not: null } } }),
        prisma.contact.findMany({ where, take: 10, orderBy: { createdAt: 'desc' } }),
      ]);

      // Rough token estimate: 1 token ≈ 4 chars. Add 20 tokens for system overhead.
      const avgTokensPerMessage = Math.max(
        10,
        Math.ceil(campaign.template.length / 4) + 20,
      );
      // Cost estimate uses a conservative default model (haiku pricing).
      const estimatedTotalCostUsd = calculateCost(
        'claude-haiku-4-5',
        avgTokensPerMessage * totalAudience,
        0,
      );

      const previews = sample.map((contact) => ({
        contactId: contact.id,
        name: contact.name,
        rendered: interpolateTemplate(campaign.template, {
          name: contact.name,
          displayName: contact.displayName ?? undefined,
          phone: contact.phone ?? undefined,
          email: contact.email ?? undefined,
        }),
        channel: campaign.channel,
        estimatedTokens: avgTokensPerMessage,
      }));

      await sendSuccess(reply, {
        campaignId: campaign.id,
        totalAudience,
        estimatedTotalCostUsd,
        coverage: {
          withPhone,
          withEmail,
        },
        previews,
      });
    },
  );

  // POST /projects/:projectId/campaigns/:id/execute
  fastify.post(
    '/projects/:projectId/campaigns/:id/execute',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      if (!campaignRunner) {
        await sendError(
          reply,
          'SERVICE_UNAVAILABLE',
          'Campaign execution is not available. Redis must be configured (REDIS_URL).',
          503,
        );
        return;
      }

      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });

      if (campaign?.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      if (campaign.status !== 'active') {
        await sendError(
          reply,
          'INVALID_STATE',
          `Campaign status is "${campaign.status}", must be "active" to execute`,
          409,
        );
        return;
      }

      const result = await campaignRunner.executeCampaign(request.params.id);

      if (!result.ok) {
        await sendError(reply, 'CAMPAIGN_EXECUTION_ERROR', result.error.message, 500);
        return;
      }

      logger.info('Campaign executed via REST', {
        component: 'campaign-routes',
        ...result.value,
      });

      await sendSuccess(reply, result.value);
    },
  );
}
