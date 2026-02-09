/**
 * Agent Communications Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentComms } from './agent-comms.js';
import type { AgentId, AgentMessage, AgentMessageId, AgentComms } from './types.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mock Logger ─────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AgentComms', () => {
  let mockLogger: Logger;
  let comms: AgentComms;

  beforeEach(() => {
    mockLogger = createMockLogger();
    comms = createAgentComms({ logger: mockLogger });
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
        'Agent message sent',
        expect.objectContaining({
          component: 'agent-comms',
          messageId,
          from: 'agent-1',
          to: 'agent-2',
        }),
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
        'Agent message sent',
        expect.objectContaining({
          component: 'agent-comms',
          hasReplyTo: true,
        }),
      );
    });
  });

  describe('subscribe', () => {
    it('should receive messages sent to subscribed agent', async () => {
      const receivedMessages: AgentMessage[] = [];
      const handler = (message: AgentMessage): void => {
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
      expect(receivedMessages[0]?.content).toBe('Hello!');
      expect(receivedMessages[0]?.fromAgentId).toBe('agent-1');
      expect(receivedMessages[0]?.toAgentId).toBe('agent-2');

      unsubscribe();
    });

    it('should not receive messages after unsubscribing', async () => {
      const receivedMessages: AgentMessage[] = [];
      const handler = (message: AgentMessage): void => {
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
      expect(agent2Messages[0]?.content).toBe('For agent 2');

      expect(agent3Messages).toHaveLength(1);
      expect(agent3Messages[0]?.content).toBe('For agent 3');
    });
  });

  describe('sendAndWait', () => {
    it('should wait for and receive reply', async () => {
      // Set up agent-2 to reply to messages after a small delay
      comms.subscribe('agent-2' as AgentId, (message) => {
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
        'Agent received reply',
        expect.objectContaining({
          component: 'agent-comms',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          originalMessageId: expect.any(String),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          replyMessageId: expect.any(String),
        }),
      );
    });

    it('should timeout if no reply received', async () => {
      vi.useFakeTimers();

      // Recreate comms with fake timers
      comms = createAgentComms({ logger: mockLogger });

      const replyPromise = comms.sendAndWait(
        {
          fromAgentId: 'agent-1' as AgentId,
          toAgentId: 'agent-2' as AgentId,
          content: 'Will timeout',
        },
        1000,
      ).catch((e: unknown) => e);

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(1500);

      const result = await replyPromise;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Agent response timeout after 1000ms');
       
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Agent message timed out waiting for reply',
        expect.objectContaining({
          component: 'agent-comms',
          timeoutMs: 1000,
        }),
      );

      vi.useRealTimers();
    });

    it('should use default timeout value', async () => {
      vi.useFakeTimers();

      // Recreate comms with fake timers
      comms = createAgentComms({ logger: mockLogger });

      const replyPromise = comms.sendAndWait({
        fromAgentId: 'agent-1' as AgentId,
        toAgentId: 'agent-2' as AgentId,
        content: 'Default timeout',
      }).catch((e: unknown) => e);

      // Advance past 30 seconds (default timeout)
      await vi.advanceTimersByTimeAsync(35000);

      const result = await replyPromise;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Agent response timeout after 30000ms');

      vi.useRealTimers();
    });
  });
});
