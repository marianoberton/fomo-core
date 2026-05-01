/**
 * Tests for the Inbound Processor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInboundProcessor } from './inbound-processor.js';
import type { InboundProcessorDeps } from './inbound-processor.js';
import type { InboundMessage } from './types.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { Contact, ContactRepository } from '@/contacts/types.js';
import type { Session, SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { AgentChannelRouter } from './agent-channel-router.js';
import type { Logger } from '@/observability/logger.js';
import type { AgentId } from '@/agents/types.js';
import type { MessageDeduplicator } from './message-dedup.js';
import type { ReplyTracker } from '@/campaigns/reply-tracker.js';

// ─── Mock Logger ────────────────────────────────────────────────

const mockLogger: { [K in keyof Logger]: ReturnType<typeof vi.fn> } = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

// ─── Mock Contact ───────────────────────────────────────────────

const mockContact: Contact = {
  id: 'contact-1',
  projectId: 'project-1' as ProjectId,
  name: 'Test User',
  language: 'es',
  phone: '+1234567890',
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOwnerContact: Contact = {
  ...mockContact,
  id: 'contact-owner',
  name: 'Owner',
  role: 'owner',
};

// ─── Mock Session ───────────────────────────────────────────────

const mockSession: Session = {
  id: 'session-1' as SessionId,
  projectId: 'project-1' as ProjectId,
  status: 'active',
  metadata: { contactId: 'contact-1', channel: 'whatsapp' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Helpers ────────────────────────────────────────────────────

function createMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    projectId: 'project-1' as ProjectId,
    channel: 'whatsapp',
    channelMessageId: 'ch-msg-1',
    senderIdentifier: '+1234567890',
    content: 'Hello',
    rawPayload: {},
    receivedAt: new Date(),
    ...overrides,
  };
}

function createDeps(overrides: Partial<InboundProcessorDeps> = {}): InboundProcessorDeps {
  const contactRepository: { [K in keyof ContactRepository]: ReturnType<typeof vi.fn> } = {
    create: vi.fn().mockResolvedValue(mockContact),
    findById: vi.fn(),
    findByChannel: vi.fn().mockResolvedValue(mockContact),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };

  const sessionRepository: { [K in keyof SessionRepository]: ReturnType<typeof vi.fn> } = {
    create: vi.fn().mockResolvedValue(mockSession),
    ensureWithId: vi.fn().mockResolvedValue(mockSession),
    findById: vi.fn(),
    findByContactId: vi.fn().mockResolvedValue(mockSession),
    findByCallId: vi.fn(),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn().mockResolvedValue(true),
    listByProject: vi.fn().mockResolvedValue([mockSession]),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
  };

  const channelResolver = {
    send: vi.fn().mockResolvedValue({ success: true, messageId: 'sent-1' }),
    resolveAdapter: vi.fn(),
  } as unknown as { [K in keyof ChannelResolver]: ReturnType<typeof vi.fn> };

  const runAgent = vi.fn().mockResolvedValue({ response: 'Hello back!' });

  return {
    channelResolver: channelResolver as unknown as ChannelResolver,
    contactRepository,
    sessionRepository,
    logger: mockLogger,
    runAgent,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('InboundProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('process', () => {
    it('processes a basic inbound message', async () => {
      const deps = createDeps();
      const processor = createInboundProcessor(deps);
      const message = createMessage();

      const result = await processor.process(message);

      expect(result.success).toBe(true);
      expect(deps.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          sessionId: 'session-1',
          userMessage: 'Hello',
          sourceChannel: 'whatsapp',
        }),
      );
    });

    it('rejects unsupported channels', async () => {
      const deps = createDeps();
      const processor = createInboundProcessor(deps);
      const message = createMessage({ channel: 'email' as 'whatsapp' });

      const result = await processor.process(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a supported integration provider');
    });

    it('creates a new contact when not found', async () => {
      const deps = createDeps();
      const contactRepo = deps.contactRepository as unknown as { [K in keyof ContactRepository]: ReturnType<typeof vi.fn> };
      contactRepo.findByChannel.mockResolvedValue(null);
      const processor = createInboundProcessor(deps);
      const message = createMessage({ senderName: 'New User' });

      await processor.process(message);

      expect(contactRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          name: 'New User',
          phone: '+1234567890',
        }),
      );
    });

    it('creates a new session when no existing session for contact', async () => {
      const deps = createDeps();
      const sessionRepo = deps.sessionRepository as unknown as { [K in keyof SessionRepository]: ReturnType<typeof vi.fn> };
      sessionRepo.findByContactId.mockResolvedValue(null);
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());

      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          metadata: expect.objectContaining({
            contactId: 'contact-1',
            channel: 'whatsapp',
          }),
        }),
      );
    });

    it('sends response back via the same channel', async () => {
      const deps = createDeps();
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());

      const resolver = deps.channelResolver as unknown as { send: ReturnType<typeof vi.fn> };
      expect(resolver.send).toHaveBeenCalledWith(
        'project-1',
        'whatsapp',
        expect.objectContaining({
          channel: 'whatsapp',
          recipientIdentifier: '+1234567890',
          content: 'Hello back!',
        }),
      );
    });

    it('returns error on runAgent failure', async () => {
      const deps = createDeps();
      (deps.runAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Agent crashed'));
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent crashed');
    });
  });

  describe('paused session (operator takeover)', () => {
    it('persists message but skips agent when session is paused', async () => {
      const pausedSession: Session = {
        ...mockSession,
        status: 'paused',
      };
      const sessionRepo: { [K in keyof SessionRepository]: ReturnType<typeof vi.fn> } = {
        create: vi.fn(),
        ensureWithId: vi.fn(),
        findById: vi.fn(),
        findByContactId: vi.fn().mockResolvedValue(pausedSession),
        findByCallId: vi.fn(),
        updateStatus: vi.fn(),
        updateMetadata: vi.fn().mockResolvedValue(true),
        listByProject: vi.fn().mockResolvedValue([pausedSession]),
        addMessage: vi.fn().mockResolvedValue({ id: 'msg-stored-1', sessionId: pausedSession.id, role: 'user', content: 'Hello', createdAt: new Date() }),
        getMessages: vi.fn().mockResolvedValue([]),
      };

      const deps = createDeps({ sessionRepository: sessionRepo });
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(true);
      // Message should be persisted
      expect(sessionRepo.addMessage).toHaveBeenCalledWith(
        'session-1',
        { role: 'user', content: 'Hello' },
      );
      // Agent should NOT run
      expect(deps.runAgent).not.toHaveBeenCalled();
    });

    it('broadcasts to sessionBroadcaster when session is paused', async () => {
      const pausedSession: Session = {
        ...mockSession,
        status: 'paused',
      };
      const sessionRepo: { [K in keyof SessionRepository]: ReturnType<typeof vi.fn> } = {
        create: vi.fn(),
        ensureWithId: vi.fn(),
        findById: vi.fn(),
        findByContactId: vi.fn().mockResolvedValue(pausedSession),
        findByCallId: vi.fn(),
        updateStatus: vi.fn(),
        updateMetadata: vi.fn().mockResolvedValue(true),
        listByProject: vi.fn().mockResolvedValue([pausedSession]),
        addMessage: vi.fn().mockResolvedValue({ id: 'msg-stored-2', sessionId: pausedSession.id, role: 'user', content: 'Hello', createdAt: new Date() }),
        getMessages: vi.fn().mockResolvedValue([]),
      };

      const mockBroadcaster = {
        subscribe: vi.fn().mockReturnValue(() => { /* noop */ }),
        broadcast: vi.fn(),
      };

      const deps = createDeps({ sessionRepository: sessionRepo, sessionBroadcaster: mockBroadcaster });
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());

      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          type: 'message.new',
          role: 'user',
          content: 'Hello',
        }),
      );
    });
  });

  describe('deduplication', () => {
    it('skips duplicate messages when deduplicator is provided', async () => {
      const mockDedup = { isDuplicate: vi.fn() };
      mockDedup.isDuplicate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const deps = createDeps({ messageDeduplicator: mockDedup });
      const processor = createInboundProcessor(deps);

      const msg = createMessage();
      await processor.process(msg);
      const result = await processor.process(msg);

      expect(result.success).toBe(true);
      // Agent should only run once (first call)
      expect(deps.runAgent).toHaveBeenCalledTimes(1);
    });

    it('processes normally without deduplicator', async () => {
      const deps = createDeps(); // no deduplicator
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());
      await processor.process(createMessage());

      // Both calls processed
      expect(deps.runAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe('with agentChannelRouter', () => {
    it('passes resolved agentId to runAgent', async () => {
      const mockRouter: { [K in keyof AgentChannelRouter]: ReturnType<typeof vi.fn> } = {
        resolveAgent: vi.fn().mockResolvedValue({
          agentId: 'agent-42' as AgentId,
          mode: { modeName: 'public', toolAllowlist: ['calculator'], promptOverrides: undefined, mcpServerNames: [] },
        }),
      };

      const deps = createDeps({ agentChannelRouter: mockRouter });
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());

      expect(deps.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-42',
          sourceChannel: 'whatsapp',
        }),
      );
    });

    it('passes contactRole to agentChannelRouter', async () => {
      const mockRouter: { [K in keyof AgentChannelRouter]: ReturnType<typeof vi.fn> } = {
        resolveAgent: vi.fn().mockResolvedValue(null),
      };

      // Contact with role
      const contactRepo: { [K in keyof ContactRepository]: ReturnType<typeof vi.fn> } = {
        create: vi.fn().mockResolvedValue(mockOwnerContact),
        findById: vi.fn(),
        findByChannel: vi.fn().mockResolvedValue(mockOwnerContact),
        update: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const deps = createDeps({
        agentChannelRouter: mockRouter,
        contactRepository: contactRepo,
      });
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());

      expect(mockRouter.resolveAgent).toHaveBeenCalledWith(
        'project-1',
        'whatsapp',
        'owner',
      );
    });

    it('includes agentId in session metadata when agent resolved', async () => {
      const mockRouter: { [K in keyof AgentChannelRouter]: ReturnType<typeof vi.fn> } = {
        resolveAgent: vi.fn().mockResolvedValue({
          agentId: 'agent-42' as AgentId,
          mode: { modeName: 'internal', toolAllowlist: [], promptOverrides: undefined, mcpServerNames: [] },
        }),
      };

      const sessionRepo: { [K in keyof SessionRepository]: ReturnType<typeof vi.fn> } = {
        create: vi.fn().mockResolvedValue(mockSession),
        ensureWithId: vi.fn().mockResolvedValue(mockSession),
        findById: vi.fn(),
        findByContactId: vi.fn().mockResolvedValue(null), // No existing session
        findByCallId: vi.fn(),
        updateStatus: vi.fn(),
        updateMetadata: vi.fn().mockResolvedValue(true),
        listByProject: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
      };

      const deps = createDeps({
        agentChannelRouter: mockRouter,
        sessionRepository: sessionRepo,
      });
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage());

      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            agentId: 'agent-42',
          }),
        }),
      );
    });

    it('works without agentChannelRouter (backward compat)', async () => {
      const deps = createDeps();
      // No agentChannelRouter set
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(true);
      expect(deps.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: undefined,
          sourceChannel: 'whatsapp',
        }),
      );
    });
  });

  describe('type=conversational filter invariant (via agentChannelRouter)', () => {
    it('routes to conversational agent when router resolves a match', async () => {
      const mockRouter: { [K in keyof AgentChannelRouter]: ReturnType<typeof vi.fn> } = {
        resolveAgent: vi.fn().mockResolvedValue({
          agentId: 'agent-conv' as AgentId,
          mode: { modeName: 'public', toolAllowlist: ['calculator'], promptOverrides: undefined, mcpServerNames: [] },
        }),
      };

      const deps = createDeps({ agentChannelRouter: mockRouter });
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(true);
      expect(deps.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-conv', sourceChannel: 'whatsapp' }),
      );
    });

    it('logs warning and falls back to project-level routing when no conversational agent is found', async () => {
      // Simulates the case where all agents in the project are process/backoffice —
      // agentChannelRouter returns null because none pass the type='conversational' filter.
      const mockRouter: { [K in keyof AgentChannelRouter]: ReturnType<typeof vi.fn> } = {
        resolveAgent: vi.fn().mockResolvedValue(null),
      };

      const deps = createDeps({ agentChannelRouter: mockRouter });
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No conversational agent found for channel — falling back to project-level routing',
        expect.objectContaining({ component: 'inbound-processor', channel: 'whatsapp' }),
      );
      // Flow continues: project-level agent (agentId=undefined) handles the message
      expect(deps.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: undefined, sourceChannel: 'whatsapp' }),
      );
    });
  });

  describe('reply-tracker fallback', () => {
    function createReplyTrackerMock(): {
      [K in keyof ReplyTracker]: ReturnType<typeof vi.fn>;
    } {
      return {
        start: vi.fn(),
        stop: vi.fn(),
        handleInbound: vi.fn().mockResolvedValue(undefined),
        checkAndMarkReply: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('calls checkAndMarkReply with the correct params on happy path', async () => {
      const replyTracker = createReplyTrackerMock();
      const receivedAt = new Date('2026-04-24T10:00:00Z');
      const deps = createDeps({ replyTracker: replyTracker as unknown as ReplyTracker });
      const processor = createInboundProcessor(deps);

      await processor.process(createMessage({ receivedAt }));

      expect(replyTracker.checkAndMarkReply).toHaveBeenCalledTimes(1);
      expect(replyTracker.checkAndMarkReply).toHaveBeenCalledWith({
        projectId: 'project-1',
        contactId: 'contact-1',
        sessionId: 'session-1',
        receivedAt,
      });
    });

    it('is idempotent when the CampaignSend is already replied (tracker no-ops)', async () => {
      // The tracker's own query filters by `status = 'sent'`, so a repeat
      // invocation for an already-replied send is a no-op at the DB layer.
      // We simulate that here with a resolved-to-undefined mock: no throw,
      // no side effect signalled back to the processor.
      const replyTracker = createReplyTrackerMock();
      replyTracker.checkAndMarkReply.mockResolvedValue(undefined);

      const deps = createDeps({ replyTracker: replyTracker as unknown as ReplyTracker });
      const processor = createInboundProcessor(deps);

      const result1 = await processor.process(createMessage());
      const result2 = await processor.process(createMessage());

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(replyTracker.checkAndMarkReply).toHaveBeenCalledTimes(2);
      // No warn logged for either call — idempotent path must not noise up logs
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('completes the flow and logs warn when checkAndMarkReply throws', async () => {
      const replyTracker = createReplyTrackerMock();
      replyTracker.checkAndMarkReply.mockRejectedValue(new Error('DB unavailable'));

      const deps = createDeps({ replyTracker: replyTracker as unknown as ReplyTracker });
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      // Main flow must succeed despite the tracker crashing
      expect(result.success).toBe(true);
      expect(deps.runAgent).toHaveBeenCalledTimes(1);
      const resolver = deps.channelResolver as unknown as { send: ReturnType<typeof vi.fn> };
      expect(resolver.send).toHaveBeenCalledTimes(1);

      // The failure is logged as a warn with the error message
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Reply-tracker fallback failed',
        expect.objectContaining({
          component: 'inbound-processor',
          contactId: 'contact-1',
          sessionId: 'session-1',
          error: 'DB unavailable',
        }),
      );
    });

    it('still calls checkAndMarkReply when contact has no active CampaignSend (tracker decides no-op)', async () => {
      // The processor does not know whether the contact has an active
      // CampaignSend — it unconditionally calls the tracker, which decides.
      // A resolved-undefined mock simulates the "no eligible send" path.
      const replyTracker = createReplyTrackerMock();
      replyTracker.checkAndMarkReply.mockResolvedValue(undefined);

      const deps = createDeps({ replyTracker: replyTracker as unknown as ReplyTracker });
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(true);
      expect(replyTracker.checkAndMarkReply).toHaveBeenCalledTimes(1);
      // Flow continues: agent runs, response is sent
      expect(deps.runAgent).toHaveBeenCalledTimes(1);
      const resolver = deps.channelResolver as unknown as { send: ReturnType<typeof vi.fn> };
      expect(resolver.send).toHaveBeenCalledTimes(1);
    });

    it('skips the fallback call entirely when replyTracker is not provided', async () => {
      const deps = createDeps(); // no replyTracker
      const processor = createInboundProcessor(deps);

      const result = await processor.process(createMessage());

      expect(result.success).toBe(true);
      // No warn — absence of the tracker is not an error
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
