import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId, PromptLayerId, PromptSnapshot, SessionId, TraceEvent, TraceId } from '@/core/types.js';
import { createExecutionTraceRepository } from './execution-trace-repository.js';

const PROJECT_ID = 'proj_test' as ProjectId;
const SESSION_ID = 'sess_test' as SessionId;
const PROMPT_SNAPSHOT: PromptSnapshot = {
  identityLayerId: 'pl-id-1' as PromptLayerId,
  identityVersion: 1,
  instructionsLayerId: 'pl-inst-1' as PromptLayerId,
  instructionsVersion: 1,
  safetyLayerId: 'pl-safe-1' as PromptLayerId,
  safetyVersion: 1,
  toolDocsHash: 'abc',
  runtimeContextHash: 'def',
};

const makeTraceRecord = (overrides?: Record<string, unknown>): Record<string, unknown> => {
  return {
    id: 'trace_abc',
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    promptSnapshot: PROMPT_SNAPSHOT,
    events: [],
    totalDurationMs: 0,
    totalTokensUsed: 0,
    totalCostUsd: 0,
    turnCount: 0,
    status: 'running',
    createdAt: new Date('2025-01-01'),
    completedAt: null,
    ...overrides,
  };
};

function makeTraceEvent(type = 'llm_request'): TraceEvent {
  return {
    id: 'evt_1',
    traceId: 'trace_abc' as TraceId,
    type: type as TraceEvent['type'],
    timestamp: new Date(),
    data: { model: 'claude-sonnet-4-5-20250929' },
  };
}

function createMockPrisma(): PrismaClient {
  return {
    executionTrace: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('ExecutionTraceRepository', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a trace with initial values', async () => {
      vi.mocked(mockPrisma.executionTrace.create).mockResolvedValue(makeTraceRecord() as never);

      const repo = createExecutionTraceRepository(mockPrisma);
      const trace = await repo.create({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        promptSnapshot: PROMPT_SNAPSHOT,
      });

      expect(trace.id).toBe('trace_abc');
      expect(trace.status).toBe('running');
      expect(trace.turnCount).toBe(0);
      expect(trace.events).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns trace when found', async () => {
      vi.mocked(mockPrisma.executionTrace.findUnique).mockResolvedValue(
        makeTraceRecord() as never,
      );

      const repo = createExecutionTraceRepository(mockPrisma);
      const trace = await repo.findById('trace_abc' as TraceId);

      expect(trace?.id).toBe('trace_abc');
    });

    it('returns null when not found', async () => {
      vi.mocked(mockPrisma.executionTrace.findUnique).mockResolvedValue(null as never);

      const repo = createExecutionTraceRepository(mockPrisma);
      expect(await repo.findById('nope' as TraceId)).toBeNull();
    });
  });

  describe('update', () => {
    it('updates trace fields', async () => {
      vi.mocked(mockPrisma.executionTrace.update).mockResolvedValue({} as never);

      const repo = createExecutionTraceRepository(mockPrisma);
      const result = await repo.update('trace_abc' as TraceId, {
        status: 'completed',
        totalDurationMs: 5000,
        totalTokensUsed: 1200,
        totalCostUsd: 0.05,
        turnCount: 3,
        completedAt: new Date(),
      });

      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      vi.mocked(mockPrisma.executionTrace.update).mockRejectedValue(new Error('Not found'));

      const repo = createExecutionTraceRepository(mockPrisma);
      expect(await repo.update('nope' as TraceId, { status: 'completed' })).toBe(false);
    });
  });

  describe('addEvents', () => {
    it('appends events to the existing array', async () => {
      const existingEvents = [makeTraceEvent('llm_request')];
      vi.mocked(mockPrisma.executionTrace.findUnique).mockResolvedValue(
        { events: existingEvents } as never,
      );
      vi.mocked(mockPrisma.executionTrace.update).mockResolvedValue({} as never);

      const repo = createExecutionTraceRepository(mockPrisma);
      const newEvent = makeTraceEvent('tool_call');
      const result = await repo.addEvents('trace_abc' as TraceId, [newEvent]);

      expect(result).toBe(true);
       
      expect(mockPrisma.executionTrace.update).toHaveBeenCalledWith({
        where: { id: 'trace_abc' },
        data: {
          events: expect.arrayContaining([
            expect.objectContaining({ type: 'llm_request' }) as unknown,
            expect.objectContaining({ type: 'tool_call' }) as unknown,
          ]) as unknown,
        },
      });
    });

    it('returns false when trace not found', async () => {
      vi.mocked(mockPrisma.executionTrace.findUnique).mockResolvedValue(null as never);

      const repo = createExecutionTraceRepository(mockPrisma);
      expect(await repo.addEvents('nope' as TraceId, [makeTraceEvent()])).toBe(false);
    });
  });

  describe('listBySession', () => {
    it('returns traces for a session', async () => {
      vi.mocked(mockPrisma.executionTrace.findMany).mockResolvedValue([
        makeTraceRecord(),
      ] as never);

      const repo = createExecutionTraceRepository(mockPrisma);
      const traces = await repo.listBySession(SESSION_ID);

      expect(traces).toHaveLength(1);
      expect(traces[0]?.sessionId).toBe(SESSION_ID);
    });
  });
});
