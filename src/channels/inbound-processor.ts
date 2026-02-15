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
import type { ChannelRouter } from './channel-router.js';
import type { ChannelType, InboundMessage, SendResult } from './types.js';
import type { ContactRepository, ChannelIdentifier } from '@/contacts/types.js';
import type { SessionRepository, Session } from '@/infrastructure/repositories/session-repository.js';

// ─── Types ──────────────────────────────────────────────────────

export interface InboundProcessorDeps {
  channelRouter: ChannelRouter;
  contactRepository: ContactRepository;
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Default project ID for new contacts/sessions (fallback when message has no projectId) */
  defaultProjectId: ProjectId;
  /** Function to run the agent and get a response */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
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

// ─── Processor Factory ──────────────────────────────────────────

/**
 * Create an InboundProcessor that handles the full message flow.
 */
export function createInboundProcessor(deps: InboundProcessorDeps): InboundProcessor {
  const {
    channelRouter,
    contactRepository,
    sessionRepository,
    logger,
    defaultProjectId,
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
        // Use project ID from message if available, otherwise fall back to default
        const projectId = (message.projectId || defaultProjectId) as ProjectId;

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

        // 2. Find or create session for this contact
        // For now, we create a new session per message (could be improved with session persistence)
        const sessions = await sessionRepository.listByProject(projectId, 'active');
        let session: Session | null = null;

        // Try to find an existing active session for this contact
        // Note: This is a simplified approach. In production, you'd want to
        // query sessions by contactId directly.
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
            },
          });

          logger.info('Created new session', {
            component: 'inbound-processor',
            sessionId: session.id,
            contactId: contact.id,
          });
        }

        // 3. Run the agent
        const agentResult = await runAgent({
          projectId,
          sessionId: session.id,
          userMessage: message.content,
        });

        // 4. Send response back via the same channel
        const sendResult = await channelRouter.send({
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
