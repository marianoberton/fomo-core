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
import { nanoid } from 'nanoid';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { HandoffManager } from '@/channels/handoff.js';
import type { ChatwootWebhookEvent, ChatwootAdapter } from '@/channels/adapters/chatwoot.js';
import type { ProjectId } from '@/core/types.js';
import type { WebhookQueue } from '@/channels/webhook-queue.js';
import type { ChatwootIntegrationConfig } from '@/channels/types.js';
import type { Logger } from '@/observability/logger.js';
import type { SecretService } from '@/secrets/types.js';
import type { ChannelIntegrationRepository } from '@/channels/types.js';

// Chatwoot v4.12.1 signs `${timestamp}.${rawBody}` and prefixes the header
// with "sha256=". Reject anything older than 5 minutes to bound replay
// windows.
const CHATWOOT_TIMESTAMP_DRIFT_SECONDS = 300;

// `request.rawBody` is populated by the encapsulated content-type parser
// registered alongside this plugin (see registerChatwootRawBodyParser). The
// declaration below makes that field visible on FastifyRequest.
declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyRequest {
    rawBody?: string;
  }
}

// ─── HMAC verification ──────────────────────────────────────────

interface VerifyHmacInput {
  rawBody: string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  secret: string;
  /** Override for testing. Defaults to Math.floor(Date.now() / 1000). */
  nowSeconds?: number;
}

type VerifyHmacResult =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'missing_timestamp' | 'timestamp_drift' | 'mismatch' };

/**
 * Verify a Chatwoot webhook HMAC per v4.12.1 spec:
 *   header   = X-Chatwoot-Signature: "sha256=" + hex(HMAC-SHA256(secret, `${ts}.${rawBody}`))
 *   freshness= |now - ts| <= 300s
 *   compare  = constant-time over the hex digest after stripping "sha256="
 */
export function verifyChatwootHmac(input: VerifyHmacInput): VerifyHmacResult {
  if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!input.timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  const ts = Number.parseInt(input.timestampHeader, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing_timestamp' };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > CHATWOOT_TIMESTAMP_DRIFT_SECONDS) {
    return { ok: false, reason: 'timestamp_drift' };
  }

  const signedInput = `${input.timestampHeader}.${input.rawBody}`;
  const expectedHex = crypto.createHmac('sha256', input.secret).update(signedInput).digest('hex');

  // Strip the "sha256=" prefix if present, then constant-time compare hex digests.
  const receivedHex = input.signatureHeader.startsWith('sha256=')
    ? input.signatureHeader.slice('sha256='.length)
    : input.signatureHeader;

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const receivedBuf = Buffer.from(receivedHex, 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return { ok: false, reason: 'mismatch' };
  return crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

/**
 * Register a JSON content-type parser scoped to the chatwoot plugin context
 * that stashes the raw UTF-8 body string on `request.rawBody` before parsing.
 * Must be called inside an encapsulated `register()` so it does not leak to
 * sibling routes (which expect default JSON parsing without the rawBody side
 * effect).
 */
export function registerChatwootRawBodyParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const text = typeof body === 'string' ? body : (body as Buffer).toString('utf8');
      request.rawBody = text;
      if (text.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
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
  }) => Promise<{ response: string }>;
}

// ─── Secret Resolution ──────────────────────────────────────────

/**
 * Resolve the webhook HMAC secret for a Chatwoot account.
 *
 * Preferred path: read from SecretService using `webhookSecretKey` configured
 * on the project's ChannelIntegration. Falls back to the legacy
 * `CHATWOOT_WEBHOOK_SECRET` env var (shared across all projects) with a
 * deprecation warning.
 *
 * Returns null when no secret can be resolved — in that case the request
 * must be rejected (we never accept unsigned webhooks).
 */
async function resolveChatwootWebhookSecret(deps: {
  accountId: number | undefined;
  channelResolver: ChannelResolver;
  channelIntegrationRepository: ChannelIntegrationRepository;
  secretService: SecretService;
  logger: Logger;
}): Promise<string | null> {
  const { accountId, channelResolver, channelIntegrationRepository, secretService, logger } = deps;

  if (accountId !== undefined) {
    const projectId = await channelResolver.resolveProjectByAccount(accountId);
    if (projectId) {
      const integration = await channelIntegrationRepository.findByProjectAndProvider(projectId, 'chatwoot');
      const cwConfig = integration?.config as ChatwootIntegrationConfig | undefined;
      if (cwConfig?.webhookSecretKey) {
        try {
          return await secretService.get(projectId, cwConfig.webhookSecretKey);
        } catch {
          logger.error('Failed to resolve Chatwoot webhook secret from SecretService', {
            component: 'chatwoot-webhook',
            projectId,
            webhookSecretKey: cwConfig.webhookSecretKey,
          });
          // fall through to env-var fallback
        }
      }
    }
  }

  const envSecret = process.env['CHATWOOT_WEBHOOK_SECRET'];
  if (envSecret) {
    logger.warn('Chatwoot webhook using legacy env var secret — migrate to SecretService', {
      component: 'chatwoot-webhook',
      accountId,
    });
    return envSecret;
  }

  return null;
}

