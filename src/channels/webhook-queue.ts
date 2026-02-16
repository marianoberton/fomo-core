/**
 * Webhook Queue — BullMQ queue for async webhook processing with retry.
 *
 * Flow:
 * 1. Webhook endpoint validates HMAC, resolves project, enqueues job → 200 OK
 * 2. Worker picks up job, processes via InboundProcessor → sends response
 * 3. On failure: automatic retry (3 attempts, exponential backoff)
 *
 * Conditional startup: only starts if REDIS_URL is set.
 */
import { Queue, Worker } from 'bullmq';
import type { ProjectId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';
import type { InboundProcessor } from './inbound-processor.js';
import type { ChatwootAdapter } from './adapters/chatwoot.js';
import type { HandoffManager } from './handoff.js';
import type { WebhookJobData, WebhookJobResult } from './webhook-queue-types.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface WebhookQueueOptions {
  logger: Logger;
  /** Redis connection URL. */
  redisUrl: string;
  /** Callback to resolve Chatwoot adapter for a project. */
  resolveAdapter: (projectId: ProjectId | string) => Promise<ChatwootAdapter | null>;
  /** InboundProcessor for handling messages. */
  inboundProcessor: InboundProcessor;
  /** HandoffManager for escalations. */
  handoffManager: HandoffManager;
  /** Callback to run agent and get response. */
  runAgent: (params: {
    projectId: ProjectId | string;
    sessionId: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

export interface WebhookQueue {
  /** Enqueue a webhook job for async processing. */
  enqueue(data: WebhookJobData): Promise<void>;
  /** Start the worker. */
  start(): Promise<void>;
  /** Stop the worker and close queue. */
  stop(): Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Parse Redis URL into host/port/password for BullMQ connection. */
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password ? parsed.password : undefined,
  };
}

// ─── Factory ────────────────────────────────────────────────────────

const QUEUE_NAME = 'webhook-processing';

/** Create a WebhookQueue backed by BullMQ. */
export function createWebhookQueue(options: WebhookQueueOptions): WebhookQueue {
  const {
    logger,
    redisUrl,
    resolveAdapter,
    handoffManager,
    runAgent,
  } = options;

  const connection = parseRedisUrl(redisUrl);

  let queue: Queue<WebhookJobData, WebhookJobResult> | null = null;
  let worker: Worker<WebhookJobData, WebhookJobResult> | null = null;

  return {
    async enqueue(data: WebhookJobData): Promise<void> {
      if (!queue) {
        throw new Error('WebhookQueue not started');
      }

      await queue.add(
        `webhook-${data.webhookId}`,
        data,
        {
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 2000, // Start with 2s, then 4s, then 8s
          },
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 100, // Keep last 100 failed jobs
        },
      );

      logger.debug('Webhook job enqueued', {
        component: 'webhook-queue',
        webhookId: data.webhookId,
        projectId: data.projectId,
        conversationId: data.conversationId,
      });
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async start(): Promise<void> {
      queue = new Queue<WebhookJobData, WebhookJobResult>(QUEUE_NAME, { connection });

      worker = new Worker<WebhookJobData, WebhookJobResult>(
        QUEUE_NAME,
        async (job) => {
          const startTime = Date.now();
          const { projectId, event, conversationId, webhookId } = job.data;

          logger.info('Processing webhook job', {
            component: 'webhook-queue',
            webhookId,
            projectId,
            conversationId,
            attempt: job.attemptsMade + 1,
          });

          try {
            // Resolve adapter
            const adapter = await resolveAdapter(projectId);
            if (!adapter) {
              throw new Error(`No adapter found for project ${projectId}`);
            }

            // Check for escalation keywords in message
            if (event.content && handoffManager.shouldEscalateFromMessage(event.content)) {
              if (conversationId !== undefined) {
                await handoffManager.escalate(
                  conversationId,
                  adapter,
                  'Cliente solicito agente humano',
                );
              }

              const durationMs = Date.now() - startTime;
              logger.info('Webhook escalated to human', {
                component: 'webhook-queue',
                webhookId,
                conversationId,
                durationMs,
              });

              return {
                success: true,
                escalated: true,
                durationMs,
              };
            }

            // Parse message from event
            const message = await adapter.parseInbound(event);
            if (!message) {
              logger.warn('No message parsed from webhook', {
                component: 'webhook-queue',
                webhookId,
                eventType: event.event,
              });
              return {
                success: true, // Not an error, just nothing to process
                durationMs: Date.now() - startTime,
              };
            }

            // Run agent
            const result = await runAgent({
              projectId,
              sessionId: `cw-${String(conversationId ?? 'unknown')}`,
              userMessage: message.content,
            });

            let responseText = result.response;

            // Check if agent wants to hand off
            if (handoffManager.shouldEscalateFromResponse(responseText)) {
              responseText = handoffManager.stripHandoffMarker(responseText);

              // Send response before escalating (if any)
              if (responseText && conversationId !== undefined) {
                await adapter.send({
                  channel: 'chatwoot',
                  recipientIdentifier: String(conversationId),
                  content: responseText,
                });
              }

              // Escalate
              if (conversationId !== undefined) {
                await handoffManager.escalate(
                  conversationId,
                  adapter,
                  'El agente AI determino que se requiere asistencia humana',
                );
              }

              const durationMs = Date.now() - startTime;
              logger.info('Webhook processed with escalation', {
                component: 'webhook-queue',
                webhookId,
                conversationId,
                durationMs,
              });

              return {
                success: true,
                response: responseText,
                escalated: true,
                durationMs,
              };
            }

            // Send response
            if (conversationId !== undefined) {
              await adapter.send({
                channel: 'chatwoot',
                recipientIdentifier: String(conversationId),
                content: responseText,
              });
            }

            const durationMs = Date.now() - startTime;
            logger.info('Webhook processed successfully', {
              component: 'webhook-queue',
              webhookId,
              conversationId,
              durationMs,
            });

            return {
              success: true,
              response: responseText,
              durationMs,
            };
          } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error('Webhook processing failed', {
              component: 'webhook-queue',
              webhookId,
              conversationId,
              attempt: job.attemptsMade + 1,
              error: errorMessage,
              durationMs,
            });

            // Re-throw to trigger BullMQ retry
            throw error;
          }
        },
        {
          connection,
          concurrency: 5, // Process up to 5 webhooks concurrently
        },
      );

      worker.on('error', (error) => {
        logger.error('BullMQ worker error', {
          component: 'webhook-queue',
          error: error.message,
        });
      });

      worker.on('failed', (job, error) => {
        if (job) {
          logger.error('Webhook job failed permanently', {
            component: 'webhook-queue',
            webhookId: job.data.webhookId,
            conversationId: job.data.conversationId,
            attempts: job.attemptsMade,
            error: error.message,
          });
        }
      });

      logger.info('Webhook queue started', {
        component: 'webhook-queue',
        queueName: QUEUE_NAME,
        concurrency: 5,
      });
    },

    async stop(): Promise<void> {
      if (worker) {
        await worker.close();
        worker = null;
      }

      if (queue) {
        await queue.close();
        queue = null;
      }

      logger.info('Webhook queue stopped', { component: 'webhook-queue' });
    },
  };
}
