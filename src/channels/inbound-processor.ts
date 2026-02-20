/**
 * Inbound Processor — handles incoming messages from channels.
 *
 * Responsibilities:
 * 1. Resolve or create contact from sender identifier
 * 2. Find or create session for the contact
 * 3. Run the agent with the message
 * 4. Send the response back via the same channel
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
  /** Function to run the agent and get a response */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    agentId?: string;
    sourceChannel?: string;
    contactRole?: string;
    userMessage: string;
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
      return { type: 'phone', value };
    case 'slack':
      return { type: 'slackId', value };
    case 'email':
      return { type: 'email', value };
    case 'chatwoot':
      // Chatwoot conversations are identified by conversation ID, stored as phone
      return { type: 'phone', value };
  }
}

/** Check if a ChannelType is a valid IntegrationProvider (i.e. has a channel integration). */
function isIntegrationProvider(channel: ChannelType): channel is IntegrationProvider {
  return channel === 'whatsapp' || channel === 'telegram' || channel === 'slack' || channel === 'chatwoot';
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

        // Try to find an existing active session for this contact
        for (const s of sessions) {
          const metadata = s.metadata;
          if (metadata?.['contactId'] === contact.id) {
            session = s;
            break;
          }
        }

        if (!session) {
          session = await sessionRepository.create({
            projectId,
            metadata: {
              contactId: contact.id,
              channel: message.channel,
              ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
            },
          });

          logger.info('Created new session', {
            component: 'inbound-processor',
            sessionId: session.id,
            contactId: contact.id,
          });
        }

        // 3. Run the agent (with mode-aware params)
        const agentResult = await runAgent({
          projectId,
          sessionId: session.id,
          agentId: resolvedAgentId,
          sourceChannel: message.channel,
          contactRole: contact.role,
          userMessage: message.content,
        });

        // 4. Send response back via the same channel
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