// ─── Route Registration ─────────────────────────────────────────

export function chatwootWebhookRoutes(
  fastify: FastifyInstance,
  deps: ChatwootWebhookDeps,
): void {
  const { channelResolver, handoffManager, webhookQueue, logger, channelIntegrationRepository, secretService } = deps;

  /**
   * POST /webhooks/chatwoot — receives Agent Bot webhook events from Chatwoot.
   *
   * Auth: HMAC-SHA256 over `${X-Chatwoot-Timestamp}.${rawBody}` keyed with the
   * Agent Bot signing secret. Header is `X-Chatwoot-Signature: sha256=<hex>`.
   * Replays older than 5 minutes are rejected.
   */
  fastify.post('/webhooks/chatwoot', async (request: FastifyRequest, reply: FastifyReply) => {
    const signatureHeader = request.headers['x-chatwoot-signature'] as string | undefined;
    const timestampHeader = request.headers['x-chatwoot-timestamp'] as string | undefined;
    const deliveryId = request.headers['x-chatwoot-delivery'] as string | undefined;

    // Peek at the parsed payload to find the account, so we can resolve the
    // per-project webhook secret before validating the HMAC.
    const earlyEvent = request.body as ChatwootWebhookEvent | undefined;
    const secret = await resolveChatwootWebhookSecret({
      accountId: earlyEvent?.account?.id,
      channelResolver,
      channelIntegrationRepository,
      secretService,
      logger,
    });

    if (!secret) {
      logger.error('Chatwoot webhook rejected — no signing secret configured', {
        component: 'chatwoot-webhook',
        accountId: earlyEvent?.account?.id,
        deliveryId,
      });
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const verification = verifyChatwootHmac({
      rawBody: request.rawBody ?? '',
      signatureHeader,
      timestampHeader,
      secret,
    });

    if (!verification.ok) {
      logger.warn('Chatwoot webhook rejected', {
        component: 'chatwoot-webhook',
        ip: request.ip,
        accountId: earlyEvent?.account?.id,
        deliveryId,
        reason: verification.reason,
      });
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // ─── Process Webhook ───────────────────────────────────────────
    const event = request.body as ChatwootWebhookEvent;
    if (deliveryId) {
      logger.debug('Chatwoot webhook delivery accepted', {
        component: 'chatwoot-webhook',
        deliveryId,
        accountId: event.account?.id,
        eventType: event.event,
      });
    }

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

    // ─── Process via Queue (if available) or Inline ──────────────────

    if (webhookQueue) {
      // Async processing: enqueue job and respond 200 OK immediately
      const webhookId = nanoid();

      await webhookQueue.enqueue({
        webhookId,
        projectId,
        event,
        receivedAt: new Date().toISOString(),
        conversationId,
      });

      logger.debug('Webhook enqueued for async processing', {
        component: 'chatwoot-webhook',
        webhookId,
        projectId,
        conversationId,
      });

      return reply.status(200).send({ ok: true, webhookId, queued: true });
    }

    // Fallback: Inline processing (legacy behavior, no queue configured)
    const adapter = await channelResolver.resolveAdapter(projectId, 'chatwoot') as ChatwootAdapter | null;
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
        .escalate(
          conversationId,
          adapter,
          'Cliente solicito agente humano',
          { projectId, sessionId: `cw-${String(conversationId)}` as import('@/core/types.js').SessionId },
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
              { projectId, sessionId: `cw-${String(conversationId)}` as import('@/core/types.js').SessionId },
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
    const signatureHeader = request.headers['x-chatwoot-signature'] as string | undefined;
    const timestampHeader = request.headers['x-chatwoot-timestamp'] as string | undefined;
    const deliveryId = request.headers['x-chatwoot-delivery'] as string | undefined;

    const earlyEvent = request.body as ChatwootWebhookEvent | undefined;
    const secret = await resolveChatwootWebhookSecret({
      accountId: earlyEvent?.account?.id,
      channelResolver,
      channelIntegrationRepository,
      secretService,
      logger,
    });

    if (!secret) {
      logger.error('Chatwoot webhook rejected — no signing secret (status endpoint)', {
        component: 'chatwoot-webhook',
        accountId: earlyEvent?.account?.id,
        deliveryId,
      });
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const verification = verifyChatwootHmac({
      rawBody: request.rawBody ?? '',
      signatureHeader,
      timestampHeader,
      secret,
    });

    if (!verification.ok) {
      logger.warn('Chatwoot webhook rejected (status endpoint)', {
        component: 'chatwoot-webhook',
        ip: request.ip,
        accountId: earlyEvent?.account?.id,
        deliveryId,
        reason: verification.reason,
      });
      return reply.status(401).send({ error: 'Unauthorized' });
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
        const adapter = await channelResolver.resolveAdapter(projectId, 'chatwoot') as ChatwootAdapter | null;
        if (adapter) {
          void handoffManager
            .resume(
              conversationId,
              adapter,
              { projectId, sessionId: `cw-${String(conversationId)}` as import('@/core/types.js').SessionId },
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
    }

    return reply.status(200).send({ ok: true });
  });
}
