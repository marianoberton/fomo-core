/**
 * Campaign Reply Tracker — listens to `message.inbound` on the event bus and
 * marks the most recent `sent` CampaignSend as `replied` when a contact
 * responds within the reply window (default: 72h).
 *
 * Also emits a `campaign.progress` event with the updated reply count so
 * subscribers can refresh live dashboards without polling.
 *
 * Wired at boot in main.ts; runs until the process exits.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type {
  ProjectEvent,
  ProjectEventBus,
} from '@/api/events/event-bus.js';
import { markCampaignReply } from './campaign-tracker.js';
import type { CampaignId } from './types.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';

// ─── Config ─────────────────────────────────────────────────────

/** How far back to look for a matching campaign send when marking a reply. */
const REPLY_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h

// ─── Interface ──────────────────────────────────────────────────

export interface ReplyTrackerDeps {
  prisma: PrismaClient;
  eventBus: ProjectEventBus;
  logger: Logger;
  /** Override the default 72h reply window. */
  replyWindowMs?: number;
}

export interface CheckAndMarkReplyParams {
  projectId: ProjectId;
  contactId: ContactId;
  sessionId: SessionId;
  receivedAt?: Date;
}

export interface ReplyTracker {
  start(): void;
  stop(): void;
  /**
   * Process a single inbound event. Exposed for unit tests — production
   * code should prefer start() + emitting onto the bus.
   */
  handleInbound(event: ProjectEvent): Promise<void>;
  /**
   * Defensive entry point for direct callers (e.g. inbound-processor) that
   * cannot assume the event-bus subscriber fired. Runs the same idempotent
   * check as `handleInbound`: filters by `status = 'sent'`, so duplicate
   * invocations (bus + direct) cannot double-mark a reply.
   */
  checkAndMarkReply(params: CheckAndMarkReplyParams): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────

export function createReplyTracker(deps: ReplyTrackerDeps): ReplyTracker {
  const { prisma, eventBus, logger } = deps;
  const windowMs = deps.replyWindowMs ?? REPLY_WINDOW_MS;

  let unsubscribe: (() => void) | null = null;

  async function handleInbound(event: ProjectEvent): Promise<void> {
    if (event.kind !== 'message.inbound') return;
    if (!event.contactId) return;

    const windowStart = new Date(Date.now() - windowMs);

    try {
      const send = await prisma.campaignSend.findFirst({
        where: {
          contactId: event.contactId,
          status: 'sent',
          sentAt: { gte: windowStart },
          campaign: { projectId: event.projectId },
        },
        orderBy: { sentAt: 'desc' },
      });

      if (!send) return;

      const result = await markCampaignReply(
        prisma,
        send.campaignId as CampaignId,
        event.contactId,
        event.sessionId,
      );

      if (!result) return;

      logger.info('Campaign reply tracked', {
        component: 'reply-tracker',
        campaignSendId: result.campaignSend.id,
        contactId: event.contactId,
        sessionId: event.sessionId,
        projectId: event.projectId,
        campaignId: send.campaignId,
      });

      // Recompute aggregate counts for this campaign and emit progress.
      const counts = await prisma.campaignSend.groupBy({
        by: ['status'],
        where: { campaignId: send.campaignId },
        _count: { _all: true },
      });
      const tally = { sent: 0, failed: 0, replied: 0 };
      for (const row of counts) {
        if (row.status === 'sent') {
          tally.sent += row._count._all;
        } else if (row.status === 'failed') {
          tally.failed += row._count._all;
        } else if (row.status === 'replied' || row.status === 'converted') {
          tally.replied += row._count._all;
          tally.sent += row._count._all;
        }
      }
      eventBus.emit({
        kind: 'campaign.progress',
        projectId: event.projectId,
        campaignId: send.campaignId,
        sent: tally.sent,
        failed: tally.failed,
        replied: tally.replied,
        ts: Date.now(),
      });
    } catch (err) {
      logger.error('Reply tracker failed to mark reply', {
        component: 'reply-tracker',
        projectId: event.projectId,
        contactId: event.contactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    start(): void {
      if (unsubscribe) return;
      unsubscribe = eventBus.subscribeAll((event) => {
        void handleInbound(event);
      });
      logger.info('Reply tracker started', {
        component: 'reply-tracker',
        replyWindowMs: windowMs,
      });
    },
    stop(): void {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
    handleInbound,
    async checkAndMarkReply(params: CheckAndMarkReplyParams): Promise<void> {
      await handleInbound({
        kind: 'message.inbound',
        projectId: params.projectId,
        sessionId: params.sessionId,
        contactId: params.contactId,
        text: '',
        channel: 'fallback',
        ts: (params.receivedAt ?? new Date()).getTime(),
      });
    },
  };
}
