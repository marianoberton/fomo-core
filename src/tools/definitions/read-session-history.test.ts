/**
 * Tests for the read-session-history tool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createReadSessionHistoryTool } from './read-session-history.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { SessionRepository, Session, StoredMessage } from '@/infrastructure/repositories/session-repository.js';
import type { ProjectId, SessionId } from '@/core/types.js';

// ─── Mock Session Repository ────────────────────────────────────

function createMockSessionRepo(): { [K in keyof SessionRepository]: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByContactId: vi.fn(),
    updateStatus: vi.fn(),
    listByProject: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
  };
}

// ─── Test Data ──────────────────────────────────────────────────

const mockSession: Session = {
  id: 'session-1' as SessionId,
  projectId: 'test-project' as ProjectId,
  status: 'active',
  metadata: { contactId: 'contact-1', channel: 'whatsapp' },
  createdAt: new Date('2026-02-19T10:00:00Z'),
  updatedAt: new Date('2026-02-19T11:00:00Z'),
};

const mockMessages: StoredMessage[] = [
  {
    id: 'msg-1',
    sessionId: 'session-1' as SessionId,
    role: 'user',
    content: 'Hello, I need help',
    createdAt: new Date('2026-02-19T10:00:00Z'),
  },
  {
    id: 'msg-2',
    sessionId: 'session-1' as SessionId,
    role: 'assistant',
    content: 'Hi! How can I help you today?',
    createdAt: new Date('2026-02-19T10:00:05Z'),
  },
  {
    id: 'msg-3',
    sessionId: 'session-1' as SessionId,
    role: 'user',
    content: 'I want to check my order status',
    createdAt: new Date('2026-02-19T10:00:10Z'),
  },
];

// ─── Tests ──────────────────────────────────────────────────────

describe('read-session-history tool', () => {
  const context = createTestContext({ allowedTools: ['read-session-history'] });

  describe('schema validation', () => {
    it('accepts valid input', () => {
      const repo = createMockSessionRepo();
      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({ sessionId: 'session-1' });
      expect(result.success).toBe(true);
    });

    it('accepts sessionId + limit', () => {
      const repo = createMockSessionRepo();
      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({ sessionId: 'session-1', limit: 10 });
      expect(result.success).toBe(true);
    });

    it('rejects missing sessionId', () => {
      const repo = createMockSessionRepo();
      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects limit above 100', () => {
      const repo = createMockSessionRepo();
      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({ sessionId: 's', limit: 200 });
      expect(result.success).toBe(false);
    });
  });

  describe('dryRun', () => {
    it('returns expected shape', async () => {
      const repo = createMockSessionRepo();
      const tool = createReadSessionHistoryTool({ sessionRepository: repo });

      const result = await tool.dryRun({ sessionId: 'session-1' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { dryRun: boolean; description: string };
        expect(output.dryRun).toBe(true);
        expect(output.description).toContain('session-1');
      }
    });
  });

  describe('execute', () => {
    let repo: ReturnType<typeof createMockSessionRepo>;

    beforeEach(() => {
      repo = createMockSessionRepo();
    });

    it('returns session messages', async () => {
      repo.findById.mockResolvedValue(mockSession);
      repo.getMessages.mockResolvedValue(mockMessages);

      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const result = await tool.execute({ sessionId: 'session-1' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as {
          sessionId: string;
          status: string;
          contactId: string;
          channel: string;
          messages: { role: string; content: string }[];
          totalMessages: number;
        };
        expect(output.sessionId).toBe('session-1');
        expect(output.status).toBe('active');
        expect(output.contactId).toBe('contact-1');
        expect(output.channel).toBe('whatsapp');
        expect(output.messages).toHaveLength(3);
        expect(output.totalMessages).toBe(3);
        expect(output.messages[0]?.role).toBe('user');
        expect(output.messages[0]?.content).toBe('Hello, I need help');
      }
    });

    it('returns error when session not found', async () => {
      repo.findById.mockResolvedValue(null);

      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const result = await tool.execute({ sessionId: 'nonexistent' }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('returns error when session belongs to different project', async () => {
      repo.findById.mockResolvedValue({
        ...mockSession,
        projectId: 'other-project' as ProjectId,
      });

      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const result = await tool.execute({ sessionId: 'session-1' }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('does not belong');
      }
    });

    it('respects the limit parameter', async () => {
      repo.findById.mockResolvedValue(mockSession);
      repo.getMessages.mockResolvedValue(mockMessages);

      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const result = await tool.execute({ sessionId: 'session-1', limit: 2 }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as {
          messages: unknown[];
          totalMessages: number;
        };
        // Should return last 2 messages (most recent)
        expect(output.messages).toHaveLength(2);
        expect(output.totalMessages).toBe(3);
      }
    });

    it('handles empty message history', async () => {
      repo.findById.mockResolvedValue(mockSession);
      repo.getMessages.mockResolvedValue([]);

      const tool = createReadSessionHistoryTool({ sessionRepository: repo });
      const result = await tool.execute({ sessionId: 'session-1' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { messages: unknown[]; totalMessages: number };
        expect(output.messages).toEqual([]);
        expect(output.totalMessages).toBe(0);
      }
    });
  });
});
