/**
 * Send notification tool — send notifications via configured channels.
 *
 * High-risk tool that requires human approval before execution.
 * Currently supports webhook channel (HTTP POST to target URL).
 * Includes SSRF protection on target URLs.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'send-notification' });

// ─── Notification Sender Interface ─────────────────────────────

export interface NotificationSender {
  send(params: {
    channel: string;
    target: string;
    subject: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; response?: unknown }>;
}

export interface SendNotificationToolOptions {
  /** Custom notification sender. If not provided, uses default webhook sender. */
  sender?: NotificationSender;
}

// ─── SSRF Protection (shared logic) ────────────────────────────

const BLOCKED_IPV4_PREFIXES = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.', '127.', '169.254.', '0.',
];

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', '[::1]', '[::0]'];

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  if (lower.startsWith('[fc') || lower.startsWith('[fd')) return true;
  if (lower.startsWith('[fe8') || lower.startsWith('[fe9') || lower.startsWith('[fea') || lower.startsWith('[feb')) return true;
  return false;
}

function validateTargetUrl(urlStr: string): void {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error('Blocked host: notifications to private/reserved IPs are not allowed');
  }
}

// ─── Default Webhook Sender ────────────────────────────────────

function createDefaultWebhookSender(): NotificationSender {
  return {
    async send(params) {
      const response = await fetch(params.target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: params.subject,
          message: params.message,
          metadata: params.metadata,
          channel: params.channel,
          sentAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(30_000),
      });

      return {
        success: response.ok,
        response: {
          status: response.status,
          statusText: response.statusText,
        },
      };
    },
  };
}

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  channel: z.enum(['webhook']),
  target: z.string().url(),
  subject: z.string().min(1).max(500),
  message: z.string().min(1).max(10_000),
  metadata: z.record(z.unknown()).optional(),
});

const outputSchema = z.object({
  sent: z.boolean(),
  channel: z.string(),
  timestamp: z.string(),
  response: z.unknown().optional(),
});

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a send-notification tool for delivering messages via configured channels. */
export function createSendNotificationTool(options?: SendNotificationToolOptions): ExecutableTool {
  const sender = options?.sender ?? createDefaultWebhookSender();

  return {
    id: 'send-notification',
    name: 'Send Notification',
    description:
      'Send a notification via a configured channel. Currently supports webhook (HTTP POST). ' +
      'This is a high-risk tool that requires human approval before execution. ' +
      'Provide a target URL, subject, and message body.',
    category: 'communication',
    inputSchema,
    outputSchema,
    riskLevel: 'high',
    requiresApproval: true,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // SSRF check on target URL
        validateTargetUrl(parsed.target);

        logger.info('Sending notification', {
          component: 'send-notification',
          projectId: context.projectId,
          traceId: context.traceId,
          channel: parsed.channel,
          target: parsed.target,
          subject: parsed.subject,
        });

        const result = await sender.send({
          channel: parsed.channel,
          target: parsed.target,
          subject: parsed.subject,
          message: parsed.message,
          metadata: parsed.metadata,
        });

        const timestamp = new Date().toISOString();

        logger.info('Notification sent', {
          component: 'send-notification',
          projectId: context.projectId,
          traceId: context.traceId,
          channel: parsed.channel,
          success: result.success,
        });

        return ok({
          success: true,
          output: {
            sent: result.success,
            channel: parsed.channel,
            timestamp,
            response: result.response,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Notification failed', {
          component: 'send-notification',
          projectId: context.projectId,
          traceId: context.traceId,
          channel: parsed.channel,
          error: message,
        });
        return err(new ToolExecutionError('send-notification', message));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      try {
        // Validate target URL (SSRF check) without sending
        validateTargetUrl(parsed.target);

        return Promise.resolve(ok({
          success: true,
          output: {
            channel: parsed.channel,
            target: parsed.target,
            subject: parsed.subject,
            messageLength: parsed.message.length,
            hasMetadata: parsed.metadata !== undefined,
            dryRun: true,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('send-notification', message)));
      }
    },
  };
}
