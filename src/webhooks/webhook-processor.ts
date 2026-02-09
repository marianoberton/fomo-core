/**
 * Webhook Processor — validates and processes incoming webhook events.
 *
 * Responsibilities:
 * 1. Validate webhook exists and is active
 * 2. Validate HMAC signature (if configured)
 * 3. Validate source IP (if configured)
 * 4. Parse the trigger prompt template with payload data
 * 5. Run the agent with the generated prompt
 */
import { createHmac } from 'crypto';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type {
  Webhook,
  WebhookEvent,
  WebhookExecutionResult,
  WebhookRepository,
} from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface WebhookProcessorDeps {
  webhookRepository: WebhookRepository;
  sessionRepository: SessionRepository;
  logger: Logger;
  /** Function to run the agent and get a response */
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

export interface WebhookProcessor {
  /** Process a webhook event */
  process(event: WebhookEvent): Promise<WebhookExecutionResult>;

  /** Validate HMAC signature */
  validateSignature(
    webhook: Webhook,
    payload: string,
    signature: string,
  ): boolean;
}

// ─── Template Parsing ───────────────────────────────────────────

/**
 * Parse a Mustache-style template with the given data.
 * Supports nested paths: {{user.name}}, {{data.items.0.id}}
 */
function parseTemplate(template: string, data: unknown): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const value = getNestedValue(data, path.trim());
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ─── Processor Factory ──────────────────────────────────────────

/**
 * Create a WebhookProcessor.
 */
export function createWebhookProcessor(deps: WebhookProcessorDeps): WebhookProcessor {
  const { webhookRepository, sessionRepository, logger, runAgent } = deps;

  return {
    async process(event: WebhookEvent): Promise<WebhookExecutionResult> {
      const startTime = Date.now();

      logger.info('Processing webhook event', {
        component: 'webhook-processor',
        webhookId: event.webhookId,
      });

      try {
        // 1. Validate webhook exists
        const webhook = await webhookRepository.findById(event.webhookId);

        if (!webhook) {
          logger.warn('Webhook not found', {
            component: 'webhook-processor',
            webhookId: event.webhookId,
          });
          return {
            success: false,
            error: 'Webhook not found',
            durationMs: Date.now() - startTime,
          };
        }

        // 2. Check if webhook is active
        if (webhook.status !== 'active') {
          logger.warn('Webhook is not active', {
            component: 'webhook-processor',
            webhookId: event.webhookId,
            status: webhook.status,
          });
          return {
            success: false,
            error: 'Webhook is paused',
            durationMs: Date.now() - startTime,
          };
        }

        // 3. Validate IP if configured
        if (webhook.allowedIps && webhook.allowedIps.length > 0 && event.sourceIp) {
          if (!webhook.allowedIps.includes(event.sourceIp)) {
            logger.warn('IP not allowed', {
              component: 'webhook-processor',
              webhookId: event.webhookId,
              sourceIp: event.sourceIp,
            });
            return {
              success: false,
              error: 'IP not allowed',
              durationMs: Date.now() - startTime,
            };
          }
        }

        // 4. Validate HMAC if configured
        if (webhook.secretEnvVar) {
          const signature = event.headers['x-webhook-signature'] ??
                           event.headers['x-hub-signature-256'] ??
                           event.headers['x-signature'];

          if (!signature) {
            logger.warn('Missing signature', {
              component: 'webhook-processor',
              webhookId: event.webhookId,
            });
            return {
              success: false,
              error: 'Missing signature',
              durationMs: Date.now() - startTime,
            };
          }

          const payloadString = typeof event.payload === 'string'
            ? event.payload
            : JSON.stringify(event.payload);

          if (!this.validateSignature(webhook, payloadString, signature)) {
            logger.warn('Invalid signature', {
              component: 'webhook-processor',
              webhookId: event.webhookId,
            });
            return {
              success: false,
              error: 'Invalid signature',
              durationMs: Date.now() - startTime,
            };
          }
        }

        // 5. Parse the trigger prompt template
        const prompt = parseTemplate(webhook.triggerPrompt, event.payload);

        logger.debug('Parsed webhook prompt', {
          component: 'webhook-processor',
          webhookId: event.webhookId,
          prompt,
        });

        // 6. Create a new session for this webhook event
        const session = await sessionRepository.create({
          projectId: webhook.projectId,
          metadata: {
            source: 'webhook',
            webhookId: webhook.id,
            webhookName: webhook.name,
          },
        });

        // 7. Run the agent
        const agentResult = await runAgent({
          projectId: webhook.projectId,
          sessionId: session.id,
          userMessage: prompt,
        });

        const durationMs = Date.now() - startTime;

        logger.info('Webhook processed successfully', {
          component: 'webhook-processor',
          webhookId: event.webhookId,
          sessionId: session.id,
          durationMs,
        });

        return {
          success: true,
          sessionId: session.id,
          response: agentResult.response,
          durationMs,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error('Failed to process webhook', {
          component: 'webhook-processor',
          webhookId: event.webhookId,
          error: errorMessage,
        });

        return {
          success: false,
          error: errorMessage,
          durationMs: Date.now() - startTime,
        };
      }
    },

    validateSignature(
      webhook: Webhook,
      payload: string,
      signature: string,
    ): boolean {
      if (!webhook.secretEnvVar) return true;

      const secret = process.env[webhook.secretEnvVar];
      if (!secret) {
        logger.warn('Webhook secret env var not set', {
          component: 'webhook-processor',
          webhookId: webhook.id,
          secretEnvVar: webhook.secretEnvVar,
        });
        return false;
      }

      // Support both raw and prefixed signatures
      const signatureValue = signature.startsWith('sha256=')
        ? signature.slice(7)
        : signature;

      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Constant-time comparison
      if (signatureValue.length !== expectedSignature.length) {
        return false;
      }

      let result = 0;
      for (let i = 0; i < signatureValue.length; i++) {
        result |= signatureValue.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
      }

      return result === 0;
    },
  };
}
