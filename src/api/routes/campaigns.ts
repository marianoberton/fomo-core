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
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { paginationSchema } from '../pagination.js';
import { getVariantMetrics, calculateWinner } from '../../campaigns/ab-test-engine.js';
import { getCampaignMetrics } from '@/campaigns/campaign-tracker.js';
import { interpolateTemplate } from '@/campaigns/campaign-runner.js';
import type {
  CampaignId,
  ABTestResult,
  AudienceFilter,
  AudienceSource,
} from '../../campaigns/types.js';
import type { ProjectId } from '@/core/types.js';
import type { AgentId } from '@/agents/types.js';
import { calculateCost } from '@/providers/models.js';

// ─── Schemas ────────────────────────────────────────────────────

const audienceFilterSchema = z.object({
  tags: z.array(z.string()).optional(),
  role: z.string().optional(),
});

const audienceSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('contacts'),
    filter: audienceFilterSchema,
  }),
  z.object({
    kind: z.literal('mcp'),
    serverName: z.string().min(1).max(100),
    toolName: z.string().min(1).max(200),
    args: z.record(z.string(), z.unknown()),
    mapping: z.object({
      contactIdField: z.string().min(1),
      phoneField: z.string().optional(),
      emailField: z.string().optional(),
      nameField: z.string().optional(),
    }),
    ttlHours: z.number().int().min(1).max(24 * 30).default(24),
  }),
]);

