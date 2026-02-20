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
    findById: vi.fn(),
    findByContactId: vi.fn(),
    listByProject: vi.fn().mockResolvedValue([mockSession]),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
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
      sessionRepo.listByProject.mockResolvedValue([]);
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
        findById: vi.fn(),
        findByContactId: vi.fn(),
        listByProject: vi.fn().mockResolvedValue([]), // No existing session
        addMessage: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        updateStatus: vi.fn(),
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
});
