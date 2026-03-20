/**
 * Campaign Tracker — records replies, conversions, and aggregates metrics.
 *
 * Deliberately decoupled from the runner so it can be called from any
 * inbound handler and tested in isolation.
 */
import type { PrismaClient } from '@prisma/client';
import type { ContactId } from '@/contacts/types.js';
import type {
  CampaignId,
  CampaignSendId,
  CampaignReply,
  CampaignMetrics,
} from './types.js';

// ─── Mark Reply ─────────────────────────────────────────────────

export interface MarkReplyOptions {
  messageCount?: number;
}

/**
 * Record a contact's reply to a campaign message.
 *
 * - Finds the most-recent CampaignSend for (campaignId, contactId) with
 *   status 'sent'.
 * - Updates it to 'replied'.
 * - Creates a CampaignReply record.
 * - Returns the updated CampaignSend, or null if no eligible send was found.
 */
export async function markCampaignReply(
  prisma: PrismaClient,
  campaignId: CampaignId,
  contactId: ContactId,
  sessionId: string,
  options: MarkReplyOptions = {},
): Promise<{ campaignSend: { id: string; status: string }; reply: CampaignReply } | null> {
  const send = await prisma.campaignSend.findFirst({
    where: {
      campaignId,
      contactId,
      status: 'sent',
    },
    orderBy: { sentAt: 'desc' },
  });

  if (!send) return null;

  const now = new Date();

  let updatedSend: { id: string; status: string };
  let createdReply: {
    id: string; campaignSendId: string; contactId: string; sessionId: string;
    repliedAt: Date; messageCount: number; converted: boolean; conversionNote: string | null;
  };

  await prisma.$transaction(async (tx) => {
    updatedSend = await tx.campaignSend.update({
      where: { id: send.id },
      data: { status: 'replied' },
    });
    createdReply = await tx.campaignReply.create({
      data: {
        campaignSendId: send.id,
        contactId,
        sessionId,
        repliedAt: now,
        messageCount: options.messageCount ?? 1,
        converted: false,
      },
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const s = updatedSend!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const r = createdReply!;

  return {
    campaignSend: { id: s.id, status: s.status },
    reply: {
      id: r.id,
      campaignSendId: r.campaignSendId as CampaignSendId,
      contactId: r.contactId,
      sessionId: r.sessionId,
      repliedAt: r.repliedAt,
      messageCount: r.messageCount,
      converted: r.converted,
      conversionNote: r.conversionNote ?? undefined,
    },
  };
}

// ─── Mark Conversion ────────────────────────────────────────────

/**
 * Mark a campaign send as converted and update its associated reply.
 *
 * Returns true if the send was found and updated, false otherwise.
 */
export async function markConversion(
  prisma: PrismaClient,
  campaignSendId: CampaignSendId,
  note?: string,
): Promise<boolean> {
  const send = await prisma.campaignSend.findUnique({
    where: { id: campaignSendId },
    include: { reply: true },
  });

  if (!send) return false;

  await prisma.$transaction(async (tx) => {
    await tx.campaignSend.update({
      where: { id: campaignSendId },
      data: { status: 'converted' },
    });

    if (send.reply) {
      await tx.campaignReply.update({
        where: { id: send.reply.id },
        data: { converted: true, ...(note !== undefined && { conversionNote: note }) },
      });
    }
  });

  return true;
}

// ─── Metrics ────────────────────────────────────────────────────

/**
 * Aggregate reply/conversion metrics for a campaign.
 *
 * All CampaignSend rows are fetched together with their optional
 * CampaignReply so we can compute timing and daily breakdowns in one pass.
 */
export async function getCampaignMetrics(
  prisma: PrismaClient,
  campaignId: CampaignId,
): Promise<CampaignMetrics> {
  const sends = await prisma.campaignSend.findMany({
    where: { campaignId },
    include: { reply: true },
    orderBy: { createdAt: 'asc' },
  });

  let totalSent = 0;
  let totalFailed = 0;
  let totalReplied = 0;
  let totalConverted = 0;
  let totalResponseMs = 0;
  let responseCount = 0;

  // byDay accumulator: key = 'YYYY-MM-DD'
  const dayMap = new Map<string, { sent: number; replied: number; converted: number }>();

  const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

  for (const send of sends) {
    const status = send.status;

    // Sent = any status beyond queued (sent, replied, converted)
    const isSent = status === 'sent' || status === 'replied' || status === 'converted';
    const isFailed = status === 'failed';
    const isReplied = status === 'replied' || status === 'converted';
    const isConverted = status === 'converted';

    if (isSent) totalSent++;
    if (isFailed) totalFailed++;
    if (isReplied) totalReplied++;
    if (isConverted) totalConverted++;

    // Response time: sentAt → repliedAt
    if (send.reply && send.sentAt) {
      const ms = send.reply.repliedAt.getTime() - send.sentAt.getTime();
      if (ms >= 0) {
        totalResponseMs += ms;
        responseCount++;
      }
    }

    // Daily breakdown keyed by sentAt (or createdAt as fallback)
    const dateStr = dayKey(send.sentAt ?? send.createdAt);
    const day = dayMap.get(dateStr) ?? { sent: 0, replied: 0, converted: 0 };
    if (isSent) day.sent++;
    if (isReplied) day.replied++;
    if (isConverted) day.converted++;
    dayMap.set(dateStr, day);
  }

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  return {
    campaignId,
    totalSent,
    totalFailed,
    totalReplied,
    totalConverted,
    replyRate: totalSent > 0 ? totalReplied / totalSent : 0,
    conversionRate: totalSent > 0 ? totalConverted / totalSent : 0,
    avgResponseTimeMs: responseCount > 0 ? Math.round(totalResponseMs / responseCount) : null,
    breakdown: { byDay },
  };
}