const createCampaignSchema = z
  .object({
    agentId: z.string().min(1),
    name: z.string().min(1).max(200),
    template: z.string().min(1).max(10_000),
    channel: z.enum(['whatsapp', 'telegram', 'slack']),
    audienceFilter: audienceFilterSchema.optional(),
    audienceSource: audienceSourceSchema.optional(),
    scheduledTaskId: z.string().min(1).optional(),
    scheduledFor: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((d) => d.audienceFilter !== undefined || d.audienceSource !== undefined, {
    message: 'Either audienceFilter or audienceSource is required',
    path: ['audienceFilter'],
  });

// PATCH cannot set status='cancelled' — use POST /:id/cancel instead so the
// cancellation is traced and the cancelledAt timestamp is populated.
const updateCampaignSchema = z
  .object({
    agentId: z.string().min(1).optional(),
    name: z.string().min(1).max(200).optional(),
    template: z.string().min(1).max(10_000).optional(),
    channel: z.enum(['whatsapp', 'telegram', 'slack']).optional(),
    audienceFilter: audienceFilterSchema.optional(),
    audienceSource: audienceSourceSchema.nullable().optional(),
    scheduledTaskId: z.string().min(1).nullable().optional(),
    status: z.enum(['draft', 'active', 'paused']).optional(),
    scheduledFor: z.string().datetime().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (d) =>
      d.audienceFilter === undefined && d.audienceSource === undefined
        ? true
        : d.audienceFilter !== undefined || d.audienceSource !== null,
    {
      message: 'audienceSource cannot be null when audienceFilter is not provided',
      path: ['audienceSource'],
    },
  );

// ─── Routes ─────────────────────────────────────────────────────

/** Register campaign routes on a Fastify instance. */
export function campaignRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { prisma, campaignRunner, agentRepository, mcpServerRepository, logger } = opts;

  /**
   * Validate an agentId belongs to the project and is active.
   * Returns null if valid, otherwise a human-readable error string.
   */
  async function validateAgent(
    agentId: string,
    projectId: string,
  ): Promise<string | null> {
    const agent = await agentRepository.findById(agentId as AgentId);
    if (!agent || agent.projectId !== projectId) {
      return `Agent "${agentId}" not found in project`;
    }
    if (agent.status !== 'active') {
      return `Agent "${agentId}" is not active (status=${agent.status})`;
    }
    return null;
  }

  /**
   * Validate an AudienceSource — when kind='mcp', the MCP server instance
   * must exist in the project with status='active'.
   */
  async function validateAudienceSource(
    source: AudienceSource,
    projectId: string,
  ): Promise<string | null> {
    if (source.kind !== 'mcp') return null;
    const instances = await mcpServerRepository.listInstances(
      projectId as ProjectId,
      'active',
    );
    const match = instances.find((i) => i.name === source.serverName);
    if (!match) {
      return `MCP server "${source.serverName}" is not connected to this project (or not active)`;
    }
    return null;
  }

  /**
   * Validate a scheduledTaskId — must exist in the project and not be linked
   * to a different campaign.
   */
  async function validateScheduledTask(
    scheduledTaskId: string,
    projectId: string,
    excludeCampaignId?: string,
  ): Promise<{ error: string; status: number } | null> {
    const task = await prisma.scheduledTask.findUnique({
      where: { id: scheduledTaskId },
      include: { campaign: true },
    });
    if (!task || task.projectId !== projectId) {
      return { error: `ScheduledTask "${scheduledTaskId}" not found in project`, status: 400 };
    }
    if (task.campaign && task.campaign.id !== excludeCampaignId) {
      return {
        error: `ScheduledTask "${scheduledTaskId}" is already linked to campaign "${task.campaign.id}"`,
        status: 409,
      };
    }
    return null;
  }

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

      // Validate agent
      const agentError = await validateAgent(body.agentId, projectId);
      if (agentError) {
        await sendError(reply, 'VALIDATION_ERROR', agentError, 400);
        return;
      }

      // Validate MCP audience source (when applicable)
      if (body.audienceSource) {
        const sourceError = await validateAudienceSource(
          body.audienceSource as AudienceSource,
          projectId,
        );
        if (sourceError) {
          await sendError(reply, 'VALIDATION_ERROR', sourceError, 400);
          return;
        }
      }

      // Validate scheduledTaskId (when provided)
      if (body.scheduledTaskId) {
        const taskError = await validateScheduledTask(body.scheduledTaskId, projectId);
        if (taskError) {
          await sendError(
            reply,
            taskError.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR',
            taskError.error,
            taskError.status,
          );
          return;
        }
      }

      const campaign = await prisma.campaign.create({
        data: {
          projectId,
          agentId: body.agentId,
          name: body.name,
          template: body.template,
          channel: body.channel,
          audienceFilter: (body.audienceFilter ?? {}) as Prisma.InputJsonValue,
          ...(body.audienceSource !== undefined && {
            audienceSource: body.audienceSource as Prisma.InputJsonValue,
          }),
          ...(body.scheduledTaskId !== undefined && {
            scheduledTaskId: body.scheduledTaskId,
          }),
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
          metadata: body.metadata as Prisma.InputJsonValue,
        },
      });

      logger.info('Campaign created', {
        component: 'campaign-routes',
        campaignId: campaign.id,
        projectId,
        agentId: body.agentId,
        audienceMode: body.audienceSource?.kind ?? 'contacts',
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
      const { projectId, id: campaignId } = request.params;

      // Validate agentId (if provided)
      if (body.agentId !== undefined) {
        const agentError = await validateAgent(body.agentId, projectId);
        if (agentError) {
          await sendError(reply, 'VALIDATION_ERROR', agentError, 400);
          return;
        }
      }

      // Validate audienceSource MCP (if provided and not null)
      if (body.audienceSource) {
        const sourceError = await validateAudienceSource(
          body.audienceSource as AudienceSource,
          projectId,
        );
        if (sourceError) {
          await sendError(reply, 'VALIDATION_ERROR', sourceError, 400);
          return;
        }
      }

      // Validate scheduledTaskId (if provided and not null)
      if (body.scheduledTaskId) {
        const taskError = await validateScheduledTask(
          body.scheduledTaskId,
          projectId,
          campaignId,
        );
        if (taskError) {
          await sendError(
            reply,
            taskError.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR',
            taskError.error,
            taskError.status,
          );
          return;
        }
      }

      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          ...(body.agentId !== undefined && { agentId: body.agentId }),
          ...(body.name !== undefined && { name: body.name }),
          ...(body.template !== undefined && { template: body.template }),
          ...(body.channel !== undefined && { channel: body.channel }),
          ...(body.audienceFilter !== undefined && {
            audienceFilter: body.audienceFilter as Prisma.InputJsonValue,
          }),
          ...(body.audienceSource !== undefined && {
            audienceSource:
              body.audienceSource === null
                ? Prisma.JsonNull
                : (body.audienceSource as Prisma.InputJsonValue),
          }),
          ...(body.scheduledTaskId !== undefined && {
            scheduledTaskId: body.scheduledTaskId,
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

  // POST /projects/:projectId/campaigns/:id/refresh-audience
  // Forces re-resolution of the audience (ignores cache).
  fastify.post(
    '/projects/:projectId/campaigns/:id/refresh-audience',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      if (!campaignRunner) {
        await sendError(
          reply,
          'SERVICE_UNAVAILABLE',
          'Campaign runner is not available. Redis must be configured (REDIS_URL).',
          503,
        );
        return;
      }

      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });
      if (!campaign || campaign.projectId !== request.params.projectId) {
        await sendNotFound(reply, 'Campaign', request.params.id);
        return;
      }

      const result = await campaignRunner.resolveAudience(request.params.id, {
        force: true,
      });

      if (!result.ok) {
        const status = result.error.statusCode ?? 500;
        await sendError(reply, result.error.code, result.error.message, status);
        return;
      }

      const { contacts, cache } = result.value;
      await sendSuccess(reply, {
        contactIds: contacts.map((c) => c.id),
        count: contacts.length,
        resolvedAt: cache?.resolvedAt ?? new Date().toISOString(),
        expiresAt: cache?.expiresAt ?? null,
      });
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

  // ── Lifecycle ─────────────────────────────────────────────────

  // POST /projects/:projectId/campaigns/:id/pause
  fastify.post(
    '/projects/:projectId/campaigns/:id/pause',
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
      if (campaign.status !== 'active') {
        await sendError(
          reply,
          'CONFLICT',
          `Campaign status is "${campaign.status}", must be "active" to pause`,
          409,
        );
        return;
      }

      const now = new Date();
      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'paused', pausedAt: now },
      });

      logger.info('Campaign paused', {
        component: 'campaign-routes',
        campaignId: campaign.id,
        agentId: campaign.agentId,
      });

      await sendSuccess(reply, {
        id: updated.id,
        status: updated.status,
        pausedAt: updated.pausedAt,
      });
    },
  );

  // POST /projects/:projectId/campaigns/:id/resume
  fastify.post(
    '/projects/:projectId/campaigns/:id/resume',
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
      if (campaign.status !== 'paused') {
        await sendError(
          reply,
          'CONFLICT',
          `Campaign status is "${campaign.status}", must be "paused" to resume`,
          409,
        );
        return;
      }

      const now = new Date();
      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'active', resumedAt: now, pausedAt: null },
      });

      logger.info('Campaign resumed', {
        component: 'campaign-routes',
        campaignId: campaign.id,
        agentId: campaign.agentId,
      });

      await sendSuccess(reply, {
        id: updated.id,
        status: updated.status,
        resumedAt: updated.resumedAt,
      });
    },
  );

  // POST /projects/:projectId/campaigns/:id/cancel
  fastify.post(
    '/projects/:projectId/campaigns/:id/cancel',
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
      if (campaign.status === 'completed' || campaign.status === 'cancelled') {
        await sendError(
          reply,
          'CONFLICT',
          `Campaign status is "${campaign.status}", cannot cancel`,
          409,
        );
        return;
      }

      const now = new Date();
      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'cancelled', cancelledAt: now },
      });

      logger.info('Campaign cancelled', {
        component: 'campaign-routes',
        campaignId: campaign.id,
        agentId: campaign.agentId,
      });

      await sendSuccess(reply, {
        id: updated.id,
        status: updated.status,
        cancelledAt: updated.cancelledAt,
      });
    },
  );

  // GET /projects/:projectId/campaigns/:id/sends
  const sendsQuerySchema = z.object({
    status: z
      .enum(['queued', 'sent', 'failed', 'delivered', 'unsubscribed', 'replied', 'converted'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  fastify.get(
    '/projects/:projectId/campaigns/:id/sends',
    async (
      request: FastifyRequest<{ Params: { projectId: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const { projectId, id } = request.params;

      const campaign = await prisma.campaign.findUnique({
        where: { id },
        select: { id: true, projectId: true },
      });
      if (!campaign || campaign.projectId !== projectId) {
        await sendNotFound(reply, 'Campaign', id);
        return;
      }

      const parseResult = sendsQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const { status, limit, offset } = parseResult.data;

      const where: Prisma.CampaignSendWhereInput = { campaignId: id };
      if (status) {
        where.status = status;
      }

      const [items, total] = await Promise.all([
        prisma.campaignSend.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.campaignSend.count({ where }),
      ]);

      await sendSuccess(reply, { items, total, limit, offset });
    },
  );

  // POST /projects/:projectId/campaigns/:id/sends/:sendId/mark-delivered
  fastify.post(
    '/projects/:projectId/campaigns/:id/sends/:sendId/mark-delivered',
    async (
      request: FastifyRequest<{
        Params: { projectId: string; id: string; sendId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const send = await prisma.campaignSend.findUnique({
        where: { id: request.params.sendId },
        include: { campaign: { select: { id: true, projectId: true } } },
      });
      if (
        !send ||
        send.campaignId !== request.params.id ||
        send.campaign.projectId !== request.params.projectId
      ) {
        await sendNotFound(reply, 'CampaignSend', request.params.sendId);
        return;
      }
      if (send.status !== 'sent') {
        await sendError(
          reply,
          'CONFLICT',
          `Send status is "${send.status}", must be "sent" to mark delivered`,
          409,
        );
        return;
      }

      const now = new Date();
      const updated = await prisma.campaignSend.update({
        where: { id: send.id },
        data: { status: 'delivered', deliveredAt: now },
      });

      await sendSuccess(reply, {
        sendId: updated.id,
        status: updated.status,
        deliveredAt: updated.deliveredAt,
      });
    },
  );

  // POST /projects/:projectId/campaigns/:id/sends/:sendId/mark-unsubscribed
  // Allowed from any status — opt-outs can arrive anytime.
  fastify.post(
    '/projects/:projectId/campaigns/:id/sends/:sendId/mark-unsubscribed',
    async (
      request: FastifyRequest<{
        Params: { projectId: string; id: string; sendId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const send = await prisma.campaignSend.findUnique({
        where: { id: request.params.sendId },
        include: { campaign: { select: { id: true, projectId: true } } },
      });
      if (
        !send ||
        send.campaignId !== request.params.id ||
        send.campaign.projectId !== request.params.projectId
      ) {
        await sendNotFound(reply, 'CampaignSend', request.params.sendId);
        return;
      }

      const now = new Date();

      // Read + write the Contact inside the transaction so concurrent updates
      // to contact.tags (e.g. another unsubscribe, a tag edit) can't race.
      const updated = await prisma.$transaction(async (tx) => {
        const s = await tx.campaignSend.update({
          where: { id: send.id },
          data: { status: 'unsubscribed', unsubscribedAt: now },
        });

        const contact = await tx.contact.findUnique({
          where: { id: send.contactId },
          select: { id: true, tags: true },
        });

        let contactUpdated = false;
        if (contact && !contact.tags.includes('opted_out')) {
          await tx.contact.update({
            where: { id: contact.id },
            data: { tags: [...contact.tags, 'opted_out'] },
          });
          contactUpdated = true;
        }

        return { send: s, contactUpdated };
      });

      logger.info('Campaign send marked unsubscribed', {
        component: 'campaign-routes',
        campaignId: send.campaignId,
        sendId: send.id,
        contactId: send.contactId,
        contactUpdated: updated.contactUpdated,
      });

      await sendSuccess(reply, {
        sendId: updated.send.id,
        status: updated.send.status,
        unsubscribedAt: updated.send.unsubscribedAt,
        contactUpdated: updated.contactUpdated,
      });
    },
  );
}
