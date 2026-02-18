/**
 * Send Channel Message Tool — sends messages via registered channel adapters.
 * Routes through the ChannelRouter to WhatsApp, Telegram, Slack, etc.
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { ChannelRouter } from '@/channels/channel-router.js';
import type { ChannelType } from '@/channels/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'send-channel-message' });

// ─── Schemas ────────────────────────────────────────────────────

const ChannelTypeSchema = z.enum([
  'whatsapp',
  'telegram',
  'slack',
  'email',
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
  channelRouter: ChannelRouter;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a send-channel-message tool that routes through channel adapters. */
export function createSendChannelMessageTool(
  options: SendChannelMessageToolOptions,
): ExecutableTool {
  const { channelRouter } = options;

  return {
    id: 'send-channel-message',
    name: 'Send Channel Message',
    description: 'Sends a message through a registered channel adapter (WhatsApp, Telegram, Slack, etc.). Requires the target channel to be configured. Medium-risk tool that requires human approval.',
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
        const channel = parsed.channel as ChannelType;
        const adapter = channelRouter.getAdapter(channel);

        if (!adapter) {
          return err(new ToolExecutionError(
            'send-channel-message',
            `No adapter registered for channel: ${channel}. Available channels: ${channelRouter.listChannels().join(', ') || 'none'}`,
          ));
        }

        const result = await channelRouter.send({
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
      void context;
      const parsed = inputSchema.parse(input);

      const channel = parsed.channel as ChannelType;
      const adapter = channelRouter.getAdapter(channel);
      const availableChannels = channelRouter.listChannels();

      return Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          channel,
          recipientIdentifier: parsed.recipientIdentifier,
          messageLength: parsed.message.length,
          adapterRegistered: adapter !== undefined,
          availableChannels,
        },
        durationMs: 0,
      }));
    },
  };
}
