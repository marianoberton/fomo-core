/**
 * Chatwoot webhook routes — receives Agent Bot deliveries.
 *
 * Auth model:
 *   Chatwoot v4.12.x Agent Bots do NOT sign their outgoing webhooks (only the
 *   API Channel has hmac_token, which is a different feature). So Nexus
 *   authenticates each delivery via a high-entropy `pathToken` embedded in
 *   the URL path:
 *
 *     POST /api/v1/webhooks/chatwoot/{pathToken}
 *
 *   The token is generated server-side at integration creation time and
 *   stored on `ChannelIntegration.config.pathToken`. The user pastes the
 *   full URL (including the token) into the bot's `outgoing_url` in
 *   Chatwoot. Anyone who knows the URL can post; treat it like a secret.
 *
 * Defense-in-depth:
 *   The handler also checks that `body.account.id` matches the integration's
 *   `config.accountId`. A token leak alone shouldn't let an attacker forge
 *   deliveries from a different account, and a misconfigured Chatwoot bot
 *   pointing at the wrong URL should fail loudly instead of silently being
 *   processed against the wrong project.
 *
 * Filtering:
 *   Only `event === "message_created"` with `message_type === "incoming"`
 *   and `sender.type === "contact"` is processed. Everything else returns
 *   200 OK with no side effects.
 */
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { HandoffManager } from '@/channels/handoff.js';
import type { ChatwootWebhookEvent, ChatwootAdapter } from '@/channels/adapters/chatwoot.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { WebhookQueue } from '@/channels/webhook-queue.js';
import type { ChatwootIntegrationConfig, ChannelIntegration } from '@/channels/types.js';

// ─── Path Token ──────────────────────────────────────────────────

const PATH_TOKEN_BYTES = 32;
const PATH_TOKEN_REGEX = /^[a-f0-9]{32,128}$/;

/**
 * Generate a fresh path token: 32 random bytes hex-encoded (64 chars). The
 * format aligns with `ChatwootIntegrationConfigSchema.pathToken` and the
 * regex used at the route boundary.
 */
export function generateChatwootPathToken(): string {
  return crypto.randomBytes(PATH_TOKEN_BYTES).toString('hex');
}

/** Truncate a token for safe logging (first 6 chars + ellipsis). */
function truncateToken(token: string | undefined): string {
  if (!token) return '<empty>';
  if (token.length <= 6) return `${token}...`;
  return `${token.slice(0, 6)}...`;
}

// ─── Extended Dependencies ──────────────────────────────────────

export interface ChatwootWebhookDeps extends RouteDependencies {
  channelResolver: ChannelResolver;
  handoffManager: HandoffManager;
  /** Optional webhook queue for async processing. If not provided, webhooks are processed inline. */
  webhookQueue?: WebhookQueue;
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    userMessage: string;
    agentId?: string;
    sourceChannel?: string;
  }) => Promise<{ response: string }>;
}

// ─── Route Registration ─────────────────────────────────────────

