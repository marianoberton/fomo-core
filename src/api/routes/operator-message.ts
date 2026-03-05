/**
 * Operator message routes — human operator sends a message to a customer
 * within a paused session, bypassing the agent loop.
 *
 * POST /projects/:projectId/sessions/:sessionId/operator-message
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { ChannelType, IntegrationProvider } from '@/channels/types.js';

// ─── Schema ─────────────────────────────────────────────────────

const operatorMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
  operatorName: z.string().min(1).max(200).optional().default('operator'),
});

// ─── Routes ─────────────────────────────────────────────────────

/** Register operator message routes on a Fastify instance. */
export function operatorMessageRoutes(
  fastify: FastifyInstance,
  opts: RouteDependencies,
): void {
  const { sessionRepository, channelResolver, sessionBroadcaster, logger } = opts;

  fastify.post(
    '/projects/:projectId/sessions/:sessionId/operator-message',
    async (
      request: FastifyRequest<{
        Params: { projectId: string; sessionId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { projectId, sessionId } = request.params;

      // 1. Validate body
      const parseResult = operatorMessageSchema.safeParse(request.body);
      if (!parseResult.success) {
        await sendError(reply, 'VALIDATION_ERROR', parseResult.error.message, 400);
        return;
      }
      const { content, operatorName } = parseResult.data;

      // 2. Load session and verify ownership + status
      const session = await sessionRepository.findById(sessionId as SessionId);
      if (!session) {
        await sendNotFound(reply, 'Session', sessionId);
        return;
      }

      if (session.projectId !== projectId) {
        await sendError(
          reply,
          'FORBIDDEN',
          'Session does not belong to this project',
          403,
        );
        return;
      }

      if (session.status !== 'paused') {
        await sendError(
          reply,
          'SESSION_NOT_PAUSED',
          'Operator messages can only be sent on paused sessions. Pause the session first to take over.',
          409,
        );
        return;
      }

      // 3. Persist operator message in the session history
      const stored = await sessionRepository.addMessage(
        sessionId as SessionId,
        {
          role: 'assistant',
          content,
          toolCalls: { fromOperator: true, operatorName },
        },
      );

      logger.info('Operator message stored', {
        component: 'operator-message',
        sessionId,
        operatorName,
      });

      // 4. Deliver via channel if session has routing metadata
      const channel = session.metadata?.['channel'] as string | undefined;
      const recipientIdentifier = session.metadata?.['recipientIdentifier'] as string | undefined;
      let delivered = false;

      if (channel && recipientIdentifier) {
        try {
          const sendResult = await channelResolver.send(
            projectId as ProjectId,
            channel as IntegrationProvider,
            {
              channel: channel as ChannelType,
              recipientIdentifier,
              content,
            },
          );
          delivered = sendResult.success;

          if (!sendResult.success) {
            logger.warn('Operator message channel delivery failed', {
              component: 'operator-message',
              sessionId,
              channel,
              error: sendResult.error,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error('Operator message channel delivery error', {
            component: 'operator-message',
            sessionId,
            channel,
            error: errorMessage,
          });
        }
      }

      // 5. Broadcast to connected WebSocket clients
      sessionBroadcaster.broadcast(sessionId, {
        type: 'message.new',
        role: 'assistant',
        content,
        fromOperator: true,
        operatorName,
        messageId: stored.id,
      });

      await sendSuccess(reply, {
        messageId: stored.id,
        delivered,
        channel: channel ?? null,
      });
    },
  );
}
