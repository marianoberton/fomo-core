/**
 * Tests for the Inbox routes.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { inboxRoutes } from './inbox.js';
import { registerErrorHandler } from '../error-handler.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

// ─── Mock Prisma ────────────────────────────────────────────────

function createMockPrisma() {
  return {
    session: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    contact: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    message: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    executionTrace: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

// ─── Test Data ──────────────────────────────────────────────────

const mockSessions = [
  {
    id: 'session-1',
    projectId: 'proj-1',
    status: 'active',
    metadata: { contactId: 'contact-1', channel: 'whatsapp', agentId: 'agent-1' },
    createdAt: new Date('2026-02-19T10:00:00Z'),
    updatedAt: new Date('2026-02-19T11:00:00Z'),
    _count: { messages: 5 },
  },
  {
    id: 'session-2',
    projectId: 'proj-1',
    status: 'closed',
    metadata: { contactId: 'contact-2', channel: 'telegram' },
    createdAt: new Date('2026-02-18T10:00:00Z'),
    updatedAt: new Date('2026-02-18T15:00:00Z'),
    _count: { messages: 12 },
  },
];

// ─── Server Setup ───────────────────────────────────────────────

let server: FastifyInstance;
let mockPrisma: ReturnType<typeof createMockPrisma>;

async function buildServer() {
  mockPrisma = createMockPrisma();
  const deps = createMockDeps();
  // Override prisma with our mock
  deps.prisma = mockPrisma as unknown as typeof deps.prisma;

  server = Fastify({ logger: false });
  registerErrorHandler(server);
  await server.register(
    async (prefixed) => {
      inboxRoutes(prefixed, deps);
    },
    { prefix: '/api/v1' },
  );
  await server.ready();
  return server;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('inbox routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    server = await buildServer();
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  describe('GET /projects/:projectId/inbox', () => {
    it('returns empty list when no sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { items: unknown[]; total: number } };
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('returns sessions with contact info and last message', async () => {
      mockPrisma.session.findMany.mockResolvedValue(mockSessions);
      mockPrisma.contact.findUnique
        .mockResolvedValueOnce({ name: 'John Doe', role: null })
        .mockResolvedValueOnce({ name: 'Jane Smith', role: 'owner' });
      mockPrisma.message.findFirst
        .mockResolvedValueOnce({ role: 'user', content: 'Hello', createdAt: new Date('2026-02-19T11:00:00Z') })
        .mockResolvedValueOnce({ role: 'assistant', content: 'Hi!', createdAt: new Date('2026-02-18T15:00:00Z') });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          items: { sessionId: string; contactName: string; channel: string; messageCount: number; lastMessage: { content: string } }[];
          total: number;
        };
      };
      expect(body.data.total).toBe(2);
      expect(body.data.items[0]?.sessionId).toBe('session-1');
      expect(body.data.items[0]?.contactName).toBe('John Doe');
      expect(body.data.items[0]?.channel).toBe('whatsapp');
      expect(body.data.items[0]?.messageCount).toBe(5);
      expect(body.data.items[0]?.lastMessage.content).toBe('Hello');
    });

    it('filters by channel', async () => {
      mockPrisma.session.findMany.mockResolvedValue(mockSessions);
      mockPrisma.contact.findUnique.mockResolvedValue({ name: 'Jane', role: null });
      mockPrisma.message.findFirst.mockResolvedValue({ role: 'user', content: 'test', createdAt: new Date() });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox?channel=telegram',
      });

      const body = response.json() as { data: { items: { channel: string }[]; total: number } };
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.channel).toBe('telegram');
    });

    it('filters by agentId', async () => {
      mockPrisma.session.findMany.mockResolvedValue(mockSessions);
      mockPrisma.contact.findUnique.mockResolvedValue({ name: 'John', role: null });
      mockPrisma.message.findFirst.mockResolvedValue({ role: 'user', content: 'test', createdAt: new Date() });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox?agentId=agent-1',
      });

      const body = response.json() as { data: { items: { agentId: string }[]; total: number } };
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.agentId).toBe('agent-1');
    });

    it('supports pagination', async () => {
      mockPrisma.session.findMany.mockResolvedValue(mockSessions);
      mockPrisma.contact.findUnique.mockResolvedValue({ name: 'Test', role: null });
      mockPrisma.message.findFirst.mockResolvedValue({ role: 'user', content: 'test', createdAt: new Date() });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox?limit=1&offset=1',
      });

      const body = response.json() as { data: { items: unknown[]; total: number; limit: number; offset: number } };
      expect(body.data.items).toHaveLength(1);
      expect(body.data.total).toBe(2);
      expect(body.data.offset).toBe(1);
    });
  });

  describe('GET /projects/:projectId/inbox/:sessionId', () => {
    it('returns 404 for nonexistent session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns session detail with messages and traces', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        projectId: 'proj-1',
        status: 'active',
        metadata: { contactId: 'contact-1', channel: 'whatsapp', agentId: 'agent-1' },
        createdAt: new Date('2026-02-19T10:00:00Z'),
        updatedAt: new Date('2026-02-19T11:00:00Z'),
        _count: { messages: 3 },
      });

      mockPrisma.contact.findUnique.mockResolvedValue({
        id: 'contact-1', name: 'John Doe', role: null, phone: '+1234567890', email: null,
      });

      mockPrisma.message.findMany.mockResolvedValue([
        { id: 'msg-1', role: 'user', content: 'Hello', toolCalls: null, createdAt: new Date('2026-02-19T10:00:00Z') },
        { id: 'msg-2', role: 'assistant', content: 'Hi!', toolCalls: null, createdAt: new Date('2026-02-19T10:00:05Z') },
      ]);

      mockPrisma.executionTrace.findMany.mockResolvedValue([
        {
          id: 'trace-1',
          createdAt: new Date('2026-02-19T10:00:00Z'),
          completedAt: new Date('2026-02-19T10:00:06Z'),
          totalTokensUsed: 500,
          totalCostUsd: 0.01,
        },
      ]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox/session-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          sessionId: string;
          contact: { id: string; name: string };
          messages: { id: string; role: string; content: string }[];
          traces: { id: string }[];
          channel: string;
          agentId: string;
        };
      };
      expect(body.data.sessionId).toBe('session-1');
      expect(body.data.contact.name).toBe('John Doe');
      expect(body.data.messages).toHaveLength(2);
      expect(body.data.traces).toHaveLength(1);
      expect(body.data.channel).toBe('whatsapp');
      expect(body.data.agentId).toBe('agent-1');
    });

    it('returns 404 when session belongs to different project', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        projectId: 'other-project',
        status: 'active',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { messages: 0 },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-1/inbox/session-1',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
