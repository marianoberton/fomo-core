/**
 * Approval notifier transports.
 *
 * Notifiers consume an enriched `ApprovalNotificationContext` (built
 * once per approval) and push it to a delivery channel. The composite
 * notifier fans out to all registered transports.
 */
export type {
  ApprovalNotificationContext,
  ApprovalContextNotifier,
  InAppApprovalPayload,
} from './types.js';

export { buildApprovalContext } from './approval-context.js';

export {
  createTelegramApprovalNotifier,
  buildMessage as buildTelegramApprovalMessage,
} from './telegram-approval-notifier.js';
export type { TelegramApprovalNotifierConfig } from './telegram-approval-notifier.js';

export {
  createInAppApprovalNotifier,
  APPROVAL_NOTIFICATION_KIND,
} from './in-app-approval-notifier.js';
export type { InAppApprovalNotifierConfig } from './in-app-approval-notifier.js';

export { createCompositeApprovalNotifier } from './composite-approval-notifier.js';
export type { CompositeApprovalNotifierConfig } from './composite-approval-notifier.js';
