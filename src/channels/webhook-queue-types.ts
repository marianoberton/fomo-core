/**
 * Webhook Queue Types — BullMQ job types for async webhook processing.
 *
 * Webhooks are enqueued immediately and processed asynchronously with retry.
 * This prevents timeouts and enables automatic retry on failure.
 */
import type { ProjectId } from '@/core/types.js';
import type { ChatwootWebhookEvent } from './adapters/chatwoot.js';

// ─── Job Data ───────────────────────────────────────────────────────

/** Data stored in BullMQ job for webhook processing. */
export interface WebhookJobData {
  /** Unique ID for this webhook delivery (for deduplication). */
  webhookId: string;
  /** Project ID resolved from webhook (e.g., from Chatwoot account_id). */
  projectId: ProjectId;
  /** The webhook event payload. */
  event: ChatwootWebhookEvent;
  /** ISO timestamp when webhook was received. */
  receivedAt: string;
  /** Optional conversation ID for tracking. */
  conversationId?: number;
}

// ─── Job Result ─────────────────────────────────────────────────────

/** Result returned from webhook processing job. */
export interface WebhookJobResult {
  success: boolean;
  /** Agent response sent back to user (if any). */
  response?: string;
  /** Whether the conversation was escalated to human. */
  escalated?: boolean;
  /** Error message if processing failed. */
  errorMessage?: string;
  /** Duration in milliseconds. */
  durationMs?: number;
}
