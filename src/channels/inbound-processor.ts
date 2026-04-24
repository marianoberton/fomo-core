/**
 * Inbound Processor — handles incoming messages from channels.
 *
 * Responsibilities:
 * 1. Resolve or create contact from sender identifier
 * 2. Find or create session for the contact
 * 3. Run the agent with the message
 * 4. Send the response back via the same channel
 *
 * Routing logic:
 * - WhatsApp/Telegram/Slack from clients → agent-channel-router (mode-aware)
 * - OpenClaw Manager (sourceChannel=openclaw in rawPayload) → direct agent invocation, skip channel send
 */
import type { Logger } from '@/observability/logger.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { ChannelType, InboundMessage, IntegrationProvider, SendResult } from './types.js';
import type { ContactRepository, ChannelIdentifier, ContactId } from '@/contacts/types.js';
import type { SessionRepository, Session } from '@/infrastructure/repositories/session-repository.js';
import type { AgentChannelRouter } from './agent-channel-router.js';
import type { MessageDeduplicator } from './message-dedup.js';
import type { ProjectEventBus } from '@/api/events/event-bus.js';
import type { ReplyTracker } from '@/campaigns/reply-tracker.js';

// ─── Types ──────────────────────────────────────────────────────

export interface InboundProcessorDeps {
  channelResolver: ChannelResolver;
  contactRepository: ContactRepository;
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Optional agent-channel router for mode-aware agent resolution. */
  agentChannelRouter?: AgentChannelRouter;
  /** Optional deduplicator to prevent duplicate webhook processing. */
  messageDeduplicator?: MessageDeduplicator;
  /** Optional broadcaster to notify WebSocket clients of new messages. */
  sessionBroadcaster?: import('@/hitl/session-broadcaster.js').SessionBroadcaster;
  /** Optional project event bus for live event fan-out (WS/SSE). */
  eventBus?: ProjectEventBus;
  /**
   * Optional reply tracker — defensive fallback alongside the event-bus
   * subscriber. If the bus subscriber fails silently (not registered, crashes),
   * this direct call still marks the reply. Idempotent: duplicate calls no-op
   * because the tracker filters by `status = 'sent'`.
   */
  replyTracker?: ReplyTracker;
  /** Function to run the agent and get a response */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    agentId?: string;
    sourceChannel?: string;
    contactRole?: string;
    userMessage: string;
    mediaUrls?: string[];
  }) => Promise<{ response: string }>;
}

export interface InboundProcessor {
  /** Process an incoming message through the full pipeline */
  process(message: InboundMessage): Promise<SendResult>;
}

// ─── Helper: Channel to Identifier ──────────────────────────────

function channelToIdentifier(channel: ChannelType, value: string): ChannelIdentifier {
  switch (channel) {
    case 'telegram':
      return { type: 'telegramId', value };
    case 'whatsapp':
    case 'whatsapp-waha':
      return { type: 'phone', value };
    case 'slack':
      return { type: 'slackId', value };
    case 'email':
      return { type: 'email', value };
    case 'chatwoot':
      // Chatwoot conversations are identified by conversation ID, stored as phone
      return { type: 'phone', value };
    case 'vapi':
      // VAPI voice calls use phone number as identifier
      return { type: 'phone', value };
  }
}

/** Check if a ChannelType is a valid IntegrationProvider (i.e. has a channel integration). */
function isIntegrationProvider(channel: ChannelType): channel is IntegrationProvider {
  return channel === 'whatsapp' || channel === 'whatsapp-waha' || channel === 'telegram' || channel === 'slack' || channel === 'chatwoot';
}

// ─── Processor Factory ──────────────────────────────────────────

/**
 * Create an InboundProcessor that handles the full message flow.
 */
