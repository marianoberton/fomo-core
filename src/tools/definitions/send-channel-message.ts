/**
 * Send Channel Message Tool — sends messages via per-project channel adapters.
 * Routes through the ChannelResolver to resolve project-specific adapters.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { IntegrationProvider } from '@/channels/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'send-channel-message' });

// ─── Schemas ────────────────────────────────────────────────────

const ChannelTypeSchema = z.enum([
  'whatsapp',
  'telegram',
  'slack',
  'chatwoot',
]);

const inputSchema = z.object({
  channel: ChannelTypeSchema.describe('Channel to send the message through'),
  recipientIdentifier: z.string().min(1).max(500)
    .describe('Recipient identifier (phone number, chat ID, channel ID, etc.)'),
  message: z.string().min(1).max(10_000).describe('Message content'),
});

const outputSchema = z.object({
  success: z.boolean(),
  channelMessageId: z.string().optional(),
  error: z.string().optional(),
});

// ─── Options ────────────────────────────────────────────────────

export interface SendChannelMessageToolOptions {
  channelResolver: ChannelResolver;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a send-channel-message tool that routes through per-project channel adapters. */
export function createSendChannelMessageTool(
  options: SendChannelMessageToolOptions,
): ExecutableTool {
  const { channelResolver } = options;

  return {
    id: 'send-channel-message',
    name: 'Send Channel Message',
    description: 'Sends a message through a per-project channel adapter (WhatsApp, Telegram, Slack, Chatwoot). Requires the target channel to be configured as an integration for the project. Medium-risk tool that requires human approval.',
    category: 'communication',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
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
        const channel = parsed.channel as IntegrationProvider;

        const adapter = await channelResolver.resolveAdapter(context.projectId, channel);
        if (!adapter) {
          return err(new ToolExecutionError(
            'send-channel-message',
            `No ${channel} integration configured for this project. Set up a ${channel} integration first.`,
          ));
        }

        const result = await channelResolver.send(context.projectId, channel, {
          channel,
          recipientIdentifier: parsed.recipientIdentifier,
          content: parsed.message,
        });

        if (!result.success) {
          return err(new ToolExecutionError(
            'send-channel-message',
            result.error ?? `Failed to send message via ${channel}`,
          ));
        }

        logger.info('Channel message sent', {
          component: 'send-channel-message',
          projectId: context.projectId,
          traceId: context.traceId,
          channel,
          channelMessageId: result.channelMessageId,
        });

        return ok({
          success: true,
          output: {
            success: true,
            channelMessageId: result.channelMessageId,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('send-channel-message', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      const channel = parsed.channel as IntegrationProvider;
      const adapter = await channelResolver.resolveAdapter(context.projectId, channel);

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          channel,
          recipientIdentifier: parsed.recipientIdentifier,
          messageLength: parsed.message.length,
          adapterConfigured: adapter !== null,
        },
        durationMs: 0,
      }));
    },
  };
}
