import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId, SessionId } from '@/core/types.js';
import { createSessionRepository } from './session-repository.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function makeSessionRecord(overrides?: Record<string, unknown>) {
  return {
    id: 'sess_abc',
    projectId: PROJECT_ID,
    status: 'active',
    metadata: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    expiresAt: null,
    ...overrides,
  };
}

function makeMessageRecord(overrides?: Record<string, unknown>) {
  return {
    id: 'msg_abc',
    sessionId: 'sess_abc',
    role: 'user',
    content: 'Hello',
    toolCalls: null,
    usage: null,
    traceId: null,
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    message: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('SessionRepository', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a session', async () => {
      vi.mocked(mockPrisma.session.create).mockResolvedValue(makeSessionRecord() as never);

      const repo = createSessionRepository(mockPrisma);
      const session = await repo.create({ projectId: PROJECT_ID });

      expect(session.id).toBe('sess_abc');
      expect(session.projectId).toBe(PROJECT_ID);
      expect(session.status).toBe('active');
    });
  });

  describe('findById', () => {
    it('returns session when found', async () => {
      vi.mocked(mockPrisma.session.findUnique).mockResolvedValue(makeSessionRecord() as never);

      const repo = createSessionRepository(mockPrisma);
      const session = await repo.findById('sess_abc' as SessionId);

      expect(session?.id).toBe('sess_abc');
    });

    it('returns null when not found', async () => {
      vi.mocked(mockPrisma.session.findUnique).mockResolvedValue(null as never);

      const repo = createSessionRepository(mockPrisma);
      expect(await repo.findById('nope' as SessionId)).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('returns true on success', async () => {
      vi.mocked(mockPrisma.session.update).mockResolvedValue({} as never);

      const repo = createSessionRepository(mockPrisma);
      expect(await repo.updateStatus('sess_abc' as SessionId, 'completed')).toBe(true);
    });

    it('returns false on error', async () => {
      vi.mocked(mockPrisma.session.update).mockRejectedValue(new Error('Not found'));

      const repo = createSessionRepository(mockPrisma);
      expect(await repo.updateStatus('nope' as SessionId, 'completed')).toBe(false);
    });
  });

  describe('listByProject', () => {
    it('returns sessions for a project', async () => {
      vi.mocked(mockPrisma.session.findMany).mockResolvedValue([makeSessionRecord()] as never);

      const repo = createSessionRepository(mockPrisma);
      const sessions = await repo.listByProject(PROJECT_ID);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.projectId).toBe(PROJECT_ID);
    });

    it('filters by status', async () => {
      vi.mocked(mockPrisma.session.findMany).mockResolvedValue([] as never);

      const repo = createSessionRepository(mockPrisma);
      await repo.listByProject(PROJECT_ID, 'active');

      expect(mockPrisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: PROJECT_ID, status: 'active' }) as unknown,
        }),
      );
    });
  });

  describe('addMessage', () => {
    it('creates a message record', async () => {
      vi.mocked(mockPrisma.message.create).mockResolvedValue(makeMessageRecord() as never);

      const repo = createSessionRepository(mockPrisma);
      const msg = await repo.addMessage('sess_abc' as SessionId, {
        role: 'user',
        content: 'Hello',
      });

      expect(msg.id).toBe('msg_abc');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
    });
  });

  describe('getMessages', () => {
    it('returns messages in chronological order', async () => {
      vi.mocked(mockPrisma.message.findMany).mockResolvedValue([
        makeMessageRecord({ id: 'msg_1', role: 'user', content: 'Hi' }),
        makeMessageRecord({ id: 'msg_2', role: 'assistant', content: 'Hello' }),
      ] as never);

      const repo = createSessionRepository(mockPrisma);
      const messages = await repo.getMessages('sess_abc' as SessionId);

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('user');
      expect(messages[1]?.role).toBe('assistant');
    });
  });
});
