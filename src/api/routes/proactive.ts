/**
 * Proactive messaging routes — send outbound messages without a user initiating.
 *
 * POST /projects/:projectId/proactive — send immediately or schedule
 * DELETE /projects/:projectId/proactive/:jobId — cancel a scheduled message
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import type { ProjectId } from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';

// ─── Schema ─────────────────────────────────────────────────────

const sendProactiveSchema = z.object({
  channel: z.enum(['whatsapp', 'telegram', 'slack', 'chatwoot']),
  recipientIdentifier: z.string().min(1).max(500),
  content: z.string().min(1).max(10_000),
  contactId: z.string().min(1).optional(),
  scheduledFor: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register proactive messaging routes on a Fastify instance. */
export function proactiveRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { proactiveMessenger, logger } = opts;

  // POST /projects/:projectId/proactive
  fastify.post(
    '/projects/:projectId/proactive',
    async (
      request: FastifyRequest<{ Params: { projectId: string } }>,
      reply: FastifyReply,
    ) => {
      if (!proactiveMessenger) {
        await sendError(
          reply,
          'SERVICE_UNAVAILABLE',
          'Proactive messaging is not available. Redis must be configured (REDIS_URL env var).',
          503,
        );
        return;
      }

      const parseResult = sendProactiveSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }

      const { projectId } = request.params;
      const body = parseResult.data;

      const messageRequest = {
        projectId: projectId as ProjectId,
        contactId: (body.contactId ?? 'manual') as ContactId,
        channel: body.channel,
        recipientIdentifier: body.recipientIdentifier,
        content: body.content,
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        metadata: body.metadata,
      };

      if (messageRequest.scheduledFor) {
        const jobId = await proactiveMessenger.schedule(messageRequest);
        logger.info('Proactive message scheduled', {
          component: 'proactive-routes',
          projectId,
          channel: body.channel,
          scheduledFor: messageRequest.scheduledFor.toISOString(),
          jobId,
        });
        await sendSuccess(reply, { scheduled: true, jobId });
        return;
      }

      const result = await proactiveMessenger.send(messageRequest);
      logger.info('Proactive message sent', {
        component: 'proactive-routes',
        projectId,
        channel: body.channel,
        success: result.success,
      });
      await sendSuccess(reply, {
        sent: true,
        channelMessageId: result.channelMessageId,
        success: result.success,
        error: result.error,
      });
    },
  );

  // DELETE /projects/:projectId/proactive/:jobId — cancel a scheduled message
  fastify.delete(
    '/projects/:projectId/proactive/:jobId',
    async (
      request: FastifyRequest<{ Params: { projectId: string; jobId: string } }>,
      reply: FastifyReply,
    ) => {
      if (!proactiveMessenger) {
        await sendError(
          reply,
          'SERVICE_UNAVAILABLE',
          'Proactive messaging is not available. Redis must be configured.',
          503,
        );
        return;
      }

      const { jobId } = request.params;
      const cancelled = await proactiveMessenger.cancel(jobId);
      await sendSuccess(reply, { cancelled, jobId });
    },
  );
}
