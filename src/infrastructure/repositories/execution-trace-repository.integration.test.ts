/**
 * ExecutionTraceRepository integration tests.
 * Tests real Prisma operations against PostgreSQL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { nanoid } from 'nanoid';
import type {
  ProjectId,
  SessionId,
  TraceId,
  PromptSnapshot,
  TraceEvent,
} from '@/core/types.js';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createExecutionTraceRepository } from './execution-trace-repository.js';

/** Helper to create a valid PromptSnapshot for tests. */
function testPromptSnapshot(): PromptSnapshot {
  return {
    identityLayerId: nanoid(),
    identityVersion: 1,
    instructionsLayerId: nanoid(),
    instructionsVersion: 1,
    safetyLayerId: nanoid(),
    safetyVersion: 1,
    toolDocsHash: 'abc123',
    runtimeContextHash: 'def456',
  };
}

/** Helper to create a TraceEvent for tests. */
function testTraceEvent(traceId: TraceId, type = 'llm_request'): TraceEvent {
  return {
    id: nanoid(),
    traceId,
    type: type as TraceEvent['type'],
    timestamp: new Date(),
    data: { model: 'gpt-4o', prompt: 'test' },
  };
}

describe('ExecutionTraceRepository Integration', () => {
  let testDb: TestDatabase;
  let projectId: ProjectId;
  let sessionId: SessionId;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;

    // Create a session for traces
    const session = await testDb.prisma.session.create({
      data: {
        id: nanoid(),
        projectId,
        status: 'active',
      },
    });
    sessionId = session.id as SessionId;
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('create', () => {
    it('creates trace with initial state', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);
      const snapshot = testPromptSnapshot();

      const trace = await repo.create({ projectId, sessionId, promptSnapshot: snapshot });

      expect(trace.id).toBeDefined();
      expect(trace.projectId).toBe(projectId);
      expect(trace.sessionId).toBe(sessionId);
      expect(trace.status).toBe('running');
      expect(trace.events).toEqual([]);
      expect(trace.totalDurationMs).toBe(0);
      expect(trace.totalTokensUsed).toBe(0);
      expect(trace.totalCostUSD).toBe(0);
      expect(trace.turnCount).toBe(0);
    });

    it('persists PromptSnapshot as JSON and roundtrips correctly', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);
      const snapshot = testPromptSnapshot();

      const trace = await repo.create({ projectId, sessionId, promptSnapshot: snapshot });
      const found = await repo.findById(trace.id);

      expect(found?.promptSnapshot).toEqual(snapshot);
    });
  });

  describe('findById', () => {
    it('retrieves trace by ID', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const trace = await repo.create({
        projectId,
        sessionId,
        promptSnapshot: testPromptSnapshot(),
      });

      const found = await repo.findById(trace.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(trace.id);
    });

    it('returns null for non-existent ID', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const found = await repo.findById('non-existent' as TraceId);
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('updates subset of fields without affecting others', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const trace = await repo.create({
        projectId,
        sessionId,
        promptSnapshot: testPromptSnapshot(),
      });

      const updated = await repo.update(trace.id, {
        totalDurationMs: 1500,
        totalTokensUsed: 500,
        totalCostUsd: 0.015,
        turnCount: 3,
      });

      expect(updated).toBe(true);

      const found = await repo.findById(trace.id);
      expect(found?.totalDurationMs).toBe(1500);
      expect(found?.totalTokensUsed).toBe(500);
      expect(found?.totalCostUSD).toBeCloseTo(0.015);
      expect(found?.turnCount).toBe(3);
      // Status unchanged
      expect(found?.status).toBe('running');
    });

    it('updates status and completedAt', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const trace = await repo.create({
        projectId,
        sessionId,
        promptSnapshot: testPromptSnapshot(),
      });

      const completedAt = new Date();
      await repo.update(trace.id, {
        status: 'completed',
        completedAt,
      });

      const found = await repo.findById(trace.id);
      expect(found?.status).toBe('completed');
      expect(found?.completedAt).toEqual(completedAt);
    });

    it('returns false for non-existent trace', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const result = await repo.update('non-existent' as TraceId, {
        status: 'failed',
      });

      expect(result).toBe(false);
    });
  });

  describe('addEvents', () => {
    it('appends events to empty array', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const trace = await repo.create({
        projectId,
        sessionId,
        promptSnapshot: testPromptSnapshot(),
      });

      const event = testTraceEvent(trace.id);
      const result = await repo.addEvents(trace.id, [event]);

      expect(result).toBe(true);

      const found = await repo.findById(trace.id);
      expect(found?.events).toHaveLength(1);
      expect(found?.events[0]).toMatchObject({
        id: event.id,
        type: 'llm_request',
      });
    });

    it('appends multiple batches preserving order', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const trace = await repo.create({
        projectId,
        sessionId,
        promptSnapshot: testPromptSnapshot(),
      });

      // First batch
      await repo.addEvents(trace.id, [
        testTraceEvent(trace.id, 'llm_request'),
        testTraceEvent(trace.id, 'llm_response'),
      ]);

      // Second batch
      await repo.addEvents(trace.id, [
        testTraceEvent(trace.id, 'tool_call'),
        testTraceEvent(trace.id, 'tool_result'),
      ]);

      const found = await repo.findById(trace.id);
      expect(found?.events).toHaveLength(4);
    });

    it('returns false for non-existent trace', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const result = await repo.addEvents('non-existent' as TraceId, []);
      expect(result).toBe(false);
    });
  });

  describe('listBySession', () => {
    it('lists traces for a session newest first', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);
      const snapshot = testPromptSnapshot();

      await repo.create({ projectId, sessionId, promptSnapshot: snapshot });
      await repo.create({ projectId, sessionId, promptSnapshot: snapshot });
      await repo.create({ projectId, sessionId, promptSnapshot: snapshot });

      const traces = await repo.listBySession(sessionId);

      expect(traces).toHaveLength(3);
      // Newest first
      const first = traces[0];
      const second = traces[1];
      if (!first || !second) throw new Error('Expected at least 2 traces');
      expect(first.createdAt.getTime()).toBeGreaterThanOrEqual(second.createdAt.getTime());
    });

    it('returns empty for session with no traces', async () => {
      const repo = createExecutionTraceRepository(testDb.prisma);

      const traces = await repo.listBySession('no-traces' as SessionId);
      expect(traces).toEqual([]);
    });
  });
});