export function chatwootWebhookRoutes(
  fastify: FastifyInstance,
  deps: ChatwootWebhookDeps,
): void {
  const { channelResolver, handoffManager, webhookQueue, logger } = deps;

  /**
   * POST /webhooks/chatwoot/:pathToken — receives Agent Bot deliveries.
   */
  fastify.post<{ Params: { pathToken: string } }>(
    '/webhooks/chatwoot/:pathToken',
    async (request, reply: FastifyReply) => {
      const result = await authenticateAndDispatch({
        params: request.params,
        body: request.body,
        ip: request.ip,
        deliveryId: request.headers['x-chatwoot-delivery'] as string | undefined,
        deps,
      });

      if (result.kind === 'reject') {
        return reply.status(result.status).send({ error: 'Unauthorized' });
      }

      const { event, integration, projectId } = result;
      const accountId = event.account?.id;
      const conversationId = event.conversation?.id;
      const agentId = (integration.config as ChatwootIntegrationConfig).agentId;

      if (!agentId) {
        logger.error('Chatwoot integration is missing agentId — cannot route inbound', {
          component: 'chatwoot-webhook',
          projectId,
          integrationId: integration.id,
          inboxId: (integration.config as ChatwootIntegrationConfig).inboxId,
        });
        return reply.status(200).send({ ok: true, ignored: true, reason: 'no-agent-configured' });
      }

      logger.debug('Chatwoot webhook accepted', {
        component: 'chatwoot-webhook',
        deliveryId: result.deliveryId,
        projectId,
        accountId,
        eventType: event.event,
      });

      // Only handle message_created from contacts (incoming messages)
      if (event.event !== 'message_created') {
        return reply.status(200).send({ ok: true });
      }
      // Chatwoot v4.12.1 omits `sender.type` at the root of the AgentBot
      // payload (only present inside conversation.messages[*].sender), so we
      // rely on `message_type === 'incoming'` to confirm the sender is a Contact.
      if (event.message_type !== 'incoming' || !event.content) {
        logger.debug('Chatwoot webhook ignored — not an incoming message with content', {
          component: 'chatwoot-webhook',
          projectId,
          deliveryId: result.deliveryId,
          messageType: event.message_type,
          hasContent: Boolean(event.content),
        });
        return reply.status(200).send({ ok: true });
      }
      if (accountId === undefined || conversationId === undefined) {
        logger.warn('Chatwoot webhook missing account or conversation ID', {
          component: 'chatwoot-webhook',
          projectId,
        });
        return reply.status(200).send({ ok: true });
      }

      // ─── Process via Queue (if available) or Inline ──────────────────
      if (webhookQueue) {
        const webhookId = nanoid();
        await webhookQueue.enqueue({
          webhookId,
          projectId,
          event,
          receivedAt: new Date().toISOString(),
          conversationId,
          agentId,
        });
        logger.debug('Webhook enqueued for async processing', {
          component: 'chatwoot-webhook',
          webhookId,
          projectId,
          conversationId,
        });
        return reply.status(200).send({ ok: true, webhookId, queued: true });
      }

      // Inline processing fallback
      const adapter = (await channelResolver.resolveAdapter(projectId, 'chatwoot')) as
        | ChatwootAdapter
        | null;
      if (!adapter) {
        logger.error('No Chatwoot adapter for project', {
          component: 'chatwoot-webhook',
          projectId,
          integrationId: integration.id,
        });
        return reply.status(200).send({ ok: true, ignored: true });
      }

      // Customer escalation keywords
      if (handoffManager.shouldEscalateFromMessage(event.content)) {
        void handoffManager
          .escalate(
            conversationId,
            adapter,
            'Cliente solicito agente humano',
            { projectId, sessionId: `cw-${String(conversationId)}` as SessionId },
          )
          .catch((error: unknown) => {
            logger.error('Failed to escalate to human', {
              component: 'chatwoot-webhook',
              conversationId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });

        return reply.status(200).send({ ok: true, escalated: true });
      }

      const message = await adapter.parseInbound(event);
      if (message) {
        void (async () => {
          try {
            const runResult = await deps.runAgent({
              projectId,
              sessionId: `cw-${String(conversationId)}`,
              userMessage: message.content,
              agentId,
              sourceChannel: 'chatwoot',
            });

            let responseText = runResult.response;

            if (handoffManager.shouldEscalateFromResponse(responseText)) {
              responseText = handoffManager.stripHandoffMarker(responseText);
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
                { projectId, sessionId: `cw-${String(conversationId)}` as SessionId },
              );
              return;
            }

            if (responseText.trim()) {
              await adapter.send({
                channel: 'chatwoot',
                recipientIdentifier: String(conversationId),
                content: responseText,
              });
            }
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
    },
  );

  /**
   * POST /webhooks/chatwoot/status/:pathToken — handle conversation status
   * changes (e.g. human resolved → re-enable bot for next message).
   */
  fastify.post<{ Params: { pathToken: string } }>(
    '/webhooks/chatwoot/status/:pathToken',
    async (request, reply) => {
      const result = await authenticateAndDispatch({
        params: request.params,
        body: request.body,
        ip: request.ip,
        deliveryId: request.headers['x-chatwoot-delivery'] as string | undefined,
        deps,
      });

      if (result.kind === 'reject') {
        return reply.status(result.status).send({ error: 'Unauthorized' });
      }

      const { event, projectId } = result;

      if (event.event !== 'conversation_status_changed') {
        return reply.status(200).send({ ok: true });
      }

      const status = event.conversation?.status;
      const conversationId = event.conversation?.id;

      if (status === 'resolved' && conversationId !== undefined) {
        const adapter = (await channelResolver.resolveAdapter(projectId, 'chatwoot')) as
          | ChatwootAdapter
          | null;
        if (adapter) {
          void handoffManager
            .resume(
              conversationId,
              adapter,
              { projectId, sessionId: `cw-${String(conversationId)}` as SessionId },
            )
            .catch((error: unknown) => {
              logger.error('Failed to resume bot after resolve', {
                component: 'chatwoot-webhook',
                conversationId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            });
        }
      }

      return reply.status(200).send({ ok: true });
    },
  );
}

// ─── Auth helper ────────────────────────────────────────────────

type AuthDispatchResult =
  | { kind: 'reject'; status: 401 }
  | {
      kind: 'accept';
      integration: ChannelIntegration;
      projectId: ProjectId;
      event: ChatwootWebhookEvent;
      deliveryId: string | undefined;
    };

/**
 * Authenticate a webhook delivery by its `pathToken` and validate the
 * payload's `account.id` against the integration's expected accountId.
 *
 * Both checks fail with 401 to avoid leaking which one rejected. Logs are
 * emitted on every failure with the truncated token for debugging desfases
 * between the URL configured in Chatwoot and the integration record.
 */
async function authenticateAndDispatch(args: {
  params: { pathToken: string };
  body: unknown;
  ip: string;
  deliveryId: string | undefined;
  deps: ChatwootWebhookDeps;
}): Promise<AuthDispatchResult> {
  const { params, body, ip, deliveryId, deps } = args;
  const { logger, channelIntegrationRepository } = deps;
  const tokenForLog = truncateToken(params.pathToken);

  if (!PATH_TOKEN_REGEX.test(params.pathToken)) {
    logger.warn('Chatwoot webhook rejected — malformed pathToken', {
      component: 'chatwoot-webhook',
      ip,
      pathTokenPrefix: tokenForLog,
      deliveryId,
    });
    return { kind: 'reject', status: 401 };
  }

  const integration = await channelIntegrationRepository.findActiveChatwootByPathToken(
    params.pathToken,
  );
  if (!integration) {
    logger.warn('Chatwoot webhook rejected — pathToken not found', {
      component: 'chatwoot-webhook',
      ip,
      pathTokenPrefix: tokenForLog,
      deliveryId,
    });
    return { kind: 'reject', status: 401 };
  }

  const event = body as ChatwootWebhookEvent | undefined;
  const config = integration.config as ChatwootIntegrationConfig;
  const expectedAccountId = config.accountId;
  const receivedAccountId = event?.account?.id;

  if (
    receivedAccountId === undefined ||
    receivedAccountId !== expectedAccountId
  ) {
    logger.warn('Chatwoot webhook rejected — account.id mismatch', {
      component: 'chatwoot-webhook',
      ip,
      pathTokenPrefix: tokenForLog,
      deliveryId,
      integrationId: integration.id,
      expectedAccountId,
      receivedAccountId,
    });
    return { kind: 'reject', status: 401 };
  }

  // Past the account.id check: event has at least { account: { id: number } }.
  return {
    kind: 'accept',
    integration,
    projectId: integration.projectId,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    event: event!,
    deliveryId,
  };
}
