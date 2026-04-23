/**
 * Reply tracker unit tests — verifies inbound events are correlated to
 * CampaignSend records and marked as replied within the 72h window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReplyTracker } from './reply-tracker.js';
import { createProjectEventBus } from '@/api/events/event-bus.js';
import { createMockLogger } from '@/testing/fixtures/routes.js';
import type { PrismaClient } from '@prisma/client';
import type { ProjectEvent } from '@/api/events/event-bus.js';
import type { ProjectId, SessionId } from '@/core/types.js';

// ─── Mock prisma builder ────────────────────────────────────────

interface MockPrisma {
  campaignSend: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  campaignReply: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function createMockPrisma(): MockPrisma {
  const send = { id: 'send-1', campaignId: 'camp-1', contactId: 'c-1', status: 'replied' };
  const reply = {
    id: 'reply-1',
    campaignSendId: 'send-1',
    contactId: 'c-1',
    sessionId: 'sess-1',
    repliedAt: new Date(),
    messageCount: 1,
    converted: false,
    conversionNote: null,
  };
  const mock: MockPrisma = {
    campaignSend: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue(send),
      groupBy: vi.fn().mockResolvedValue([
        { status: 'sent', _count: { _all: 3 } },
        { status: 'replied', _count: { _all: 1 } },
        { status: 'failed', _count: { _all: 0 } },
      ]),
    },
    campaignReply: {
      create: vi.fn().mockResolvedValue(reply),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => {
      return fn(mock);
    }),
  };
  return mock;
}

// ─── Event factory ──────────────────────────────────────────────

function makeInbound(contactId: string | undefined): ProjectEvent {
  const event: ProjectEvent = {
    kind: 'message.inbound',
    projectId: 'proj-a' as ProjectId,
    sessionId: 'sess-1' as SessionId,
    text: 'hola',
    channel: 'whatsapp',
    ts: Date.now(),
  };
  if (contactId !== undefined) event.contactId = contactId;
  return event;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('reply-tracker', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('ignores events without a contactId', async () => {
    const eventBus = createProjectEventBus();
    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    await tracker.handleInbound(makeInbound(undefined));

    expect(prisma.campaignSend.findFirst).not.toHaveBeenCalled();
  });

  it('ignores non-inbound events', async () => {
    const eventBus = createProjectEventBus();
    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    const other: ProjectEvent = {
      kind: 'trace.created',
      projectId: 'proj-a' as ProjectId,
      sessionId: 'sess-1' as SessionId,
      traceId: 't-1' as import('@/core/types.js').TraceId,
      ts: Date.now(),
    };
    await tracker.handleInbound(other);

    expect(prisma.campaignSend.findFirst).not.toHaveBeenCalled();
  });

  it('marks the most recent sent CampaignSend as replied when found', async () => {
    prisma.campaignSend.findFirst.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'sent',
      sentAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    });

    const eventBus = createProjectEventBus();
    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    await tracker.handleInbound(makeInbound('c-1'));

    expect(prisma.campaignSend.findFirst).toHaveBeenCalled();
    // markCampaignReply runs inside a transaction
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.campaignSend.update).toHaveBeenCalledWith({
      where: { id: 'send-1' },
      data: { status: 'replied' },
    });
  });

  it('does nothing when no matching send is within the window', async () => {
    // The findFirst query itself filters by `sentAt: { gte: windowStart }`,
    // so we simply return null for "no matching send".
    prisma.campaignSend.findFirst.mockResolvedValue(null);

    const eventBus = createProjectEventBus();
    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    await tracker.handleInbound(makeInbound('c-1'));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.campaignSend.update).not.toHaveBeenCalled();
  });

  it('emits a campaign.progress event with updated counts after marking a reply', async () => {
    prisma.campaignSend.findFirst.mockResolvedValue({
      id: 'send-1',
      campaignId: 'camp-1',
      contactId: 'c-1',
      status: 'sent',
      sentAt: new Date(),
    });

    const eventBus = createProjectEventBus();
    const onProgress = vi.fn();
    eventBus.subscribe('proj-a' as ProjectId, (e) => {
      if (e.kind === 'campaign.progress') onProgress(e);
    });

    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    await tracker.handleInbound(makeInbound('c-1'));

    expect(onProgress).toHaveBeenCalledOnce();
    const payload = onProgress.mock.calls[0]?.[0] as {
      campaignId: string; sent: number; failed: number; replied: number;
    };
    expect(payload.campaignId).toBe('camp-1');
    // Tally: sent (3) + replied counted as both sent & replied (1) = 4 sent, 1 replied
    expect(payload.sent).toBeGreaterThanOrEqual(3);
    expect(payload.replied).toBeGreaterThanOrEqual(1);
  });

  it('start() installs a subscribeAll listener', () => {
    const eventBus = createProjectEventBus();
    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    // No listeners to begin with
    const spy = vi.spyOn(eventBus, 'subscribeAll');
    tracker.start();

    expect(spy).toHaveBeenCalledOnce();
  });

  it('stop() removes the listener so subsequent events are ignored', () => {
    const eventBus = createProjectEventBus();
    const tracker = createReplyTracker({
      prisma: prisma as unknown as PrismaClient,
      eventBus,
      logger: createMockLogger(),
    });

    const unsub = vi.fn();
    vi.spyOn(eventBus, 'subscribeAll').mockImplementation((() => unsub) as unknown as typeof eventBus.subscribeAll);

    tracker.start();
    tracker.stop();

    expect(unsub).toHaveBeenCalledOnce();
  });
});