export function createInboundProcessor(deps: InboundProcessorDeps): InboundProcessor {
  const {
    channelResolver,
    contactRepository,
    sessionRepository,
    logger,
    agentChannelRouter,
    messageDeduplicator,
    sessionBroadcaster,
    eventBus,
    replyTracker,
    runAgent,
  } = deps;

  return {
    async process(message: InboundMessage): Promise<SendResult> {
      const startTime = Date.now();

      logger.info('Processing inbound message', {
        component: 'inbound-processor',
        channel: message.channel,
        sender: message.senderIdentifier,
        messageId: message.id,
      });

      try {
        // ─── Deduplication check ──────────────────────────────────
        // Channel providers (WhatsApp, Telegram) retry webhook deliveries.
        // Without this check the same message would be processed N times,
        // sending duplicate responses to the customer.
        if (messageDeduplicator && message.channelMessageId) {
          const dedupKey = `${message.projectId}:${message.channelMessageId}`;
          if (await messageDeduplicator.isDuplicate(dedupKey)) {
            logger.info('Skipping duplicate inbound message', {
              component: 'inbound-processor',
              channelMessageId: message.channelMessageId,
              channel: message.channel,
            });
            return { success: true };
          }
        }

        const projectId = message.projectId;

        // ─── OpenClaw Manager routing ──────────────────────────────
        // Messages from OpenClaw Manager are identified by sourceChannel=openclaw
        // in the rawPayload. These bypass contact resolution and channel routing —
        // the agent is invoked directly, and the response is returned without sending
        // back via a channel adapter (OpenClaw gets the response via HTTP).
        const rawPayload = message.rawPayload as Record<string, unknown> | null;
        const isOpenClawSource = rawPayload?.['sourceChannel'] === 'openclaw';

        if (isOpenClawSource) {
          const openclawAgentId = rawPayload['agentId'] as string | undefined;

          logger.info('Routing decision: OpenClaw Manager message — direct agent invocation', {
            component: 'inbound-processor',
            routingType: 'openclaw',
            agentId: openclawAgentId,
            projectId,
            messageId: message.id,
          });

          // Create a session for this OpenClaw invocation
          const session = await sessionRepository.create({
            projectId,
            metadata: {
              sourceChannel: 'openclaw',
              channel: 'openclaw',
              ...(openclawAgentId ? { agentId: openclawAgentId } : {}),
            },
          });

          await runAgent({
            projectId,
            sessionId: session.id,
            agentId: openclawAgentId,
            sourceChannel: 'openclaw',
            userMessage: message.content,
            mediaUrls: message.mediaUrls,
          });

          const durationMs = Date.now() - startTime;

          logger.info('Processed OpenClaw inbound message', {
            component: 'inbound-processor',
            routingType: 'openclaw',
            sessionId: session.id,
            agentId: openclawAgentId,
            durationMs,
          });

          // Response is returned to the caller (OpenClaw adapter) — no channel send needed
          return { success: true };
        }

        // ─── Standard channel routing (WhatsApp, Telegram, etc.) ───

        logger.info('Routing decision: standard channel message', {
          component: 'inbound-processor',
          routingType: 'channel',
          channel: message.channel,
          messageId: message.id,
        });

        // Validate channel is a supported integration provider
        if (!isIntegrationProvider(message.channel)) {
          logger.error('Channel cannot be sent via ChannelResolver', {
            component: 'inbound-processor',
            channel: message.channel,
          });
          return { success: false, error: `Channel '${message.channel}' is not a supported integration provider` };
        }

        // 1. Resolve or create contact
        const identifier = channelToIdentifier(message.channel, message.senderIdentifier);
        let contact = await contactRepository.findByChannel(projectId, identifier);

        if (!contact) {
          contact = await contactRepository.create({
            projectId,
            name: message.senderName ?? message.senderIdentifier,
            [identifier.type]: identifier.value,
          });

          logger.info('Created new contact', {
            component: 'inbound-processor',
            contactId: contact.id,
            channel: message.channel,
          });
        }

        // 1b. Resolve agent for this channel (mode-aware routing)
        let resolvedAgentId: string | undefined;
        if (agentChannelRouter) {
          const match = await agentChannelRouter.resolveAgent(
            projectId,
            message.channel,
            contact.role,
          );
          if (match) {
            resolvedAgentId = match.agentId;
            logger.info('Agent resolved for channel', {
              component: 'inbound-processor',
              agentId: match.agentId,
              modeName: match.mode.modeName,
              channel: message.channel,
            });
          }
        }

        // 2. Find or create session for this contact
        // Uses indexed DB query instead of loading all project sessions (O(1) vs O(N))
        let session: Session | null = null;
        let existingSession = await sessionRepository.findByContactId(projectId, contact.id);

        // /start (or resetSession flag) → close existing session and force a new one
        if (message.resetSession && existingSession) {
          await sessionRepository.updateStatus(existingSession.id, 'completed');
          logger.info('Session reset via /start command', {
            component: 'inbound-processor',
            oldSessionId: existingSession.id,
            contactId: contact.id,
          });
          existingSession = null;
        }

        session = existingSession;

        if (!session) {
          session = await sessionRepository.create({
            projectId,
            metadata: {
              contactId: contact.id,
              channel: message.channel,
              recipientIdentifier: message.senderIdentifier,
              ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
            },
          });

          logger.info('Created new session', {
            component: 'inbound-processor',
            sessionId: session.id,
            contactId: contact.id,
          });
        } else if (!session.metadata?.['recipientIdentifier'] || !session.metadata['channel']) {
          // Backfill channel routing metadata on sessions that were created without it
          // (e.g. from dashboard chat). This is needed for resumeAfterApproval to route responses.
          const updatedMetadata = {
            ...session.metadata,
            channel: session.metadata?.['channel'] ?? message.channel,
            recipientIdentifier: session.metadata?.['recipientIdentifier'] ?? message.senderIdentifier,
          };
          await sessionRepository.updateMetadata(session.id, updatedMetadata);
          session = { ...session, metadata: updatedMetadata };
        }

        // Emit live event: message.inbound — fan out to dashboard/SSE subscribers.
        // Fire-and-forget; the bus itself is synchronous but any listener doing I/O
        // should handle its own errors.
        if (eventBus) {
          eventBus.emit({
            kind: 'message.inbound',
            projectId,
            sessionId: session.id,
            contactId: contact.id,
            ...(resolvedAgentId && { agentId: resolvedAgentId }),
            text: message.content,
            channel: message.channel,
            ts: Date.now(),
          });
        }

        // Defensive reply tracking — call the tracker directly alongside the
        // event-bus subscriber. If the subscriber never registered or its
        // handler crashed, CampaignSend.replied would silently never be set.
        // The tracker itself is idempotent (filters by `status = 'sent'`),
        // so the bus path and this direct call cannot double-mark a reply.
        // Errors are swallowed — reply tracking must never break inbound.
        if (replyTracker) {
          logger.debug('Attempting fallback reply check', {
            component: 'inbound-processor',
            contactId: contact.id,
            sessionId: session.id,
          });
          try {
            await replyTracker.checkAndMarkReply({
              projectId,
              contactId: contact.id as ContactId,
              sessionId: session.id as SessionId,
              receivedAt: message.receivedAt,
            });
          } catch (err) {
            logger.warn('Reply-tracker fallback failed', {
              component: 'inbound-processor',
              contactId: contact.id,
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // 3. If session is paused (operator takeover), persist message but skip agent
        if (session.status === 'paused') {
          const stored = await sessionRepository.addMessage(
            session.id,
            { role: 'user', content: message.content, mediaUrls: message.mediaUrls },
          );

          logger.info('Session paused — persisted inbound message without running agent', {
            component: 'inbound-processor',
            sessionId: session.id,
            contactId: contact.id,
          });

          // Notify connected WebSocket clients so the operator sees the new message
          if (sessionBroadcaster) {
            sessionBroadcaster.broadcast(session.id, {
              type: 'message.new',
              role: 'user',
              content: message.content,
              messageId: stored.id,
            });
          }

          return { success: true };
        }

        // 4. Run the agent (with mode-aware params)
        const agentResult = await runAgent({
          projectId,
          sessionId: session.id,
          agentId: resolvedAgentId,
          sourceChannel: message.channel,
          contactRole: contact.role,
          userMessage: message.content,
          mediaUrls: message.mediaUrls,
        });

        // 5. Send response back via the same channel
        const sendResult = await channelResolver.send(projectId, message.channel, {
          channel: message.channel,
          recipientIdentifier: message.senderIdentifier,
          content: agentResult.response,
          replyToChannelMessageId: message.channelMessageId,
        });

        // Emit live event: message.outbound — only when the channel send succeeded.
        if (eventBus && sendResult.success) {
          eventBus.emit({
            kind: 'message.outbound',
            projectId,
            sessionId: session.id,
            ...(resolvedAgentId && { agentId: resolvedAgentId }),
            text: agentResult.response,
            channel: message.channel,
            ts: Date.now(),
          });
        }

        const durationMs = Date.now() - startTime;

        logger.info('Processed inbound message', {
          component: 'inbound-processor',
          channel: message.channel,
          contactId: contact.id,
          sessionId: session.id,
          success: sendResult.success,
          durationMs,
        });

        return sendResult;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error('Failed to process inbound message', {
          component: 'inbound-processor',
          channel: message.channel,
          sender: message.senderIdentifier,
          error: errorMessage,
        });

        return {
          success: false,
          error: `Failed to process message: ${errorMessage}`,
        };
      }
    },
  };
}
