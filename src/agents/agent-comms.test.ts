/**
 * Agent Communications Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentComms } from './agent-comms.js';
import type { AgentId, AgentMessage, AgentMessageId, AgentComms } from './types.js';

// ─── Mock Logger ─────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AgentComms', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let comms: AgentComms;

  beforeEach(() => {
    mockLogger = createMockLogger();
    comms = createAgentComms({
      logger: mockLogger as unknown as import('pino').Logger,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send a message and return message ID', async () => {
      const messageId = await comms.send({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'Hello, agent 2!',
      });

      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe('string');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId,
          from: 'agent-1',
          to: 'agent-2',
        }),
        'Agent message sent',
      );
    });

    it('should include context and replyToId in message', async () => {
      const messageId = await comms.send({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'Reply to your message',
        context: { key: 'value' },
        replyToId: 'original-msg-id' as AgentMessageId,
      });

      expect(messageId).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          hasReplyTo: true,
        }),
        'Agent message sent',
      );
    });
  });

  describe('subscribe', () => {
    it('should receive messages sent to subscribed agent', async () => {
      const receivedMessages: AgentMessage[] = [];
      const handler = (message: AgentMessage) => {
        receivedMessages.push(message);
      };

      // Subscribe agent-2 to messages
      const unsubscribe = comms.subscribe('agent-2' as AgentId, handler);

      // Send a message to agent-2
      await comms.send({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'Hello!',
      });

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].content).toBe('Hello!');
      expect(receivedMessages[0].fromAgentId).toBe('agent-1');
      expect(receivedMessages[0].toAgentId).toBe('agent-2');

      unsubscribe();
    });

    it('should not receive messages after unsubscribing', async () => {
      const receivedMessages: AgentMessage[] = [];
      const handler = (message: AgentMessage) => {
        receivedMessages.push(message);
      };

      const unsubscribe = comms.subscribe('agent-2' as AgentId, handler);

      // Unsubscribe
      unsubscribe();

      // Send a message
      await comms.send({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'Hello!',
      });

      expect(receivedMessages).toHaveLength(0);
    });

    it('should only receive messages for the subscribed agent', async () => {
      const agent2Messages: AgentMessage[] = [];
      const agent3Messages: AgentMessage[] = [];

      comms.subscribe('agent-2' as AgentId, (msg) => agent2Messages.push(msg));
      comms.subscribe('agent-3' as AgentId, (msg) => agent3Messages.push(msg));

      // Send to agent-2
      await comms.send({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'For agent 2',
      });

      // Send to agent-3
      await comms.send({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-3' as AgentId,
        content: 'For agent 3',
      });

      expect(agent2Messages).toHaveLength(1);
      expect(agent2Messages[0].content).toBe('For agent 2');

      expect(agent3Messages).toHaveLength(1);
      expect(agent3Messages[0].content).toBe('For agent 3');
    });
  });

  describe('sendAndWait', () => {
    it('should wait for and receive reply', async () => {
      // Set up agent-2 to reply to messages after a small delay
      // This ensures the reply listener is registered before the reply is sent
      comms.subscribe('agent-2' as AgentId, (message) => {
        // Use setImmediate to ensure reply is sent after listener is registered
        setImmediate(() => {
          void comms.send({
            fromAgentId: 'agent-2' as AgentId,
            toAgentId: message.fromAgentId,
            content: `Reply to: ${message.content}`,
            replyToId: message.id,
          });
        });
      });

      // Send and wait for reply with short timeout
      const reply = await comms.sendAndWait(
        {
          fromAgentId: 'agent-1' as AgentId,
          toAgentId: 'agent-2' as AgentId,
          content: 'Original message',
        },
        1000,
      );

      expect(reply).toBe('Reply to: Original message');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          originalMessageId: expect.any(String),
          replyMessageId: expect.any(String),
        }),
        'Agent received reply',
      );
    });

    it('should timeout if no reply received', async () => {
      vi.useFakeTimers();
      
      // Recreate comms with fake timers
      comms = createAgentComms({
        logger: mockLogger as unknown as import('pino').Logger,
      });

      // Start the promise and immediately attach a catch handler to prevent unhandled rejection
      const replyPromise = comms.sendAndWait(
        {
          fromAgentId: 'agent-1' as AgentId,
          toAgentId: 'agent-2' as AgentId,
          content: 'Will timeout',
        },
        1000,
      ).catch((e: Error) => e); // Catch and return error instead of rejecting

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(1500);

      const result = await replyPromise;
      
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Agent response timeout after 1000ms');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 1000,
        }),
        'Agent message timed out waiting for reply',
      );
      
      vi.useRealTimers();
    });

    it('should use default timeout value', async () => {
      vi.useFakeTimers();
      
      // Recreate comms with fake timers
      comms = createAgentComms({
        logger: mockLogger as unknown as import('pino').Logger,
      });

      // Start the promise and immediately attach a catch handler to prevent unhandled rejection
      const replyPromise = comms.sendAndWait({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'Default timeout',
      }).catch((e: Error) => e); // Catch and return error instead of rejecting

      // Advance past 30 seconds (default timeout)
      await vi.advanceTimersByTimeAsync(35000);

      const result = await replyPromise;
      
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Agent response timeout after 30000ms');
      
      vi.useRealTimers();
    });
  });
});
