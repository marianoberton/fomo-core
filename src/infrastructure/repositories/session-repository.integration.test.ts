/**
 * SessionRepository integration tests.
 * Tests real Prisma operations against PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { ProjectId, SessionId } from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createSessionRepository } from './session-repository.js';

describe('SessionRepository Integration', () => {
  let testDb: TestDatabase;
  let projectId: ProjectId;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('create', () => {
    it('creates session with default status active', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });

      expect(session.id).toBeDefined();
      expect(session.projectId).toBe(projectId);
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    it('creates session with metadata JSON', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const metadata = { source: 'telegram', channelId: 'ch-123', nested: { deep: true } };
      const session = await repo.create({ projectId, metadata });

      expect(session.metadata).toEqual(metadata);

      // Verify roundtrip via findById
      const found = await repo.findById(session.id);
      expect(found?.metadata).toEqual(metadata);
    });

    it('creates session with expiresAt', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const expiresAt = new Date(Date.now() + 3600_000);
      const session = await repo.create({ projectId, expiresAt });

      expect(session.expiresAt).toEqual(expiresAt);
    });
  });

  describe('findById', () => {
    it('retrieves session by ID', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      const found = await repo.findById(session.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(session.id);
      expect(found?.projectId).toBe(projectId);
    });

    it('returns null for non-existent ID', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const found = await repo.findById('non-existent' as SessionId);
      expect(found).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates session status', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      const result = await repo.updateStatus(session.id, 'completed');

      expect(result).toBe(true);

      const found = await repo.findById(session.id);
      expect(found?.status).toBe('completed');
    });

    it('returns false for non-existent session', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const result = await repo.updateStatus('non-existent' as SessionId, 'completed');
      expect(result).toBe(false);
    });
  });

  describe('listByProject', () => {
    it('lists sessions for a project', async () => {
      const repo = createSessionRepository(testDb.prisma);

      await repo.create({ projectId });
      await repo.create({ projectId });
      await repo.create({ projectId });

      const sessions = await repo.listByProject(projectId);

      expect(sessions).toHaveLength(3);
      sessions.forEach((s) => {
        expect(s.projectId).toBe(projectId);
      });
    });

    it('filters by status', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const s1 = await repo.create({ projectId });
      await repo.create({ projectId });
      await repo.updateStatus(s1.id, 'completed');

      const active = await repo.listByProject(projectId, 'active');
      expect(active).toHaveLength(1);

      const completed = await repo.listByProject(projectId, 'completed');
      expect(completed).toHaveLength(1);
    });

    it('returns sessions ordered by createdAt desc', async () => {
      const repo = createSessionRepository(testDb.prisma);

      await repo.create({ projectId });
      await repo.create({ projectId });

      const sessions = await repo.listByProject(projectId);
      const first = sessions[0];
      const second = sessions[1];
      if (!first || !second) throw new Error('Expected at least 2 sessions');
      expect(first.createdAt.getTime()).toBeGreaterThanOrEqual(second.createdAt.getTime());
    });

    it('returns empty array for project with no sessions', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const sessions = await repo.listByProject(projectId);
      expect(sessions).toEqual([]);
    });
  });

  describe('addMessage', () => {
    it('adds message to session', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      const msg = await repo.addMessage(session.id, {
        role: 'user',
        content: 'Hello world',
      });

      expect(msg.id).toBeDefined();
      expect(msg.sessionId).toBe(session.id);
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello world');
      expect(msg.createdAt).toBeInstanceOf(Date);
    });

    it('stores toolCalls and usage as JSON', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      const toolCalls = [{ id: 'tc-1', name: 'calculator', input: { expression: '2+2' } }];
      const usage = { inputTokens: 100, outputTokens: 50 };

      const msg = await repo.addMessage(session.id, {
        role: 'assistant',
        content: 'The answer is 4',
        toolCalls,
        usage,
      });

      expect(msg.toolCalls).toEqual(toolCalls);
      expect(msg.usage).toEqual(usage);
    });

    it('stores traceId when provided', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      const msg = await repo.addMessage(
        session.id,
        { role: 'user', content: 'test' },
        'trace-123',
      );

      expect(msg.traceId).toBe('trace-123');
    });
  });

  describe('getMessages', () => {
    it('retrieves messages in chronological order', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      await repo.addMessage(session.id, { role: 'user', content: 'First' });
      await repo.addMessage(session.id, { role: 'assistant', content: 'Second' });
      await repo.addMessage(session.id, { role: 'user', content: 'Third' });

      const messages = await repo.getMessages(session.id);

      expect(messages).toHaveLength(3);
      expect(messages[0]?.content).toBe('First');
      expect(messages[1]?.content).toBe('Second');
      expect(messages[2]?.content).toBe('Third');
    });

    it('returns empty array for session with no messages', async () => {
      const repo = createSessionRepository(testDb.prisma);

      const session = await repo.create({ projectId });
      const messages = await repo.getMessages(session.id);

      expect(messages).toEqual([]);
    });
  });
});
