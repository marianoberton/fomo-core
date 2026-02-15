/**
 * Chatwoot webhook routes — receives Agent Bot events from Chatwoot.
 *
 * Flow:
 * 1. Chatwoot sends webhook event (message_created, conversation_status_changed)
 * 2. We extract account_id from the payload → resolve to a Nexus project
 * 3. Parse the message via the Chatwoot adapter
 * 4. Process with inbound processor (contact → session → agent → response)
 * 5. Agent response sent back via Chatwoot API
 *
 * Handoff:
 * - If agent response contains [HANDOFF] marker, escalate to human in Chatwoot
 * - If customer message contains escalation keywords, escalate immediately
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { HandoffManager } from '@/channels/handoff.js';
import type { ChatwootWebhookEvent } from '@/channels/adapters/chatwoot.js';
import type { ProjectId } from '@/core/types.js';

// ─── Extended Dependencies ──────────────────────────────────────

export interface ChatwootWebhookDeps extends RouteDependencies {
  channelResolver: ChannelResolver;
  handoffManager: HandoffManager;
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

// ─── Route Registration ─────────────────────────────────────────

export function chatwootWebhookRoutes(
  fastify: FastifyInstance,
  deps: ChatwootWebhookDeps,
): void {
  const { channelResolver, handoffManager, inboundProcessor, logger } = deps;

  /**
   * POST /webhooks/chatwoot — receives Agent Bot webhook events from Chatwoot.
   */
  fastify.post('/webhooks/chatwoot', async (request: FastifyRequest, reply: FastifyReply) => {
    // ─── HMAC Signature Validation ─────────────────────────────────
    const signature = request.headers['x-chatwoot-api-signature'] as string | undefined;

    if (!signature) {
      logger.warn('Chatwoot webhook missing signature', {
        component: 'chatwoot-webhook',
        ip: request.ip,
      });
      return reply.status(401).send({ error: 'Missing signature' });
    }

    const secret = process.env['CHATWOOT_WEBHOOK_SECRET'];
    if (!secret) {
      logger.error('CHATWOOT_WEBHOOK_SECRET not configured', {
        component: 'chatwoot-webhook',
      });
      return reply.status(500).send({ error: 'Server misconfigured' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      logger.warn('Chatwoot webhook invalid signature', {
        component: 'chatwoot-webhook',
        ip: request.ip,
        received: signature.slice(0, 10) + '...',
        expected: expectedSignature.slice(0, 10) + '...',
      });
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    // ─── Process Webhook ───────────────────────────────────────────
    const event = request.body as ChatwootWebhookEvent;

    logger.debug('Received Chatwoot webhook', {
      component: 'chatwoot-webhook',
      event: event.event,
      accountId: event.account?.id,
      conversationId: event.conversation?.id,
    });

    // Only handle message_created events from contacts (incoming messages)
    if (event.event !== 'message_created') {
      return reply.status(200).send({ ok: true });
    }

    if (event.message_type !== 'incoming' || !event.content || event.sender?.type !== 'contact') {
      return reply.status(200).send({ ok: true });
    }

    const accountId = event.account?.id;
    const conversationId = event.conversation?.id;

    if (accountId === undefined || conversationId === undefined) {
      logger.warn('Chatwoot webhook missing account or conversation ID', {
        component: 'chatwoot-webhook',
      });
      return reply.status(200).send({ ok: true });
    }

    // Resolve project from Chatwoot account ID
    const projectId = await channelResolver.resolveProjectByAccount(accountId);
    if (!projectId) {
      logger.warn('No project found for Chatwoot account', {
        component: 'chatwoot-webhook',
        accountId,
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // Resolve the Chatwoot adapter for this project
    const adapter = await channelResolver.resolveAdapter(projectId);
    if (!adapter) {
      logger.error('No Chatwoot adapter for project', {
        component: 'chatwoot-webhook',
        projectId,
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // Check if customer is requesting human escalation
    if (handoffManager.shouldEscalateFromMessage(event.content)) {
      void handoffManager
        .escalate(conversationId, adapter, 'Cliente solicito agente humano')
        .catch((error: unknown) => {
          logger.error('Failed to escalate to human', {
            component: 'chatwoot-webhook',
            conversationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

      return reply.status(200).send({ ok: true, escalated: true });
    }

    // Parse message and process via inbound processor (async, respond immediately)
    const message = await adapter.parseInbound(event);

    if (message) {
      void (async () => {
        try {
          // Run agent
          const result = await deps.runAgent({
            projectId,
            sessionId: `cw-${String(conversationId)}`,
            userMessage: message.content,
          });

          let responseText = result.response;

          // Check if agent wants to hand off
          if (handoffManager.shouldEscalateFromResponse(responseText)) {
            responseText = handoffManager.stripHandoffMarker(responseText);

            // Send the response before escalating
            if (responseText) {
              await adapter.send({
                channel: 'chatwoot',
                recipientIdentifier: String(conversationId),
                content: responseText,
              });
            }

            await handoffManager.escalate(
              conversationId,
              adapter,
              'El agente AI determino que se requiere asistencia humana',
            );
            return;
          }

          // Send response back via Chatwoot
          await adapter.send({
            channel: 'chatwoot',
            recipientIdentifier: String(conversationId),
            content: responseText,
          });
        } catch (error) {
          logger.error('Failed to process Chatwoot message', {
            component: 'chatwoot-webhook',
            conversationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
    }

    return reply.status(200).send({ ok: true });
  });

  /**
   * POST /webhooks/chatwoot/conversation-resolved — handle when human resolves.
   * Chatwoot can be configured to send a webhook when a conversation is resolved.
   * This re-enables the bot for the next message.
   */
  fastify.post('/webhooks/chatwoot/status', async (request: FastifyRequest, reply: FastifyReply) => {
    // ─── HMAC Signature Validation ─────────────────────────────────
    const signature = request.headers['x-chatwoot-api-signature'] as string | undefined;

    if (!signature) {
      logger.warn('Chatwoot webhook missing signature (status endpoint)', {
        component: 'chatwoot-webhook',
        ip: request.ip,
      });
      return reply.status(401).send({ error: 'Missing signature' });
    }

    const secret = process.env['CHATWOOT_WEBHOOK_SECRET'];
    if (!secret) {
      logger.error('CHATWOOT_WEBHOOK_SECRET not configured', {
        component: 'chatwoot-webhook',
      });
      return reply.status(500).send({ error: 'Server misconfigured' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      logger.warn('Chatwoot webhook invalid signature (status endpoint)', {
        component: 'chatwoot-webhook',
        ip: request.ip,
        received: signature.slice(0, 10) + '...',
        expected: expectedSignature.slice(0, 10) + '...',
      });
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    // ─── Process Status Change ─────────────────────────────────────
    const event = request.body as ChatwootWebhookEvent;

    if (event.event !== 'conversation_status_changed') {
      return reply.status(200).send({ ok: true });
    }

    const status = event.conversation?.status;
    const conversationId = event.conversation?.id;
    const accountId = event.account?.id;

    if (status === 'resolved' && conversationId !== undefined && accountId !== undefined) {
      const projectId = await channelResolver.resolveProjectByAccount(accountId);
      if (projectId) {
        const adapter = await channelResolver.resolveAdapter(projectId);
        if (adapter) {
          void handoffManager.resume(conversationId, adapter).catch((error: unknown) => {
            logger.error('Failed to resume bot after resolve', {
              component: 'chatwoot-webhook',
              conversationId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        }
      }
    }

    return reply.status(200).send({ ok: true });
  });
}
