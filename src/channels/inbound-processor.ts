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
import type { ProjectId } from '@/core/types.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { ChannelType, InboundMessage, IntegrationProvider, SendResult } from './types.js';
import type { ContactRepository, ChannelIdentifier } from '@/contacts/types.js';
import type { SessionRepository, Session } from '@/infrastructure/repositories/session-repository.js';
import type { AgentChannelRouter } from './agent-channel-router.js';

// ─── Types ──────────────────────────────────────────────────────

export interface InboundProcessorDeps {
  channelResolver: ChannelResolver;
  contactRepository: ContactRepository;
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Optional agent-channel router for mode-aware agent resolution. */
  agentChannelRouter?: AgentChannelRouter;
  /** Optional broadcaster to notify WebSocket clients of new messages. */
  sessionBroadcaster?: import('@/hitl/session-broadcaster.js').SessionBroadcaster;
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
    sessionBroadcaster,
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
        const sessions = await sessionRepository.listByProject(projectId, 'active');
        let session: Session | null = null;

        // Find existing active session for this contact
        let existingSession: Session | null = null;
        for (const s of sessions) {
          const metadata = s.metadata;
          if (metadata?.['contactId'] === contact.id) {
            existingSession = s;
            break;
          }
        }

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
