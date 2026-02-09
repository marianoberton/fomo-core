/**
 * Channel Router — routes messages to appropriate channel adapters.
 */
import type { Logger } from '@/observability/logger.js';
import type {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from './types.js';

// ─── Router Interface ───────────────────────────────────────────

export interface ChannelRouter {
  /** Register a channel adapter */
  registerAdapter(adapter: ChannelAdapter): void;

  /** Get an adapter by channel type */
  getAdapter(channel: ChannelType): ChannelAdapter | undefined;

  /** Send a message via the appropriate adapter */
  send(message: OutboundMessage): Promise<SendResult>;

  /** Parse an inbound webhook payload */
  parseInbound(channel: ChannelType, payload: unknown): Promise<InboundMessage | null>;

  /** List all registered channels */
  listChannels(): ChannelType[];

  /** Check health of a specific channel */
  isHealthy(channel: ChannelType): Promise<boolean>;
}

// ─── Router Factory ─────────────────────────────────────────────

export interface ChannelRouterDeps {
  logger: Logger;
}

/**
 * Create a ChannelRouter that manages channel adapters.
 */
export function createChannelRouter(deps: ChannelRouterDeps): ChannelRouter {
  const adapters = new Map<ChannelType, ChannelAdapter>();
  const { logger } = deps;

  return {
    registerAdapter(adapter: ChannelAdapter): void {
      adapters.set(adapter.channelType, adapter);
      logger.info(`Registered channel adapter: ${adapter.channelType}`, {
        component: 'channel-router',
      });
    },

    getAdapter(channel: ChannelType): ChannelAdapter | undefined {
      return adapters.get(channel);
    },

    async send(message: OutboundMessage): Promise<SendResult> {
      const adapter = adapters.get(message.channel);

      if (!adapter) {
        logger.warn(`No adapter for channel: ${message.channel}`, {
          component: 'channel-router',
        });
        return {
          success: false,
          error: `No adapter registered for channel: ${message.channel}`,
        };
      }

      try {
        const result = await adapter.send(message);

        if (result.success) {
          logger.debug(`Message sent via ${message.channel}`, {
            component: 'channel-router',
            channelMessageId: result.channelMessageId,
          });
        } else {
          logger.warn(`Failed to send message via ${message.channel}`, {
            component: 'channel-router',
            error: result.error,
          });
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error sending message via ${message.channel}`, {
          component: 'channel-router',
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }
    },

    async parseInbound(
      channel: ChannelType,
      payload: unknown,
    ): Promise<InboundMessage | null> {
      const adapter = adapters.get(channel);

      if (!adapter) {
        logger.warn(`No adapter for channel: ${channel}`, {
          component: 'channel-router',
        });
        return null;
      }

      try {
        return await adapter.parseInbound(payload);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error parsing inbound message for ${channel}`, {
          component: 'channel-router',
          error: errorMessage,
        });
        return null;
      }
    },

    listChannels(): ChannelType[] {
      return Array.from(adapters.keys());
    },

    async isHealthy(channel: ChannelType): Promise<boolean> {
      const adapter = adapters.get(channel);
      if (!adapter) return false;

      try {
        return await adapter.isHealthy();
      } catch {
        return false;
      }
    },
  };
}
