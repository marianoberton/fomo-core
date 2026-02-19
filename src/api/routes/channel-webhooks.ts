/**
 * Dynamic channel webhook routes — receives inbound messages from
 * per-project channel integrations (Telegram, WhatsApp, Slack).
 *
 * URL pattern: POST /webhooks/:provider/:integrationId
 *
 * Flow:
 * 1. Look up integration by ID → resolve projectId
 * 2. Resolve adapter via channel resolver (secrets-based)
 * 3. adapter.parseInbound(payload) → InboundMessage
 * 4. Async fire-and-forget: runAgent → send response via adapter
 * 5. Return 200 immediately (messaging platforms require fast acks)
 *
 * Chatwoot has its own dedicated routes (chatwoot-webhook.ts) due to
 * HMAC validation, handoff support, and async queue processing.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { getSlackUrlChallenge } from '@/channels/adapters/slack.js';

const VALID_PROVIDERS = new Set<string>(['telegram', 'whatsapp', 'slack']);

// ─── Route Registration ─────────────────────────────────────────

/** Register dynamic channel webhook routes. */
export function channelWebhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { channelResolver, inboundProcessor, logger } = deps;

  // ─── POST /webhooks/:provider/:integrationId ───────────────────

  fastify.post<{ Params: { provider: string; integrationId: string } }>(
    '/webhooks/:provider/:integrationId',
    async (request: FastifyRequest<{ Params: { provider: string; integrationId: string } }>, reply: FastifyReply) => {
      const { provider, integrationId } = request.params;

      // Validate provider
      if (!VALID_PROVIDERS.has(provider)) {
        return reply.status(400).send({ error: `Unknown provider: ${provider}` });
      }

      // Handle Slack URL verification challenge (POST-based)
      if (provider === 'slack') {
        const challenge = getSlackUrlChallenge(request.body);
        if (challenge) {
          logger.info('Slack URL verification challenge', {
            component: 'channel-webhooks',
            integrationId,
          });
          return reply.send({ challenge });
        }
      }

      // Resolve integration
      const integration = await channelResolver.resolveIntegration(integrationId);
      if (!integration) {
        logger.warn('Integration not found for webhook', {
          component: 'channel-webhooks',
          provider,
          integrationId,
        });
        return reply.status(404).send({ error: 'Integration not found' });
      }

      // Validate provider matches integration
      if (integration.provider !== provider) {
        logger.warn('Provider mismatch in webhook', {
          component: 'channel-webhooks',
          urlProvider: provider,
          integrationProvider: integration.provider,
          integrationId,
        });
        return reply.status(400).send({ error: 'Provider mismatch' });
      }

      if (integration.status !== 'active') {
        return reply.status(200).send({ ok: true, ignored: true, reason: 'integration_paused' });
      }

      const projectId = integration.projectId;

      // Resolve adapter
      const adapter = await channelResolver.resolveAdapter(projectId, provider);
      if (!adapter) {
        logger.error('Failed to resolve adapter for webhook', {
          component: 'channel-webhooks',
          provider,
          projectId,
          integrationId,
        });
        return reply.status(200).send({ ok: true, ignored: true, reason: 'adapter_unavailable' });
      }

      // Parse inbound message
      const message = await adapter.parseInbound(request.body);

      if (message) {
        // Process async via InboundProcessor (contact management + agent run + response)
        void inboundProcessor.process(message);
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ─── GET /webhooks/:provider/:integrationId/verify ─────────────

  fastify.get<{ Params: { provider: string; integrationId: string } }>(
    '/webhooks/:provider/:integrationId/verify',
    async (request: FastifyRequest<{ Params: { provider: string; integrationId: string } }>, reply: FastifyReply) => {
      const { provider, integrationId } = request.params;

      if (provider !== 'whatsapp') {
        return reply.status(400).send({ error: 'Verification only supported for WhatsApp' });
      }

      // WhatsApp Cloud API webhook verification
      const query = request.query as Record<string, string>;
      const mode = query['hub.mode'];
      const token = query['hub.verify_token'];
      const challenge = query['hub.challenge'];

      if (mode !== 'subscribe' || !token || !challenge) {
        return reply.status(400).send({ error: 'Missing verification parameters' });
      }

      // Resolve integration to find the verify token secret key
      const integration = await channelResolver.resolveIntegration(integrationId);
      if (integration?.provider !== 'whatsapp') {
        return reply.status(404).send({ error: 'Integration not found' });
      }

      // Resolve verify token from secrets
      const config = integration.config as { verifyTokenSecretKey?: string };
      if (!config.verifyTokenSecretKey) {
        logger.warn('WhatsApp integration missing verifyTokenSecretKey', {
          component: 'channel-webhooks',
          integrationId,
        });
        return reply.status(403).send('Forbidden');
      }

      try {
        const { secretService } = deps;
        const verifyToken = await secretService.get(integration.projectId, config.verifyTokenSecretKey);

        if (token === verifyToken) {
          logger.info('WhatsApp webhook verified', {
            component: 'channel-webhooks',
            integrationId,
          });
          return await reply.status(200).send(challenge);
        }
      } catch {
        logger.error('Failed to resolve WhatsApp verify token secret', {
          component: 'channel-webhooks',
          integrationId,
        });
      }

      logger.warn('WhatsApp webhook verification failed', {
        component: 'channel-webhooks',
        integrationId,
      });
      return reply.status(403).send('Forbidden');
    },
  );
}
