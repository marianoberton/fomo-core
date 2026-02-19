/**
 * WhatsApp End-to-End Integration Test
 *
 * Tests the complete flow:
 * 1. WhatsApp webhook receives message
 * 2. Adapter parses inbound message
 * 3. InboundProcessor creates/finds contact and session
 * 4. Agent processes message
 * 5. Response is sent back via WhatsApp
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { ContactRepository, Contact, CreateContactInput, ChannelIdentifier } from '@/contacts/types.js';
import type {
  SessionRepository,
  Session,
  SessionCreateInput,
  StoredMessage,
} from '@/infrastructure/repositories/session-repository.js';
import { createWhatsAppAdapter } from './adapters/whatsapp.js';
import { createInboundProcessor } from './inbound-processor.js';
import type { ChannelResolver } from './channel-resolver.js';
import type { OutboundMessage } from './types.js';

// ─── Mock Factories ─────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockContactRepository(): ContactRepository {
  const contacts = new Map<string, Contact>();
  let idCounter = 1;

  return {
    findByChannel: vi.fn((_projectId: ProjectId, identifier: ChannelIdentifier): Promise<Contact | null> => {
      for (const contact of contacts.values()) {
        if (contact.phone === identifier.value) {
          return Promise.resolve(contact);
        }
      }
      return Promise.resolve(null);
    }),
    create: vi.fn((data: CreateContactInput): Promise<Contact> => {
      const contact: Contact = {
        id: `contact_${String(idCounter++)}`,
        projectId: data.projectId,
        name: data.name,
        email: data.email ?? undefined,
        phone: data.phone ?? undefined,
        telegramId: data.telegramId ?? undefined,
        slackId: data.slackId ?? undefined,
        language: 'es',
        metadata: data.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      contacts.set(contact.id, contact);
      return Promise.resolve(contact);
    }),
    findById: vi.fn((id: string): Promise<Contact | null> => Promise.resolve(contacts.get(id) ?? null)),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn((): Promise<Contact[]> => Promise.resolve(Array.from(contacts.values()))),
  };
}

function createMockSessionRepository(): SessionRepository {
  const sessions = new Map<string, Session>();
  let idCounter = 1;

  return {
    create: vi.fn((data: SessionCreateInput): Promise<Session> => {
      const session: Session = {
        id: `session_${String(idCounter++)}` as SessionId,
        projectId: data.projectId,
        status: 'active',
        metadata: data.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      sessions.set(session.id, session);
      return Promise.resolve(session);
    }),
    findById: vi.fn((id: string): Promise<Session | null> => Promise.resolve(sessions.get(id) ?? null)),
    findByContactId: vi.fn((): Promise<Session | null> => Promise.resolve(null)),
    listByProject: vi.fn((): Promise<Session[]> => Promise.resolve(Array.from(sessions.values()))),
    addMessage: vi.fn((sessionId: string, message: { role: string; content: string }): Promise<StoredMessage> => {
      const session = sessions.get(sessionId);
      void session;
      return Promise.resolve({
        id: `msg_${String(idCounter++)}`,
        sessionId: sessionId as SessionId,
        role: message.role,
        content: message.content,
        createdAt: new Date(),
      });
    }),
    getMessages: vi.fn((): Promise<StoredMessage[]> => Promise.resolve([])),
    updateStatus: vi.fn(),
  };
}

// ─── Test Suite ─────────────────────────────────────────────────

describe('WhatsApp End-to-End Integration', () => {
  const defaultProjectId = 'test-project' as ProjectId;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes text message end-to-end', async () => {
    // Setup
    const logger = createMockLogger();
    const contactRepository = createMockContactRepository();
    const sessionRepository = createMockSessionRepository();

    // Mock send to avoid actual API calls
    const mockSend = vi.fn().mockResolvedValue({
      success: true,
      channelMessageId: 'sent_msg_123',
    });

    const channelResolver = {
      resolveAdapter: vi.fn(),
      resolveIntegration: vi.fn(),
      resolveProjectByIntegration: vi.fn(),
      resolveProjectByAccount: vi.fn(),
      send: vi.fn().mockImplementation(async (_projectId: ProjectId, _provider: string, message: OutboundMessage) => mockSend(message)),
      invalidate: vi.fn(),
    } as unknown as ChannelResolver;

    // Mock runAgent
    const runAgent = vi.fn().mockResolvedValue({
      response: 'Hello! I am an AI agent. How can I help you?',
    });

    const whatsappAdapter = createWhatsAppAdapter({
      accessToken: 'test-token-123',
      phoneNumberId: 'test-phone-id',
      projectId: defaultProjectId,
    });

    const inboundProcessor = createInboundProcessor({
      channelResolver,
      contactRepository,
      sessionRepository,
      logger,
      runAgent,
    });

    // Simulate webhook payload
    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: 'test-phone-id',
                },
                contacts: [
                  {
                    profile: { name: 'Test User' },
                    wa_id: '5491132766709',
                  },
                ],
                messages: [
                  {
                    from: '5491132766709',
                    id: 'msg_incoming_123',
                    timestamp: '1633036800',
                    type: 'text',
                    text: {
                      body: 'Hello, are you there?',
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // Parse inbound message
    const inboundMessage = await whatsappAdapter.parseInbound(webhookPayload);
    expect(inboundMessage).not.toBeNull();

    if (!inboundMessage) {
      throw new Error('Expected inbound message to be non-null');
    }

    // Process message
    const result = await inboundProcessor.process(inboundMessage);

    // Assertions
    expect(result.success).toBe(true);
    expect(result.channelMessageId).toBe('sent_msg_123');

    // Verify contact was created
    expect(contactRepository.create).toHaveBeenCalledWith({
      projectId: 'test-project',
      name: 'Test User',
      phone: '5491132766709',
    });

    // Verify session was created
    expect(sessionRepository.create).toHaveBeenCalledWith({
      projectId: 'test-project',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      metadata: expect.objectContaining({
        channel: 'whatsapp',
      }),
    });

    // Verify agent was called
    expect(runAgent).toHaveBeenCalledWith({
      projectId: 'test-project',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      sessionId: expect.stringContaining('session_'),
      userMessage: 'Hello, are you there?',
    });

    // Verify response was sent
    expect(mockSend).toHaveBeenCalledWith({
      channel: 'whatsapp',
      recipientIdentifier: '5491132766709',
      content: 'Hello! I am an AI agent. How can I help you?',
      replyToChannelMessageId: 'msg_incoming_123',
    });
  });

  it('processes image message end-to-end', async () => {
    // Setup
    const logger = createMockLogger();
    const contactRepository = createMockContactRepository();
    const sessionRepository = createMockSessionRepository();

    const whatsappAdapter = createWhatsAppAdapter({
      accessToken: 'test-token-123',
      phoneNumberId: 'test-phone-id',
      projectId: defaultProjectId,
    });

    const channelResolver = {
      resolveAdapter: vi.fn(),
      resolveIntegration: vi.fn(),
      resolveProjectByIntegration: vi.fn(),
      resolveProjectByAccount: vi.fn(),
      send: vi.fn().mockResolvedValue({ success: true, channelMessageId: 'sent_msg_456' }),
      invalidate: vi.fn(),
    } as unknown as ChannelResolver;

    const runAgent = vi.fn().mockResolvedValue({
      response: 'I see you sent an image. How can I help with that?',
    });

    const inboundProcessor = createInboundProcessor({
      channelResolver,
      contactRepository,
      sessionRepository,
      logger,
      runAgent,
    });

    // Simulate webhook payload with image
    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: 'test-phone-id',
                },
                contacts: [
                  {
                    profile: { name: 'Image Sender' },
                    wa_id: '5491132766710',
                  },
                ],
                messages: [
                  {
                    from: '5491132766710',
                    id: 'msg_image_789',
                    timestamp: '1633036900',
                    type: 'image',
                    image: {
                      id: 'media_abc123',
                      mime_type: 'image/jpeg',
                      caption: 'What is this?',
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // Parse and process
    const inboundMessage = await whatsappAdapter.parseInbound(webhookPayload);
    expect(inboundMessage).not.toBeNull();
    expect(inboundMessage?.mediaUrls).toEqual(['media_abc123']);

    if (!inboundMessage) {
      throw new Error('Expected inbound message to be non-null');
    }

    const result = await inboundProcessor.process(inboundMessage);

    // Assertions
    expect(result.success).toBe(true);
    expect(runAgent).toHaveBeenCalledWith({
      projectId: 'test-project',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      sessionId: expect.stringContaining('session_'),
      userMessage: 'What is this?',
    });
  });

  it('reuses existing contact for subsequent messages', async () => {
    // Setup
    const logger = createMockLogger();
    const contactRepository = createMockContactRepository();
    const sessionRepository = createMockSessionRepository();

    const channelResolver = {
      resolveAdapter: vi.fn(),
      resolveIntegration: vi.fn(),
      resolveProjectByIntegration: vi.fn(),
      resolveProjectByAccount: vi.fn(),
      send: vi.fn().mockResolvedValue({ success: true }),
      invalidate: vi.fn(),
    } as unknown as ChannelResolver;

    const runAgent = vi.fn().mockResolvedValue({ response: 'Response' });

    const whatsappAdapter = createWhatsAppAdapter({
      accessToken: 'test-token-123',
      phoneNumberId: 'test-phone-id',
      projectId: defaultProjectId,
    });

    const inboundProcessor = createInboundProcessor({
      channelResolver,
      contactRepository,
      sessionRepository,
      logger,
      runAgent,
    });

    const createPayload = (messageId: string, text: string): Record<string, unknown> => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: 'test-phone-id',
                },
                contacts: [
                  {
                    profile: { name: 'Returning User' },
                    wa_id: '5491132766711',
                  },
                ],
                messages: [
                  {
                    from: '5491132766711',
                    id: messageId,
                    timestamp: '1633036800',
                    type: 'text',
                    text: { body: text },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    });

    // First message
    const msg1 = await whatsappAdapter.parseInbound(createPayload('msg_1', 'First message'));
    if (!msg1) {
      throw new Error('Expected first message to be non-null');
    }
    await inboundProcessor.process(msg1);

    // Second message
    const msg2 = await whatsappAdapter.parseInbound(createPayload('msg_2', 'Second message'));
    if (!msg2) {
      throw new Error('Expected second message to be non-null');
    }
    await inboundProcessor.process(msg2);

    // Contact should only be created once
    expect(contactRepository.create).toHaveBeenCalledTimes(1);
    expect(contactRepository.findByChannel).toHaveBeenCalledTimes(2);
  });

  it('handles agent errors gracefully', async () => {
    // Setup
    const logger = createMockLogger();
    const contactRepository = createMockContactRepository();
    const sessionRepository = createMockSessionRepository();

    const channelResolver = {
      resolveAdapter: vi.fn(),
      resolveIntegration: vi.fn(),
      resolveProjectByIntegration: vi.fn(),
      resolveProjectByAccount: vi.fn(),
      send: vi.fn().mockResolvedValue({ success: true }),
      invalidate: vi.fn(),
    } as unknown as ChannelResolver;

    // Mock agent failure
    const runAgent = vi.fn().mockRejectedValue(new Error('Agent processing failed'));

    const whatsappAdapter = createWhatsAppAdapter({
      accessToken: 'test-token-123',
      phoneNumberId: 'test-phone-id',
      projectId: defaultProjectId,
    });

    const inboundProcessor = createInboundProcessor({
      channelResolver,
      contactRepository,
      sessionRepository,
      logger,
      runAgent,
    });

    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: 'test-phone-id',
                },
                contacts: [
                  {
                    profile: { name: 'Error Test' },
                    wa_id: '5491132766712',
                  },
                ],
                messages: [
                  {
                    from: '5491132766712',
                    id: 'msg_error',
                    timestamp: '1633036800',
                    type: 'text',
                    text: { body: 'Trigger error' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const inboundMessage = await whatsappAdapter.parseInbound(webhookPayload);
    if (!inboundMessage) {
      throw new Error('Expected inbound message to be non-null');
    }
    const result = await inboundProcessor.process(inboundMessage);

    // Should fail gracefully
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to process message');
    expect(logger.error).toHaveBeenCalled();
  });
});
