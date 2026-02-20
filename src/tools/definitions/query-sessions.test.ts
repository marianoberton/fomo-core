/**
 * Tests for the query-sessions tool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createQuerySessionsTool } from './query-sessions.js';
import { createTestContext } from '@/testing/fixtures/context.js';

// ─── Mock Prisma ────────────────────────────────────────────────

function createMockPrisma() {
  return {
    session: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    contact: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    message: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

// ─── Test Data ──────────────────────────────────────────────────

const mockSessions = [
  {
    id: 'session-1',
    projectId: 'test-project',
    status: 'active',
    metadata: { contactId: 'contact-1', channel: 'whatsapp' },
    createdAt: new Date('2026-02-19T10:00:00Z'),
    updatedAt: new Date('2026-02-19T11:00:00Z'),
    _count: { messages: 5 },
  },
  {
    id: 'session-2',
    projectId: 'test-project',
    status: 'closed',
    metadata: { contactId: 'contact-2', channel: 'telegram' },
    createdAt: new Date('2026-02-18T10:00:00Z'),
    updatedAt: new Date('2026-02-18T15:00:00Z'),
    _count: { messages: 12 },
  },
];

// ─── Tests ──────────────────────────────────────────────────────

describe('query-sessions tool', () => {
  const context = createTestContext({ allowedTools: ['query-sessions'] });

  describe('schema validation', () => {
    it('accepts empty input (all optional)', () => {
      const tool = createQuerySessionsTool({ prisma: createMockPrisma() as never });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts all filters', () => {
      const tool = createQuerySessionsTool({ prisma: createMockPrisma() as never });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({
        contactId: 'contact-1',
        contactName: 'John',
        channel: 'whatsapp',
        status: 'active',
        limit: 10,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const tool = createQuerySessionsTool({ prisma: createMockPrisma() as never });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects limit above 50', () => {
      const tool = createQuerySessionsTool({ prisma: createMockPrisma() as never });
      const schema = tool.inputSchema as z.ZodType;
      const result = schema.safeParse({ limit: 100 });
      expect(result.success).toBe(false);
    });
  });

  describe('dryRun', () => {
    it('returns expected shape', async () => {
      const prisma = createMockPrisma();
      const tool = createQuerySessionsTool({ prisma: prisma as never });

      const result = await tool.dryRun({ channel: 'whatsapp' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as { dryRun: boolean; filters: { channel: string } };
        expect(output.dryRun).toBe(true);
        expect(output.filters.channel).toBe('whatsapp');
      }
    });
  });

  describe('execute', () => {
    let prisma: ReturnType<typeof createMockPrisma>;

    beforeEach(() => {
      prisma = createMockPrisma();
    });

    it('returns empty results when no sessions', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      const tool = createQuerySessionsTool({ prisma: prisma as never });

      const result = await tool.execute({}, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { sessions: unknown[]; total: number };
        expect(output.sessions).toEqual([]);
        expect(output.total).toBe(0);
      }
    });

    it('returns sessions with message count', async () => {
      prisma.session.findMany.mockResolvedValue(mockSessions);
      prisma.contact.findUnique
        .mockResolvedValueOnce({ name: 'John Doe' })
        .mockResolvedValueOnce({ name: 'Jane Smith' });
      prisma.message.findFirst
        .mockResolvedValueOnce({ createdAt: new Date('2026-02-19T11:00:00Z') })
        .mockResolvedValueOnce({ createdAt: new Date('2026-02-18T15:00:00Z') });

      const tool = createQuerySessionsTool({ prisma: prisma as never });
      const result = await tool.execute({}, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { sessions: { sessionId: string; contactName: string; messageCount: number }[]; total: number };
        expect(output.total).toBe(2);
        expect(output.sessions[0]?.sessionId).toBe('session-1');
        expect(output.sessions[0]?.contactName).toBe('John Doe');
        expect(output.sessions[0]?.messageCount).toBe(5);
      }
    });

    it('filters by channel', async () => {
      prisma.session.findMany.mockResolvedValue(mockSessions);
      prisma.contact.findUnique.mockResolvedValue({ name: 'John' });
      prisma.message.findFirst.mockResolvedValue({ createdAt: new Date() });

      const tool = createQuerySessionsTool({ prisma: prisma as never });
      const result = await tool.execute({ channel: 'telegram' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { sessions: { channel: string }[]; total: number };
        expect(output.total).toBe(1);
        expect(output.sessions[0]?.channel).toBe('telegram');
      }
    });

    it('filters by contactId', async () => {
      prisma.session.findMany.mockResolvedValue(mockSessions);
      prisma.contact.findUnique.mockResolvedValue({ name: 'Jane' });
      prisma.message.findFirst.mockResolvedValue({ createdAt: new Date() });

      const tool = createQuerySessionsTool({ prisma: prisma as never });
      const result = await tool.execute({ contactId: 'contact-2' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { sessions: { contactId: string }[]; total: number };
        expect(output.total).toBe(1);
        expect(output.sessions[0]?.contactId).toBe('contact-2');
      }
    });

    it('handles Prisma errors gracefully', async () => {
      prisma.session.findMany.mockRejectedValue(new Error('DB connection failed'));
      const tool = createQuerySessionsTool({ prisma: prisma as never });

      const result = await tool.execute({}, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('DB connection failed');
      }
    });
  });
});
