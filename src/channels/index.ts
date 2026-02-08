// Types
export * from './types.js';

// Router
export { createChannelRouter } from './channel-router.js';
export type { ChannelRouter, ChannelRouterDeps } from './channel-router.js';

// Inbound Processor
export { createInboundProcessor } from './inbound-processor.js';
export type { InboundProcessor, InboundProcessorDeps } from './inbound-processor.js';

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

// Adapters
export {
  createTelegramAdapter,
  createWhatsAppAdapter,
  createSlackAdapter,
  getSlackUrlChallenge,
} from './adapters/index.js';
export type {
  TelegramAdapterConfig,
  WhatsAppAdapterConfig,
  SlackAdapterConfig,
} from './adapters/index.js';
