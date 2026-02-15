// Types
export * from './types.js';

// Router
export { createChannelRouter } from './channel-router.js';
export type { ChannelRouter, ChannelRouterDeps } from './channel-router.js';

// Channel Resolver
export { createChannelResolver } from './channel-resolver.js';
export type { ChannelResolver, ChannelResolverDeps } from './channel-resolver.js';

// Inbound Processor
export { createInboundProcessor } from './inbound-processor.js';
export type { InboundProcessor, InboundProcessorDeps } from './inbound-processor.js';

// Handoff
export { createHandoffManager, DEFAULT_HANDOFF_CONFIG } from './handoff.js';
export type { HandoffManager, HandoffManagerDeps, HandoffConfig } from './handoff.js';

// Proactive Messenger
export {
  createProactiveMessenger,
  createProactiveMessageHandler,
  PROACTIVE_MESSAGE_QUEUE,
} from './proactive.js';
export type {
  ProactiveMessenger,
  ProactiveMessengerDeps,
  ProactiveMessageRequest,
  ProactiveMessageJobData,
} from './proactive.js';

// Webhook Queue
export { createWebhookQueue } from './webhook-queue.js';
export type { WebhookQueue, WebhookQueueOptions } from './webhook-queue.js';
export type { WebhookJobData, WebhookJobResult } from './webhook-queue-types.js';

// Adapters
export {
  createTelegramAdapter,
  createWhatsAppAdapter,
  createSlackAdapter,
  getSlackUrlChallenge,
  createChatwootAdapter,
} from './adapters/index.js';
export type {
  TelegramAdapterConfig,
  WhatsAppAdapterConfig,
  SlackAdapterConfig,
  ChatwootAdapterConfig,
  ChatwootAdapter,
  ChatwootWebhookEvent,
} from './adapters/index.js';
