/**
 * Proactive Messenger — sends messages to contacts without them initiating.
 *
 * Supports:
 * - Immediate sending
 * - Scheduled sending via BullMQ
 */
import type { Queue, Job } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { ChannelType, IntegrationProvider, SendResult } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ProactiveMessageRequest {
  /** Project that owns the channel integration */
  projectId: ProjectId;
  /** Contact ID (for tracking) */
  contactId: ContactId;
  /** Channel to send through */
  channel: ChannelType;
  /** Recipient identifier (phone, chat id, etc.) */
  recipientIdentifier: string;
  /** Message content */
  content: string;
  /** Optional: schedule for later */
  scheduledFor?: Date;
  /** Optional: metadata for tracking */
  metadata?: Record<string, unknown>;
}

export interface ProactiveMessenger {
  /** Send a message immediately */
  send(request: ProactiveMessageRequest): Promise<SendResult>;

  /** Schedule a message for later (returns job ID) */
  schedule(request: ProactiveMessageRequest): Promise<string>;

  /** Cancel a scheduled message */
  cancel(jobId: string): Promise<boolean>;
}

// ─── Job Data ───────────────────────────────────────────────────

export interface ProactiveMessageJobData {
  projectId: ProjectId;
  contactId: ContactId;
  channel: ChannelType;
  recipientIdentifier: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// ─── Queue Name ─────────────────────────────────────────────────

export const PROACTIVE_MESSAGE_QUEUE = 'proactive-messages';

// ─── Messenger Factory ──────────────────────────────────────────

/** Type guard: checks if a ChannelType is a supported IntegrationProvider. */
function isIntegrationProvider(channel: ChannelType): channel is IntegrationProvider {
  return channel === 'whatsapp' || channel === 'telegram' || channel === 'slack' || channel === 'chatwoot';
}

export interface ProactiveMessengerDeps {
  channelResolver: ChannelResolver;
  queue: Queue<ProactiveMessageJobData>;
  logger: Logger;
}

/**
 * Create a ProactiveMessenger for sending scheduled/immediate messages.
 */
export function createProactiveMessenger(deps: ProactiveMessengerDeps): ProactiveMessenger {
  const { channelResolver, queue, logger } = deps;

  return {
    async send(request: ProactiveMessageRequest): Promise<SendResult> {
      logger.info('Sending proactive message', {
        component: 'proactive-messenger',
        contactId: request.contactId,
        channel: request.channel,
      });

      if (!isIntegrationProvider(request.channel)) {
        return { success: false, error: `Channel '${request.channel}' is not a supported integration provider` };
      }

      return channelResolver.send(request.projectId, request.channel, {
        channel: request.channel,
        recipientIdentifier: request.recipientIdentifier,
        content: request.content,
      });
    },

    async schedule(request: ProactiveMessageRequest): Promise<string> {
      const delay = request.scheduledFor
        ? Math.max(0, request.scheduledFor.getTime() - Date.now())
        : 0;

      const jobData: ProactiveMessageJobData = {
        projectId: request.projectId,
        contactId: request.contactId,
        channel: request.channel,
        recipientIdentifier: request.recipientIdentifier,
        content: request.content,
        metadata: request.metadata,
      };

      const job = await queue.add('send', jobData, {
        delay,
        removeOnComplete: true,
        removeOnFail: { count: 10 },
      });

      logger.info('Scheduled proactive message', {
        component: 'proactive-messenger',
        jobId: job.id,
        contactId: request.contactId,
        channel: request.channel,
        scheduledFor: request.scheduledFor?.toISOString(),
        delayMs: delay,
      });

      return job.id ?? '';
    },

    async cancel(jobId: string): Promise<boolean> {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          logger.info('Cancelled proactive message', {
            component: 'proactive-messenger',
            jobId,
          });
          return true;
        }
        return false;
      } catch (error) {
        logger.warn('Failed to cancel proactive message', {
          component: 'proactive-messenger',
          jobId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return false;
      }
    },
  };
}

// ─── Worker Handler ─────────────────────────────────────────────

/**
 * Create a job handler for the proactive message queue.
 * Use this with BullMQ Worker.
 */
export function createProactiveMessageHandler(deps: {
  channelResolver: ChannelResolver;
  logger: Logger;
}): (job: Job<ProactiveMessageJobData>) => Promise<SendResult> {
  const { channelResolver, logger } = deps;

  return async (job: Job<ProactiveMessageJobData>): Promise<SendResult> => {
    const { data } = job;

    logger.info('Processing scheduled proactive message', {
      component: 'proactive-message-worker',
      jobId: job.id,
      contactId: data.contactId,
      channel: data.channel,
    });

    if (!isIntegrationProvider(data.channel)) {
      const error = `Channel '${data.channel}' is not a supported integration provider`;
      logger.error(error, { component: 'proactive-message-worker', jobId: job.id });
      return { success: false, error };
    }

    const result = await channelResolver.send(data.projectId, data.channel, {
      channel: data.channel,
      recipientIdentifier: data.recipientIdentifier,
      content: data.content,
    });

    if (result.success) {
      logger.info('Sent scheduled proactive message', {
        component: 'proactive-message-worker',
        jobId: job.id,
        channelMessageId: result.channelMessageId,
      });
    } else {
      logger.error('Failed to send scheduled proactive message', {
        component: 'proactive-message-worker',
        jobId: job.id,
        error: result.error,
      });
    }

    return result;
  };
}
