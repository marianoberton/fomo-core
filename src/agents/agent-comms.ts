/**
 * Agent Communications — inter-agent messaging system.
 *
 * Provides a pub/sub mechanism for agents to communicate with each other.
 * Uses EventEmitter for in-process communication. Can be extended to use
 * Redis pub/sub for distributed deployments.
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Logger } from 'pino';
import type { AgentId, AgentMessage, AgentMessageId, AgentComms } from './types.js';

// ─── Pending Reply Tracking ──────────────────────────────────────

interface PendingReply {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

// ─── Comms Dependencies ──────────────────────────────────────────

interface CommsDeps {
  logger: Logger;
}

// ─── Factory Function ────────────────────────────────────────────

/**
 * Create an inter-agent communication system.
 */
export function createAgentComms(deps: CommsDeps): AgentComms {
  const emitter = new EventEmitter();
  const pendingReplies = new Map<string, PendingReply>();

  // Set a higher limit for event listeners (one per agent subscription)
  emitter.setMaxListeners(100);

  const comms: AgentComms = {
    async send(message): Promise<AgentMessageId> {
      const id = randomUUID() as AgentMessageId;
      const fullMessage: AgentMessage = {
        ...message,
        id,
        createdAt: new Date(),
      };

      deps.logger.info(
        {
          messageId: id,
          from: message.fromAgentId,
          to: message.toAgentId,
          hasReplyTo: !!message.replyToId,
        },
        'Agent message sent',
      );

      // Emit to the target agent's channel
      emitter.emit(`agent:${message.toAgentId}`, fullMessage);

      return id;
    },

    async sendAndWait(message, timeoutMs = 30000): Promise<string> {
      const id = await comms.send(message);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingReplies.delete(id);
          deps.logger.warn(
            { messageId: id, timeoutMs },
            'Agent message timed out waiting for reply',
          );
          reject(new Error(`Agent response timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingReplies.set(id, { resolve, reject, timeoutId });

        // Listen for reply on the sender's channel
        const handler = (reply: AgentMessage) => {
          if (reply.replyToId === id) {
            const pending = pendingReplies.get(id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingReplies.delete(id);
              deps.logger.debug(
                { originalMessageId: id, replyMessageId: reply.id },
                'Agent received reply',
              );
              pending.resolve(reply.content);
            }
            emitter.off(`agent:${message.fromAgentId}`, handler);
          }
        };

        emitter.on(`agent:${message.fromAgentId}`, handler);
      });
    },

    subscribe(agentId: AgentId, handler: (message: AgentMessage) => void): () => void {
      const eventName = `agent:${agentId}`;

      deps.logger.debug({ agentId }, 'Agent subscribed to messages');
      emitter.on(eventName, handler);

      // Return unsubscribe function
      return () => {
        deps.logger.debug({ agentId }, 'Agent unsubscribed from messages');
        emitter.off(eventName, handler);
      };
    },
  };

  return comms;
}
