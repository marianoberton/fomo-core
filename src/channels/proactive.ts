/**
 * Proactive Messenger — sends messages to contacts without them initiating.
 *
 * Supports:
 * - Immediate sending
 * - Scheduled sending via BullMQ
 */
import type { Queue, Job } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { ContactId } from '@/contacts/types.js';
import type { ChannelRouter } from './channel-router.js';
import type { ChannelType, SendResult } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ProactiveMessageRequest {
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
  contactId: ContactId;
  channel: ChannelType;
  recipientIdentifier: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// ─── Queue Name ─────────────────────────────────────────────────

export const PROACTIVE_MESSAGE_QUEUE = 'proactive-messages';

// ─── Messenger Factory ──────────────────────────────────────────

export interface ProactiveMessengerDeps {
  channelRouter: ChannelRouter;
  queue: Queue<ProactiveMessageJobData>;
  logger: Logger;
}

/**
 * Create a ProactiveMessenger for sending scheduled/immediate messages.
 */
export function createProactiveMessenger(deps: ProactiveMessengerDeps): ProactiveMessenger {
  const { channelRouter, queue, logger } = deps;

  return {
    async send(request: ProactiveMessageRequest): Promise<SendResult> {
      logger.info('Sending proactive message', {
        component: 'proactive-messenger',
        contactId: request.contactId,
        channel: request.channel,
      });

      return channelRouter.send({
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
  channelRouter: ChannelRouter;
  logger: Logger;
}): (job: Job<ProactiveMessageJobData>) => Promise<SendResult> {
  const { channelRouter, logger } = deps;

  return async (job: Job<ProactiveMessageJobData>): Promise<SendResult> => {
    const { data } = job;

    logger.info('Processing scheduled proactive message', {
      component: 'proactive-message-worker',
      jobId: job.id,
      contactId: data.contactId,
      channel: data.channel,
    });

    const result = await channelRouter.send({
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
