/**
 * Webhook routes — receives messages from messaging channels.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { getSlackUrlChallenge } from '@/channels/adapters/slack.js';

// ─── Route Registration ─────────────────────────────────────────

export function webhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { channelRouter, inboundProcessor, logger } = deps;

  // ─── Telegram Webhook ───────────────────────────────────────────

  fastify.post('/webhooks/telegram', async (request: FastifyRequest, reply: FastifyReply) => {
    logger.debug('Received Telegram webhook', {
      component: 'webhooks',
      body: request.body,
    });

    const message = await channelRouter.parseInbound('telegram', request.body);

    if (message) {
      // Process async, respond immediately to Telegram
      void inboundProcessor.process(message).catch((error: unknown) => {
        logger.error('Failed to process Telegram message', {
          component: 'webhooks',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }

    return reply.status(200).send({ ok: true });
  });

  // ─── WhatsApp Webhook Verification (GET) ────────────────────────

  fastify.get('/webhooks/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];

    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('WhatsApp webhook verified', { component: 'webhooks' });
      return reply.status(200).send(challenge);
    }

    logger.warn('WhatsApp webhook verification failed', { component: 'webhooks' });
    return reply.status(403).send('Forbidden');
  });

  // ─── WhatsApp Webhook (POST) ────────────────────────────────────

  fastify.post('/webhooks/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    logger.debug('Received WhatsApp webhook', {
      component: 'webhooks',
      body: request.body,
    });

    const message = await channelRouter.parseInbound('whatsapp', request.body);

    if (message) {
      // Process async, respond immediately to WhatsApp
      void inboundProcessor.process(message).catch((error: unknown) => {
        logger.error('Failed to process WhatsApp message', {
          component: 'webhooks',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }

    return reply.status(200).send({ ok: true });
  });

  // ─── Slack Webhook ──────────────────────────────────────────────

  fastify.post('/webhooks/slack', async (request: FastifyRequest, reply: FastifyReply) => {
    logger.debug('Received Slack webhook', {
      component: 'webhooks',
      body: request.body,
    });

    // Handle URL verification challenge
    const challenge = getSlackUrlChallenge(request.body);
    if (challenge) {
      logger.info('Slack URL verification challenge', { component: 'webhooks' });
      return reply.send({ challenge });
    }

    const message = await channelRouter.parseInbound('slack', request.body);

    if (message) {
      // Process async, respond immediately to Slack
      void inboundProcessor.process(message).catch((error: unknown) => {
        logger.error('Failed to process Slack message', {
          component: 'webhooks',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }

    return reply.status(200).send({ ok: true });
  });

  // ─── Health Check for Channels ──────────────────────────────────

  fastify.get('/webhooks/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const channels = channelRouter.listChannels();
    const health: Record<string, boolean> = {};

    for (const channel of channels) {
      health[channel] = await channelRouter.isHealthy(channel);
    }

    return reply.send({
      channels,
      health,
      timestamp: new Date().toISOString(),
    });
  });
}
